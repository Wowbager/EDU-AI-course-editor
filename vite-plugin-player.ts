import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Serves the Flutter web build at `/player/` during development.
 *
 * In production nginx does this (see `nginx.conf`), and the point is the same in
 * both: the editor and the player share an origin, because the preview is an iframe
 * that has to exchange messages with the page around it. Without this, `npm run dev`
 * would give you an editor whose preview can never work.
 *
 * Build the player with:
 *
 *     flutter build web --release --base-href /player/
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

export function playerPlugin(playerRoot: string): Plugin {
	const root = resolve(playerRoot);

	return {
		name: 'edu-player',
		apply: 'serve',
		configureServer(server) {
			if (!existsSync(root)) {
				server.config.logger.warn(
					`[player] ${root} not found — the preview column will say the player is not running. ` +
						`Build it with: flutter build web --release --base-href /player/`
				);
			}

			server.middlewares.use((request, response, next) => {
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
				createReadStream(file).pipe(response);
			});
		}
	};
}
