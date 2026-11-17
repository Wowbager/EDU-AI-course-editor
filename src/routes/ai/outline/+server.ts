/**
 * Proposing a structure with AI. Not under `/api/`: the proxy sends that to the Laravel API.
 *
 *   POST /ai/outline  OutlineRequest  → application/x-ndjson, one OutlineEvent per line
 *     (the scope, then a lesson, or a card, at a time as the model writes, then `done`)
 *
 * Same provider, key and limits as the other AI routes (`server/ai/limits.ts`).
 */
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { MAX_CONTEXT_CHARS } from '$lib/domain/authoring';
import { outlineRequestSchema } from '$lib/domain/outline';
import { isConfigured, readAiConfig } from '$lib/server/ai/config';
import { sharedLimits } from '$lib/server/ai/limits';
import { outlineEvents } from '$lib/server/ai/outline';
import { ProviderError, streamer } from '$lib/server/ai/provider';
import { loadPicture } from '$lib/server/images/instance';
import { whoOf } from '$lib/server/ai/route';
import type { RequestHandler } from './$types';

const MAX_BODY = MAX_CONTEXT_CHARS + 200_000;
const NO_STORE = { headers: { 'cache-control': 'no-store' } };

export const POST: RequestHandler = async (event) => {
	const { request } = event;
	const who = whoOf(event);
	const config = readAiConfig(env);
	if (!isConfigured(config)) {
		if (config.problem !== null) console.error('[ai]', config.problem);
		error(503, 'AI není nastavena.');
	}
	const raw = await request.text();
	if (raw.length > MAX_BODY) error(413, 'Požadavek je příliš velký.');
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		error(400, 'Tělo požadavku není JSON.');
	}
	const parsed = outlineRequestSchema.safeParse(body);
	if (!parsed.success) {
		const tooLong = parsed.error.issues.some(
			(i) => i.path[0] === 'context' && i.code === 'too_big'
		);
		error(
			tooLong ? 413 : 400,
			tooLong ? 'Požadavek je příliš velký.' : 'Požadavek nemá očekávaný tvar.'
		);
	}

	const limits = sharedLimits(config);
	const verdict = limits.check(who);
	if (!verdict.ok)
		return json(
			{ reason: verdict.reason },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);

	const encoder = new TextEncoder();
	// The teacher discarding or closing the page cancels the response; that must end the
	// call at the host too, not leave it to run for minutes.
	const abort = new AbortController();
	let open = true;
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: unknown) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					open = false;
				}
			};
			try {
				for await (const event of outlineEvents(
					parsed.data,
					streamer(config, fetch, loadPicture),
					(tokens) => limits.record(who, tokens),
					abort.signal
				))
					send(event);
			} catch (e) {
				if (!(e instanceof ProviderError)) throw e;
				// The teacher gets a sentence from the client; the log keeps what failed.
				if (open) console.error('[ai] provider call failed:', e.kind, e.message);
				send({ type: 'failed', problem: e.kind === 'busy' ? 'busy' : 'failed' });
			} finally {
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
};
