/**
 * A PDF into one piece per page: its text layer. A page with (almost) no text is a
 * scan: it is drawn and read as a picture. A page that cannot be read is said, not left
 * out in silence.
 */
import type { Piece } from '$lib/domain/materials';
import { MAX_PAGES } from '$lib/domain/materials';
import { MIN_TEXT, Refused, TOO_MANY_PAGES, type ReadIO, type ReadOut, type Room } from './types';

/** The part of pdf.js used here, so a test can hand in the build that runs under Node. */
export interface Pdfjs {
	getDocument(source: { data: Uint8Array }): {
		promise: Promise<{
			numPages: number;
			getPage(n: number): Promise<{
				getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
			}>;
			destroy?(): Promise<void>;
		}>;
	};
}

export async function readPdf(
	data: ArrayBuffer,
	io: ReadIO,
	room: Room,
	pdfjs: Pdfjs
): Promise<ReadOut> {
	const document = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
	try {
		const pages = document.numPages;
		if (pages > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
		const unread: string[] = [];
		const pieces: (Piece | null)[] = new Array(pages).fill(null);
		// A scan is read by the server, a few at a time (the reader's own pool); the text
		// of the other pages does not wait for it.
		const reading: Promise<void>[] = [];
		for (let n = 1; n <= pages; n++) {
			const piece = (text: string): Piece => ({
				title: `Strana ${n}`,
				text,
				unit: 'page',
				from: n
			});
			const failed = () => unread.push(`Stranu ${n} se nepodařilo přečíst`);
			let page: Awaited<ReturnType<typeof document.getPage>>;
			let text = '';
			try {
				page = await document.getPage(n);
				text = (await page.getTextContent()).items
					.map((item) => (item.str ?? '') + (item.hasEOL === true ? '\n' : ''))
					.join('')
					.replace(/[ \t]+\n/g, '\n')
					.trim();
			} catch {
				failed();
				continue;
			}
			if (text.length >= MIN_TEXT) {
				pieces[n - 1] = piece(text);
				continue;
			}
			const scanned = page;
			reading.push(
				(async () => {
					try {
						const read = (await io.ocr(await io.renderPage(scanned))).trim();
						// A page of its own few words that the picture reader does not add to is still a page.
						if (read !== '') pieces[n - 1] = piece(read);
						else if (text !== '') pieces[n - 1] = piece(text);
					} catch {
						if (text !== '') pieces[n - 1] = piece(text);
						else failed();
					}
				})()
			);
		}
		await Promise.all(reading);
		unread.sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
		return { pieces: pieces.filter((p): p is Piece => p !== null), pages, unread };
	} finally {
		void document.destroy?.();
	}
}
