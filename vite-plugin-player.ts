import { existsSync, createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Logger, Plugin } from 'vite';
import { injectPlayerShim } from './scripts/inject-player-shim.mjs';

/**
 * Serves the Flutter web build at `/player/` from `vite dev` and `vite preview`.
 *
 * In production nginx does this (see `nginx.conf`), and the point is the same in
 * both: the editor and the player share an origin, because the preview is an iframe
 * that has to exchange messages with the page around it. Without this, `npm run dev`
 * would give you an editor whose preview can never work. `vite preview` is what the
 * e2e suite runs against (playwright.config.ts), so it serves the same player.
 *
 * Build the player with:
 *
 *     flutter build web --release --base-href /player/ --no-web-resources-cdn
 */
const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.wasm': 'application/wasm',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.bin': 'application/octet-stream',
	'.map': 'application/json; charset=utf-8'
};

// The same shim the production build injects (via `scripts/inject-player-shim.mjs`
// in the Dockerfile), read once here so dev and prod cannot drift — see that
// script's doc comment for why `/api/proxy/image` requests need rewriting at all.
const SHIM_PATH = fileURLToPath(new URL('./src/lib/preview/player-shim.js', import.meta.url));

export function playerPlugin(playerRoot: string): Plugin {
	const root = resolve(playerRoot);

	return {
		name: 'edu-player',
		apply: 'serve',
		configureServer(server) {
			warnAboutBuild(root, server.config.logger);
			server.middlewares.use(servePlayer(root, server.config.logger));
		},
		configurePreviewServer(server) {
			warnAboutBuild(root, server.config.logger);
			server.middlewares.use(servePlayer(root, server.config.logger));
		}
	};
}

function warnAboutBuild(root: string, logger: Logger) {
	if (!existsSync(root)) {
		logger.warn(
			`[player] ${root} not found — the preview column will say the player is not running. ` +
				`Build it with: flutter build web --release --base-href /player/ --no-web-resources-cdn`
		);
	} else if (
		existsSync(join(root, 'flutter_bootstrap.js')) &&
		!readFileSync(join(root, 'flutter_bootstrap.js'), 'utf-8').includes('"useLocalCanvasKit":true')
	) {
		// Built without the flag, the player fetches CanvasKit from gstatic, and one
		// aborted request there leaves the preview empty.
		logger.warn(`[player] ${root} loads CanvasKit from a CDN. Rebuild it with --no-web-resources-cdn.`);
	}
}

function servePlayer(root: string, logger: Logger): Connect.NextHandleFunction {
	return (request, response, next) => {
		const url = request.url ?? '';
		if (!url.startsWith('/player')) return next();
		if (!existsSync(root)) {
			response.statusCode = 404;
			response.end('player build not found');
			return;
		}

		const path = url.slice('/player'.length).split('?')[0] || '/';
		// The player is a SPA: an unknown path inside it is a route, not a file.
		const candidate = join(root, normalize(path));
		const file =
			candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
				? candidate
				: join(root, 'index.html');

		response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
		// Same-origin embedding only, matching the production headers.
		response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");

		if (extname(file) === '.html') {
			// Every HTML response is the player's index (there is only one), and it
			// has to carry the same preview-image shim the Docker build injects —
			// same module, so the two cannot drift (see inject-player-shim.mjs).
			// Read and patched in memory rather than streamed, since it's a few KB.
			try {
				const html = readFileSync(file, 'utf-8');
				const shimSource = readFileSync(SHIM_PATH, 'utf-8');
				response.end(injectPlayerShim(html, shimSource));
			} catch (error) {
				// Fail loudly rather than silently serving an unpatched player: that
				// would look fine and quietly still call the unreliable image proxy.
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`[player] failed to inject preview-image shim: ${message}`);
				response.statusCode = 500;
				response.end(`player shim injection failed: ${message}`);
			}
			return;
		}

		createReadStream(file).pipe(response);
	};
}
