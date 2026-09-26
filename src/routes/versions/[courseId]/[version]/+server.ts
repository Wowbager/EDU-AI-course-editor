/** GET /versions/:courseId/:version — one version, with its document. */
import { error } from '@sveltejs/kit';
import { answer, ownerOf } from '$lib/server/versions/http';
import { versionFiles } from '$lib/server/versions/instance';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request, params }) =>
	answer(async () => {
		const found = await versionFiles().get(ownerOf(request), params.courseId, Number(params.version));
		if (found === null) error(404, 'Verze nenalezena.');
		return found;
	});
