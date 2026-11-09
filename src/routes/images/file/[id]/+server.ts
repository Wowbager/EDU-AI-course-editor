/**
 * GET /images/file/[id]
 *
 * Public endpoint that serves an uploaded image file by its id.
 * Accessible from anywhere (editor, Flutter preview, student app, external services)
 * without authentication, and with permissive CORS headers.
 */
import { error } from '@sveltejs/kit';
import { imageFiles } from '$lib/server/images/instance';
import { ImageError } from '$lib/server/images/files';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const served = await imageFiles().serveFile(params.id);
		if (!served) error(404, 'Obrázek nebyl nalezen.');

		const { Readable } = await import('node:stream');
		const web = Readable.toWeb(served.stream) as ReadableStream<Uint8Array>;

		return new Response(web, {
			status: 200,
			headers: {
				'content-type': served.contentType,
				'content-length': String(served.size),
				'cache-control': 'public, max-age=31536000, immutable',
				'access-control-allow-origin': '*',
				'access-control-allow-methods': 'GET, HEAD, OPTIONS'
			}
		});
	} catch (e) {
		if (e instanceof ImageError) error(e.status, e.message);
		throw e;
	}
};

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 204,
		headers: {
			'access-control-allow-origin': '*',
			'access-control-allow-methods': 'GET, HEAD, OPTIONS',
			'access-control-allow-headers': '*'
		}
	});
};
