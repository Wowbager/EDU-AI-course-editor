/**
 * DELETE /images/gallery/[id]
 *
 * Removes an image from the owner's gallery index and deletes the file from disk.
 * Requires `x-editor-workspace` header (owner identification).
 */
import { error, json } from '@sveltejs/kit';
import { ownerOf } from '$lib/server/versions/http';
import { imageFiles } from '$lib/server/images/instance';
import { ImageError } from '$lib/server/images/files';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, request }) => {
	const owner = ownerOf(request);
	try {
		const deleted = await imageFiles().delete(owner, params.id);
		if (!deleted) {
			error(404, 'Obrázek nebyl nalezen.');
		}
		return json({ ok: true });
	} catch (e) {
		if (e instanceof ImageError) error(e.status, e.message);
		throw e;
	}
};
