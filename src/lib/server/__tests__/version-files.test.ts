import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyCourse } from '$lib/domain/document';
import { snapshot } from '$lib/domain/versions';
import { VersionFiles, VersionError } from '../versions/files';
import { resolveOwner, WORKSPACE_HEADER } from '../versions/owner';

const OWNER = `ws_${'a'.repeat(64)}`;
const now = new Date('2026-09-26T10:00:00Z');
const version = (n: number, name = 'Kurz') => snapshot({ ...emptyCourse('KURZ_X', name), lessons: [] }, n, now);

let root: string;
let files: VersionFiles;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'versions-'));
	files = new VersionFiles(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const status = async (work: Promise<unknown>) => {
	try {
		await work;
		return 200;
	} catch (e) {
		if (e instanceof VersionError) return e.status;
		throw e;
	}
};

describe('versions on the server', () => {
	it('stores, lists and returns a version', async () => {
		await files.put(OWNER, 'KURZ_X', version(1));
		await files.setPublished(OWNER, 'KURZ_X', { version: 1, visibility: 'public', at: now.toISOString() });
		const index = await files.index(OWNER, 'KURZ_X');
		expect(index.versions.map((v) => v.version)).toEqual([1]);
		expect(index.published).toMatchObject({ version: 1, visibility: 'public' });
		expect((await files.get(OWNER, 'KURZ_X', 1))?.doc.name).toBe('Kurz');
	});

	it('accepts the same version twice and refuses other content under its number', async () => {
		await files.put(OWNER, 'KURZ_X', version(1));
		expect(await status(files.put(OWNER, 'KURZ_X', version(1)))).toBe(200);
		expect(await status(files.put(OWNER, 'KURZ_X', version(1, 'Jiný')))).toBe(409);
	});

	it('keeps owners apart', async () => {
		await files.put(OWNER, 'KURZ_X', version(1));
		const other = `ws_${'b'.repeat(64)}`;
		expect((await files.index(other, 'KURZ_X')).versions).toEqual([]);
	});

	it('lets nothing from the request reach a path unchecked', async () => {
		for (const courseId of ['../x', 'a/b', '..', '', 'x'.repeat(81)]) {
			expect(await status(files.index(OWNER, courseId)), courseId).toBe(400);
		}
		expect(await status(files.index('../../etc', 'KURZ_X'))).toBe(400);
		expect(await status(files.get(OWNER, 'KURZ_X', -1))).toBe(400);
		expect(await status(files.get(OWNER, 'KURZ_X', 1.5))).toBe(400);
	});

	it('stores only a course whose content matches what it claims', async () => {
		const good = version(2);
		expect(await status(files.put(OWNER, 'KURZ_X', { ...good, hash: '0'.repeat(16) }))).toBe(400);
		expect(await status(files.put(OWNER, 'KURZ_X', { ...good, version: 3 }))).toBe(400);
		expect(await status(files.put(OWNER, 'OTHER', good))).toBe(400);
		expect(await status(files.put(OWNER, 'KURZ_X', { ...good, doc: { not: 'a course' } }))).toBe(400);
		expect(await status(files.setPublished(OWNER, 'KURZ_X', { version: 1, visibility: 'everyone', at: 'x' }))).toBe(400);
		// Nothing half-written was left behind.
		expect(await readdir(root).catch(() => [])).toEqual([]);
	});

	it('does not interleave two writes to one course', async () => {
		await Promise.all([1, 2, 3, 4, 5].map((n) => files.put(OWNER, 'KURZ_X', version(n))));
		expect((await files.index(OWNER, 'KURZ_X')).versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
	});
});

describe('who a request belongs to', () => {
	const request = (key?: string) =>
		new Request('http://localhost/versions/X', { headers: key ? { [WORKSPACE_HEADER]: key } : {} });

	it('is the hash of the browser key, never the key', () => {
		const key = 'A'.repeat(43);
		const owner = resolveOwner(request(key))!;
		expect(owner.id).toMatch(/^ws_[0-9a-f]{64}$/);
		expect(owner.id).not.toContain(key);
	});

	it('is nobody without a well-formed key', () => {
		expect(resolveOwner(request())).toBeNull();
		expect(resolveOwner(request('short'))).toBeNull();
		expect(resolveOwner(request('../'.repeat(15)))).toBeNull();
	});
});
