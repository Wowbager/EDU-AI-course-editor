/**
 * One call to an OpenAI-compatible chat endpoint (OpenRouter, or DeepSeek directly),
 * asking for a JSON object. This is the only file that knows a provider; everything
 * else sees `Complete`.
 */
import type { AiConfig } from './config';
import { fakeComplete, fakeRead, fakeStream } from './fake';
import { weightedTokens, type Usage } from './limits';

export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
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
		detail: string
	) {
		super(detail);
		this.name = 'ProviderError';
	}
}

/** A whole card with a long dossier and some thinking: more than a single step took. */
const TIMEOUT_MS = 150_000;

/** What a request costs at most, $ per million tokens: rules out the one host priced 10 times higher. */
export const MAX_PRICE = { prompt: 0.5, completion: 2 } as const;

export function buildBody(
	config: AiConfig,
	messages: readonly Message[],
	options: { stream?: boolean } = {}
): Record<string, unknown> {
	const body: Record<string, unknown> = { model: config.model, messages };
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

export function completer(config: AiConfig, fetcher: typeof fetch = fetch): Complete {
	if (config.provider === 'fake') return fakeComplete;
	return async (messages) => {
		let response: Response;
		try {
			response = await fetcher(`${config.baseURL}/chat/completions`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${config.apiKey}`,
					// ASCII only: a header with a Czech letter fails the request.
					...(config.provider === 'openrouter'
						? { 'HTTP-Referer': 'https://edu-ai.eu', 'X-Title': 'EDU-AI course editor' }
						: {})
				},
				body: JSON.stringify(buildBody(config, messages)),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (e) {
			throw new ProviderError('network', e instanceof Error ? e.message : String(e));
		}
		if (!response.ok) {
			const detail = `${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`;
			if (response.status === 401 || response.status === 403 || response.status === 402)
				throw new ProviderError('auth', detail);
			if (response.status === 429 || response.status === 503 || response.status === 529)
				throw new ProviderError('busy', detail);
			throw new ProviderError('failed', detail);
		}
		const data = (await response.json().catch(() => null)) as {
			choices?: { message?: { content?: unknown } }[];
			usage?: Usage;
		} | null;
		const content = data?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') throw new ProviderError('failed', 'no message content');
		return { text: content, tokens: weightedTokens(data?.usage) };
	};
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

export function streamer(config: AiConfig, fetcher: typeof fetch = fetch): Stream {
	if (config.provider === 'fake') return fakeStream;
	return async (messages, onText, signal) => {
		let response: Response;
		try {
			response = await fetcher(`${config.baseURL}/chat/completions`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${config.apiKey}`,
					...(config.provider === 'openrouter'
						? { 'HTTP-Referer': 'https://edu-ai.eu', 'X-Title': 'EDU-AI course editor' }
						: {})
				},
				body: JSON.stringify(buildBody(config, messages, { stream: true })),
				signal:
					signal === undefined
						? AbortSignal.timeout(TIMEOUT_MS)
						: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
			});
		} catch (e) {
			throw new ProviderError('network', e instanceof Error ? e.message : String(e));
		}
		if (!response.ok || response.body === null) {
			const detail = `${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`;
			if ([401, 402, 403].includes(response.status)) throw new ProviderError('auth', detail);
			if ([429, 503, 529].includes(response.status)) throw new ProviderError('busy', detail);
			throw new ProviderError('failed', detail);
		}
		const reader = sseReader(onText);
		const decoder = new TextDecoder();
		try {
			for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>)
				reader.feed(decoder.decode(chunk, { stream: true }));
		} catch (e) {
			throw new ProviderError('network', e instanceof Error ? e.message : String(e));
		}
		const ended = reader.end();
		if (ended.error !== undefined)
			throw new ProviderError('failed', `stream error: ${ended.error}`);
		if (!ended.finished)
			throw new ProviderError('network', 'the stream ended before the model finished');
		return { tokens: ended.tokens };
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

export function visionist(config: AiConfig, fetcher: typeof fetch = fetch): Vision {
	if (config.provider === 'fake') return fakeRead;
	return async (instructions, picture) => {
		let response: Response;
		try {
			response = await fetcher(`${config.baseURL}/chat/completions`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${config.apiKey}`,
					...(config.provider === 'openrouter'
						? { 'HTTP-Referer': 'https://edu-ai.eu', 'X-Title': 'EDU-AI course editor' }
						: {})
				},
				body: JSON.stringify(buildVisionBody(config, instructions, picture)),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (e) {
			throw new ProviderError('network', e instanceof Error ? e.message : String(e));
		}
		if (!response.ok) {
			const detail = `${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`;
			if ([401, 402, 403].includes(response.status)) throw new ProviderError('auth', detail);
			if ([429, 503, 529].includes(response.status)) throw new ProviderError('busy', detail);
			throw new ProviderError('failed', detail);
		}
		const data = (await response.json().catch(() => null)) as {
			choices?: { message?: { content?: unknown } }[];
			usage?: Usage;
		} | null;
		const content = data?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') throw new ProviderError('failed', 'no message content');
		return { text: content, tokens: weightedTokens(data?.usage) };
	};
}
