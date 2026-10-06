/**
 * `POST /ai/chat`, as a function of a Request and its dependencies, so tests can call
 * it without SvelteKit or a network. `routes/ai/chat/+server.ts` wires the real ones.
 *
 * The server owns the system prompt and the tools. The browser sends only the
 * conversation, and this checks its shape and size before anything reaches a provider.
 */
import { z } from 'zod';
import type { ChatMessage, StreamEvent } from '$lib/agent/protocol';
import type { ToolDefinition } from '$lib/agent/server-prompt';
import { resolveOwner } from '../versions/owner';
import { isConfigured, type AiConfig } from './config';
import type { AiLimits } from './limits';
import type { ChatParams } from './provider';

export const MAX_MESSAGES = 200;
export const MAX_TOTAL_CHARS = 400_000;
export const MAX_TOOL_CONTENT = 100_000;
const MAX_BODY_BYTES = 2_000_000;

const toolCall = z.object({
	id: z.string().min(1).max(200),
	name: z.string().min(1).max(200),
	arguments: z.string()
});

const message = z.discriminatedUnion('role', [
	z.object({ role: z.literal('user'), content: z.string() }),
	z.object({
		role: z.literal('assistant'),
		text: z.string(),
		toolCalls: z.array(toolCall).max(64),
		reasoning: z.unknown().optional()
	}),
	z.object({
		role: z.literal('tool'),
		toolCallId: z.string().min(1).max(200),
		content: z.string().max(MAX_TOOL_CONTENT)
	}),
	z.object({ role: z.literal('notice'), content: z.string() })
]);

const body = z.object({ messages: z.array(message).min(1).max(MAX_MESSAGES) });

export type ChatDeps = {
	config: AiConfig;
	limits: AiLimits;
	system: string;
	tools: readonly ToolDefinition[];
	stream: (params: ChatParams) => AsyncIterable<StreamEvent>;
};

function refuse(status: number, message: string, code: string, headers?: HeadersInit): Response {
	return new Response(JSON.stringify({ message, code }), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }
	});
}

function size(m: ChatMessage): number {
	switch (m.role) {
		case 'assistant':
			return (
				m.text.length +
				m.toolCalls.reduce((n, c) => n + c.name.length + c.arguments.length, 0) +
				(m.reasoning === undefined ? 0 : (JSON.stringify(m.reasoning)?.length ?? 0))
			);
		default:
			return m.content.length;
	}
}

/** What is wrong with a well-formed conversation, in Czech, or null. */
export function conversationProblem(
	messages: readonly ChatMessage[],
	tools: readonly ToolDefinition[]
): string | null {
	if (messages.reduce((n, m) => n + size(m), 0) > MAX_TOTAL_CHARS)
		return 'Konverzace je příliš dlouhá. Začni novou.';
	const known = new Set(tools.map((t) => t.name));
	const asked = new Set<string>();
	for (const m of messages) {
		if (m.role === 'assistant') {
			for (const c of m.toolCalls) {
				if (!known.has(c.name)) return `Neznámý nástroj „${c.name}“.`;
				asked.add(c.id);
			}
		} else if (m.role === 'tool' && !asked.has(m.toolCallId)) {
			return 'Výsledek nástroje nepatří k žádnému volání.';
		}
	}
	if (messages[messages.length - 1].role === 'assistant')
		return 'Konverzace nesmí končit odpovědí asistenta.';
	return null;
}

export async function handleChat(request: Request, deps: ChatDeps): Promise<Response> {
	const { config } = deps;
	if (!isConfigured(config)) return refuse(503, 'AI není nastavena.', 'not_configured');

	const owner = resolveOwner(request);
	if (owner === null) return refuse(401, 'Chybí klíč pracovního prostoru.', 'auth');

	if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES)
		return refuse(413, 'Konverzace je příliš dlouhá. Začni novou.', 'context_length');
	const raw = await request.text();
	if (raw.length > MAX_BODY_BYTES)
		return refuse(413, 'Konverzace je příliš dlouhá. Začni novou.', 'context_length');
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return refuse(400, 'Tělo požadavku není JSON.', 'bad_request');
	}
	const parsed = body.safeParse(json);
	if (!parsed.success) return refuse(400, 'Požadavek nemá správný tvar.', 'bad_request');
	const messages = parsed.data.messages as ChatMessage[];
	const problem = conversationProblem(messages, deps.tools);
	if (problem !== null) return refuse(400, problem, 'bad_request');

	const verdict = deps.limits.check(owner.id);
	if (!verdict.ok) {
		const retry = { 'retry-after': String(verdict.retryAfterSeconds) };
		return verdict.reason === 'rate'
			? refuse(429, 'Posíláš to moc rychle, chvíli počkej.', 'rate_limit', retry)
			: refuse(429, 'Denní limit AI je vyčerpán. Zkus to zítra.', 'budget', retry);
	}

	const abort = new AbortController();
	request.signal.addEventListener('abort', () => abort.abort(), { once: true });
	const events = deps
		.stream({
			system: deps.system,
			tools: deps.tools,
			messages,
			signal: abort.signal
		})
		[Symbol.asyncIterator]();
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await events.next();
				if (next.done) return controller.close();
				const event = next.value;
				if (event.type === 'done') deps.limits.record(owner.id, event.usage.totalTokens);
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				if (event.type === 'done' || event.type === 'error') controller.close();
			} catch {
				const failed: StreamEvent = {
					type: 'error',
					message: 'AI selhala, zkus to znovu.',
					code: 'unknown'
				};
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(failed)}\n\n`));
				controller.close();
			}
		},
		cancel() {
			abort.abort();
			void events.return?.();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-store',
			'x-accel-buffering': 'no'
		}
	});
}
