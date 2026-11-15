/**
 *   DELETE /materials/:courseId/:hash   take one file out of the course's materials
 */
import { error, json } from '@sveltejs/kit';
import { ownerOf } from '$lib/server/versions/http';
import { VersionError } from '$lib/server/versions/files';
import { materialFiles } from '$lib/server/materials/instance';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ request, params }) => {
	const owner = ownerOf(request);
	try {
		await materialFiles().remove(owner, params.courseId, params.hash);
	} catch (e) {
		if (e instanceof VersionError) error(e.status, e.message);
		throw e;
	}
	return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
};
