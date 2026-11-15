import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_FILES, MAX_PAGES, sectionsOf, type MaterialFile } from '$lib/domain/materials';
import { VersionError } from '../versions/files';
import { MaterialFiles } from './files';

const OWNER = `ws_${'a'.repeat(64)}`;
const OTHER = `ws_${'b'.repeat(64)}`;

const file = (hash: string, name: string, pages = 1): MaterialFile => ({
	hash,
	name,
	pages,
	unread: [],
	sections: sectionsOf(hash, name, [{ title: 'Jedna', text: 'Text.' }])
});
const h = (n: number) => n.toString(16).padStart(16, '0');

const store = async () => new MaterialFiles(await mkdtemp(join(tmpdir(), 'materials-')));

describe('a course’s materials on the server', () => {
	it('lists what was added, in the order it was added, and keeps it for the next call', async () => {
		const files = await store();
		expect(await files.list(OWNER, 'kurz')).toEqual([]);
		await files.add(OWNER, 'kurz', file(h(1), 'b.docx'));
		await new Promise((r) => setTimeout(r, 5));
		await files.add(OWNER, 'kurz', file(h(2), 'a.pdf', 3));
		expect((await files.list(OWNER, 'kurz')).map((f) => f.name)).toEqual(['b.docx', 'a.pdf']);
		expect((await files.list(OWNER, 'kurz'))[0].sections[0].key).toBe(`${h(1).slice(0, 8)}.0`);
	});

	it('belongs to the course and the owner: another course or owner sees nothing', async () => {
		const files = await store();
		await files.add(OWNER, 'kurz', file(h(1), 'a.docx'));
		expect(await files.list(OWNER, 'jiny')).toEqual([]);
		expect(await files.list(OTHER, 'kurz')).toEqual([]);
	});

	it('the same file again is one file, and a removed file is gone', async () => {
		const files = await store();
		await files.add(OWNER, 'kurz', file(h(1), 'a.docx'));
		await files.add(OWNER, 'kurz', file(h(1), 'a.docx'));
		expect(await files.list(OWNER, 'kurz')).toHaveLength(1);
		await files.remove(OWNER, 'kurz', h(1));
		expect(await files.list(OWNER, 'kurz')).toEqual([]);
		// Removing what is not there is not an error.
		await files.remove(OWNER, 'kurz', h(9));
	});

	it('refuses past the page limit and the file limit, and what is refused is not stored', async () => {
		const files = await store();
		await files.add(OWNER, 'kurz', file(h(1), 'a.pdf', MAX_PAGES - 1));
		await expect(files.add(OWNER, 'kurz', file(h(2), 'b.pdf', 2))).rejects.toMatchObject({
			status: 429
		});
		await files.add(OWNER, 'kurz', file(h(3), 'c.pdf', 1));
		expect(await files.list(OWNER, 'kurz')).toHaveLength(2);

		const many = await store();
		for (let i = 0; i < MAX_FILES; i++) await many.add(OWNER, 'kurz', file(h(i + 1), `f${i}.docx`));
		await expect(many.add(OWNER, 'kurz', file(h(999), 'x.docx'))).rejects.toBeInstanceOf(
			VersionError
		);
	});

	it('refuses what is not a file of materials, and a path that is not safe', async () => {
		const files = await store();
		await expect(files.add(OWNER, 'kurz', { hash: 'zz' })).rejects.toMatchObject({ status: 400 });
		// Sections that carry another file's keys.
		const stolen = file(h(1), 'a.docx');
		stolen.sections[0].key = 'ffffffff.0';
		await expect(files.add(OWNER, 'kurz', stolen)).rejects.toMatchObject({ status: 400 });
		await expect(files.list(OWNER, '../x')).rejects.toMatchObject({ status: 400 });
		await expect(files.remove(OWNER, 'kurz', '../../x')).rejects.toMatchObject({ status: 400 });
		await expect(files.list('nobody', 'kurz')).rejects.toMatchObject({ status: 400 });
	});

	it('writes nothing but whole files', async () => {
		const root = await mkdtemp(join(tmpdir(), 'materials-'));
		const files = new MaterialFiles(root);
		await files.add(OWNER, 'kurz', file(h(1), 'a.docx'));
		const dir = join(root, 'owners', OWNER, 'courses', 'kurz', 'materials');
		expect(await readdir(dir)).toEqual([`${h(1)}.json`]);
	});
});
