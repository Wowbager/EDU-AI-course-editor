/**
 * An OpenDocument text (.odt) or presentation (.odp) into Markdown: our own walk over
 * `content.xml` (headings, paragraphs, lists, tables, bold and italic), as `pptx.ts` does
 * for slides. A presentation is one piece per slide; a text is cut at its headings. A
 * formula is an embedded object holding MathML, which becomes `$…$`. A page or slide with
 * (almost) no text but with pictures has them read. No DOM is used, so this runs the same
 * in a browser and in a test.
 */
import { estimatePages, MAX_PAGES, splitMarkdown, type Piece } from '$lib/domain/materials';
import type JSZip from 'jszip';
import { MEDIA, resolve, safeDecode, unescapeXml } from './pptx';
import { MIN_TEXT, Refused, TOO_MANY_PAGES, type ReadIO, type ReadOut, type Room } from './types';

interface El {
	name: string;
	attrs: Record<string, string>;
	children: (El | string)[];
}

const TOKEN =
	/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** XML into a tree of elements and text (entities are undone where the text is used). */
export function parseXml(xml: string): El {
	const root: El = { name: '#root', attrs: {}, children: [] };
	const stack = [root];
	for (const m of xml.matchAll(TOKEN)) {
		const top = stack[stack.length - 1];
		if (m[1] !== undefined) top.children.push(m[1].replace(/&/g, '&amp;').replace(/</g, '&lt;'));
		else if (m[6] !== undefined) top.children.push(m[6]);
		else if (m[3] !== undefined && m[2] === '/') {
			if (stack.length > 1) stack.pop();
		} else if (m[3] !== undefined) {
			const attrs: Record<string, string> = {};
			for (const a of m[4].matchAll(ATTR)) attrs[a[1]] = unescapeXml(a[2] ?? a[3]);
			const el: El = { name: m[3], attrs, children: [] };
			top.children.push(el);
			if (m[5] !== '/') stack.push(el);
		}
	}
	return root;
}

const elements = (el: El): El[] => el.children.filter((c): c is El => typeof c !== 'string');
const find = (el: El, name: string): El | undefined => elements(el).find((c) => c.name === name);
const findDeep = (el: El, name: string): El | undefined => {
	for (const c of elements(el)) {
		if (c.name === name) return c;
		const inner = findDeep(c, name);
		if (inner !== undefined) return inner;
	}
	return undefined;
};

/** What walking a part needs: the styles that mean bold or italic, formulas, and pictures met. */
interface Context {
	marks: Map<string, { bold: boolean; italic: boolean }>;
	/** Formulas by the folder that holds them, already as LaTeX. */
	formulas: Map<string, string>;
	/** Addresses of the pictures met, in order. */
	pictures: string[];
}

const PICTURE = (n: number) => `![](img:${n})`;
// Spaces that were written (`text:s`) are kept apart from the white space of the XML source.
const KEPT = ' ';

function wrap(text: string, mark: string): string {
	const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
	return m[2] === '' ? text : `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

function inline(el: El, ctx: Context): string {
	let out = '';
	for (const child of el.children) {
		if (typeof child === 'string') {
			out += unescapeXml(child).replace(/\s+/g, ' ');
			continue;
		}
		switch (child.name) {
			case 'text:s':
				out += KEPT.repeat(Math.min(Number(child.attrs['text:c'] ?? 1) || 1, 20));
				break;
			case 'text:tab':
			case 'text:line-break':
				out += ' ';
				break;
			case 'text:span': {
				let text = inline(child, ctx);
				const style = ctx.marks.get(child.attrs['text:style-name'] ?? '');
				if (style?.bold) text = wrap(text, '**');
				if (style?.italic) text = wrap(text, '*');
				out += text;
				break;
			}
			case 'draw:frame':
				out += frame(child, ctx);
				break;
			case 'draw:object':
			case 'draw:image':
				out += frame({ name: 'draw:frame', attrs: {}, children: [child] }, ctx);
				break;
			// Notes, comments, deleted text and bookmarks are not the text of the page.
			case 'text:note':
			case 'office:annotation':
			case 'office:annotation-end':
			case 'text:tracked-changes':
				break;
			default:
				out += inline(child, ctx);
		}
	}
	return out;
}

/** A frame inside text: a formula, a picture, or a text box's words. */
function frame(el: El, ctx: Context): string {
	const object = find(el, 'draw:object');
	if (object !== undefined) {
		const folder = (object.attrs['xlink:href'] ?? '').replace(/^\.\//, '').replace(/\/$/, '');
		const latex = ctx.formulas.get(folder) ?? ctx.formulas.get(safeDecode(folder));
		return latex === undefined || latex === '' ? '' : `$${latex}$`;
	}
	const image = find(el, 'draw:image');
	if (image !== undefined && image.attrs['xlink:href'] !== undefined) {
		ctx.pictures.push(image.attrs['xlink:href']);
		return PICTURE(ctx.pictures.length - 1);
	}
	const box = find(el, 'draw:text-box');
	return box === undefined
		? ''
		: blocks(box, ctx)
				.join(' ')
				.replace(/\s*\n\s*/g, ' ');
}

const oneLine = (s: string): string =>
	s
		.replace(/\s*\n\s*/g, ' ')
		.replace(new RegExp(KEPT, 'g'), ' ')
		.replace(/ {2,}/g, ' ')
		.trim();

function listLines(list: El, ctx: Context, depth: number): string[] {
	const lines: string[] = [];
	for (const item of elements(list)) {
		if (item.name !== 'text:list-item' && item.name !== 'text:list-header') continue;
		const own: string[] = [];
		const nested: string[] = [];
		for (const child of elements(item)) {
			if (child.name === 'text:list') nested.push(...listLines(child, ctx, depth + 1));
			else if (child.name === 'text:p' || child.name === 'text:h') {
				const text = oneLine(inline(child, ctx));
				if (text !== '') own.push(text);
			}
		}
		if (own.length > 0) lines.push(`${'  '.repeat(depth)}- ${own.join(' ')}`);
		lines.push(...nested);
	}
	return lines;
}

function tableMarkdown(table: El, ctx: Context): string {
	const rows: string[][] = [];
	const collect = (el: El) => {
		for (const row of elements(el)) {
			if (row.name === 'table:table-header-rows' || row.name === 'table:table-row-group')
				collect(row);
			else if (row.name === 'table:table-row') {
				const cells: string[] = [];
				for (const cell of elements(row)) {
					if (cell.name !== 'table:table-cell' && cell.name !== 'table:covered-table-cell')
						continue;
					const text =
						cell.name === 'table:covered-table-cell'
							? ''
							: oneLine(blocks(cell, ctx).join(' ')).replace(/\|/g, '\\|');
					const repeat = Number(cell.attrs['table:number-columns-repeated'] ?? 1) || 1;
					for (let i = 0; i < (text === '' ? 1 : Math.min(repeat, 20)); i++) cells.push(text);
				}
				if (cells.some((c) => c !== '')) rows.push(cells);
			}
		}
	};
	collect(table);
	if (rows.length === 0) return '';
	const width = Math.max(...rows.map((r) => r.length));
	const line = (r: string[]) =>
		`| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
	return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

/** The blocks of a container, each as Markdown. */
function blocks(el: El, ctx: Context): string[] {
	const out: string[] = [];
	for (const child of elements(el)) {
		switch (child.name) {
			case 'text:h': {
				const text = oneLine(inline(child, ctx));
				const level = Math.min(6, Math.max(1, Number(child.attrs['text:outline-level'] ?? 1) || 1));
				if (text !== '') out.push(`${'#'.repeat(level)} ${text}`);
				break;
			}
			case 'text:p': {
				const text = oneLine(inline(child, ctx));
				if (text !== '') out.push(text);
				break;
			}
			case 'text:list': {
				const lines = listLines(child, ctx, 0);
				if (lines.length > 0) out.push(lines.join('\n'));
				break;
			}
			case 'table:table': {
				const md = tableMarkdown(child, ctx);
				if (md !== '') out.push(md);
				break;
			}
			case 'draw:frame': {
				const inner = find(child, 'draw:text-box');
				if (inner !== undefined) out.push(...blocks(inner, ctx));
				else {
					const text = frame(child, ctx);
					if (text !== '') out.push(text);
				}
				break;
			}
			case 'text:section':
			case 'draw:text-box':
			case 'office:text':
			case 'text:index-body':
			case 'text:table-of-content':
			case 'text:index-title':
			case 'draw:g':
				out.push(...blocks(child, ctx));
				break;
		}
	}
	return out;
}

const clean = (s: string): string =>
	s
		.replace(/!\[\]\(img:\d+\)/g, '')
		.replace(new RegExp(KEPT, 'g'), ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

function marksOf(content: El): Context['marks'] {
	const marks: Context['marks'] = new Map();
	const styles = find(content, 'office:document-content');
	const automatic = styles === undefined ? undefined : find(styles, 'office:automatic-styles');
	for (const style of automatic === undefined ? [] : elements(automatic)) {
		const props = find(style, 'style:text-properties');
		const name = style.attrs['style:name'];
		if (props === undefined || name === undefined) continue;
		const weight = props.attrs['fo:font-weight'] ?? '';
		marks.set(name, {
			bold: weight === 'bold' || Number(weight) >= 600,
			italic: props.attrs['fo:font-style'] === 'italic'
		});
	}
	return marks;
}

/** Each embedded formula's MathML as LaTeX, by the folder it is in. */
async function formulasOf(zip: JSZip, mathml: (m: string) => string): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const path of Object.keys(zip.files)) {
		const m = /^(.+)\/content\.xml$/.exec(path);
		if (m === null) continue;
		const xml = (await zip.file(path)?.async('string')) ?? '';
		const math = /<math\b[\s\S]*<\/math>/.exec(xml)?.[0];
		if (math === undefined) continue;
		try {
			out.set(m[1], mathml(math).trim());
		} catch {
			// A formula that cannot be converted is left out.
		}
	}
	return out;
}

/** Pictures read, each as its text or null. */
async function readPictures(
	zip: JSZip,
	hrefs: string[],
	io: ReadIO
): Promise<{ read: string | null; known: boolean }[]> {
	const out: { read: string | null; known: boolean }[] = [];
	for (const href of hrefs) {
		const ext = href.split('.').pop()?.toLowerCase() ?? '';
		const file =
			MEDIA[ext] === undefined
				? null
				: (zip.file(resolve('content.xml', href)) ??
					zip.file(resolve('content.xml', safeDecode(href))));
		if (file === null) {
			out.push({ read: null, known: false });
			continue;
		}
		try {
			const bytes = await file.async('arraybuffer');
			const read = (await io.ocr(await io.shrink(new Blob([bytes], { type: MEDIA[ext] })))).trim();
			out.push({ read: read === '' ? null : read, known: true });
		} catch {
			out.push({ read: null, known: true });
		}
	}
	return out;
}

const MAX_PICTURES = 20;

export async function readOdf(
	data: ArrayBuffer,
	kind: 'odt' | 'odp',
	io: ReadIO,
	room: Room,
	JSZipClass: typeof JSZip,
	mathml: (mathml: string) => string
): Promise<ReadOut> {
	const zip = await JSZipClass.loadAsync(data);
	const xml = await zip.file('content.xml')?.async('string');
	const limit = Math.min(room.pages, MAX_PAGES);
	if (xml === undefined) return { pieces: [], pages: 1, unread: [] };
	const tree = parseXml(xml);
	const body = findDeep(tree, 'office:body');
	const shared = { marks: marksOf(tree), formulas: await formulasOf(zip, mathml) };
	const unread: string[] = [];

	if (kind === 'odt') {
		const ctx: Context = { ...shared, pictures: [] };
		const root = body === undefined ? undefined : find(body, 'office:text');
		const text = clean(root === undefined ? '' : blocks(root, ctx).join('\n\n'));
		const pictures = ctx.pictures.slice(0, MAX_PICTURES);
		const pieces: Piece[] = [];
		if (text.length >= MIN_TEXT || pictures.length === 0) pieces.push(...splitMarkdown(text));
		else {
			// A scan saved as a text: the pictures are the pages.
			for (const [i, r] of (await readPictures(zip, pictures, io)).entries()) {
				if (r.read !== null) pieces.push({ title: `Obrázek ${i + 1}`, text: r.read });
				else unread.push(`Obrázek ${i + 1} se nepodařilo přečíst`);
			}
		}
		const pages = Math.max(
			estimatePages(text),
			pictures.length > 0 && text === '' ? pictures.length : 1
		);
		if (pages > limit) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
		return { pieces, pages, unread };
	}

	const presentation = body === undefined ? undefined : find(body, 'office:presentation');
	const slides =
		presentation === undefined ? [] : elements(presentation).filter((e) => e.name === 'draw:page');
	if (slides.length === 0) throw new Refused('V souboru nejsou žádné snímky.');
	if (slides.length > limit) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
	const pieces: Piece[] = [];
	for (const [i, slide] of slides.entries()) {
		const n = i + 1;
		const ctx: Context = { ...shared, pictures: [] };
		const frames = elements(slide).filter((e) => e.name === 'draw:frame');
		const isTitle = (f: El) => f.attrs['presentation:class'] === 'title';
		const title = oneLine(
			frames
				.filter(isTitle)
				.flatMap((f) => blocks({ name: 'x', attrs: {}, children: [f] }, ctx))
				.join(' ')
		);
		const bodyBlocks = blocks(
			{ name: 'x', attrs: {}, children: frames.filter((f) => !isTitle(f)) },
			ctx
		);
		const notes = find(slide, 'presentation:notes');
		const noteBlocks =
			notes === undefined
				? []
				: blocks(
						{
							name: 'x',
							attrs: {},
							children: elements(notes).filter(
								(f) => f.name === 'draw:frame' && f.attrs['presentation:class'] === 'notes'
							)
						},
						ctx
					);
		let textOut = clean(bodyBlocks.join('\n\n'));
		let picture = '';
		const pictures = ctx.pictures.slice(0, 2);
		if (title.length + textOut.length < MIN_TEXT && pictures.length > 0) {
			const reads = await readPictures(zip, pictures, io);
			picture = reads
				.map((r) => r.read)
				.filter((r): r is string => r !== null)
				.join('\n\n');
			if (picture === '' && title === '' && textOut === '' && noteBlocks.length === 0) {
				unread.push(`Snímek ${n} se nepodařilo přečíst`);
				continue;
			}
		}
		textOut = [textOut, picture].filter((t) => t !== '').join('\n\n');
		if (noteBlocks.length > 0)
			textOut += `${textOut === '' ? '' : '\n\n'}Poznámky: ${oneLine(clean(noteBlocks.join(' ')))}`;
		if (title === '' && textOut === '') continue;
		pieces.push({
			title: title === '' ? `Snímek ${n}` : title,
			text: textOut === '' ? title : textOut,
			unit: 'slide',
			from: n
		});
	}
	return { pieces, pages: slides.length, unread };
}
