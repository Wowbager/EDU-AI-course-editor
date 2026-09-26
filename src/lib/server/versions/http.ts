import { json, error } from '@sveltejs/kit';
import { resolveOwner } from './owner';
import { MAX_BODY_BYTES, VersionError } from './files';

/** The owner, or a 401 — nothing is stored or read without one. */
export function ownerOf(request: Request): string {
	const owner = resolveOwner(request);
	if (owner === null) error(401, 'Chybí klíč pracovního prostoru.');
	return owner.id;
}

export async function body(request: Request): Promise<unknown> {
	const length = Number(request.headers.get('content-length') ?? '0');
	if (length > MAX_BODY_BYTES) error(413, 'Verze je příliš velká.');
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) error(413, 'Verze je příliš velká.');
	try {
		return JSON.parse(text);
	} catch {
		error(400, 'Tělo požadavku není JSON.');
	}
}

export async function answer<T>(work: () => Promise<T>) {
	try {
		return json(await work(), { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		if (e instanceof VersionError) error(e.status, e.message);
		throw e;
	}
}
