import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sectionsOf, type MaterialFile } from '$lib/domain/materials';
import { materials } from './materials.svelte';

vi.mock('$lib/state/versions/server', () => ({ workspaceKey: () => 'k'.repeat(43) }));

const stored = (hash: string, name: string, pages = 1): MaterialFile => ({
	hash,
	name,
	pages,
	unread: [],
	sections: sectionsOf(hash, name, [{ title: 'Jedna', text: 'Text.' }])
});

const calls: [string, RequestInit | undefined][] = [];
function server(files: MaterialFile[]) {
	calls.length = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push([url, init]);
			return init?.method === 'DELETE' ? Response.json({ ok: true }) : Response.json({ files });
		})
	);
}

beforeEach(async () => {
	server([]);
	await materials.load('other');
});
afterEach(() => vi.unstubAllGlobals());

describe('the course’s materials in the browser', () => {
	it('loads the course’s files from the server, under the workspace key, and forgets them for another course', async () => {
		server([stored('abcdef0123456789', 'a.docx')]);
		await materials.load('kurz');
		expect(materials.files.map((f) => f.name)).toEqual(['a.docx']);
		expect(materials.sections).toHaveLength(1);
		const [url, init] = calls[0];
		expect(url).toBe('/materials/kurz');
		expect((init?.headers as Record<string, string>)['x-editor-workspace']).toHaveLength(43);

		server([]);
		await materials.load('jiny');
		expect(materials.files).toEqual([]);
	});

	it('ignores a stored file that is not in the shape it expects', async () => {
		server([{ hash: 'x' } as unknown as MaterialFile, stored('abcdef0123456789', 'a.docx')]);
		await materials.load('kurz');
		expect(materials.files.map((f) => f.name)).toEqual(['a.docx']);
	});

	it('removes a file at once, and asks the server to forget it', async () => {
		server([stored('abcdef0123456789', 'a.docx'), stored('1234567890abcdef', 'b.pdf')]);
		await materials.load('kurz');
		await materials.remove('kurz', 'abcdef0123456789');
		expect(materials.files.map((f) => f.name)).toEqual(['b.pdf']);
		expect(calls.at(-1)![0]).toBe('/materials/kurz/abcdef0123456789');
		expect(calls.at(-1)![1]?.method).toBe('DELETE');
	});

	it('brings the file back when the server could not forget it', async () => {
		server([stored('abcdef0123456789', 'a.docx')]);
		await materials.load('kurz');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 500 }))
		);
		await materials.remove('kurz', 'abcdef0123456789');
		expect(materials.files).toHaveLength(1);
	});

	it('refuses a file it cannot read, and one that is too big, in one line each, and reads nothing', async () => {
		server([]);
		await materials.load('kurz');
		await materials.add('kurz', [new File(['x'], 'archiv.zip')]);
		expect(materials.message).toBe(
			'Soubor archiv.zip neumím přečíst. Zkus Word, PowerPoint, PDF nebo obrázek.'
		);
		const huge = new File(['x'], 'velky.pdf');
		Object.defineProperty(huge, 'size', { value: 51 * 1024 * 1024 });
		await materials.add('kurz', [huge]);
		expect(materials.message).toBe('Soubor velky.pdf je větší než 50 MB.');
		expect(materials.reading).toEqual([]);
		expect(materials.files).toEqual([]);
	});
});
