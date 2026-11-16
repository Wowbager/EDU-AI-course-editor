import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MAX_PAGES, MAX_SECTION_CHARS } from '$lib/domain/materials';
import { ACCEPT, kindOf, readMaterial, unsupported, type Libraries } from '../read';
import { Refused, type ReadIO } from '../types';

const io: ReadIO = {
	ocr: async () => '',
	shrink: async (b) => b,
	renderPage: async () => new Blob()
};
const libraries = {
	xlsx: async () => XLSX
} as unknown as Libraries;
const room = { pages: MAX_PAGES };

const file = (bytes: Uint8Array | string, name: string) =>
	Object.assign(new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)]), { name });
const read = (f: ReturnType<typeof file>, r = room) => readMaterial(f, io, r, libraries);

/** Czech text as windows-1250 bytes, for the letters these tests use. */
const CP1250: Record<string, number> = {
	č: 0xe8,
	š: 0x9a,
	ž: 0x9e,
	ř: 0xf8,
	ě: 0xec,
	ý: 0xfd,
	á: 0xe1,
	í: 0xed,
	é: 0xe9,
	ů: 0xf9,
	Č: 0xc8,
	Ř: 0xd8
};
const cp1250 = (text: string) =>
	Uint8Array.from([...text].map((c) => CP1250[c] ?? c.charCodeAt(0)));

describe('a text file', () => {
	it('reads UTF-8 and drops the BOM', async () => {
		const bom = new Uint8Array([
			0xef,
			0xbb,
			0xbf,
			...new TextEncoder().encode('Příliš žluťoučký kůň')
		]);
		const out = await read(file(bom, 'a.txt'));
		expect(out.sections).toHaveLength(1);
		expect(out.sections[0].text).toBe('Příliš žluťoučký kůň');
		expect(out.sections[0].title).toBe('a');
		expect(out.pages).toBe(1);
	});

	it('reads windows-1250 when the bytes are not UTF-8', async () => {
		const out = await read(file(cp1250('Řeka teče přes město, žába skáče'), 'stary.txt'));
		expect(out.sections[0].text).toBe('Řeka teče přes město, žába skáče');
	});

	it('cuts a Markdown file at its headings', async () => {
		const out = await read(
			file('Úvod text\n\n# První\n\nTělo jedna.\n\n## Druhý\n\nTělo dvě.\n\n# Prázdný\n', 'n.md')
		);
		expect(out.sections.map((s) => s.title)).toEqual(['Úvod', 'První', 'Druhý']);
		expect(out.sections[1].text).toContain('Tělo jedna.');
	});

	it('cuts a huge plain text into pieces and counts a page for about 3000 characters', async () => {
		const text = Array.from({ length: 40 }, (_, i) => `Odstavec ${i} ${'x'.repeat(980)}`).join(
			'\n\n'
		);
		const out = await read(file(text, 'velky.txt'));
		expect(out.sections.length).toBeGreaterThan(5);
		expect(out.sections.every((s) => s.text.length <= 6000)).toBe(true);
		expect(out.sections.map((s) => s.text).join('')).toContain('Odstavec 39');
		expect(out.pages).toBe(Math.ceil(text.length / 3000));
	});

	it('refuses a text longer than the pages left', async () => {
		await expect(read(file('x'.repeat(3000 * 101), 'moc.txt'))).rejects.toBeInstanceOf(Refused);
	});
});

const book = (sheets: Record<string, unknown[][]>) => {
	const wb = XLSX.utils.book_new();
	for (const [name, rows] of Object.entries(sheets))
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
	return wb;
};
const bytes = (wb: XLSX.WorkBook, bookType: XLSX.BookType) =>
	new Uint8Array(XLSX.write(wb, { type: 'array', bookType, cellStyles: true }) as ArrayBuffer);

describe('a spreadsheet', () => {
	it('becomes a table per sheet with shown values, skipping empty rows, columns and sheets', async () => {
		const wb = book({
			Data: [
				['Jméno', 'Body', 'Poznámka | zlo', ''],
				[],
				['Eva', 3, 'řádek\nnový', ''],
				['Jan', 4, '', '']
			],
			Prázdný: [[], ['', '']]
		});
		wb.Sheets.Data['B5'] = { t: 'n', f: 'SUM(B3:B4)', v: 7 };
		wb.Sheets.Data['A6'] = { t: 'n', v: 45292, z: 'dd.mm.yyyy' };
		wb.Sheets.Data['!ref'] = 'A1:D6';
		const out = await read(file(bytes(wb, 'xlsx'), 'k.xlsx'));
		expect(out.pages).toBe(1);
		expect(out.sections.map((s) => s.title)).toEqual(['Data']);
		const text = out.sections[0].text;
		expect(text.split('\n')[0]).toBe('| Jméno | Body | Poznámka \\| zlo |');
		expect(text).toContain('| Eva | 3 | řádek nový |');
		expect(text).toContain('|  | 7 |  |');
		expect(text).toContain('| 01.01.2024 |  |  |');
		expect(text).not.toContain('| Jan | 4 |  |\n\n');
		expect(out.unread).toEqual([]);
	});

	it.each(['ods', 'xls'] as const)('reads a .%s', async (type) => {
		const out = await read(
			file(
				bytes(
					book({
						A: [
							['x', 'y'],
							[1, 2]
						],
						B: [['z'], ['w']]
					}),
					type
				),
				`k.${type}`
			)
		);
		expect(out.sections.map((s) => s.title)).toEqual(['A', 'B']);
		expect(out.pages).toBe(2);
		expect(out.sections[0].text).toContain('| 1 | 2 |');
	});

	it('reads a CSV with ; separators in windows-1250', async () => {
		const out = await read(file(cp1250('Město;Počet\nPraha;1,3\nBrno;0,4\n'), 'e.csv'));
		expect(out.sections[0].text).toBe(
			'| Město | Počet |\n| --- | --- |\n| Praha | 1,3 |\n| Brno | 0,4 |'
		);
	});

	it('reads a TSV', async () => {
		const out = await read(file('a\tb\n1\t2\n', 'e.tsv'));
		expect(out.sections[0].text).toContain('| 1 | 2 |');
	});

	it('shortens a huge sheet and says so', async () => {
		const rows = [
			['Číslo', 'Text'],
			...Array.from({ length: 6000 }, (_, i) => [i, 'y'.repeat(60)])
		];
		const out = await read(file(bytes(book({ Data: rows }), 'xlsx'), 'h.xlsx'));
		const text = out.sections[0].text;
		expect(text.length).toBeLessThanOrEqual(MAX_SECTION_CHARS);
		expect(text.endsWith('|')).toBe(true);
		expect(out.unread).toHaveLength(1);
		const kept = text.split('\n').length - 1;
		expect(out.unread[0]).toBe(`List Data: zkráceno na prvních ${kept} řádků`);
		expect(kept).toBeLessThan(6001);
	});

	it('refuses a file with nothing in it', async () => {
		await expect(read(file(bytes(book({ A: [[]] }), 'xlsx'), 'p.xlsx'))).rejects.toBeInstanceOf(
			Refused
		);
	});
});

describe('kinds of file', () => {
	it('knows text and sheets, and offers them in the picker', () => {
		for (const n of ['a.txt', 'A.MD']) expect(kindOf(n)).toBe('text');
		for (const n of ['a.xlsx', 'a.xls', 'a.ods', 'a.csv', 'a.tsv', 'a.Numbers'])
			expect(kindOf(n)).toBe('sheet');
		expect(kindOf('a.zip')).toBeUndefined();
		for (const e of ['.txt', '.md', '.xlsx', '.xls', '.ods', '.csv', '.tsv', '.numbers'])
			expect(ACCEPT.split(',')).toContain(e);
		expect(unsupported('a.zip')).toBe(
			'Soubor a.zip neumím přečíst. Zkus Word, PowerPoint, PDF, tabulku, text nebo obrázek.'
		);
	});
});
