/**
 * Writing one card with AI. Not under `/api/`: the proxy sends that to the Laravel API.
 *
 *   GET  /ai/block               → { configured }   whether the editor may offer AI
 *   POST /ai/block  GenRequest   → { status, block } the empty slots, written
 *
 * The provider's key stays on the server. A workspace is limited in requests per
 * minute and tokens per day (`server/ai/limits.ts`).
 */
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { genRequestSchema } from '$lib/domain/authoring';
import { isConfigured, readAiConfig } from '$lib/server/ai/config';
import { generateBlock } from '$lib/server/ai/generate';
import { sharedLimits } from '$lib/server/ai/limits';
import { completer, ProviderError } from '$lib/server/ai/provider';
import { ownerOf } from '$lib/server/versions/http';
import type { RequestHandler } from './$types';

const MAX_BODY = 200_000;
const NO_STORE = { headers: { 'cache-control': 'no-store' } };

export const GET: RequestHandler = () =>
	json({ configured: isConfigured(readAiConfig(env)) }, NO_STORE);

export const POST: RequestHandler = async ({ request }) => {
	const owner = ownerOf(request);
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
	const parsed = genRequestSchema.safeParse(body);
	if (!parsed.success) error(400, 'Požadavek nemá očekávaný tvar.');

	const limits = sharedLimits(config);
	const verdict = limits.check(owner);
	if (!verdict.ok)
		return json(
			{ reason: verdict.reason },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);

	try {
		const { response, tokens } = await generateBlock(parsed.data, completer(config));
		limits.record(owner, tokens);
		return json(response, NO_STORE);
	} catch (e) {
		if (!(e instanceof ProviderError)) throw e;
		// The teacher gets a sentence from the client; the log keeps what failed.
		console.error('[ai] provider call failed:', e.kind, e.message);
		error(e.kind === 'busy' ? 503 : 502, e.kind);
	}
};
