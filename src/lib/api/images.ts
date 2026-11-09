/**
 * Client helpers for the image upload and gallery endpoints.
 *
 * Both functions accept the workspace key (the same 43-char random string stored
 * in `state/versions/browser.ts`) and pass it as `x-editor-workspace` — the same
 * header the version-store client uses.
 */
import type { ImageMeta } from '$lib/server/images/files';

export type { ImageMeta };

export interface ImageGallery {
	items: ImageMeta[];
}

export async function uploadImage(file: File, workspaceKey: string): Promise<ImageMeta> {
	const form = new FormData();
	form.append('file', file);

	const response = await fetch('/images/upload', {
		method: 'POST',
		headers: { 'x-editor-workspace': workspaceKey },
		body: form
	});

	if (!response.ok) {
		const text = await response.text().catch(() => response.statusText);
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json() as Promise<ImageMeta>;
}

export async function listImages(workspaceKey: string): Promise<ImageGallery> {
	const response = await fetch('/images/gallery', {
		headers: { 'x-editor-workspace': workspaceKey }
	});

	if (!response.ok) {
		const text = await response.text().catch(() => response.statusText);
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json() as Promise<ImageGallery>;
}

export async function deleteImage(id: string, workspaceKey: string): Promise<void> {
	const response = await fetch(`/images/gallery/${encodeURIComponent(id)}`, {
		method: 'DELETE',
		headers: { 'x-editor-workspace': workspaceKey }
	});

	if (!response.ok) {
		const text = await response.text().catch(() => response.statusText);
		throw new Error(text || `HTTP ${response.status}`);
	}
}
