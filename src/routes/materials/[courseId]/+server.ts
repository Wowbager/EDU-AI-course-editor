/**
 * A course's materials on the editor's server (`lib/server/materials/`). Not under
 * `/api/`: nginx sends that to the Laravel API.
 *
 *   GET  /materials/:courseId   the files read so far, with their sections
 *   POST /materials/:courseId   store one file the browser has read
 */
import { error, json } from '@sveltejs/kit';
import { ownerOf } from '$lib/server/versions/http';
import { VersionError } from '$lib/server/versions/files';
import { MAX_FILE_BODY_BYTES } from '$lib/server/materials/files';
import { materialFiles } from '$lib/server/materials/instance';
import type { RequestHandler } from './$types';

const NO_STORE = { headers: { 'cache-control': 'no-store' } };

async function answer<T>(work: () => Promise<T>) {
	try {
		return json(await work(), NO_STORE);
	} catch (e) {
		if (e instanceof VersionError) error(e.status, e.message);
		throw e;
	}
}

export const GET: RequestHandler = ({ request, params }) =>
	answer(async () => ({ files: await materialFiles().list(ownerOf(request), params.courseId) }));

export const POST: RequestHandler = async ({ request, params }) => {
	const owner = ownerOf(request);
	// By the bytes, not the characters, and before reading when the browser says how many.
	const declared = Number(request.headers.get('content-length') ?? '0');
	if (declared > MAX_FILE_BODY_BYTES) error(413, 'Podklad je příliš velký.');
	const text = await request.text();
	if (Buffer.byteLength(text) > MAX_FILE_BODY_BYTES) error(413, 'Podklad je příliš velký.');
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		error(400, 'Tělo požadavku není JSON.');
	}
	return answer(() => materialFiles().add(owner, params.courseId, body));
};
