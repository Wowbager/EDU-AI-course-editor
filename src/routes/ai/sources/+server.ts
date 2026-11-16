/**
 * Naming the sources of cards that have none. Not under `/api/`: the proxy sends that to
 * the Laravel API.
 *
 *   POST /ai/sources  SourcesRequest  → { status: 'ok', cards: [{ id, sources }] }
 *
 * Asked once after „Vytvořit vybrané“, when the materials do not all fit in a card's
 * request (`domain/source-assign.ts`). Same provider, key and limits as the other AI
 * routes (`server/ai/limits.ts`).
 */
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { MAX_MATERIALS_CHARS } from '$lib/domain/authoring';
import { sourcesRequestSchema } from '$lib/domain/source-assign';
import { isConfigured, readAiConfig } from '$lib/server/ai/config';
import { sharedLimits } from '$lib/server/ai/limits';
import { completer, ProviderError } from '$lib/server/ai/provider';
import { assignSources } from '$lib/server/ai/sources';
import { ownerOf } from '$lib/server/versions/http';
import type { RequestHandler } from './$types';

const MAX_BODY = MAX_MATERIALS_CHARS + 100_000;
const NO_STORE = { headers: { 'cache-control': 'no-store' } };

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
	const parsed = sourcesRequestSchema.safeParse(body);
	if (!parsed.success) error(400, 'Požadavek nemá očekávaný tvar.');

	const limits = sharedLimits(config);
	const verdict = limits.check(owner);
	if (!verdict.ok)
		return json(
			{ reason: verdict.reason },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);

	try {
		const cards = await assignSources(parsed.data, completer(config), (tokens) =>
			limits.record(owner, tokens)
		);
		return json({ status: 'ok', cards }, NO_STORE);
	} catch (e) {
		if (!(e instanceof ProviderError)) throw e;
		console.error('[ai] provider call failed:', e.kind, e.message);
		error(e.kind === 'busy' ? 503 : 502, e.kind);
	}
};
