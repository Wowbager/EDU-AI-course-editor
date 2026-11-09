/**
 * GET /images/gallery
 *
 * Returns the owner's uploaded image list as JSON with absolute URLs.
 */
import { error, json } from '@sveltejs/kit';
import { ownerOf } from '$lib/server/versions/http';
import { imageFiles } from '$lib/server/images/instance';
import { ImageError } from '$lib/server/images/files';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	const owner = ownerOf(request);
	try {
		const index = await imageFiles().list(owner);
		const items = index.items.map((item) => ({
			...item,
			url: item.url.startsWith('http') ? item.url : `${url.origin}${item.url}`
		}));
		return json({ items }, { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		if (e instanceof ImageError) error(e.status, e.message);
		throw e;
	}
};
