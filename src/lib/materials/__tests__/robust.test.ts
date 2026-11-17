import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { MAX_PAGES } from '$lib/domain/materials';
import { readPdf, SCANS_AT_ONCE, type Pdfjs } from '../pdf';
import { readPptx } from '../pptx';
import { latexOf } from '../omml';
import type { ReadIO } from '../types';

vi.mock('$lib/state/versions/server', () => ({ workspaceKey: () => 'k'.repeat(43) }));

const room = { pages: MAX_PAGES };
const io = (over: Partial<ReadIO> = {}): ReadIO => ({
	ocr: async () => 'Přepis',
	shrink: async (b) => b,
	fitPicture: async (b) => b,
	keep: async () => 'x',
	fromPixels: async () => new Blob(['x']),
	renderPage: async () => new Blob(['x']),
	...over
});

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A one-slide deck: its shapes, and (when given) a picture it holds. */
async function deck(shapes: string, picture = false): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file(
		'ppt/slides/slide1.xml',
		`<p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:spTree>${shapes}${
			picture
				? '<p:pic><p:nvPicPr><p:cNvPr id="9" name="P"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic>'
				: ''
		}</p:spTree></p:cSld></p:sld>`
	);
	if (picture) {
		zip.file(
			'ppt/slides/_rels/slide1.xml.rels',
			`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/image" Target="../media/image1.png"/></Relationships>`
		);
		zip.file('ppt/media/image1.png', new Uint8Array([1, 2, 3]));
	}
	return zip.generateAsync({ type: 'arraybuffer' });
}
const shape = (type: string, text: string) =>
	`<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const failing = io({
	ocr: async () => {
		throw new Error('503');
	}
});

describe('a slide with a picture that cannot be read', () => {
	it('keeps its short text, and is not unread', async () => {
		const out = await readPptx(await deck(shape('title', 'Úvod'), true), failing, room, JSZip);
		expect(out.pieces.map((p) => p.title)).toEqual(['Úvod']);
		expect(out.unread).toEqual([]);
	});

	it('is unread only when nothing at all came out of it', async () => {
		const out = await readPptx(await deck('', true), failing, room, JSZip);
		expect(out.pieces).toEqual([]);
		expect(out.unread).toEqual(['Snímek 1 se nepodařilo přečíst']);
	});
});

describe('a number in the XML that is not a character', () => {
	it('is left as written, in a deck and in an equation, and the file still reads', async () => {
		const out = await readPptx(
			await deck(shape('title', 'Cena &#x110000; &#0; &#xD800; &#65; Kč')),
			io(),
			room,
			JSZip
		);
		expect(out.pieces[0].title).toBe('Cena &#x110000; &#0; &#xD800; A Kč');
		expect(latexOf('<m:oMath><m:r><m:t>a&#99999999;b</m:t></m:r></m:oMath>')).toBe(
			'a&\\#99999999;b'
		);
	});
});

describe('the scanned pages of a long PDF', () => {
	/** A document of `pages` pages with no text, which counts the bitmaps alive at once. */
	function scans(pages: number) {
		const state = { drawn: 0, live: 0, most: 0 };
		const pdfjs: Pdfjs = {
			getDocument: () => ({
				promise: Promise.resolve({
					numPages: pages,
					getPage: async () => ({ getTextContent: async () => ({ items: [] }) })
				})
			})
		};
		const reader = io({
			renderPage: async () => {
				state.drawn++;
				state.live++;
				state.most = Math.max(state.most, state.live);
				return new Blob(['x']);
			},
			ocr: async () => {
				await new Promise((r) => setTimeout(r, 5));
				state.live--;
				return 'Přepis';
			}
		});
		return { state, pdfjs, reader };
	}

	it('are drawn and read a few at a time, each drawn when its turn comes', async () => {
		const { state, pdfjs, reader } = scans(12);
		const out = await readPdf(new ArrayBuffer(4), reader, room, pdfjs);
		expect(out.pieces).toHaveLength(12);
		expect(state.drawn).toBe(12);
		expect(state.most).toBeLessThanOrEqual(SCANS_AT_ONCE);
		expect(state.most).toBeGreaterThan(1);
	});
});

describe('asking the server to read a picture', () => {
	const picture = new Blob(['x'], { type: 'image/png' });
	const answer = (
		status: number,
		headers: Record<string, string> = {},
		body: unknown = { text: 'T' }
	) => new Response(JSON.stringify(body), { status, headers });

	it('waits out a busy or limited server, as long as it says, and asks again', async () => {
		const { readOnServer } = await import('../browser');
		const replies = [answer(429), answer(503, { 'retry-after': '7' }), answer(200)];
		const fetcher = vi.fn(async () => replies.shift()!);
		const waits: number[] = [];
		const text = await readOnServer(picture, {
			fetcher: fetcher as unknown as typeof fetch,
			wait: async (s) => void waits.push(s)
		});
		expect(text).toBe('T');
		expect(fetcher).toHaveBeenCalledTimes(3);
		// Without a Retry-After the wait grows; with one, that is the wait.
		expect(waits).toEqual([2, 7]);
	});

	it('gives the page up after a few waits, and at once for any other answer', async () => {
		const { readOnServer } = await import('../browser');
		const busy = vi.fn(async () => answer(503, { 'retry-after': '1' }));
		await expect(
			readOnServer(picture, { fetcher: busy as unknown as typeof fetch, wait: async () => {} })
		).rejects.toThrow('503');
		expect(busy).toHaveBeenCalledTimes(4);
		// A 503 that does not say when to come back is a server with no AI: no waiting.
		const off = vi.fn(async () => answer(503));
		await expect(
			readOnServer(picture, { fetcher: off as unknown as typeof fetch, wait: async () => {} })
		).rejects.toThrow('503');
		expect(off).toHaveBeenCalledTimes(1);
		const bad = vi.fn(async () => answer(502));
		await expect(
			readOnServer(picture, { fetcher: bad as unknown as typeof fetch, wait: async () => {} })
		).rejects.toThrow('502');
		expect(bad).toHaveBeenCalledTimes(1);
	});
});
