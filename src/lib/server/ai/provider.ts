/**
 * Calls to an OpenAI-compatible chat endpoint (OpenRouter, or DeepSeek directly): a JSON
 * object (`Complete`), lines of them (`Stream`), a turn of a conversation with tools
 * (`Chat`), or a picture read (`Vision`). This is the only file that knows a provider.
 */
import type { AiConfig, ReasoningEffort } from './config';
import { fakeChat, fakeComplete, fakeRead, fakeStream } from './fake';
import { weightedTokens, type Usage } from './limits';

/**
 * A part of a message: text, or a picture the teacher attached, by its section's key and
 * its id in the image store. Only here, at the call, is a picture read and sent inline
 * (`hostMessages`): what builds a conversation never handles the bytes.
 */
export type Part = { type: 'text'; text: string } | { type: 'picture'; key: string; id: string };
export type Message = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };

/** A message's text, its pictures left out. */
export const textOf = (content: string | readonly Part[]): string =>
	typeof content === 'string'
		? content
		: content.map((p) => (p.type === 'text' ? p.text : '')).join('');

/** A text, followed by the pictures that go with it, each said by its key. */
export function withPictures(
	text: string,
	pictures: readonly { key: string; id: string }[] = []
): string | Part[] {
	if (pictures.length === 0) return text;
	return [
		{ type: 'text', text },
		...pictures.map((p): Part => ({ type: 'picture', key: p.key, id: p.id }))
	];
}

/** A kept picture's bytes, by its id in the image store; `undefined` when it is gone. */
export type PictureLoader = (id: string) => Promise<Picture | undefined>;
const noPictures: PictureLoader = async () => undefined;

/**
 * The messages as the host takes them: a picture is read from the store and sent inline,
 * after a line with its key, so the model can tell which section it is. One that is gone
 * is said to be gone.
 */
export async function hostMessages<M extends { content?: unknown }>(
	messages: readonly M[],
	load: PictureLoader
): Promise<M[]> {
	const loaded = new Map<string, Promise<Picture | undefined>>();
	const read = (id: string) => {
		if (!loaded.has(id))
			loaded.set(
				id,
				load(id).catch(() => undefined)
			);
		return loaded.get(id)!;
	};
	return Promise.all(
		messages.map(async (m) => {
			if (!Array.isArray(m.content)) return m;
			const parts = await Promise.all(
				(m.content as Part[]).map(async (part) => {
					if (part.type === 'text') return [part];
					const picture = await read(part.id);
					return picture === undefined
						? [{ type: 'text', text: `\n\nPicture [${part.key}]: no longer available.` }]
						: [
								{ type: 'text', text: `\n\nPicture [${part.key}]:` },
								{
									type: 'image_url',
									image_url: { url: `data:${picture.mime};base64,${picture.base64}` }
								}
							];
				})
			);
			return { ...m, content: parts.flat() };
		})
	);
}
export type Completion = { text: string; tokens: number };
export type Complete = (messages: readonly Message[]) => Promise<Completion>;
/**
 * The same call, answered in pieces as the model writes. `text` goes to `onText` as it
 * arrives; the promise ends with what the call used. Without `json`, the model is not
 * held to one JSON object (a proposal is one object per line).
 */
export type Stream = (
	messages: readonly Message[],
	onText: (piece: string) => void,
	/** Aborting it ends the call at the host too. */
	signal?: AbortSignal
) => Promise<{ tokens: number }>;

/** Why a call failed, in the terms the route answers with. */
export class ProviderError extends Error {
	constructor(
		readonly kind: 'auth' | 'busy' | 'network' | 'failed',
		detail: string,
		/**
		 * Whether the same call may succeed if made again: a busy host, a call that did not
		 * get through, a host's own error (500, 502, 504). `slow` when the time limit ended
		 * it, which is worth one more try, not several.
		 */
		readonly again: { slow?: boolean; afterMs?: number } | false = kind === 'busy' ||
		kind === 'network'
			? {}
			: false
	) {
		super(detail);
		this.name = 'ProviderError';
	}
}

/**
 * How a call is made again after a failure that may pass: waits that double from `baseMs`
 * up to `maxDelayMs` (or what the host's `Retry-After` asks, up to the same), half of each
 * left to chance so that parallel lessons do not come back together; `attempts` calls at
 * most, and no more once `maxWaitMs` would be spent waiting. The teacher sees only the
 * last failure.
 */
export type RetryPolicy = {
	attempts: number;
	baseMs: number;
	maxDelayMs: number;
	maxWaitMs: number;
	random?: () => number;
};
export const RETRY: RetryPolicy = {
	attempts: 5,
	baseMs: 2000,
	maxDelayMs: 30_000,
	maxWaitMs: 90_000
};

function pause(ms: number, signal?: AbortSignal): Promise<boolean> {
	return new Promise((resolve) => {
		if (signal?.aborted === true) return resolve(false);
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', done);
			resolve(signal?.aborted !== true);
		};
		const timer = setTimeout(done, ms);
		signal?.addEventListener('abort', done, { once: true });
	});
}

/**
 * `call`, made again while it fails in a way that may pass and `may()` still allows it
 * (a stream that has shown text may not). What fails for good is thrown at once.
 */
export async function withRetry<T>(
	policy: RetryPolicy,
	call: () => Promise<T>,
	options: { signal?: AbortSignal; may?: () => boolean } = {}
): Promise<T> {
	let waited = 0;
	let slow = 0;
	for (let attempt = 1; ; attempt++) {
		try {
			return await call();
		} catch (e) {
			if (!(e instanceof ProviderError) || e.again === false) throw e;
			if (attempt >= policy.attempts || options.may?.() === false) throw e;
			if (options.signal?.aborted === true) throw e;
			if (e.again.slow === true && ++slow > 1) throw e;
			const ceiling = Math.min(policy.maxDelayMs, policy.baseMs * 2 ** (attempt - 1));
			const jittered = ceiling / 2 + ((policy.random ?? Math.random)() * ceiling) / 2;
			const wait = Math.round(
				Math.max(jittered, Math.min(e.again.afterMs ?? 0, policy.maxDelayMs))
			);
			if (waited + wait > policy.maxWaitMs) throw e;
			console.warn(
				`[ai] call failed (${e.kind}: ${e.message.slice(0, 120)}), attempt ${attempt + 1}/${policy.attempts} in ${wait} ms`
			);
			if (!(await pause(wait, options.signal))) throw e;
			waited += wait;
		}
	}
}

/** A whole card with a long dossier and some thinking: more than a single step took. */
const TIMEOUT_MS = 150_000;

/** What a request costs at most, $ per million tokens: rules out the one host priced 10 times higher. */
export const MAX_PRICE = { prompt: 0.5, completion: 2 } as const;

/** `max_tokens`, what OpenRouter reserves the call's price at while it runs; none when unset. */
const outputCap = (config: AiConfig) =>
	config.maxOutputTokens !== null ? { max_tokens: config.maxOutputTokens } : {};

/** The request every call makes: the endpoint, the key, OpenRouter's attribution. */
function post(
	config: AiConfig,
	fetcher: typeof fetch,
	body: Record<string, unknown>,
	signal: AbortSignal
): Promise<Response> {
	return fetcher(`${config.baseURL}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${config.apiKey}`,
			// ASCII only: a header with a Czech letter fails the request.
			...(config.provider === 'openrouter'
				? { 'HTTP-Referer': 'https://edu-ai.eu', 'X-Title': 'EDU-AI course editor' }
				: {})
		},
		body: JSON.stringify(body),
		signal
	}).catch((e: unknown) => {
		throw new ProviderError('network', e instanceof Error ? e.message : String(e), {
			slow: signal.aborted
		});
	});
}

/** A `Retry-After` in seconds, as milliseconds. */
function retryAfterOf(response: Response): number | undefined {
	const seconds = Number(response.headers.get('retry-after'));
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * The error an answer that is not `ok` stands for. OpenRouter answers 402 both when the
 * credit is spent (`auth`) and when the calls running at once have reserved all of it
 * (`in_flight_budget`): the latter passes as they finish, so it is `busy`.
 */
async function failureOf(response: Response, timeout: AbortSignal): Promise<ProviderError> {
	const text = await response.text().catch(() => '');
	const detail = `${response.status} ${text.slice(0, 300)}`;
	const afterMs = retryAfterOf(response);
	if (
		response.status === 402 &&
		text.includes('in_flight_budget') &&
		!text.includes('weight_exceeds')
	)
		return new ProviderError('busy', detail, { afterMs });
	if ([401, 402, 403].includes(response.status)) return new ProviderError('auth', detail);
	if ([429, 503, 529].includes(response.status))
		return new ProviderError('busy', detail, { afterMs });
	// Any other error whose body the time limit cut is a call that did not get through.
	if (timeout.aborted) return new ProviderError('network', `${detail} (timed out)`, { slow: true });
	if ([500, 502, 504].includes(response.status))
		return new ProviderError('failed', detail, { afterMs });
	return new ProviderError('failed', detail);
}

export function buildBody(
	config: AiConfig,
	messages: readonly Message[],
	options: { stream?: boolean } = {}
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: config.model,
		messages,
		...outputCap(config)
	};
	// One JSON object. A stream is lines of them, which the mode would refuse.
	if (options.stream !== true) body.response_format = { type: 'json_object' };
	else {
		body.stream = true;
		body.stream_options = { include_usage: true };
	}
	if (config.provider === 'deepseek') {
		body.thinking = { type: config.reasoningEffort === 'none' ? 'disabled' : 'enabled' };
	} else {
		body.reasoning = { effort: config.reasoningEffort };
		// Only hosts that honour the parameters above, and none that train on what they see.
		body.provider = {
			require_parameters: true,
			data_collection: 'deny',
			max_price: MAX_PRICE
		};
	}
	return body;
}

// ───────────────────────────── a conversation with a tool ─────────────────────────────

/** A tool call as the host returns it; `arguments` is the JSON text the model wrote. */
export type ToolCall = {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
};

/**
 * What the model said in one turn, sent back with the next: its text and tool calls. Its
 * reasoning is not kept (a plan writes its decisions out), except DeepSeek's own API's
 * `reasoning_content`, which that API wants back after a tool's result. The other fields
 * remain only in turns a browser held from before.
 */
export type AssistantTurn = {
	role: 'assistant';
	content: string;
	tool_calls?: ToolCall[];
	reasoning_details?: unknown[];
	reasoning_content?: string;
	reasoning?: string;
};

export type ChatMessage =
	Message | AssistantTurn | { role: 'tool'; tool_call_id: string; content: string };

/** The tools every conversation defines, so that their prefix is the same everywhere. */
export type ToolName = 'save_plan' | 'write_card';

export type ChatOptions = {
	/** The tool the model must call this turn. */
	tool: ToolName;
	/** Instead of the configured effort (the plan thinks harder than a card). */
	effort?: ReasoningEffort;
	timeoutMs?: number;
	signal?: AbortSignal;
};

/** One turn of a conversation: the model's answer, and what the call used. */
export type Chat = (
	messages: readonly ChatMessage[],
	options: ChatOptions
) => Promise<{ turn: AssistantTurn; tokens: number }>;

/**
 * The two tools. Their parameters are described loosely: the system prompt gives the
 * shape, and the answer is checked here, so a host's own schema check adds nothing.
 */
export const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'save_plan',
			description: 'Save the plan for the new cards, before any card is written.',
			parameters: {
				type: 'object',
				properties: {
					conventions: { type: 'string' },
					lessons: {
						type: 'array',
						items: {
							type: 'object',
							properties: { lesson: { type: 'integer' }, note: { type: 'string' } },
							required: ['lesson', 'note']
						}
					},
					cards: {
						type: 'array',
						items: {
							type: 'object',
							properties: { card: { type: 'integer' }, brief: { type: 'string' } },
							required: ['card', 'brief']
						}
					}
				},
				required: ['conventions', 'lessons', 'cards']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'write_card',
			description: 'Write the whole card asked for in the last message.',
			parameters: {
				type: 'object',
				properties: { steps: { type: 'array', items: { type: 'object' } } },
				required: ['steps']
			}
		}
	}
] as const;

/** The longest a turn may take: a plan of a whole course thinks for a while. */
export const PLAN_TIMEOUT_MS = 300_000;

export function buildChatBody(
	config: AiConfig,
	messages: readonly ChatMessage[],
	options: Pick<ChatOptions, 'tool' | 'effort'>
): Record<string, unknown> {
	const effort = options.effort ?? config.reasoningEffort;
	const body: Record<string, unknown> = {
		model: config.model,
		messages: messages.map((m) => (m.role === 'assistant' ? sentTurn(m, config.provider) : m)),
		tools: TOOLS,
		...outputCap(config)
	};
	if (config.provider === 'deepseek') {
		// Whether DeepSeek's own API takes a forced tool while thinking is not known; the
		// answer is read from the text when the model writes it there instead.
		body.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' };
	} else {
		body.tool_choice = { type: 'function', function: { name: options.tool } };
		body.reasoning = { effort };
		body.provider = { require_parameters: true, data_collection: 'deny', max_price: MAX_PRICE };
	}
	return body;
}

/** A turn as it goes back to the host: without its reasoning (see `AssistantTurn`). */
function sentTurn(turn: ChatMessage, provider: AiConfig['provider']): ChatMessage {
	const { reasoning_details, reasoning_content, reasoning, ...rest } = turn as AssistantTurn;
	void reasoning_details;
	void reasoning;
	return provider === 'deepseek' && reasoning_content !== undefined
		? { ...rest, reasoning_content }
		: rest;
}

type HostMessage = {
	content?: unknown;
	tool_calls?: unknown;
	reasoning_details?: unknown;
	reasoning_content?: unknown;
	reasoning?: unknown;
};

/** The answer as it will be sent back (see `AssistantTurn`). */
export function turnOf(message: HostMessage, provider?: AiConfig['provider']): AssistantTurn {
	const turn: AssistantTurn = {
		role: 'assistant',
		content: typeof message.content === 'string' ? message.content : ''
	};
	if (Array.isArray(message.tool_calls)) {
		const calls = message.tool_calls.flatMap((c): ToolCall[] => {
			const call = c as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
			if (typeof call.id !== 'string' || typeof call.function?.name !== 'string') return [];
			const args = call.function.arguments;
			return [
				{
					id: call.id,
					type: 'function',
					function: {
						name: call.function.name,
						arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {})
					}
				}
			];
		});
		if (calls.length > 0) turn.tool_calls = calls;
	}
	if (
		provider === 'deepseek' &&
		typeof message.reasoning_content === 'string' &&
		message.reasoning_content !== ''
	)
		turn.reasoning_content = message.reasoning_content;
	return turn;
}

export function chatter(
	config: AiConfig,
	fetcher: typeof fetch = fetch,
	pictures: PictureLoader = noPictures,
	retry: RetryPolicy = RETRY
): Chat {
	if (config.provider === 'fake') return fakeChat;
	return async (asked, options) => {
		const messages = await hostMessages(asked, pictures);
		const body = buildChatBody(config, messages, options);
		return withRetry(
			retry,
			async () => {
				const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
				const response = await post(
					config,
					fetcher,
					body,
					options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
				);
				if (!response.ok) throw await failureOf(response, timeout);
				// A host can send the headers at once and the answer never: the time limit then
				// ends the reading of the body, which is a call that did not get through, not a
				// bad answer.
				const data = (await response.json().catch(() => {
					if (timeout.aborted || options.signal?.aborted === true)
						throw new ProviderError('network', 'the answer did not arrive in time', {
							slow: true
						});
					return null;
				})) as {
					choices?: { message?: HostMessage }[];
					usage?: Usage;
					error?: unknown;
				} | null;
				const message = data?.choices?.[0]?.message;
				if (message === undefined) throw new ProviderError('failed', 'no message');
				return { turn: turnOf(message, config.provider), tokens: weightedTokens(data?.usage) };
			},
			{ signal: options.signal }
		);
	};
}

/** A call answered whole, its text in `message.content`. */
async function wholeAnswer(response: Response): Promise<Completion> {
	const data = (await response.json().catch(() => null)) as {
		choices?: { message?: { content?: unknown } }[];
		usage?: Usage;
	} | null;
	const content = data?.choices?.[0]?.message?.content;
	if (typeof content !== 'string') throw new ProviderError('failed', 'no message content');
	return { text: content, tokens: weightedTokens(data?.usage) };
}

export function completer(
	config: AiConfig,
	fetcher: typeof fetch = fetch,
	retry: RetryPolicy = RETRY
): Complete {
	if (config.provider === 'fake') return fakeComplete;
	return (messages) =>
		withRetry(retry, async () => {
			const timeout = AbortSignal.timeout(TIMEOUT_MS);
			const response = await post(config, fetcher, buildBody(config, messages), timeout);
			if (!response.ok) throw await failureOf(response, timeout);
			return wholeAnswer(response);
		});
}

/** Pieces of text out of an OpenAI-style event stream, and the usage it ends with. */
export function sseReader(onText: (piece: string) => void): {
	feed(chunk: string): void;
	end(): { tokens: number; finished: boolean; error?: string };
} {
	let buffer = '';
	let usage: Usage | undefined;
	// A stream that ends without `[DONE]` or a finish reason was cut, however well it read.
	let finished = false;
	let error: string | undefined;
	const line = (raw: string) => {
		const text = raw.trim();
		// Comments (": OPENROUTER PROCESSING") and other fields are not data.
		if (!text.startsWith('data:')) return;
		const data = text.slice(5).trim();
		if (data === '[DONE]') return void (finished = true);
		if (data === '') return;
		try {
			const event = JSON.parse(data) as {
				choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
				usage?: Usage;
				error?: { message?: unknown } | string;
			};
			// A host that fails half way says so inside the stream.
			if (event.error !== undefined)
				error =
					typeof event.error === 'string' ? event.error : String(event.error.message ?? 'error');
			if (event.choices?.some((c) => c.finish_reason !== undefined && c.finish_reason !== null))
				finished = true;
			const piece = event.choices?.[0]?.delta?.content;
			if (typeof piece === 'string' && piece !== '') onText(piece);
			if (event.usage !== undefined) usage = event.usage;
		} catch {
			// A damaged event is skipped; the answer is checked as a whole afterwards.
		}
	};
	return {
		feed(chunk) {
			buffer += chunk;
			let at: number;
			while ((at = buffer.indexOf('\n')) >= 0) {
				line(buffer.slice(0, at));
				buffer = buffer.slice(at + 1);
			}
		},
		end() {
			line(buffer);
			buffer = '';
			return { tokens: weightedTokens(usage), finished, ...(error !== undefined ? { error } : {}) };
		}
	};
}

export function streamer(
	config: AiConfig,
	fetcher: typeof fetch = fetch,
	pictures: PictureLoader = noPictures,
	retry: RetryPolicy = RETRY
): Stream {
	if (config.provider === 'fake') return fakeStream;
	return async (asked, onText, signal) => {
		const messages = await hostMessages(asked, pictures);
		const body = buildBody(config, messages, { stream: true });
		// Once the teacher has seen text, a new call would write it again.
		let shown = false;
		const show = (piece: string) => {
			shown = true;
			onText(piece);
		};
		return withRetry(
			retry,
			async () => {
				const timeout = AbortSignal.timeout(TIMEOUT_MS);
				const response = await post(
					config,
					fetcher,
					body,
					signal === undefined ? timeout : AbortSignal.any([signal, timeout])
				);
				if (!response.ok) throw await failureOf(response, timeout);
				if (response.body === null) throw new ProviderError('failed', 'no body');
				const reader = sseReader(show);
				const decoder = new TextDecoder();
				try {
					for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>)
						reader.feed(decoder.decode(chunk, { stream: true }));
				} catch (e) {
					throw new ProviderError('network', e instanceof Error ? e.message : String(e), {
						slow: timeout.aborted
					});
				}
				const ended = reader.end();
				if (ended.error !== undefined)
					throw new ProviderError('failed', `stream error: ${ended.error}`);
				if (!ended.finished)
					throw new ProviderError('network', 'the stream ended before the model finished');
				return { tokens: ended.tokens };
			},
			{ signal, may: () => !shown }
		);
	};
}

/** A picture the model is asked to read: its type and bytes, base64. */
export type Picture = { mime: string; base64: string };
/** One picture and the instructions for reading it, answered whole. */
export type Vision = (instructions: string, picture: Picture) => Promise<Completion>;

/** The call that reads a picture: the instructions, and the picture as an `image_url` part. */
export function buildVisionBody(
	config: AiConfig,
	instructions: string,
	picture: Picture
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: config.model,
		messages: [
			{ role: 'system', content: instructions },
			{
				role: 'user',
				content: [
					{
						type: 'image_url',
						image_url: { url: `data:${picture.mime};base64,${picture.base64}` }
					},
					{ type: 'text', text: 'Přepiš obrázek.' }
				]
			}
		],
		max_tokens: 6000
	};
	// Reading is copying, not thinking: no reasoning, which is also what makes it quick.
	if (config.provider === 'deepseek') body.thinking = { type: 'disabled' };
	else {
		body.reasoning = { effort: 'none' };
		body.provider = { require_parameters: true, data_collection: 'deny', max_price: MAX_PRICE };
	}
	return body;
}

export function visionist(
	config: AiConfig,
	fetcher: typeof fetch = fetch,
	retry: RetryPolicy = RETRY
): Vision {
	if (config.provider === 'fake') return fakeRead;
	return (instructions, picture) =>
		withRetry(retry, async () => {
			const timeout = AbortSignal.timeout(TIMEOUT_MS);
			const response = await post(
				config,
				fetcher,
				buildVisionBody(config, instructions, picture),
				timeout
			);
			if (!response.ok) throw await failureOf(response, timeout);
			return wholeAnswer(response);
		});
}
