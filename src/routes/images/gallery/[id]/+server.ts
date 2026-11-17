/**
 * DELETE /images/gallery/[id]
 *
 * Removes an image from the owner's gallery index and deletes the file from disk.
 * Requires `x-editor-workspace` header (owner identification).
 *
 * With `?unless=saved` a picture a saved version of the owner's courses shows is kept
 * (answered `{ ok: true, kept: true }`): what a material's removal asks, not the teacher.
 */
import { error, json } from '@sveltejs/kit';
import { ownerOf } from '$lib/server/versions/http';
import { imageFiles } from '$lib/server/images/instance';
import { ImageError } from '$lib/server/images/files';
import { versionFiles } from '$lib/server/versions/instance';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, request, url }) => {
	const owner = ownerOf(request);
	try {
		if (
			url.searchParams.get('unless') === 'saved' &&
			(await versionFiles().mentions(owner, params.id))
		)
			return json({ ok: true, kept: true });
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
