/**
 * A spreadsheet (xlsx, xls, ods, csv, tsv, numbers) into one piece and one page per
 * sheet, as a Markdown table of the values as the sheet shows them. SheetJS does the
 * reading; a text file (csv, tsv) is decoded here, so `;` and windows-1250 from Czech
 * Excel read right.
 */
import type * as XLSXType from 'xlsx';
import { MAX_PAGES, MAX_SECTION_CHARS, type Piece } from '$lib/domain/materials';
import { decodeText } from './text';
import { Refused, TOO_MANY_PAGES, type ReadOut, type Room } from './types';

export type SheetJS = typeof XLSXType;

/** Left for the table's last row and the line that says it was shortened. */
const BUDGET = MAX_SECTION_CHARS - 500;

const cell = (text: string): string =>
	text
		.replace(/\s*[\r\n]+\s*/g, ' ')
		.replace(/\|/g, '\\|')
		.trim();

/**
 * A cell as the sheet shows it. SheetJS cannot format a date written `d.m.yyyy` (the dot
 * reads as a fraction of a second) and then gives the bare number, so such a format is
 * tried again with its dots escaped.
 */
function shown(XLSX: SheetJS, c: XLSXType.CellObject): string {
	if (c.v === undefined || c.v === null) return '';
	const text = XLSX.utils.format_cell(c);
	if (c.t !== 'n' || typeof c.z !== 'string' || text !== String(c.v) || !/[dmy]/i.test(c.z))
		return text;
	return XLSX.utils.format_cell({ ...c, w: undefined, z: c.z.replace(/(?<!\\)\.(?!0)/g, '\\.') });
}

/** The rows of a sheet that hold anything, each as its cells (empty trailing columns cut). */
function rowsOf(XLSX: SheetJS, sheet: XLSXType.WorkSheet): string[][] {
	const byRow = new Map<number, Map<number, string>>();
	for (const address of Object.keys(sheet)) {
		if (address[0] === '!') continue;
		const c = sheet[address] as XLSXType.CellObject;
		const text = cell(shown(XLSX, c));
		if (text === '') continue;
		const { r, c: col } = XLSX.utils.decode_cell(address);
		if (!byRow.has(r)) byRow.set(r, new Map());
		byRow.get(r)!.set(col, text);
	}
	const width = Math.max(0, ...[...byRow.values()].flatMap((m) => [...m.keys()].map((k) => k + 1)));
	return [...byRow.keys()]
		.sort((a, b) => a - b)
		.map((r) => Array.from({ length: width }, (_, i) => byRow.get(r)!.get(i) ?? ''));
}

/** The rows as a Markdown table; the first row is its header. Cut when the text is too long. */
function table(rows: string[][]): { text: string; kept: number } {
	const line = (r: string[]) => `| ${r.join(' | ')} |`;
	const lines = [line(rows[0]), `| ${rows[0].map(() => '---').join(' | ')} |`];
	let length = lines[0].length + lines[1].length + 2;
	let kept = 1;
	for (const row of rows.slice(1)) {
		const l = line(row);
		if (length + l.length + 1 > BUDGET) break;
		lines.push(l);
		length += l.length + 1;
		kept++;
	}
	return { text: lines.join('\n'), kept };
}

export function readSheets(data: ArrayBuffer, name: string, room: Room, XLSX: SheetJS): ReadOut {
	const textual = /\.(csv|tsv)$/i.test(name);
	let book: XLSXType.WorkBook;
	try {
		book = textual
			? XLSX.read(decodeText(data), { type: 'string' })
			: XLSX.read(data, { type: 'array', cellNF: true });
	} catch {
		throw new Refused(`Soubor ${name} se nepodařilo přečíst.`);
	}
	const pieces: Piece[] = [];
	const unread: string[] = [];
	for (const sheetName of book.SheetNames) {
		const rows = rowsOf(XLSX, book.Sheets[sheetName]);
		if (rows.length === 0 || rows[0].length === 0) continue;
		const { text, kept } = table(rows);
		const title = textual ? name.replace(/\.[^.]+$/, '') || name : sheetName;
		pieces.push({ title, text });
		if (kept < rows.length)
			unread.push(`List ${title}: zkráceno na prvních ${kept} řádků`.slice(0, 120));
	}
	if (pieces.length > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
	return { pieces, pages: pieces.length, unread };
}
