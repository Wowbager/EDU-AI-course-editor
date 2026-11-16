import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { MAX_PAGES } from '$lib/domain/materials';
import { fitSide } from '../image';
import { readMaterial, hashOf, kindOf, unsupported, type Libraries } from '../read';
import { readDocx } from '../docx';
import { readPdf } from '../pdf';
import UTIF from 'utif2';
import { Refused, type ReadIO } from '../types';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = async (name: string) => {
	const bytes = await readFile(join(here, 'fixtures', name));
	return Object.assign(new Blob([new Uint8Array(bytes)]), { name });
};

/** What the browser would do, with pictures "read" as a line that says they were read. */
function io(overrides: Partial<ReadIO> = {}): ReadIO & { read: number } {
	const state = {
		read: 0,
		ocr: async (picture: Blob) => {
			state.read++;
			return `Přepis obrázku ($${picture.size > 0 ? 'x' : '?'}$)`;
		},
		shrink: async (picture: Blob) => picture,
		fromPixels: async () => new Blob(['p'], { type: 'image/png' }),
		renderPage: async () => new Blob(['page'], { type: 'image/png' }),
		...overrides
	};
	return state;
}

const libraries: Libraries = {
	mammoth: async () =>
		((await import('mammoth/mammoth.browser.js')) as unknown as { default: never }).default,
	jszip: async () => JSZip,
	pdfjs: async () =>
		(await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as Awaited<
			ReturnType<Libraries['pdfjs']>
		>,
	xlsx: async () => await import('xlsx'),
	utif: async () => UTIF as unknown as Awaited<ReturnType<Libraries['utif']>>,
	heic: async () => {
		throw new Error('no converter');
	}
};

const room = { pages: MAX_PAGES };

describe('a Word file', () => {
	it('becomes a section per heading, with the text as Markdown and no pictures read', async () => {
		const reader = io();
		const file = await readMaterial(await fixture('handout.docx'), reader, room, libraries);
		expect(file.sections.map((s) => s.title)).toEqual([
			'Lineární rovnice',
			'Řešení krok za krokem',
			'Zkouška'
		]);
		const second = file.sections[1];
		expect(second.text).toContain('x + 5 = 12');
		expect(second.text).toContain('x = 12 - 5 = 7');
		// Every section has a stable key made of the file's hash and its place, and a file name.
		expect(file.sections.map((s) => s.key)).toEqual(
			[0, 1, 2].map((i) => `${file.hash.slice(0, 8)}.${i}`)
		);
		expect(file.sections.every((s) => s.file === 'handout.docx')).toBe(true);
		expect(file.sections[0].unit).toBeUndefined();
		expect(file.unread).toEqual([]);
		expect(reader.read).toBe(0);
	});

	it('gives the same keys for the same bytes, and other keys for other bytes', async () => {
		const a = await readMaterial(await fixture('handout.docx'), io(), room, libraries);
		const b = await readMaterial(await fixture('handout.docx'), io(), room, libraries);
		expect(b.sections.map((s) => s.key)).toEqual(a.sections.map((s) => s.key));
		expect(await hashOf(new TextEncoder().encode('a').buffer as ArrayBuffer)).not.toBe(
			await hashOf(new TextEncoder().encode('b').buffer as ArrayBuffer)
		);
	});

	it('fails when the bytes are not a Word file', async () => {
		await expect(
			readDocx(
				new TextEncoder().encode('not a zip').buffer as ArrayBuffer,
				io(),
				room,
				(await libraries.mammoth()) as never,
				JSZip
			)
		).rejects.toBeTruthy();
	});
});

describe('a PowerPoint file', () => {
	it('becomes a section per slide in the deck order, with title, text and speaker notes', async () => {
		const reader = io();
		const file = await readMaterial(await fixture('slides.pptx'), reader, room, libraries);
		// The deck lists slide 2 first.
		expect(file.sections.map((s) => [s.title, s.unit, s.from])).toEqual([
			['Úvod', 'slide', 1],
			['Zlomky & čísla', 'slide', 2],
			['Snímek 3', 'slide', 3]
		]);
		expect(file.sections[0].text).toContain('Dnes se naučíme zlomky.');
		expect(file.sections[0].text).toContain('Poznámky: Začni příkladem s pizzou.');
		expect(file.sections[1].text).toContain('- Čitatel nad čarou');
		expect(file.sections[1].text).toContain('Poznámky: Zdůrazni, že jmenovatel nesmí být nula.');
		expect(file.pages).toBe(3);
	});

	it('reads the picture of a slide that has only a picture, and no other', async () => {
		const reader = io();
		const file = await readMaterial(await fixture('slides.pptx'), reader, room, libraries);
		expect(reader.read).toBe(1);
		expect(file.sections[2].text).toContain('Přepis obrázku');
	});

	it('says which slide could not be read', async () => {
		const reader = io({
			ocr: async () => {
				throw new Error('503');
			}
		});
		const file = await readMaterial(await fixture('slides.pptx'), reader, room, libraries);
		expect(file.unread).toEqual(['Snímek 3 se nepodařilo přečíst']);
		expect(file.sections).toHaveLength(2);
	});
});

describe('a PDF', () => {
	it('takes the text layer of a page that has one and reads a page that is only a picture', async () => {
		const reader = io();
		const file = await readMaterial(await fixture('scan.pdf'), reader, room, libraries);
		expect(file.pages).toBe(2);
		expect(file.sections.map((s) => [s.title, s.unit, s.from])).toEqual([
			['Strana 1', 'page', 1],
			['Strana 2', 'page', 2]
		]);
		expect(file.sections[0].text).toContain('Sčítání zlomků se stejným jmenovatelem');
		expect(file.sections[1].text).toContain('Přepis obrázku');
		// Only the scan went to the picture reader.
		expect(reader.read).toBe(1);
	});

	it('says which page could not be read, and keeps the others', async () => {
		const reader = io({
			renderPage: async () => {
				throw new Error('no canvas');
			}
		});
		const file = await readMaterial(await fixture('scan.pdf'), reader, room, libraries);
		expect(file.unread).toEqual(['Stranu 2 se nepodařilo přečíst']);
		expect(file.sections.map((s) => s.title)).toEqual(['Strana 1']);
	});

	it('is refused when it has more pages than the course has room for', async () => {
		const pdfjs = await libraries.pdfjs();
		const data = (await (await fixture('scan.pdf')).arrayBuffer()) as ArrayBuffer;
		const refused = readPdf(data, io(), { pages: 1 }, pdfjs);
		await expect(refused).rejects.toThrow(Refused);
		await expect(refused).rejects.toThrow(/100 stran/);
		// The caller's bytes are still there after the read.
		expect(data.byteLength).toBeGreaterThan(0);
	});
});

describe('a picture', () => {
	it('is one section named for the file, read once', async () => {
		const reader = io();
		const file = await readMaterial(await fixture('page.png'), reader, room, libraries);
		expect(file.sections).toHaveLength(1);
		expect(file.sections[0].title).toBe('page');
		expect(file.sections[0].text).toContain('Přepis obrázku');
		expect(file.pages).toBe(1);
		expect(reader.read).toBe(1);
	});

	it('says plainly that a HEIC photo cannot be opened when the browser cannot decode it', async () => {
		const heic = Object.assign(new Blob(['x']), { name: 'foto.heic' });
		const reader = io({
			shrink: async () => {
				throw new Error('cannot decode');
			}
		});
		await expect(readMaterial(heic, reader, room, libraries)).rejects.toThrow(/HEIC/);
	});

	it('converts a HEIC photo the browser cannot decode, and reads the converted JPEG', async () => {
		const heic = Object.assign(new Blob(['x']), { name: 'foto.HEIF' });
		const shrunk: string[] = [];
		const reader = io({
			shrink: async (b) => {
				shrunk.push(b.type);
				if (b === heic) throw new Error('cannot decode');
				return b;
			}
		});
		let asked: { toType: string } | undefined;
		const file = await readMaterial(heic, reader, room, {
			...libraries,
			heic: async () => async (o) => {
				asked = o;
				return [new Blob(['jpg'], { type: 'image/jpeg' })];
			}
		});
		expect(asked?.toType).toBe('image/jpeg');
		expect(shrunk).toEqual(['', 'image/jpeg']);
		expect(file.pages).toBe(1);
		expect(reader.read).toBe(1);
	});

	it('does not try the converter for other formats, and says so when both fail', async () => {
		let called = 0;
		const failing = io({
			shrink: async () => {
				throw new Error('cannot decode');
			}
		});
		const heic = async () => {
			called++;
			return async () => {
				throw new Error('bad');
			};
		};
		await expect(
			readMaterial(Object.assign(new Blob(['x']), { name: 'a.gif' }), failing, room, {
				...libraries,
				heic
			})
		).rejects.toThrow(/nepodařilo otevřít/);
		expect(called).toBe(0);
		await expect(
			readMaterial(Object.assign(new Blob(['x']), { name: 'a.heic' }), failing, room, {
				...libraries,
				heic
			})
		).rejects.toThrow(/HEIC/);
		expect(called).toBe(1);
	});

	it('is refused when the reading finds nothing', async () => {
		const reader = io({ ocr: async () => '' });
		await expect(readMaterial(await fixture('page.png'), reader, room, libraries)).rejects.toThrow(
			/nenašel žádný text/
		);
	});
});

/**
 * An uncompressed grayscale TIFF of `n` pages of 4x4 pixels, written by hand (utif2's
 * encoder writes one page only).
 */
function tiff(n: number): Blob & { name: string } {
	const entries = 8;
	const ifdSize = 2 + entries * 12 + 4;
	const bytes = new Uint8Array(8 + n * (ifdSize + 16));
	const view = new DataView(bytes.buffer);
	view.setUint16(0, 0x4949, true);
	view.setUint16(2, 42, true);
	view.setUint32(4, 8, true);
	for (let page = 0; page < n; page++) {
		const ifd = 8 + page * (ifdSize + 16);
		const data = ifd + ifdSize;
		view.setUint16(ifd, entries, true);
		// tag, type (3 = SHORT, 4 = LONG), value
		[
			[256, 3, 4],
			[257, 3, 4],
			[258, 3, 8],
			[262, 3, 1],
			[273, 4, data],
			[277, 3, 1],
			[278, 3, 4],
			[279, 4, 16]
		].forEach(([tag, type, value], i) => {
			const at = ifd + 2 + i * 12;
			view.setUint16(at, tag, true);
			view.setUint16(at + 2, type, true);
			view.setUint32(at + 4, 1, true);
			if (type === 3) view.setUint16(at + 8, value, true);
			else view.setUint32(at + 8, value, true);
		});
		view.setUint32(ifd + 2 + entries * 12, page < n - 1 ? data + 16 : 0, true);
		bytes.fill(40 + page * 50, data, data + 16);
	}
	return Object.assign(new Blob([bytes]), { name: n === 1 ? 'sken.tif' : 'sken.tiff' });
}

describe('a TIFF', () => {
	it('is one page, titled by the file name', async () => {
		const reader = io();
		const file = await readMaterial(tiff(1), reader, room, libraries);
		expect(file.pages).toBe(1);
		expect(file.sections.map((s) => s.title)).toEqual(['sken']);
		expect(reader.read).toBe(1);
	});

	it('counts and reads every page of a multi-page scan, a failed page said in Czech', async () => {
		let calls = 0;
		const reader = io({
			ocr: async () => {
				if (++calls === 2) throw new Error('server');
				return 'Text strany';
			}
		});
		const file = await readMaterial(tiff(3), reader, room, libraries);
		expect(file.pages).toBe(3);
		expect(file.sections).toHaveLength(2);
		expect(file.unread).toHaveLength(1);
		expect(file.unread[0]).toMatch(/^Stranu \d se nepodařilo přečíst$/);
	});

	it('lets go of each decoded page once it is read', async () => {
		const seen: object[] = [];
		const spy = {
			...(UTIF as object),
			decode: (b: ArrayBuffer) => {
				const out = UTIF.decode(b);
				seen.push(...out);
				return out;
			}
		} as unknown as Awaited<ReturnType<Libraries['utif']>>;
		await readMaterial(tiff(3), io(), room, { ...libraries, utif: async () => spy });
		expect(seen).toHaveLength(3);
		expect(seen.every((p) => (p as { data?: unknown }).data === undefined)).toBe(true);
	});

	it('respects the pages left in the budget', async () => {
		await expect(readMaterial(tiff(3), io(), { pages: 2 }, libraries)).rejects.toThrow(/nejvýše/);
	});
});

describe('fitSide', () => {
	it('shrinks a 600 dpi scan to the longest side and never enlarges', () => {
		expect(fitSide(5000, 7000, 1600)).toEqual({ width: 1143, height: 1600 });
		expect(fitSide(800, 600, 1600)).toEqual({ width: 800, height: 600 });
	});
});

describe('which files are taken', () => {
	it('knows the kinds by their extension and refuses the old Office formats with the way out', () => {
		expect(['a.DOCX', 'b.pptx', 'c.pdf', 'd.JPG', 'e.heic', 'f.webp'].map(kindOf)).toEqual([
			'docx',
			'pptx',
			'pdf',
			'image',
			'image',
			'image'
		]);
		expect(['a.gif', 'b.BMP', 'c.avif', 'd.heif'].map(kindOf)).toEqual([
			'image',
			'image',
			'image',
			'image'
		]);
		expect(['a.tif', 'b.TIFF'].map(kindOf)).toEqual(['tiff', 'tiff']);
		expect(kindOf('x.doc')).toBeUndefined();
		expect(unsupported('x.doc')).toContain('.docx');
		expect(unsupported('x.zip')).toContain('Word, PowerPoint, PDF');
	});
});
