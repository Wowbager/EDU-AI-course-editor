/**
 * The chat loop, in the browser: one `ChatSession` per course session.
 *
 * It keeps the conversation sent to the model — append-only and provider-neutral
 * (`protocol.ts`): each assistant turn with its `reasoning` exactly as the provider gave
 * it, and every tool call answered by one `tool` message — and the lines the teacher
 * reads (`store.ai`). The tools run through the `AgentContext`, so every safeguard
 * (revision, mode, confirmation, one undo entry) is the tool layer's, not this loop's.
 *
 * The loop: send, stream the answer into the bubble, and while the model asks for tools
 * run them and send again, at most `maxToolRounds` times for one message of the
 * teacher's. Stop ends it at once: a tool already running finishes, nothing starts after
 * it, and every call still unanswered gets a "stopped" result so the history stays valid.
 *
 * The transport is injected: the page uses `httpTransport`, the eval suite the provider
 * itself. Nothing here names a provider, and nothing here touches the document.
 */
import type { DocStore } from '$lib/state/doc-store.svelte';
import type { AgentContext } from './context';
import type { ChatMessage, StreamEvent, ToolCall, Usage } from './protocol';
import type { Transport } from './chat-transport';
import { runTool } from './handlers';
import { TOOL_SPECS } from './catalog';
import { fail, type ToolResult } from './tool';

/** Tool results are limited by the server (`MAX_TOOL_CONTENT`); a write's report is small. */
const MAX_RESULT_CHARS = 90_000;

export const STALE_NOTICE = 'Učitel mezitím upravil kurz; čti znovu, než něco změníš.';
export const ROUNDS_NOTE =
	'Došly kroky, které smím udělat na jednu zprávu. Napiš „pokračuj“, pokud mám pokračovat.';
export const LENGTH_NOTE =
	'Odpověď se nevešla do limitu a byla uříznutá. Napiš „pokračuj“, pokud mám pokračovat.';

const KNOWN = new Set(TOOL_SPECS.map((t) => t.name));

export type ToolRunner = (name: string, args: unknown, ctx: AgentContext) => Promise<ToolResult>;

export interface ChatSessionOptions {
	store: DocStore;
	ctx: AgentContext;
	transport: Transport;
	/** For tests; the real tools by default. */
	run?: ToolRunner;
}

const empty = (): Usage => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

export class ChatSession {
	#store: DocStore;
	#ctx: AgentContext;
	#transport: Transport;
	#run: ToolRunner;
	#history: ChatMessage[] = [];
	#abort: AbortController | null = null;
	/** The course's revision when the AI last finished: a different one is the teacher's work. */
	#seen: number | null = null;

	/** Everything the provider reported, summed. */
	usage: Usage = empty();
	/** Requests sent and the tools called, in order: what a test or an eval grades. */
	requests = 0;
	toolCalls: { name: string; arguments: string; ok: boolean; error?: string }[] = [];

	constructor(options: ChatSessionOptions) {
		this.#store = options.store;
		this.#ctx = options.ctx;
		this.#transport = options.transport;
		this.#run = options.run ?? runTool;
	}

	get history(): readonly ChatMessage[] {
		return this.#history;
	}

	get running(): boolean {
		return this.#abort !== null;
	}

	/** End the conversation the model has; the lines on screen stay. */
	reset() {
		if (this.running) return;
		this.#history = [];
		this.#seen = null;
	}

	/** Stop now. A tool that is running finishes; nothing starts after it. */
	stop() {
		this.#abort?.abort();
		// A question the teacher has not answered is a no.
		this.#store.ai.confirm?.resolve(false);
	}

	/** One message of the teacher's, and everything the model does about it. */
	async send(text: string): Promise<void> {
		const message = text.trim();
		if (message === '' || this.running) return;
		const ai = this.#store.ai;
		const abort = new AbortController();
		this.#abort = abort;
		ai.running = true;
		try {
			if (this.#seen !== null && this.#store.revision !== this.#seen) {
				this.#history.push({ role: 'notice', content: STALE_NOTICE });
			}
			this.#history.push({ role: 'user', content: message });
			ai.addLine('user', message);
			await this.#loop(abort.signal);
		} finally {
			ai.thinking = false;
			ai.running = false;
			this.#abort = null;
			this.#seen = this.#store.revision;
		}
	}

	async #loop(signal: AbortSignal) {
		const ai = this.#store.ai;
		const max = this.#ctx.limits.maxToolRounds;
		for (let round = 1; ; round++) {
			const done = await this.#turn(signal);
			if (done === null) {
				if (signal.aborted) ai.addLine('notice', 'Zastaveno.');
				return;
			}
			// A name the server does not know would make it refuse the whole conversation
			// from now on, so such a call is never kept: the model is told instead.
			const unknown = done.assistant.toolCalls.filter((c) => !KNOWN.has(c.name));
			const calls = done.assistant.toolCalls.filter((c) => KNOWN.has(c.name));
			this.#history.push({ ...done.assistant, toolCalls: calls });

			for (const call of calls) {
				const result = signal.aborted
					? fail('declined', 'Učitel AI zastavil. Nic dalšího se neprovedlo.')
					: await this.#call(call);
				this.#history.push({ role: 'tool', toolCallId: call.id, content: serialise(result) });
			}
			if (unknown.length > 0) {
				this.#history.push({
					role: 'notice',
					content: `Nástroj ${unknown.map((c) => `„${c.name}“`).join(', ')} neexistuje; použij jen nástroje ze seznamu.`
				});
			}
			if (signal.aborted) {
				ai.addLine('notice', 'Zastaveno.');
				return;
			}
			if (calls.length === 0 && unknown.length === 0) {
				if (done.finishReason === 'length') ai.addLine('notice', LENGTH_NOTE);
				return;
			}
			if (round >= max) {
				ai.addLine('notice', ROUNDS_NOTE);
				return;
			}
		}
	}

	async #call(call: ToolCall): Promise<ToolResult> {
		let result: ToolResult;
		try {
			result = await this.#run(call.name, call.arguments, this.#ctx);
		} catch {
			result = fail('internal', 'Nástroj selhal. Nic se nezměnilo.');
		}
		this.toolCalls.push({
			name: call.name,
			arguments: call.arguments,
			ok: result.ok,
			...(result.ok ? {} : { error: result.error.code })
		});
		return result;
	}

	/** One request and its answer, streamed into a bubble. Null when it ended without one. */
	async #turn(signal: AbortSignal) {
		const ai = this.#store.ai;
		let bubble: number | null = null;
		let finished: Extract<StreamEvent, { type: 'done' }> | null = null;
		ai.thinking = true;
		this.requests++;
		for await (const event of this.#transport(this.#history, signal)) {
			if (signal.aborted) break;
			switch (event.type) {
				case 'text_delta':
					ai.thinking = false;
					bubble ??= ai.addLine('assistant', '');
					ai.append(bubble, event.text);
					break;
				case 'tool_call':
					ai.thinking = false;
					break;
				case 'reasoning_delta':
					// Kept in the history by the server's `done`; never shown.
					break;
				case 'error':
					ai.thinking = false;
					ai.addLine('error', event.message);
					if (event.code === 'not_configured') ai.configured = false;
					return null;
				case 'done':
					finished = event;
					add(this.usage, event.usage);
					break;
			}
		}
		ai.thinking = false;
		if (signal.aborted) return null;
		if (finished === null) {
			ai.addLine('error', 'Spojení s AI se přerušilo dřív, než odpověď skončila. Zkus to znovu.');
			return null;
		}
		return finished;
	}
}

function add(total: Usage, usage: Usage) {
	total.promptTokens += usage.promptTokens;
	total.completionTokens += usage.completionTokens;
	total.totalTokens += usage.totalTokens;
	if (usage.cachedTokens !== undefined) {
		total.cachedTokens = (total.cachedTokens ?? 0) + usage.cachedTokens;
	}
}

function serialise(result: ToolResult): string {
	const text = JSON.stringify(result);
	if (text.length <= MAX_RESULT_CHARS) return text;
	return JSON.stringify(
		fail('too_large', 'Výsledek je příliš dlouhý. Zeptej se na menší část kurzu.')
	);
}
