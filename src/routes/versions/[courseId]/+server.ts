/**
 * A course's version history on the editor's server (`lib/server/versions/`).
 * Not under `/api/`: nginx sends that to the Laravel API.
 *
 *   GET  /versions/:courseId            the index (numbers, notes, the publication)
 *   POST /versions/:courseId            store one version
 */
import { answer, body, ownerOf } from '$lib/server/versions/http';
import { versionFiles } from '$lib/server/versions/instance';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request, params }) =>
	answer(() => versionFiles().index(ownerOf(request), params.courseId));

export const POST: RequestHandler = async ({ request, params }) => {
	const owner = ownerOf(request);
	const payload = await body(request);
	return answer(() => versionFiles().put(owner, params.courseId, payload));
};
