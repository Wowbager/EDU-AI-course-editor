/**
 * The adapter between the editor's neutral chat protocol and an OpenAI-compatible
 * provider (OpenRouter, or DeepSeek directly), using the `openai` SDK.
 *
 * Provider-specific request fields (`thinking`, `reasoning`, `provider`) are not in the
 * SDK's types. The SDK serialises the body object as given, so they are added to it and
 * the object is cast once, in `buildRequest`. Reasoning comes back in non-standard delta
 * fields (`reasoning_content`, `reasoning`, `reasoning_details`), read through `Extras`.
 */
import OpenAI from 'openai';
import {
	APIConnectionError,
	APIConnectionTimeoutError,
	APIError,
	APIUserAbortError,
	AuthenticationError,
	BadRequestError,
	InternalServerError,
	PermissionDeniedError,
	RateLimitError
} from 'openai/error';
import type {
	ChatCompletionChunk,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam
} from 'openai/resources/chat/completions';
import type {
	AssistantMessage,
	ChatMessage,
	ErrorCode,
	FinishReason,
	StreamEvent,
	ToolCall,
	Usage
} from '$lib/agent/protocol';
import type { ToolDefinition } from '$lib/agent/server-prompt';
import type { AiConfig, Provider } from './config';

export type ChatParams = {
	system: string;
	tools: readonly ToolDefinition[];
	messages: readonly ChatMessage[];
	signal?: AbortSignal;
};

/** The part of the SDK client the adapter uses; tests supply a fake. */
export type ChatClient = {
	chat: {
		completions: {
			create(
				body: ChatCompletionCreateParamsStreaming,
				options?: { signal?: AbortSignal }
			): PromiseLike<AsyncIterable<ChatCompletionChunk>>;
		};
	};
};

export function createClient(config: AiConfig): OpenAI {
	return new OpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseURL,
		maxRetries: 1,
		timeout: 120_000,
		defaultHeaders:
			config.provider === 'openrouter'
				? { 'HTTP-Referer': 'https://edu-ai.eu', 'X-Title': 'EDU-AI course editor' }
				: undefined
	});
}

// ── Messages: neutral → provider ────────────────────────────────────────────────────

/** Fields a provider adds to an assistant message and wants back unchanged. */
type AssistantExtras = { reasoning_content?: string; reasoning_details?: unknown[] };

export function toProviderMessages(
	provider: Provider,
	system: string,
	messages: readonly ChatMessage[]
): ChatCompletionMessageParam[] {
	const out: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
	for (const m of messages) {
		switch (m.role) {
			case 'user':
				out.push({ role: 'user', content: m.content });
				break;
			case 'notice':
				out.push({ role: 'system', content: m.content });
				break;
			case 'tool':
				out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
				break;
			case 'assistant': {
				const msg: ChatCompletionMessageParam & AssistantExtras = {
					role: 'assistant',
					content: m.text === '' ? null : m.text
				};
				if (m.toolCalls.length > 0) {
					msg.tool_calls = m.toolCalls.map((c) => ({
						id: c.id,
						type: 'function' as const,
						function: { name: c.name, arguments: c.arguments }
					}));
				}
				// Passed back verbatim, on every later turn.
				if (provider === 'deepseek' && typeof m.reasoning === 'string' && m.reasoning !== '') {
					msg.reasoning_content = m.reasoning;
				}
				if (provider === 'openrouter' && Array.isArray(m.reasoning) && m.reasoning.length > 0) {
					msg.reasoning_details = m.reasoning;
				}
				out.push(msg);
				break;
			}
		}
	}
	return out;
}

/** DeepSeek knows two effort levels; map the wider OpenRouter scale onto them. */
function deepseekEffort(effort: AiConfig['reasoningEffort']): 'high' | 'max' {
	return effort === 'xhigh' || effort === 'max' ? 'max' : 'high';
}

export function buildRequest(
	config: AiConfig,
	params: ChatParams
): ChatCompletionCreateParamsStreaming {
	const body: Record<string, unknown> = {
		model: config.model,
		stream: true,
		stream_options: { include_usage: true },
		messages: toProviderMessages(config.provider, params.system, params.messages)
	};
	if (params.tools.length > 0) {
		// Order as given: a stable prefix lets the provider cache the prompt.
		body.tools = params.tools.map((t) => ({
			type: 'function',
			function: {
				name: t.name,
				description: t.description,
				parameters: t.parameters,
				// DeepSeek's strict mode lives on a beta endpoint; OpenRouter passes it on.
				...(config.provider === 'openrouter' && t.strict !== undefined ? { strict: t.strict } : {})
			}
		}));
	}
	if (config.provider === 'deepseek') {
		if (config.reasoningEffort === 'none') {
			body.thinking = { type: 'disabled' };
		} else {
			body.thinking = { type: 'enabled' };
			body.reasoning_effort = deepseekEffort(config.reasoningEffort);
		}
	} else {
		body.reasoning = { effort: config.reasoningEffort };
		// Only hosts that support tools and the parameters above, and none that train on it.
		body.provider = { require_parameters: true, data_collection: 'deny' };
	}
	return body as unknown as ChatCompletionCreateParamsStreaming;
}

// ── Stream: provider → neutral ──────────────────────────────────────────────────────

/** Delta fields outside the SDK's types. */
type Extras = {
	reasoning_content?: string | null;
	reasoning?: string | null;
	reasoning_details?: Record<string, unknown>[] | null;
};

/**
 * Merge streamed `reasoning_details` fragments. A block arrives in pieces that share
 * a `type` and `index` (or `id`): text pieces are joined, any other field is replaced
 * by the latest value (signatures, encrypted data, format).
 */
function mergeDetails(
	blocks: Record<string, unknown>[],
	fragments: Record<string, unknown>[]
): void {
	for (const f of fragments) {
		const key = (b: Record<string, unknown>) => `${b.type}|${b.index ?? b.id ?? ''}`;
		const same = blocks.find((b) => key(b) === key(f));
		if (!same) {
			blocks.push({ ...f });
			continue;
		}
		for (const [k, v] of Object.entries(f)) {
			if ((k === 'text' || k === 'summary') && typeof v === 'string' && typeof same[k] === 'string')
				same[k] = (same[k] as string) + v;
			else same[k] = v;
		}
	}
}

function finishOf(raw: string | null, hasToolCalls: boolean): FinishReason {
	if (raw === 'length') return 'length';
	if (raw === 'tool_calls' || raw === 'function_call') return 'tool_calls';
	if (raw === 'stop' || raw === null) return hasToolCalls ? 'tool_calls' : 'stop';
	// content_filter, insufficient_system_resource, error …
	return 'error';
}

export async function* assembleStream(
	provider: Provider,
	chunks: AsyncIterable<ChatCompletionChunk>
): AsyncGenerator<StreamEvent> {
	let text = '';
	let reasoningText = '';
	const details: Record<string, unknown>[] = [];
	const calls = new Map<number, { id: string; name: string; arguments: string }>();
	let finish: string | null | undefined;
	let usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

	for await (const chunk of chunks) {
		if (chunk.usage) {
			usage = {
				promptTokens: chunk.usage.prompt_tokens ?? 0,
				completionTokens: chunk.usage.completion_tokens ?? 0,
				totalTokens: chunk.usage.total_tokens ?? 0
			};
			const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
			if (typeof cached === 'number') usage.cachedTokens = cached;
			// DeepSeek reports its own cache counters.
			const hit = (chunk.usage as { prompt_cache_hit_tokens?: number }).prompt_cache_hit_tokens;
			if (typeof hit === 'number') usage.cachedTokens = hit;
		}
		const choice = chunk.choices?.[0];
		if (!choice) continue;
		if (choice.finish_reason) finish = choice.finish_reason;
		const delta = choice.delta as typeof choice.delta & Extras;
		if (!delta) continue;

		if (typeof delta.content === 'string' && delta.content !== '') {
			text += delta.content;
			yield { type: 'text_delta', text: delta.content };
		}

		let shown = '';
		if (typeof delta.reasoning_content === 'string') shown = delta.reasoning_content;
		else if (typeof delta.reasoning === 'string') shown = delta.reasoning;
		if (Array.isArray(delta.reasoning_details)) {
			mergeDetails(details, delta.reasoning_details);
			if (shown === '') {
				for (const d of delta.reasoning_details) if (typeof d.text === 'string') shown += d.text;
			}
		}
		if (shown !== '') {
			reasoningText += shown;
			yield { type: 'reasoning_delta', text: shown };
		}

		for (const t of delta.tool_calls ?? []) {
			const call = calls.get(t.index) ?? { id: '', name: '', arguments: '' };
			if (t.id) call.id = t.id;
			if (t.function?.name) call.name += t.function.name;
			if (t.function?.arguments) call.arguments += t.function.arguments;
			calls.set(t.index, call);
		}
	}

	const toolCalls: ToolCall[] = [...calls.entries()]
		.sort(([a], [b]) => a - b)
		.map(([index, c]) => ({
			id: c.id || `call_${index}`,
			name: c.name,
			// Passed on as received, valid JSON or not: the browser validates.
			arguments: c.arguments === '' ? '{}' : c.arguments
		}));
	for (const c of toolCalls) yield { type: 'tool_call', ...c };

	if (finish === undefined) {
		yield {
			type: 'error',
			message: 'Spojení s AI se přerušilo dřív, než odpověď skončila. Zkus to znovu.',
			code: 'network'
		};
		return;
	}

	let reasoning: unknown;
	if (provider === 'openrouter') reasoning = details.length > 0 ? details : undefined;
	else reasoning = reasoningText === '' ? undefined : reasoningText;
	const assistant: AssistantMessage = { role: 'assistant', text, toolCalls };
	if (reasoning !== undefined) assistant.reasoning = reasoning;
	yield {
		type: 'done',
		finishReason: finishOf(finish, toolCalls.length > 0),
		assistant,
		usage
	};
}

// ── Errors ──────────────────────────────────────────────────────────────────────────

export function describeError(e: unknown): { message: string; code: ErrorCode } | null {
	if (e instanceof APIUserAbortError) return null;
	if (e instanceof APIConnectionTimeoutError)
		return { message: 'AI neodpověděla včas. Zkus to znovu.', code: 'timeout' };
	if (e instanceof APIConnectionError)
		return {
			message: 'Nepodařilo se spojit s AI. Zkontroluj připojení a zkus to znovu.',
			code: 'network'
		};
	if (e instanceof AuthenticationError || e instanceof PermissionDeniedError)
		return { message: 'AI není správně nastavena. Řekni to správci editoru.', code: 'auth' };
	if (e instanceof RateLimitError)
		return { message: 'AI je přetížená, zkus to za chvíli.', code: 'rate_limit' };
	if (e instanceof InternalServerError)
		return { message: 'AI je dočasně nedostupná, zkus to za chvíli.', code: 'unavailable' };
	if (e instanceof BadRequestError) {
		const detail = `${e.code ?? ''} ${e.message}`.toLowerCase();
		if (detail.includes('context') || detail.includes('too long') || detail.includes('maximum'))
			return {
				message: 'Konverzace je příliš dlouhá. Začni novou.',
				code: 'context_length'
			};
		return {
			message: 'AI požadavek odmítla. Zkus to jinak nebo začni novou konverzaci.',
			code: 'bad_request'
		};
	}
	if (e instanceof APIError) {
		if (e.status === 402)
			return { message: 'Na účtu AI došly prostředky. Řekni to správci editoru.', code: 'payment' };
		if (e.status === 408)
			return { message: 'AI neodpověděla včas. Zkus to znovu.', code: 'timeout' };
		if (e.status === 529 || e.status === 503)
			return { message: 'AI je přetížená, zkus to za chvíli.', code: 'overloaded' };
		if (typeof e.status === 'number' && e.status >= 500)
			return { message: 'AI je dočasně nedostupná, zkus to za chvíli.', code: 'unavailable' };
		if (e.status === 401 || e.status === 403)
			return { message: 'AI není správně nastavena. Řekni to správci editoru.', code: 'auth' };
		if (e.status === 429)
			return { message: 'AI je přetížená, zkus to za chvíli.', code: 'rate_limit' };
	}
	return { message: 'AI selhala, zkus to znovu.', code: 'unknown' };
}

// ── Entry point ─────────────────────────────────────────────────────────────────────

/**
 * Stream one assistant turn as neutral events. Never throws: a failure is an `error`
 * event, and a client abort ends the stream silently.
 */
export async function* streamChat(
	params: ChatParams,
	config: AiConfig,
	client: ChatClient = createClient(config)
): AsyncGenerator<StreamEvent> {
	try {
		const chunks = await client.chat.completions.create(buildRequest(config, params), {
			signal: params.signal
		});
		yield* assembleStream(config.provider, chunks);
	} catch (e) {
		if (params.signal?.aborted) return;
		// The teacher sees a Czech sentence; the server log keeps what actually failed.
		console.error('[ai] provider call failed:', e instanceof Error ? e.message : e);
		const described = describeError(e);
		if (described) yield { type: 'error', ...described };
	}
}
