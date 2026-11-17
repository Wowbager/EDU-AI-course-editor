/**
 * A picture opened on its own runs nothing on the editor's origin: an SVG uploaded before
 * SVG was refused, or one a teacher's link points at, comes with a sandbox.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ImageFiles } from '$lib/server/images/files';

let dir = '';
vi.mock('$lib/server/images/instance', () => ({ imageFiles: () => new ImageFiles(dir) }));
vi.mock('$lib/server/image-fetch-guard', () => ({
	fetchImageSafely: async () => ({
		ok: true,
		response: new Response('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', {
			headers: { 'content-type': 'image/svg+xml' }
		})
	})
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { GET as file } from './+server';
import { GET as preview } from '../../../preview-image/+server';

const ID = '00000000-0000-4000-8000-000000000000-kruh.svg';

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'untrusted-'));
	await mkdir(join(dir, 'images'));
	await writeFile(
		join(dir, 'images', ID),
		'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'
	);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

function expectSandboxed(response: Response) {
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(response.headers.get('content-security-policy')).toContain('sandbox');
	expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
}

describe('a picture the server passes on', () => {
	it('is sandboxed when it is an uploaded one', async () => {
		const response = await file({ params: { id: ID } } as never);
		expect(response.headers.get('content-type')).toBe('image/svg+xml');
		expectSandboxed(response);
	});

	it('is sandboxed when the preview fetches it, from here or from a teacher’s link', async () => {
		const local = new URL(
			`http://x/preview-image?url=${encodeURIComponent(`https://e.cz/images/file/${ID}`)}`
		);
		expectSandboxed(await preview({ url: local } as never));
		const remote = new URL('http://x/preview-image?url=https%3A%2F%2Fexample.com%2Fkruh.svg');
		expectSandboxed(await preview({ url: remote } as never));
	});
});
