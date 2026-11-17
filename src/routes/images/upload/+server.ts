/**
 * POST /images/upload
 *
 * Accepts a `multipart/form-data` request with a single `file` part.
 * Returns the stored image metadata as JSON with an absolute URL.
 */
import { error, json } from '@sveltejs/kit';
import { ownerOf } from '$lib/server/versions/http';
import { imageFiles } from '$lib/server/images/instance';
import { ImageError, MAX_IMAGE_BYTES } from '$lib/server/images/files';
import { clientOf } from '$lib/server/ip';
import { pictureUploads } from '$lib/server/upload-limits';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { request, url } = event;
	const owner = ownerOf(request);

	const contentLength = Number(request.headers.get('content-length') ?? '');
	if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES + 2048) {
		error(413, 'Soubor je příliš velký.');
	}
	// Per address: a workspace key costs nothing to make up.
	const verdict = pictureUploads.admit(
		clientOf(event),
		Number.isFinite(contentLength) && contentLength > 0 ? contentLength : MAX_IMAGE_BYTES
	);
	if (!verdict.ok)
		return new Response('busy', {
			status: 503,
			headers: { 'retry-after': String(verdict.retryAfterSeconds) }
		});

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		error(400, 'Očekáváno multipart/form-data.');
	}

	const file = formData.get('file');
	if (!(file instanceof File)) {
		error(400, 'Chybí pole "file".');
	}

	const mimeType = file.type || 'application/octet-stream';
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await file.arrayBuffer());
	} catch {
		error(400, 'Nepodařilo se přečíst soubor.');
	}

	try {
		const meta = await imageFiles().upload(owner, bytes, file.name, mimeType);
		const fullUrl = `${url.origin}${meta.url}`;
		return json({ ...meta, url: fullUrl }, { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		if (e instanceof ImageError) error(e.status, e.message);
		throw e;
	}
};
