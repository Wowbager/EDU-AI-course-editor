/** PUT /versions/:courseId/published — which version is out, and for whom. */
import { answer, body, ownerOf } from '$lib/server/versions/http';
import { versionFiles } from '$lib/server/versions/instance';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request, params }) => {
	const owner = ownerOf(request);
	const payload = await body(request);
	return answer(() => versionFiles().setPublished(owner, params.courseId, payload));
};
