/**
 * What the routes that hold a conversation with the model share: reading the body, the
 * limits, and an answer of one JSON event per line that is written as the work goes.
 *
 * Every call to the model counts against the per-minute limit, not every request: a
 * lesson is one request and many calls. The first call is checked before the answer
 * starts, so a refusal is an ordinary 429; a later one ends the stream with a `stopped`
 * event, and what was written before it stays written.
 */
import { error, json } from '@sveltejs/kit';
import type { z } from 'zod';
import { isConfigured, readAiConfig, type AiConfig } from './config';
import { sharedLimits } from './limits';
import { ProviderError } from './provider';
import type { Gate } from './lesson';

/** The configured provider and the parsed body, or the error the route answers with. */
export async function readAiRequest<T extends z.ZodTypeAny>(
	request: Request,
	env: Readonly<Record<string, string | undefined>>,
	schema: T,
	maxBody: number
): Promise<{ config: AiConfig; body: z.infer<T> }> {
	const config = readAiConfig(env);
	if (!isConfigured(config)) {
		if (config.problem !== null) console.error('[ai]', config.problem);
		error(503, 'AI není nastavena.');
	}
	const raw = await request.text();
	if (raw.length > maxBody) error(413, 'Požadavek je příliš velký.');
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		error(400, 'Tělo požadavku není JSON.');
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		// Too long a text (a dossier, the materials, the plan's turn); too many cards is a shape.
		const tooLong = parsed.error.issues.some(
			(i) => (i.code === 'too_big' && i.origin === 'string') || i.path.at(-1) === 'turn'
		);
		error(
			tooLong ? 413 : 400,
			tooLong ? 'Požadavek je příliš velký.' : 'Požadavek nemá očekávaný tvar.'
		);
	}
	return { config, body: parsed.data };
}

/** Between two lines, so that a proxy does not take a long think for a dead connection. */
export const HEARTBEAT_MS = 15_000;

/**
 * The limits for `owner`: a 429 when the first call may not be made; else a gate for
 * every call after it, and where to count what each used.
 */
export function limitsFor(
	config: AiConfig,
	owner: string
): Response | { gate: Gate; spent: (tokens: number) => void } {
	const limits = sharedLimits(config);
	const verdict = limits.check(owner);
	if (!verdict.ok)
		return json(
			{ reason: verdict.reason },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);
	let first = true;
	return {
		gate: () => {
			if (!first) return limits.check(owner);
			first = false;
			return { ok: true };
		},
		spent: (tokens) => limits.record(owner, tokens)
	};
}

/**
 * An answer of one JSON event per line, from `run`. A provider failure ends it with a
 * `failed` event; the teacher closing the page aborts `signal`, which ends the call at
 * the host too. An empty line goes out every `HEARTBEAT_MS`; the client skips it.
 */
export function eventStream(
	run: (send: (event: unknown) => void, signal: AbortSignal) => Promise<void>
): Response {
	const encoder = new TextEncoder();
	const abort = new AbortController();
	let open = true;
	let beat: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const write = (text: string) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(text));
				} catch {
					open = false;
				}
			};
			const send = (event: unknown) => write(`${JSON.stringify(event)}\n`);
			beat = setInterval(() => write('\n'), HEARTBEAT_MS);
			try {
				await run(send, abort.signal);
			} catch (e) {
				if (!(e instanceof ProviderError)) {
					if (abort.signal.aborted) return;
					throw e;
				}
				// The teacher gets a sentence from the client; the log keeps what failed.
				if (open) console.error('[ai] provider call failed:', e.kind, e.message);
				send({ type: 'failed', problem: e.kind === 'busy' ? 'busy' : 'failed' });
			} finally {
				clearInterval(beat);
				if (open) {
					open = false;
					try {
						controller.close();
					} catch {
						// Already closed by the cancel.
					}
				}
			}
		},
		cancel() {
			open = false;
			clearInterval(beat);
			abort.abort();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson',
			'cache-control': 'no-store',
			// A proxy in front must pass each line on as it is written.
			'x-accel-buffering': 'no'
		}
	});
}
