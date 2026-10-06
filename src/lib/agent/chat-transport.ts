/**
 * The browser's side of `POST /ai/chat`: send the conversation, read the server-sent
 * events back as the neutral `StreamEvent`s of `protocol.ts`. Nothing here knows a
 * provider. A transport never throws: a failure is an `error` event with a Czech
 * message, and an abort ends the stream without one.
 */
import type { ChatMessage, ErrorCode, StreamEvent } from './protocol';

/** One assistant turn: the conversation so far in, events out. */
export type Transport = (
	messages: readonly ChatMessage[],
	signal: AbortSignal
) => AsyncIterable<StreamEvent>;

/** Split a stream of text into the JSON of its `data:` events. */
export async function* sseData(chunks: AsyncIterable<string>): AsyncGenerator<string> {
	let buffer = '';
	const flush = function* (block: string) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).replace(/^ /, ''))
			.join('\n');
		if (data !== '') yield data;
	};
	for await (const chunk of chunks) {
		buffer += chunk;
		let end: number;
		while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
			const block = buffer.slice(0, end);
			buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
			yield* flush(block);
		}
	}
	if (buffer.trim() !== '') yield* flush(buffer);
}

async function* decode(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			yield decoder.decode(value, { stream: true });
		}
		const rest = decoder.decode();
		if (rest !== '') yield rest;
	} finally {
		reader.releaseLock();
	}
}

const failure = (message: string, code: ErrorCode): StreamEvent => ({
	type: 'error',
	message,
	code
});

export interface HttpOptions {
	fetcher?: typeof fetch;
	/** The owner header's name and value, as the versions backend sends it. */
	workspace?: () => { header: string; key: string } | null;
	url?: string;
}

export function httpTransport(options: HttpOptions = {}): Transport {
	const fetcher = options.fetcher ?? ((...args) => fetch(...args));
	const url = options.url ?? '/ai/chat';
	return async function* (messages, signal) {
		const owner = options.workspace?.() ?? null;
		let response: Response;
		try {
			response = await fetcher(url, {
				method: 'POST',
				signal,
				headers: {
					'content-type': 'application/json',
					accept: 'text/event-stream',
					...(owner === null ? {} : { [owner.header]: owner.key })
				},
				body: JSON.stringify({ messages })
			});
		} catch {
			if (!signal.aborted)
				yield failure('Nepodařilo se spojit se serverem. Zkus to znovu.', 'network');
			return;
		}
		if (!response.ok) {
			let message = 'AI selhala, zkus to znovu.';
			let code: ErrorCode = response.status === 503 ? 'not_configured' : 'unknown';
			try {
				const body = (await response.json()) as { message?: unknown; code?: unknown };
				if (typeof body.message === 'string') message = body.message;
				if (typeof body.code === 'string') code = body.code as ErrorCode;
			} catch {
				// The status is all there is.
			}
			yield failure(message, code);
			return;
		}
		if (response.body === null) {
			yield failure('AI neodpověděla. Zkus to znovu.', 'unknown');
			return;
		}
		try {
			for await (const data of sseData(decode(response.body))) {
				let event: StreamEvent;
				try {
					event = JSON.parse(data) as StreamEvent;
				} catch {
					continue;
				}
				yield event;
				if (event.type === 'done' || event.type === 'error') return;
			}
		} catch {
			if (!signal.aborted) yield failure('Spojení s AI se přerušilo. Zkus to znovu.', 'network');
		}
	};
}
