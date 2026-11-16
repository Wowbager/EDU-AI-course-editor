import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { MAX_PAGES } from '$lib/domain/materials';
import { kindOf, readMaterial, unsupported, ACCEPT, type Libraries } from '../read';
import { Refused, type ReadIO } from '../types';

const libraries: Libraries = {
	mammoth: async () => {
		throw new Error('not used');
	},
	jszip: async () => JSZip,
	pdfjs: async () => {
		throw new Error('not used');
	},
	turndown: async () => ({
		TurndownService: (await import('turndown')).default,
		gfm: (await import('@joplin/turndown-plugin-gfm')).gfm
	}),
	mathml: async () => {
		const { MathMLToLaTeX } = await import('mathml-to-latex');
		return (mathml) => MathMLToLaTeX.convert(mathml);
	}
};

function io(): ReadIO & { read: number } {
	const state = {
		read: 0,
		ocr: async () => {
			state.read++;
			return 'Přepis obrázku';
		},
		shrink: async (picture: Blob) => picture,
		renderPage: async () => new Blob(['page'], { type: 'image/png' })
	};
	return state;
}

const room = { pages: MAX_PAGES };
const file = (name: string, body: BlobPart) => Object.assign(new Blob([body]), { name });
const zipped = async (name: string, files: Record<string, string | Uint8Array>) => {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(files)) zip.file(path, content);
	return file(name, await zip.generateAsync({ type: 'arraybuffer' }));
};

const NS =
	'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';
const content = (body: string, styles = '') =>
	`<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:automatic-styles>${styles}</office:automatic-styles><office:body>${body}</office:body></office:document-content>`;

const LONG = 'Toto je dost dlouhý odstavec, aby se text nepovažoval za obrázek.';

describe('names', () => {
	it('knows the new kinds and keeps the old-format message for .doc and .ppt only', () => {
		expect(['a.html', 'a.HTM', 'a.epub', 'a.odt', 'a.odp'].map(kindOf)).toEqual([
			'html',
			'html',
			'epub',
			'odt',
			'odp'
		]);
		for (const ext of ['.html', '.htm', '.epub', '.odt', '.odp']) expect(ACCEPT).toContain(ext);
		expect(unsupported('a.doc')).toContain('starém formátu');
		expect(unsupported('a.odt')).not.toContain('starém formátu');
	});
});

describe('an HTML page', () => {
	const page = `<!doctype html><html><head><title>Titul</title><style>p{}</style><script>alert(1)</script></head>
<body><nav><a href="/">Menu</a></nav><h1>Zlomky</h1><p>Úvod ke zlomkům ve škole.</p>
<h2>Sčítání</h2><p>Zlomky se sčítají <b>po převedení</b> na společného jmenovatele.</p>
<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math></body></html>`;

	it('becomes sections per heading, with a table, a formula, and no script or menu', async () => {
		const read = await readMaterial(file('a.html', page), io(), room, libraries);
		expect(read.sections.map((s) => s.title)).toEqual(['Zlomky', 'Sčítání']);
		const all = read.sections.map((s) => s.text).join('\n');
		expect(all).toContain('| a   | b   |');
		expect(all).toContain('| 1   | 2   |');
		expect(all).toContain('$\\frac{1}{2}$');
		expect(all).toContain('**po převedení**');
		expect(all).not.toMatch(/alert|Menu|Titul/);
	});

	it('reads a picture that is a data: address when the page has no text, and drops others', async () => {
		const reader = io();
		const png = btoa('not really a png');
		const only = `<body><img src="data:image/png;base64,${png}"><img src="https://x.cz/a.png"></body>`;
		const read = await readMaterial(file('a.htm', only), reader, room, libraries);
		expect(read.sections.map((s) => s.title)).toEqual(['Obrázek 1']);
		expect(reader.read).toBe(1);
		const withText = `<body><p>${LONG}</p><img src="data:image/png;base64,${png}"></body>`;
		const second = io();
		await readMaterial(file('b.html', withText), second, room, libraries);
		expect(second.read).toBe(0);
	});

	it('keeps a backslash and a pipe that are in the page, in a table and in code', async () => {
		const html =
			'<table><tr><th>a</th><th>b</th></tr><tr><td>a|b</td><td>c</td></tr></table><pre><code>a\\*b</code></pre>';
		const read = await readMaterial(file('a.html', html), io(), room, libraries);
		const text = read.sections.map((s) => s.text).join('\n');
		expect(text).toContain('| a\\|b | c   |');
		expect(text).toContain('a\\*b');
	});

	it('refuses a page longer than the budget', async () => {
		const words = `<p>${'slovo '.repeat(1100)}</p>`;
		await expect(
			readMaterial(file('a.html', words), io(), { pages: 2 }, libraries)
		).rejects.toBeInstanceOf(Refused);
	});
});

describe('an e-book', () => {
	const epub = (chapters: number, spine = [...Array(chapters).keys()]) =>
		zipped('kniha.epub', {
			'META-INF/container.xml':
				'<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
			'OEBPS/content.opf': `<package><manifest>${[...Array(chapters).keys()]
				.map((i) => `<item id="c${i}" href="text/c${i}.xhtml" media-type="application/xhtml+xml"/>`)
				.join('')}<item id="img" href="x.png" media-type="image/png"/></manifest><spine>${spine
				.map((i) => `<itemref idref="c${i}"/>`)
				.join('')}</spine></package>`,
			...Object.fromEntries(
				[...Array(chapters).keys()].map((i) => [
					`OEBPS/text/c${i}.xhtml`,
					`<html><body><h1>Kapitola číslo ${i}</h1><p>${LONG}</p></body></html>`
				])
			)
		});

	it('follows the spine, not the order of the files, and counts a chapter as a page', async () => {
		const read = await readMaterial(await epub(3, [2, 0, 1]), io(), room, libraries);
		expect(read.sections.map((s) => s.title)).toEqual([
			'Kapitola číslo 2',
			'Kapitola číslo 0',
			'Kapitola číslo 1'
		]);
		expect(read.pages).toBe(3);
	});

	it('respects the pages left', async () => {
		await expect(readMaterial(await epub(5), io(), { pages: 4 }, libraries)).rejects.toBeInstanceOf(
			Refused
		);
	});

	it('counts the pages of long chapters by their words, not one for a chapter', async () => {
		const long = await zipped('b.epub', {
			'META-INF/container.xml':
				"<container><rootfiles><rootfile full-path='c.opf'/></rootfiles></container>",
			'c.opf':
				"<package><manifest><item id='a' href='a%20b.xhtml' media-type='application/xhtml+xml'/><item id='b' href='bad%zz.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='a'/><itemref idref='b'/></spine></package>",
			'a b.xhtml': `<html><body><p>${'slovo '.repeat(2600)}</p></body></html>`,
			'bad%zz.xhtml': `<html><body><p>${LONG}</p></body></html>`
		});
		const read = await readMaterial(long, io(), room, libraries);
		expect(read.pages).toBe(7);
		await expect(readMaterial(long, io(), { pages: 6 }, libraries)).rejects.toBeInstanceOf(Refused);
	});

	it('refuses a file with no chapters', async () => {
		await expect(
			readMaterial(await zipped('a.epub', { 'x.txt': 'x' }), io(), room, libraries)
		).rejects.toThrow('V souboru nejsou žádné kapitoly.');
	});
});

describe('an OpenDocument text', () => {
	const styles =
		'<style:style style:name="T1"><style:text-properties fo:font-weight="bold"/></style:style>';
	const body = `<office:text>
<text:h text:outline-level="1">Zlomky</text:h>
<text:p>Úvod s <text:span text:style-name="T1">tučným</text:span> slovem${' a text'.repeat(6)}.</text:p>
<text:h text:outline-level="2">Seznam</text:h>
<text:list><text:list-item><text:p>jedna</text:p></text:list-item><text:list-item><text:p>dvě</text:p>
<text:list><text:list-item><text:p>vnořená</text:p></text:list-item></text:list></text:list-item></text:list>
<table:table><table:table-row><table:table-cell><text:p>Jméno</text:p></table:table-cell><table:table-cell><text:p>Body</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>Eva</text:p></table:table-cell><table:table-cell><text:p>5</text:p></table:table-cell></table:table-row></table:table>
<text:h text:outline-level="2">Vzorec</text:h>
<text:p>Platí <draw:frame><draw:object xlink:href="./Object 1"/></draw:frame> vždy${' a text'.repeat(6)}.</text:p>
</office:text>`;
	const odt = () =>
		zipped('a.odt', {
			'content.xml': content(body, styles),
			'Object 1/content.xml':
				'<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>=</mo><mn>4</mn></mrow></semantics></math>'
		});

	it('keeps headings, bold, lists, tables and formulas as Markdown', async () => {
		const read = await readMaterial(await odt(), io(), room, libraries);
		expect(read.sections.map((s) => s.title)).toEqual(['Zlomky', 'Seznam', 'Vzorec']);
		expect(read.sections[0].text).toContain('s **tučným** slovem');
		expect(read.sections[1].text).toContain('- jedna\n- dvě\n  - vnořená');
		expect(read.sections[1].text).toContain('| Jméno | Body |\n| --- | --- |\n| Eva | 5 |');
		expect(read.sections[2].text).toContain('$x^{2} = 4$');
	});
});

describe('an OpenDocument presentation', () => {
	const slide = (title: string, text: string, notes = '') =>
		`<draw:page><draw:frame presentation:class="title"><draw:text-box><text:p>${title}</text:p></draw:text-box></draw:frame>
<draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>${text}</text:p></text:list-item></text:list></draw:text-box></draw:frame>
${notes === '' ? '' : `<presentation:notes><draw:frame presentation:class="notes"><draw:text-box><text:p>${notes}</text:p></draw:text-box></draw:frame></presentation:notes>`}</draw:page>`;
	const odp = (slides: string) =>
		zipped('a.odp', {
			'content.xml': content(`<office:presentation>${slides}</office:presentation>`)
		});

	it('is a piece and a page for each slide, with the notes', async () => {
		const read = await readMaterial(
			await odp(
				slide('První', 'Bod jedna je tady', 'Říct nahlas') + slide('Druhý', 'Bod dva je tady')
			),
			io(),
			room,
			libraries
		);
		expect(read.pages).toBe(2);
		expect(read.sections.map((s) => [s.title, s.unit, s.from])).toEqual([
			['První', 'slide', 1],
			['Druhý', 'slide', 2]
		]);
		expect(read.sections[0].text).toContain('- Bod jedna je tady');
		expect(read.sections[0].text).toContain('Poznámky: Říct nahlas');
	});

	it('respects the pages left', async () => {
		await expect(
			readMaterial(
				await odp(slide('A', 'a') + slide('B', 'b') + slide('C', 'c')),
				io(),
				{ pages: 2 },
				libraries
			)
		).rejects.toBeInstanceOf(Refused);
	});
});
