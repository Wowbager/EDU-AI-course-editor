/**
 * A plain text or Markdown file. The bytes are UTF-8, or, when they are not valid UTF-8,
 * windows-1250 (what Czech files from old programs are). Markdown is cut at its headings;
 * plain text is cut at a size. No library.
 */
import { MAX_PAGES, splitMarkdown, type Piece } from '$lib/domain/materials';
import { TOO_MANY_PAGES, Refused, type ReadOut, type Room } from './types';

/** Characters a page counts as, so `MAX_PAGES` still means something for text. */
export const PAGE_CHARS = 3000;
/** A plain text piece is cut at a line or blank line once it passes this. */
const CHUNK_CHARS = 6000;

/** The text of the bytes: UTF-16 with a BOM, UTF-8 (BOM dropped), or windows-1250 when the bytes are not UTF-8. */
export function decodeText(data: ArrayBuffer): string {
	const head = new Uint8Array(data, 0, Math.min(2, data.byteLength));
	const bom = (text: string) => text.replace(/^\uFEFF/, '');
	if (head.length === 2 && head[0] === 0xff && head[1] === 0xfe)
		return bom(new TextDecoder('utf-16le').decode(data));
	if (head.length === 2 && head[0] === 0xfe && head[1] === 0xff)
		return bom(new TextDecoder('utf-16be').decode(data));
	try {
		return bom(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data));
	} catch {
		return bom(new TextDecoder('windows-1250').decode(data));
	}
}

/** Plain text cut at blank lines, then lines, then (a line with no end) at the size. */
function chunks(text: string): string[] {
	const out: string[] = [];
	let chunk = '';
	const flush = () => {
		if (chunk.trim() !== '') out.push(chunk.trim());
		chunk = '';
	};
	for (const paragraph of text.split(/\n{2,}/)) {
		for (let rest = paragraph; ;) {
			const room = CHUNK_CHARS - chunk.length;
			if (rest.length + 2 <= room) {
				chunk += `${rest}\n\n`;
				break;
			}
			if (chunk.trim() !== '' && rest.length <= CHUNK_CHARS) {
				flush();
				continue;
			}
			// Longer than a piece: cut at the last line break (or the size) that fits.
			const window = rest.slice(0, CHUNK_CHARS);
			const at = window.lastIndexOf('\n');
			const cut = at > CHUNK_CHARS / 2 ? at : CHUNK_CHARS;
			flush();
			out.push(rest.slice(0, cut).trim());
			rest = rest.slice(cut);
			if (rest.trim() === '') break;
		}
	}
	flush();
	return out.filter((c) => c !== '');
}

export function readText(data: ArrayBuffer, name: string, room: Room): ReadOut {
	const text = decodeText(data).replace(/\r\n?/g, '\n');
	const pages = Math.max(1, Math.ceil(text.trim().length / PAGE_CHARS));
	if (pages > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
	let pieces: Piece[];
	if (/\.md$/i.test(name)) pieces = splitMarkdown(text);
	else {
		const title = (name.replace(/\.[^.]+$/, '') || name).slice(0, 190);
		const parts = chunks(text);
		pieces = parts.map((t, i) => ({
			title: parts.length === 1 ? title : `${title} (${i + 1})`,
			text: t
		}));
	}
	return { pieces, pages, unread: [] };
}
