/**
 * A teacher's materials (Word, PowerPoint, PDF, scans), as the AI sees them.
 *
 * Every file is read once, in the browser, into sections: a heading's worth of a Word
 * file, a slide, a page. A section has a stable key (the file's hash and the section's
 * place in it), a title, where it came from and its text as Markdown. The course
 * document stores nothing of this except a card's `source_refs`, a list of keys; the
 * sections live on the server beside the course (`server/materials/`).
 *
 * Two ways to put them in front of the model, decided by size (`fitsFully`):
 *  - they all fit (about 60k tokens): everything is sent in full, which gives better
 *    cards than any selection;
 *  - they do not: the model gets an index (title, place, the first 200 characters) and a
 *    card gets in full only the sections it names.
 * `renderMaterials` is the one function that makes that text, for a proposal and for a
 * card alike.
 *
 * A picture the teacher attached (a photo, a drawing) is not read into text: it is kept as
 * it is, in the image store, and is a section whose `picture` is its id there. The model
 * sees the picture itself (`picturesFor` says which go with a request) and may put it in a
 * card as a picture step. At most `MAX_PICTURES` of them, since every proposal carries all.
 */
import { z } from 'zod';
import {
	MAX_MATERIALS_CHARS,
	MAX_PICTURES,
	PICTURE_ID,
	pictureRefSchema,
	picturesSchema,
	type PictureRef
} from './authoring';
import { estimateTokens } from './dossier';

export { MAX_MATERIALS_CHARS, MAX_PICTURES, PICTURE_ID, pictureRefSchema, picturesSchema };
export type { PictureRef };

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Pages of a PDF, slides of a deck, and a Word file counted as 500 words a page. */
export const MAX_PAGES = 100;
export const MAX_FILES = 30;
/** What may be sent whole: all the sections together, estimated as `estimateTokens` does. */
export const FULL_TEXT_TOKENS = 60_000;
export const MAX_SECTION_CHARS = 120_000;
/** A kept picture's longest side, in pixels, and its size at most: what the model needs to see it well. */
export const PICTURE_SIDE = 1568;
export const PICTURE_BYTES = 1024 * 1024;

const KEY = /^[0-9a-f]{8}\.\d{1,4}$/;
export const HASH = /^[0-9a-f]{8,64}$/;

export const sectionSchema = z.object({
	key: z.string().regex(KEY),
	file: z.string().trim().min(1).max(200),
	title: z.string().trim().min(1).max(200),
	/** Where it came from, when the file has pages or slides. */
	unit: z.enum(['page', 'slide']).optional(),
	from: z.number().int().min(1).max(100_000).optional(),
	to: z.number().int().min(1).max(100_000).optional(),
	text: z.string().max(MAX_SECTION_CHARS),
	/** A picture kept as it is: its id in the image store. Its `text` is empty. */
	picture: z.string().regex(PICTURE_ID).optional()
});
export type Section = z.infer<typeof sectionSchema>;

/** One file as it is stored: what it was read into, and the pages that could not be read. */
export const materialFileSchema = z
	.object({
		hash: z.string().regex(HASH),
		name: z.string().trim().min(1).max(200),
		pages: z.number().int().min(1).max(MAX_PAGES),
		/** One line each, in Czech, for a page or slide that could not be read. */
		unread: z.array(z.string().max(120)).max(MAX_PAGES).default([]),
		sections: z.array(sectionSchema).min(1).max(400)
	})
	.refine((f) => f.sections.every((s) => s.key.startsWith(`${f.hash.slice(0, 8)}.`)), {
		message: 'section keys belong to the file'
	})
	.refine((f) => f.sections.every((s) => s.file === f.name), {
		message: 'sections carry their file name'
	});
export type MaterialFile = z.infer<typeof materialFileSchema>;

export const sectionKey = (hash: string, index: number): string => `${hash.slice(0, 8)}.${index}`;

// ───────────────────────────────── where it came from ─────────────────────────────────

const numbers = (list: number[]): string => {
	const sorted = [...new Set(list)].sort((a, b) => a - b);
	const parts: string[] = [];
	for (let i = 0; i < sorted.length;) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
		parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
		i = j + 1;
	}
	return parts.join(', ');
};

/** „str. 3–4“, „snímek 5“, or nothing for a section that has no place in its file. */
export function locationOf(sections: readonly Section[]): string {
	const pages: number[] = [];
	const slides: number[] = [];
	for (const s of sections) {
		if (s.from === undefined) continue;
		const range = Array.from({ length: (s.to ?? s.from) - s.from + 1 }, (_, i) => s.from! + i);
		(s.unit === 'slide' ? slides : pages).push(...range);
	}
	const out: string[] = [];
	if (pages.length > 0) out.push(`str. ${numbers(pages)}`);
	if (slides.length > 0)
		out.push(`${new Set(slides).size === 1 ? 'snímek' : 'snímky'} ${numbers(slides)}`);
	return out.join(', ');
}

/** A file's name as the teacher reads it: without its extension. */
export const displayName = (name: string): string =>
	name.replace(/\.[A-Za-z0-9]{1,5}$/, '') || name;

/**
 * The quiet line under a proposed card: „Učebnice · str. 12–14“, „Prezentace · snímek 5“, or just the name for a whole file. Keys that are
 * no longer among the sections are left out; with none left the line is empty.
 */
export function sourceLine(sections: readonly Section[], keys: readonly string[]): string {
	const byFile = new Map<string, Section[]>();
	for (const key of keys) {
		const section = sections.find((s) => s.key === key);
		if (section === undefined) continue;
		byFile.set(section.file, [...(byFile.get(section.file) ?? []), section]);
	}
	if (byFile.size === 0) return '';
	const parts = [...byFile].map(([file, list]) => {
		const place = locationOf(list);
		return place === '' ? displayName(file) : `${displayName(file)} · ${place}`;
	});
	return parts.join('; ');
}

// ───────────────────────────────── what the model reads ─────────────────────────────────

export const tokensOf = (section: Section): number => estimateTokens(section.text);
export const totalTokens = (sections: readonly Section[]): number =>
	sections.reduce((sum, s) => sum + tokensOf(s), 0);
/** All the text may go to the model whole. */
export const fitsFully = (sections: readonly Section[]): boolean =>
	totalTokens(sections) <= FULL_TEXT_TOKENS;

const oneLine = (text: string, max: number): string => {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

export interface IndexEntry {
	key: string;
	file: string;
	title: string;
	location: string;
	start: string;
	tokens: number;
}

export function materialsIndex(sections: readonly Section[]): IndexEntry[] {
	return sections.map((s) => ({
		key: s.key,
		file: s.file,
		title: s.title,
		location: locationOf([s]),
		start: s.picture !== undefined ? '(a picture)' : oneLine(s.text, 200),
		tokens: tokensOf(s)
	}));
}

const where = (s: Section): string => {
	const place = locationOf([s]);
	return `${s.file}${place === '' ? '' : `, ${place}`}`;
};
const heading = (s: Section): string => `[${s.key}] ${where(s)} — ${s.title}`;

const indexText = (sections: readonly Section[]): string =>
	materialsIndex(sections)
		.map(
			(e) =>
				`- [${e.key}] ${e.file}${e.location === '' ? '' : `, ${e.location}`} — ${e.title} (~${e.tokens} tokens)${
					e.start === '' ? '' : `: ${e.start}`
				}`
		)
		.join('\n');

const titlesText = (sections: readonly Section[]): string =>
	sections.map((s) => `- [${s.key}] ${where(s)} — ${s.title}`).join('\n');

/** What stands for a picture in the text: the picture itself goes with the request. */
const pictureNote = (s: Section): string =>
	`(a picture; when it is attached to this request it follows as picture [${s.key}])`;

const fullText = (sections: readonly Section[]): string =>
	sections
		.map((s) => `### ${heading(s)}\n\n${s.picture !== undefined ? pictureNote(s) : s.text.trim()}`)
		.join('\n\n');

export type MaterialsFor = 'outline' | 'card' | 'lesson';

/**
 * The materials as one text for the model, or '' when there are none.
 *
 * - `outline`: the index, and when everything fits, every section in full after it.
 * - `card`: when everything fits, every section in full; the sections the card names
 *   (`refs`) are said at the end, so the text before them is the same for every card.
 *   When it does not fit, the named sections in full (as many as fit) and only the titles
 *   of the others; a card that names none gets the index.
 * - `lesson`: as `card`, for the cards of one lesson written in one conversation: `refs`
 *   are all their sections, and each card says its own in its turn.
 */
export function renderMaterials(
	sections: readonly Section[],
	use: { for: MaterialsFor; refs?: readonly string[] }
): string {
	if (sections.length === 0) return '';
	const fits = fitsFully(sections);
	const refs = new Set(use.refs ?? []);
	const named = sections.filter((s) => refs.has(s.key));
	const lesson = use.for === 'lesson';
	// A lesson's cards say each in their own turn which sections they draw on.
	const mainly =
		named.length === 0 || lesson
			? ''
			: `\n\nThis card draws mainly on: ${named.map((s) => `[${s.key}]`).join(', ')}.`;

	if (use.for === 'outline')
		return fits
			? `Index of the materials:\n${indexText(sections)}\n\nThe materials in full:\n\n${fullText(sections)}`
			: `Index of the materials (the full text is too long to send; judge by the titles and the first words):\n${indexText(sections)}`;

	if (fits) return `The materials in full:\n\n${fullText(sections)}${mainly}`;
	if (named.length === 0)
		return `Index of the materials (only the index, no section is named for ${lesson ? 'these cards' : 'this card'}):\n${indexText(sections)}`;
	// The named sections in full, as many as fit; the rest, and the others, by title.
	let room = FULL_TEXT_TOKENS;
	const whole: Section[] = [];
	const left: Section[] = [];
	for (const s of named) {
		if (tokensOf(s) <= room) {
			whole.push(s);
			room -= tokensOf(s);
		} else left.push(s);
	}
	const others = [...sections.filter((s) => !refs.has(s.key)), ...left];
	return `The sections ${lesson ? 'these cards draw' : 'this card draws'} on, in full:\n\n${fullText(whole)}\n\nThe other sections, by title only:\n${titlesText(others)}`;
}

const refOf = (s: Section): PictureRef[] =>
	s.picture === undefined ? [] : [{ key: s.key, id: s.picture }];

/** The keys of every picture, which a card may show. */
export const pictureKeys = (sections: readonly Section[]): string[] =>
	sections.filter((s) => s.picture !== undefined).map((s) => s.key);

/**
 * The pictures that go with a request: every one with a proposal or a plan, which decide
 * where each is used; with cards only those the cards draw on (`refs`).
 */
export function picturesFor(
	sections: readonly Section[],
	use: { for: MaterialsFor; refs?: readonly string[] }
): PictureRef[] {
	if (use.for === 'outline') return sections.flatMap(refOf);
	const refs = new Set(use.refs ?? []);
	return sections.filter((s) => refs.has(s.key)).flatMap(refOf);
}

// ───────────────────────────────── a Word file into sections ─────────────────────────────────

/** A section is cut when it passes this, so one huge unbroken file is still a list. */
const CHUNK_CHARS = 6000;

/** What `splitMarkdown` made of a text, before the file's name and hash are known. */
export interface Piece {
	title: string;
	text: string;
	unit?: 'page' | 'slide';
	from?: number;
	to?: number;
	/** A picture kept as it is (`Section.picture`). */
	picture?: string;
}

/**
 * A Markdown text cut at its headings into pieces (the text before the first heading is
 * the first piece, „Úvod“); one that is longer than `CHUNK_CHARS` is cut again at a blank
 * line and named „<heading> (2)“.
 */
export function splitMarkdown(markdown: string, firstTitle = 'Úvod'): Piece[] {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const parts: { title: string; lines: string[] }[] = [{ title: firstTitle, lines: [] }];
	let fenced = false;
	for (const line of lines) {
		if (/^```/.test(line)) fenced = !fenced;
		const h = fenced ? null : /^#{1,3}\s+(.+?)\s*#*$/.exec(line);
		if (h !== null) parts.push({ title: oneLine(h[1].replace(/[*_`]/g, ''), 120), lines: [line] });
		else parts[parts.length - 1].lines.push(line);
	}
	const out: Piece[] = [];
	for (const part of parts) {
		const text = part.lines.join('\n').trim();
		// A heading with nothing under it holds nothing.
		if (
			text === '' ||
			(part.lines[0].startsWith('#') && part.lines.slice(1).join('').trim() === '')
		)
			continue;
		if (text.length <= CHUNK_CHARS) {
			out.push({ title: part.title, text });
			continue;
		}
		let chunk = '';
		let n = 1;
		const flush = () => {
			if (chunk.trim() === '') return;
			out.push({ title: n === 1 ? part.title : `${part.title} (${n})`, text: chunk.trim() });
			n++;
			chunk = '';
		};
		for (const paragraph of text.split(/\n{2,}/)) {
			if (chunk.length + paragraph.length > CHUNK_CHARS) flush();
			chunk += `${paragraph}\n\n`;
		}
		flush();
	}
	return out;
}

/** Pages of a Word file, which has none: 500 words to a page. */
export const estimatePages = (text: string): number =>
	Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 500));

/** The file's pieces as stored sections. */
export function sectionsOf(hash: string, file: string, pieces: readonly Piece[]): Section[] {
	return pieces.map((p, i) => ({
		key: sectionKey(hash, i),
		file,
		title: p.title,
		...(p.unit !== undefined && p.from !== undefined
			? { unit: p.unit, from: p.from, ...(p.to !== undefined ? { to: p.to } : {}) }
			: {}),
		text: p.text,
		...(p.picture !== undefined ? { picture: p.picture } : {})
	}));
}

/** The pages or slides the sections of all files make, against `MAX_PAGES`. */
export const pagesIn = (files: readonly Pick<MaterialFile, 'pages'>[]): number =>
	files.reduce((sum, f) => sum + f.pages, 0);

/** The pictures among the files' sections, against `MAX_PICTURES`. */
export const picturesIn = (files: readonly Pick<MaterialFile, 'sections'>[]): number =>
	files.reduce((sum, f) => sum + f.sections.filter((s) => s.picture !== undefined).length, 0);

/** Why a file cannot be taken, in one Czech line, or `undefined`. */
export function refusal(
	file: { name: string; size: number },
	have: { files: number; pages: number; pictures?: number },
	pages?: number,
	/** The file is a picture, kept as one. */
	picture = false
): string | undefined {
	if (file.size > MAX_FILE_BYTES) return `Soubor ${file.name} je větší než 50 MB.`;
	if (have.files >= MAX_FILES) return `Podkladů je příliš mnoho. Některé odeber.`;
	if (picture && (have.pictures ?? 0) >= MAX_PICTURES)
		return `Obrázků může být v podkladech nejvýše ${MAX_PICTURES}. Některý odeber.`;
	if (pages !== undefined && have.pages + pages > MAX_PAGES)
		return `Podklady mohou mít nejvýše ${MAX_PAGES} stran nebo snímků.`;
	return undefined;
}
