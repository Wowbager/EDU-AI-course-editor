/**
 * A web page (.html) or an e-book (.epub) into Markdown: turndown with its GFM plugin for
 * the text and the tables, `mathml-to-latex` for formulas. An e-book is one page for each
 * chapter, in the order of its spine. Pictures are left out; a page or a chapter with
 * (almost) no text but with pictures has them read, as in a Word file.
 */
import { estimatePages, MAX_PAGES, splitMarkdown, type Piece } from '$lib/domain/materials';
import type JSZip from 'jszip';
import type TurndownService from 'turndown';
import { MEDIA, resolve, safeDecode } from './pptx';
import { MIN_TEXT, Refused, TOO_MANY_PAGES, type ReadIO, type ReadOut, type Room } from './types';

/** turndown and its table plugin, as `browser.ts` loads them. */
export interface TurndownLib {
	TurndownService: typeof TurndownService;
	gfm: TurndownService.Plugin;
}

/** What turning HTML into Markdown needs from outside. */
export interface HtmlLibs {
	turndown: TurndownLib;
	/** MathML (`<math>…</math>`) as LaTeX. */
	mathml(mathml: string): string;
}

/** Pictures read for one file, as in a Word file. */
const MAX_PICTURES = 20;

/** A picture's bytes by the address the page gives it, or null when it cannot be had. */
type LoadPicture = (src: string) => Promise<{ type: string; data: ArrayBuffer } | null>;

/** The text of an HTML page as Markdown, and the addresses of the pictures in it (in order). */
export function htmlToMarkdown(html: string, libs: HtmlLibs): { text: string; images: string[] } {
	const service = new libs.turndown.TurndownService({
		headingStyle: 'atx',
		bulletListMarker: '-',
		codeBlockStyle: 'fenced',
		emDelimiter: '*'
	});
	service.use(libs.turndown.gfm);
	// The model reads plain text, so nothing is escaped (a `|` in a table cell still is, by the
	// table plugin; code stays as it was).
	service.escape = (text) => text;
	service.remove((node) =>
		['script', 'style', 'nav', 'head', 'title', 'noscript', 'template', 'iframe', 'svg'].includes(
			node.nodeName.toLowerCase()
		)
	);
	const images: string[] = [];
	service.addRule('picture', {
		filter: 'img',
		replacement: (_content, node) => {
			const src = (node as Element).getAttribute('src') ?? '';
			if (src === '') return '';
			images.push(src);
			return `![](img:${images.length - 1})`;
		}
	});
	service.addRule('formula', {
		filter: (node) => node.nodeName.toLowerCase() === 'math',
		replacement: (_content, node) => {
			try {
				const latex = libs.mathml((node as Element).outerHTML).trim();
				return latex === '' ? '' : `$${latex}$`;
			} catch {
				return node.textContent ?? '';
			}
		}
	});
	const text = service
		.turndown(html)
		.replace(/!\[[^\]]*\]\(img:\d+\)/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return { text, images };
}

/** The pictures read, each as its text or null; `budget.left` is what the file may still read. */
async function readPictures(
	sources: string[],
	io: ReadIO,
	load: LoadPicture,
	budget: { left: number }
): Promise<(string | null)[]> {
	const out: (string | null)[] = [];
	for (const src of sources) {
		if (budget.left <= 0) {
			out.push(null);
			continue;
		}
		budget.left--;
		try {
			const picture = await load(src);
			if (picture === null) {
				out.push(null);
				continue;
			}
			const read = (
				await io.ocr(await io.shrink(new Blob([picture.data], { type: picture.type })))
			).trim();
			out.push(read === '' ? null : read);
		} catch {
			out.push(null);
		}
	}
	return out;
}

/** A `data:` picture of a kind the reader takes. */
const loadDataUrl: LoadPicture = async (src) => {
	const m = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/i.exec(src.trim());
	if (m === null) return null;
	const bytes = Uint8Array.from(atob(m[2].replace(/\s/g, '')), (c) => c.charCodeAt(0));
	return { type: m[1].toLowerCase(), data: bytes.buffer };
};

/** The bytes as text, in the charset the page names for itself (UTF-8 when it names none). */
function decode(data: ArrayBuffer): string {
	const head = new TextDecoder('latin1').decode(
		new Uint8Array(data, 0, Math.min(2048, data.byteLength))
	);
	const label =
		/<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head)?.[1] ??
		/<\?xml[^>]+encoding=["']([\w-]+)["']/i.exec(head)?.[1];
	try {
		return new TextDecoder(label ?? 'utf-8').decode(data);
	} catch {
		return new TextDecoder('utf-8').decode(data);
	}
}

export async function readHtml(
	data: ArrayBuffer,
	io: ReadIO,
	room: Room,
	libs: HtmlLibs
): Promise<ReadOut> {
	const { text, images } = htmlToMarkdown(decode(data), libs);
	const pieces: Piece[] = [];
	const unread: string[] = [];
	if (text.length >= MIN_TEXT || images.length === 0) pieces.push(...splitMarkdown(text));
	else {
		// Only pictures: they are the page.
		const reads = await readPictures(images, io, loadDataUrl, { left: MAX_PICTURES });
		for (const [i, read] of reads.entries()) {
			if (read !== null) pieces.push({ title: `Obrázek ${i + 1}`, text: read });
			else if (/^data:/i.test(images[i])) unread.push(`Obrázek ${i + 1} se nepodařilo přečíst`);
		}
	}
	const pages = estimatePages(text);
	if (pages > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
	return { pieces, pages, unread };
}

const attr = (tag: string, name: string): string | undefined => {
	const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
	return m === null ? undefined : (m[1] ?? m[2]);
};

/** The chapters' paths in the order of the spine. */
async function chapterPaths(zip: JSZip): Promise<string[]> {
	const container = await zip.file('META-INF/container.xml')?.async('string');
	const root =
		container === undefined
			? undefined
			: attr(/<rootfile\b[^>]*>/.exec(container)?.[0] ?? '', 'full-path');
	if (root === undefined) return [];
	const opf = await zip.file(root)?.async('string');
	if (opf === undefined) return [];
	const manifest = new Map<string, string>();
	for (const item of opf.matchAll(/<item\b[^>]*>/g)) {
		const id = attr(item[0], 'id');
		const href = attr(item[0], 'href');
		const type = attr(item[0], 'media-type') ?? '';
		if (id !== undefined && href !== undefined && /html/i.test(type)) {
			const raw = resolve(root, href.split('#')[0]);
			const decoded = resolve(root, safeDecode(href.split('#')[0]));
			manifest.set(id, zip.file(decoded) !== null ? decoded : raw);
		}
	}
	return [...opf.matchAll(/<itemref\b[^>]*>/g)]
		.map((m) => manifest.get(attr(m[0], 'idref') ?? ''))
		.filter((p): p is string => p !== undefined && zip.file(p) !== null);
}

export async function readEpub(
	data: ArrayBuffer,
	io: ReadIO,
	room: Room,
	JSZipClass: typeof JSZip,
	libs: HtmlLibs
): Promise<ReadOut> {
	const zip = await JSZipClass.loadAsync(data);
	const paths = await chapterPaths(zip);
	if (paths.length === 0) throw new Refused('V souboru nejsou žádné kapitoly.');
	if (paths.length > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
	const pieces: Piece[] = [];
	const unread: string[] = [];
	const budget = { left: MAX_PICTURES };
	let pages = 0;
	for (const [i, path] of paths.entries()) {
		const html = decode(await zip.file(path)!.async('arraybuffer'));
		const converted = htmlToMarkdown(html, libs);
		const { images } = converted;
		let text = converted.text;
		if (text.length < MIN_TEXT && images.length > 0) {
			const reads = await readPictures(
				images.slice(0, 2),
				io,
				async (address) => {
					// "p1.png?v=1" or "p1.png#x" is the file p1.png in the book.
					const src = address.split(/[?#]/)[0];
					const ext = src.split('.').pop()?.toLowerCase() ?? '';
					const file =
						MEDIA[ext] === undefined
							? null
							: (zip.file(resolve(path, safeDecode(src))) ?? zip.file(resolve(path, src)));
					return file === null ? null : { type: MEDIA[ext], data: await file.async('arraybuffer') };
				},
				budget
			);
			const read = reads.filter((r): r is string => r !== null);
			if (read.length === 0 && text === '') unread.push(`Kapitola ${i + 1} se nepodařilo přečíst`);
			text = [text, ...read].filter((t) => t !== '').join('\n\n');
		}
		// A chapter is at least a page, and a long one is as many as its words make.
		pages += estimatePages(text);
		if (pages > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
		pieces.push(...splitMarkdown(text, `Kapitola ${i + 1}`));
	}
	return { pieces, pages, unread };
}
