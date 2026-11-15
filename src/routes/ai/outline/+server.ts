/**
 * Proposing a structure with AI. Not under `/api/`: the proxy sends that to the Laravel API.
 *
 *   POST /ai/outline  OutlineRequest  → { status, outline }  lessons with cards, or cards
 *
 * Same provider, key and limits as `/ai/block` (`server/ai/limits.ts`).
 */
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { MAX_CONTEXT_CHARS } from '$lib/domain/authoring';
import { outlineRequestSchema } from '$lib/domain/outline';
import { isConfigured, readAiConfig } from '$lib/server/ai/config';
import { sharedLimits } from '$lib/server/ai/limits';
import { generateOutline } from '$lib/server/ai/outline';
import { completer, ProviderError } from '$lib/server/ai/provider';
import { ownerOf } from '$lib/server/versions/http';
import type { RequestHandler } from './$types';

const MAX_BODY = MAX_CONTEXT_CHARS + 200_000;
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
	const verdict = limits.check(owner);
	if (!verdict.ok)
		return json(
			{ reason: verdict.reason },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);

	try {
		const { response } = await generateOutline(parsed.data, completer(config), (tokens) =>
			limits.record(owner, tokens)
		);
		return json(response, NO_STORE);
	} catch (e) {
		if (!(e instanceof ProviderError)) throw e;
		console.error('[ai] provider call failed:', e.kind, e.message);
		error(e.kind === 'busy' ? 503 : 502, e.kind);
	}
};
