/**
 * Reading one picture of a teacher's material with AI. Not under `/api/`: the proxy sends
 * that to the Laravel API.
 *
 *   POST /ai/read   the picture itself (image/png, image/jpeg or image/webp) → { text }
 *
 * The browser sends a scanned page, a photo, or a slide that is only a picture; the text
 * that comes back is Markdown with maths in `$…$` (`server/ai/read.ts`). Same provider,
 * key and limits as the other AI routes (`server/ai/limits.ts`).
 */
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { isConfigured, readAiConfig } from '$lib/server/ai/config';
import { sharedLimits } from '$lib/server/ai/limits';
import { ProviderError, visionist } from '$lib/server/ai/provider';
import { readPicture } from '$lib/server/ai/read';
import { ownerOf } from '$lib/server/versions/http';
import type { RequestHandler } from './$types';

/** A page rendered for reading is well under this; a phone photo is shrunk first. */
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const POST: RequestHandler = async ({ request }) => {
	const owner = ownerOf(request);
	const config = readAiConfig(env);
	if (!isConfigured(config)) {
		if (config.problem !== null) console.error('[ai]', config.problem);
		error(503, 'AI není nastavena.');
	}
	const mime = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!TYPES.includes(mime)) error(415, 'Obrázek musí být PNG, JPEG nebo WebP.');
	const declared = Number(request.headers.get('content-length') ?? '0');
	if (declared > MAX_PICTURE_BYTES) error(413, 'Obrázek je příliš velký.');
	const bytes = Buffer.from(await request.arrayBuffer());
	if (bytes.length > MAX_PICTURE_BYTES) error(413, 'Obrázek je příliš velký.');
	if (bytes.length === 0) error(400, 'Chybí obrázek.');

	const limits = sharedLimits(config);
	const verdict = limits.check(owner);
	if (!verdict.ok)
		return json(
			{ reason: verdict.reason },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);

	try {
		const { text, tokens } = await readPicture(visionist(config), {
			mime,
			base64: bytes.toString('base64')
		});
		limits.record(owner, tokens);
		return json({ text }, { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		if (!(e instanceof ProviderError)) throw e;
		console.error('[ai] provider call failed:', e.kind, e.message);
		error(e.kind === 'busy' ? 503 : 502, e.kind);
	}
};
