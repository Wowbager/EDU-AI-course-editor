/**
 * Client helpers for the image upload and gallery endpoints.
 *
 * The owner is this browser's workspace key (`state/versions/server.ts`), sent as
 * `x-editor-workspace`, the same header the version store uses.
 *
 * A failure is thrown as an `ImageRequestError` that says only which kind it was. What
 * the server wrote is for a log, not for a teacher: the picker turns the kind into a
 * sentence with `imageErrorText`.
 */
import type { ImageMeta } from '$lib/server/images/files';
import { IMAGE_PROBLEM_TEXT, imageProblem, type ImageProblem } from '$lib/images/limits';
import { workspaceKey } from '$lib/state/versions/server';

export type { ImageMeta };

export interface ImageGallery {
	items: ImageMeta[];
}

export class ImageRequestError extends Error {
	constructor(readonly problem: ImageProblem | 'failed') {
		super(problem);
	}
}

const BY_STATUS: Record<number, ImageProblem> = {
	413: 'too-big',
	415: 'wrong-type',
	429: 'full'
};

async function call(path: string, init: RequestInit = {}): Promise<Response> {
	const key = workspaceKey();
	if (!key) throw new ImageRequestError('failed');
	let response: Response;
	try {
		response = await fetch(path, { ...init, headers: { 'x-editor-workspace': key } });
	} catch (e) {
		// A cancelled upload is the caller's own doing; it tells by the signal.
		if (e instanceof DOMException && e.name === 'AbortError') throw e;
		throw new ImageRequestError('failed');
	}
	if (!response.ok) throw new ImageRequestError(BY_STATUS[response.status] ?? 'failed');
	return response;
}

/**
 * The address the course keeps for an uploaded picture: on the origin the teacher's
 * browser is on. The server's own idea of its origin can be `http://` behind a proxy,
 * and the app refuses a picture that is not on `https://`.
 */
export function imageAddress(meta: Pick<ImageMeta, 'url'>): string {
	const path = new URL(meta.url, window.location.origin);
	return `${window.location.origin}${path.pathname}`;
}

export async function uploadImage(file: File, signal?: AbortSignal): Promise<ImageMeta> {
	const problem = imageProblem(file);
	if (problem) throw new ImageRequestError(problem);
	const form = new FormData();
	form.append('file', file);
	const response = await call('/images/upload', { method: 'POST', body: form, signal });
	return (await response.json()) as ImageMeta;
}

export async function listImages(): Promise<ImageGallery> {
	const response = await call('/images/gallery');
	return (await response.json()) as ImageGallery;
}

export async function deleteImage(id: string): Promise<void> {
	await call(`/images/gallery/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

const FAILED = {
	upload: 'Nahrání se nepovedlo. Zkontroluj připojení a zkus to znovu.',
	gallery: 'Galerii se nepodařilo načíst. Zkontroluj připojení a zkus to znovu.',
	delete: 'Obrázek se nepodařilo smazat. Zkus to znovu.'
};

/** What to tell the teacher when `action` threw `error`. */
export function imageErrorText(error: unknown, action: keyof typeof FAILED): string {
	if (error instanceof ImageRequestError && error.problem !== 'failed')
		return IMAGE_PROBLEM_TEXT[error.problem];
	return FAILED[action];
}
