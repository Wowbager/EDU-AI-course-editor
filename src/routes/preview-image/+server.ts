/**
 * A same-origin image endpoint for the player preview.
 *
 * The Flutter player (embedded under `/player/`, see `vite-plugin-player.ts` and
 * `nginx.conf`) loads every step/solution image through the Laravel API's
 * `/api/proxy/image` — a CORS workaround for CanvasKit's `fetch()`-based image
 * loading (see `EDU-AI-asistent-APP/lib/core/utils/image_url.dart`). That proxy is
 * unreliable: it 502s for hosts that redirect, or that refuse the API server's own
 * requests (verified live against `picsum.photos` and `upload.wikimedia.org`), so a
 * teacher pasting an ordinary image URL gets a broken-image icon with no explanation.
 *
 * This endpoint gives the player something more reliable to call, on this same
 * origin. `src/lib/preview/player-shim.js`, injected into the player's page (see
 * `scripts/inject-player-shim.mjs` and `vite-plugin-player.ts`), rewrites the
 * player's own proxy requests to land here instead of at the Laravel proxy.
 *
 * Strategy, in order:
 *  1. Fetch the original URL directly, from the server. A server has no CORS to
 *     fight — that is the whole reason this can succeed where the browser could not
 *     — and it also works for the hosts the Laravel proxy fails on.
 *  2. If that fails for any reason (network error, non-2xx, wrong content type,
 *     blocked by the SSRF guard), fall back to the Laravel proxy. It genuinely helps
 *     for the opposite case: a host that blocks direct browser/reader-style fetches
 *     but allows the specific server the API runs on.
 *  3. If both fail, a 502 naming exactly what was tried — an author debugging a
 *     broken image needs that, not a silent blank.
 *
 * Both attempts go through the same `fetchImageSafely` guard (scheme/address checks,
 * a body cap, a wall-clock timeout). The Laravel proxy is a fixed, trusted host
 * rather than something a teacher controls, so the SSRF address check is not the
 * point for that hop — but the size cap and timeout still are, and reusing one
 * function for both keeps there from being two different definitions of "safe
 * enough to stream to a browser".
 */
import { env } from '$env/dynamic/private';
import { fetchImageSafely } from '$lib/server/image-fetch-guard';
import type { RequestHandler } from './$types';

// Matches the fallback already baked into `vite.config.ts`'s dev proxy and into the
// Dockerfile's `ENV API_URL` — the one hostname this project already has, not a new
// one invented here.
const DEFAULT_API_URL = 'https://app-api.edu-ai.eu';

const CACHE_CONTROL = 'public, max-age=3600';

export const GET: RequestHandler = async ({ url }) => {
	const target = url.searchParams.get('url');
	if (!target) {
		return new Response('missing required ?url= query parameter', {
			status: 400,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	const attempts: string[] = [];

	const direct = await fetchImageSafely(target);
	if (direct.ok && direct.response) {
		return relay(direct.response);
	}
	attempts.push(`direct fetch of the original URL: ${direct.error ?? 'unknown failure'}`);

	const apiUrl = (env.API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
	const proxyUrl = `${apiUrl}/api/proxy/image?url=${encodeURIComponent(target)}`;
	const proxied = await fetchImageSafely(proxyUrl);
	if (proxied.ok && proxied.response) {
		return relay(proxied.response);
	}
	attempts.push(`Laravel proxy fallback: ${proxied.error ?? 'unknown failure'}`);

	return new Response(
		`could not load image: ${target}\n\n` + attempts.map((a) => `- ${a}`).join('\n') + '\n',
		{ status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } }
	);
};

/** Streams an upstream image response back with the headers a browser `<img>` (or
 * Flutter's `Image.network`) needs, and nothing else from upstream. */
function relay(upstream: Response): Response {
	return new Response(upstream.body, {
		status: 200,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
			'cache-control': CACHE_CONTROL
		}
	});
}
