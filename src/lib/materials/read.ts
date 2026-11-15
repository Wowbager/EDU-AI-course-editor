/**
 * One file the teacher attached, read into a `MaterialFile`. The three libraries that do
 * the reading (mammoth, jszip, pdf.js) are loaded when a file of their kind is read, so
 * the editor's first load does not carry them (`browser.ts` supplies the drawing and the
 * picture reading they need).
 */
import {
	materialFileSchema,
	MAX_SECTION_CHARS,
	sectionsOf,
	type MaterialFile
} from '$lib/domain/materials';
import { Refused, type ReadIO, type ReadOut, type Room } from './types';

export type Kind = 'docx' | 'pptx' | 'pdf' | 'image';

export const IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.webp', '.heic'];
/** For the file picker. */
export const ACCEPT = ['.docx', '.pptx', '.pdf', ...IMAGE_TYPES].join(',');

export function kindOf(name: string): Kind | undefined {
	const ext = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? '';
	if (ext === '.docx') return 'docx';
	if (ext === '.pptx') return 'pptx';
	if (ext === '.pdf') return 'pdf';
	return IMAGE_TYPES.includes(ext) ? 'image' : undefined;
}

/** Why a name is not a kind of file we read, as a sentence. */
export function unsupported(name: string): string {
	return /\.(doc|ppt|odt|odp)$/i.test(name)
		? `Soubor ${name} je ve starém formátu. Ulož ho jako .docx nebo .pptx.`
		: `Soubor ${name} neumím přečíst. Zkus Word, PowerPoint, PDF nebo obrázek.`;
}

/** SHA-256 of the bytes in hex, or, where the browser has no `crypto.subtle`, a 53-bit hash. */
export async function hashOf(data: ArrayBuffer): Promise<string> {
	if (globalThis.crypto?.subtle !== undefined) {
		const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (const byte of new Uint8Array(data)) {
		h1 = Math.imul(h1 ^ byte, 2654435761);
		h2 = Math.imul(h2 ^ byte, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** The libraries, loaded on demand; a test passes its own. */
export interface Libraries {
	mammoth(): Promise<Parameters<typeof import('./docx').readDocx>[3]>;
	jszip(): Promise<Parameters<typeof import('./pptx').readPptx>[3]>;
	pdfjs(): Promise<Parameters<typeof import('./pdf').readPdf>[3]>;
}

export async function readMaterial(
	file: { name: string; arrayBuffer(): Promise<ArrayBuffer> } & Blob,
	io: ReadIO,
	room: Room,
	libraries: Libraries
): Promise<MaterialFile> {
	const kind = kindOf(file.name);
	if (kind === undefined) throw new Refused(unsupported(file.name));
	const data = await file.arrayBuffer();
	// First: pdf.js hands its copy of the bytes to a worker, which empties it.
	const hash = await hashOf(data);
	let out: ReadOut;
	if (kind === 'docx')
		out = await (await import('./docx')).readDocx(data, io, room, await libraries.mammoth());
	else if (kind === 'pptx')
		out = await (await import('./pptx')).readPptx(data, io, room, await libraries.jszip());
	else if (kind === 'pdf')
		out = await (await import('./pdf')).readPdf(data, io, room, await libraries.pdfjs());
	else out = await (await import('./image')).readImage(file as Blob & { name: string }, io);

	if (out.pieces.length === 0)
		throw new Refused(`V souboru ${file.name} jsem nenašel žádný text, který by šel přečíst.`);
	const pieces = out.pieces.map((p) => ({ ...p, text: p.text.slice(0, MAX_SECTION_CHARS) }));
	return materialFileSchema.parse({
		hash,
		name: file.name.slice(0, 200),
		pages: Math.max(1, out.pages),
		unread: out.unread,
		sections: sectionsOf(hash, file.name.slice(0, 200), pieces)
	});
}
