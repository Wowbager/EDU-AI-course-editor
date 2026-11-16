/**
 * What the readers of a teacher's files (Word, PowerPoint, PDF, pictures) need from the
 * browser, so they can be tested without one: turning a picture into text goes through the
 * server's `/ai/read`, and drawing a PDF page or shrinking a photo needs a canvas.
 */
import type { Piece } from '$lib/domain/materials';

export interface ReadIO {
	/** A picture's text as Markdown; rejects when it cannot be read. */
	ocr(picture: Blob): Promise<string>;
	/** A picture small enough to send: the same one, or shrunk. Rejects for a format the browser cannot decode. */
	shrink(picture: Blob): Promise<Blob>;
	/** Decoded RGBA pixels (a TIFF page) drawn as a picture. */
	fromPixels(rgba: Uint8Array, width: number, height: number): Promise<Blob>;
	/** A PDF page drawn as a picture. */
	renderPage(page: unknown): Promise<Blob>;
}

/** What a file was read into: the pieces, the pages it counts as, and the pages that failed. */
export interface ReadOut {
	pieces: Piece[];
	pages: number;
	/** One Czech line for each page or slide that could not be read. */
	unread: string[];
}

/** A reason for not taking a file, already a sentence for the teacher. */
export class Refused extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'Refused';
	}
}

/** Pages left in the course's budget (`MAX_PAGES`) for the file being read. */
export type Room = { pages: number };

export const TOO_MANY_PAGES = (max: number) =>
	`Podklady mohou mít nejvýše ${max} stran nebo snímků.`;

/** Text a page or slide must hold to count as having any: less goes to the picture reader. */
export const MIN_TEXT = 25;
