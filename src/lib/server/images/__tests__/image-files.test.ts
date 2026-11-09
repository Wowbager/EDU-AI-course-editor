/**
 * Unit tests for ImageFiles.
 *
 * Uses a real temp directory (os.tmpdir()) so the atomic-write logic runs against
 * a real filesystem — the same approach as `version-files.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ImageFiles, ImageError, MAX_IMAGE_BYTES, MAX_IMAGES_PER_OWNER } from '../files';

const FAKE_OWNER = 'ws_' + '0'.repeat(64);
const PNG_1PX = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
	0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
	0x44, 0xae, 0x42, 0x60, 0x82
]);

let dir: string;
let store: ImageFiles;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'image-files-test-'));
	store = new ImageFiles(dir);
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('ImageFiles', () => {
	describe('list', () => {
		it('returns an empty items array when no images have been uploaded', async () => {
			const result = await store.list(FAKE_OWNER);
			expect(result.items).toEqual([]);
		});
	});

	describe('upload', () => {
		it('stores an image and returns metadata with a URL', async () => {
			const meta = await store.upload(FAKE_OWNER, PNG_1PX, 'test.png', 'image/png');
			expect(meta.name).toBe('test.png');
			expect(meta.url).toMatch(/^\/images\/file\//);
			expect(meta.size).toBe(PNG_1PX.byteLength);
			expect(meta.mimeType).toBe('image/png');
			expect(meta.uploadedAt).toBeTruthy();
		});

		it('appears in the list after upload', async () => {
			await store.upload(FAKE_OWNER, PNG_1PX, 'a.png', 'image/png');
			const { items } = await store.list(FAKE_OWNER);
			expect(items).toHaveLength(1);
			expect(items[0].name).toBe('a.png');
		});

		it('prepends new uploads (most recent first)', async () => {
			await store.upload(FAKE_OWNER, PNG_1PX, 'first.png', 'image/png');
			await store.upload(FAKE_OWNER, PNG_1PX, 'second.png', 'image/png');
			const { items } = await store.list(FAKE_OWNER);
			expect(items[0].name).toBe('second.png');
			expect(items[1].name).toBe('first.png');
		});

		it('rejects an unsupported MIME type with a 400 error', async () => {
			await expect(
				store.upload(FAKE_OWNER, PNG_1PX, 'doc.pdf', 'application/pdf')
			).rejects.toMatchObject({ status: 400 });
		});

		it('rejects a file that exceeds the size cap with a 413 error', async () => {
			const tooBig = new Uint8Array(MAX_IMAGE_BYTES + 1);
			await expect(store.upload(FAKE_OWNER, tooBig, 'big.png', 'image/png')).rejects.toMatchObject({
				status: 413
			});
		});

		it('rejects when the per-owner count is at the maximum (429)', async () => {
			// Patch the constant with a tiny limit to avoid actually uploading 500 files.
			const tinyStore = new (class extends ImageFiles {
				async upload(owner: string, bytes: Uint8Array, name: string, mime: string) {
					// Fill the index to the limit without touching disk.
					const fakeItems = Array.from({ length: MAX_IMAGES_PER_OWNER }, (_, i) => ({
						id: `${i}.png`,
						name: `${i}.png`,
						url: `/images/file/${i}.png`,
						size: 1,
						uploadedAt: new Date().toISOString(),
						mimeType: 'image/png'
					}));
					// Write the fake index then call the real upload.
					const { writeFile, mkdir } = await import('node:fs/promises');
					const { join: j } = await import('node:path');
					const imgDir = j(dir, 'owners', owner, 'images');
					await mkdir(imgDir, { recursive: true });
					await writeFile(j(imgDir, 'index.json'), JSON.stringify({ items: fakeItems }));
					return super.upload(owner, bytes, name, mime);
				}
			})(dir);

			await expect(
				tinyStore.upload(FAKE_OWNER, PNG_1PX, 'over.png', 'image/png')
			).rejects.toMatchObject({ status: 429 });
		});

		it('sanitises a dangerous filename', async () => {
			const meta = await store.upload(FAKE_OWNER, PNG_1PX, '../../../etc/passwd', 'image/png');
			expect(meta.name).not.toContain('..');
			expect(meta.name).not.toContain('/');
		});
	});

	describe('delete', () => {
		it('removes the image from the index and deletes the file', async () => {
			const meta = await store.upload(FAKE_OWNER, PNG_1PX, 'to-delete.png', 'image/png');
			const servedBefore = await store.serveFile(meta.id);
			expect(servedBefore).not.toBeNull();

			const deleted = await store.delete(FAKE_OWNER, meta.id);
			expect(deleted).toBe(true);

			const { items } = await store.list(FAKE_OWNER);
			expect(items).toHaveLength(0);

			const servedAfter = await store.serveFile(meta.id);
			expect(servedAfter).toBeNull();
		});

		it('returns false when deleting a nonexistent image id', async () => {
			const fakeUuid = '00000000-0000-0000-0000-000000000000.png';
			const result = await store.delete(FAKE_OWNER, fakeUuid);
			expect(result).toBe(false);
		});

		it('returns false for an invalid id', async () => {
			const result = await store.delete(FAKE_OWNER, '../../../etc/passwd');
			expect(result).toBe(false);
		});
	});

	describe('serveFile', () => {
		it('returns the file stream for an uploaded image', async () => {
			const meta = await store.upload(FAKE_OWNER, PNG_1PX, 'serve.png', 'image/png');
			const served = await store.serveFile(meta.id);
			expect(served).not.toBeNull();
			expect(served!.contentType).toBe('image/png');
			// Read the stream to verify content
			const chunks: Uint8Array[] = [];
			for await (const chunk of served!.stream) {
				chunks.push(chunk as Uint8Array);
			}
			const bytes = Buffer.concat(chunks);
			expect(bytes).toEqual(Buffer.from(PNG_1PX));
		});

		it('returns null for an unknown id', async () => {
			const result = await store.serveFile('nonexistent-id');
			expect(result).toBeNull();
		});

		it('returns null for a path-traversal id attempt', async () => {
			const result = await store.serveFile('../../../etc/passwd');
			expect(result).toBeNull();
		});
	});

	describe('ImageError', () => {
		it('carries the HTTP status', () => {
			const e = new ImageError(400, 'test');
			expect(e.status).toBe(400);
			expect(e.message).toBe('test');
		});
	});
});
