/**
 * A PowerPoint file into one piece per slide: its title, its text and the speaker's
 * notes. A slide with a picture and no text has the picture read. The XML is read with
 * patterns, not a DOM, so this runs the same in a browser and in a test.
 */
import type JSZip from 'jszip';
import type { Piece } from '$lib/domain/materials';
import { MIN_TEXT, Refused, TOO_MANY_PAGES, type ReadIO, type ReadOut, type Room } from './types';
import { MAX_PAGES } from '$lib/domain/materials';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s: string): string =>
	s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			// A number that is not a character is left as it was written.
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e] ?? m;
	});

/** The paragraphs of a piece of slide XML, each as its text. */
function paragraphs(xml: string): string[] {
	const out: string[] = [];
	for (const p of xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)) {
		const text = [...p[0].matchAll(/<a:t(?: [^>]*)?>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g)]
			.map((m) => (m[1] === undefined ? '\n' : unescapeXml(m[1])))
			.join('')
			.trim();
		if (text !== '') out.push(text);
	}
	return out;
}

const shapes = (xml: string): string[] => xml.match(/<p:sp[ >][\s\S]*?<\/p:sp>/g) ?? [];
const isTitle = (shape: string): boolean => /<p:ph[^>]*type="(?:title|ctrTitle)"/.test(shape);

const MEDIA: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
};

/** The relationships of a part: id → target, and the targets by type's last word. */
function relations(xml: string | null): { id: string; type: string; target: string }[] {
	if (xml === null) return [];
	return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
		const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[0])?.[1] ?? '';
		return { id: attr('Id'), type: attr('Type').split('/').pop() ?? '', target: attr('Target') };
	});
}

/** `target` as a path in the archive, from the folder of the part that names it. */
function resolve(from: string, target: string): string {
	if (target.startsWith('/')) return target.slice(1);
	const parts = from.split('/').slice(0, -1);
	for (const part of target.split('/')) {
		if (part === '..') parts.pop();
		else if (part !== '.') parts.push(part);
	}
	return parts.join('/');
}

async function text(zip: JSZip, path: string): Promise<string | null> {
	const file = zip.file(path);
	return file === null ? null : file.async('string');
}

/** The slides' paths in the order of the deck. */
async function slidePaths(zip: JSZip): Promise<string[]> {
	const all = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
	const numeric = [...all].sort(
		(a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1])
	);
	const presentation = await text(zip, 'ppt/presentation.xml');
	const rels = relations(await text(zip, 'ppt/_rels/presentation.xml.rels'));
	if (presentation === null || rels.length === 0) return numeric;
	const ordered = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
		.map((m) => rels.find((r) => r.id === m[1]))
		.flatMap((r) => (r === undefined ? [] : [resolve('ppt/presentation.xml', r.target)]))
		.filter((p) => all.includes(p));
	return ordered.length > 0 ? ordered : numeric;
}

export async function readPptx(
	data: ArrayBuffer,
	io: ReadIO,
	room: Room,
	JSZipClass: typeof JSZip
): Promise<ReadOut> {
	const zip = await JSZipClass.loadAsync(data);
	const paths = await slidePaths(zip);
	if (paths.length === 0) throw new Refused('V souboru nejsou žádné snímky.');
	if (paths.length > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));

	const unread: string[] = [];
	const slides = await Promise.all(
		paths.map(async (path, i): Promise<Piece | null> => {
			const n = i + 1;
			const xml = (await text(zip, path)) ?? '';
			const all = shapes(xml);
			const title = all.filter(isTitle).flatMap(paragraphs).join(' ').trim();
			const body = paragraphs(
				all.filter((s) => !isTitle(s)).join('') +
					(xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) ?? []).join('')
			);
			const rels = relations(await text(zip, resolve(path, `_rels/${path.split('/').pop()}.rels`)));
			const notesPath = rels.find((r) => r.type === 'notesSlide');
			const notesXml =
				notesPath === undefined ? null : await text(zip, resolve(path, notesPath.target));
			const notes =
				notesXml === null
					? []
					: shapes(notesXml)
							.filter((s) => /<p:ph[^>]*type="body"/.test(s))
							.flatMap(paragraphs);

			let picture = '';
			if (title.length + body.join('').length < MIN_TEXT && /<p:pic[ >]/.test(xml)) {
				// A slide that is only a picture: read the picture.
				const images = rels.filter((r) => r.type === 'image').slice(0, 2);
				const parts: string[] = [];
				let failed = images.length === 0;
				for (const image of images) {
					const ext = image.target.split('.').pop()?.toLowerCase() ?? '';
					const file = zip.file(resolve(path, image.target));
					if (MEDIA[ext] === undefined || file === null) {
						failed = true;
						continue;
					}
					try {
						const bytes = await file.async('arraybuffer');
						const read = await io.ocr(await io.shrink(new Blob([bytes], { type: MEDIA[ext] })));
						if (read.trim() !== '') parts.push(read.trim());
					} catch {
						failed = true;
					}
				}
				picture = parts.join('\n\n');
				// The short text of the slide is kept; only a slide with nothing at all is unread.
				if (picture === '' && failed && title === '' && body.length === 0 && notes.length === 0) {
					unread.push(`Snímek ${n} se nepodařilo přečíst`);
					return null;
				}
			}
			const lines = [
				...body.map((l) => (body.length > 1 ? `- ${l.replace(/\n/g, ' ')}` : l)),
				...(picture !== '' ? [picture] : [])
			];
			if (notes.length > 0) lines.push(`Poznámky: ${notes.join(' ').replace(/\n/g, ' ')}`);
			const textOut = lines.join('\n\n').replace(/\n\n(?=- )/g, '\n');
			if (title === '' && textOut === '') return null;
			return {
				title: title === '' ? `Snímek ${n}` : title,
				text: textOut === '' ? title : textOut,
				unit: 'slide',
				from: n
			};
		})
	);
	return { pieces: slides.filter((s): s is Piece => s !== null), pages: paths.length, unread };
}
