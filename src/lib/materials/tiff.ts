/**
 * A TIFF (what a school scanner makes) into one piece per page, each page drawn and read
 * as a picture. A page that cannot be read is said, not left out in silence.
 */
import type { Piece } from '$lib/domain/materials';
import { MAX_PAGES } from '$lib/domain/materials';
import { Refused, TOO_MANY_PAGES, type ReadIO, type ReadOut, type Room } from './types';

/** The part of utif2 used here, so a test can hand in the module that runs under Node. */
export interface Utif {
	decode(buffer: ArrayBuffer): object[];
	decodeImage(buffer: ArrayBuffer, ifd: object): void;
	toRGBA8(ifd: object): Uint8Array;
}

/** Pages drawn and read at the same time. */
const AT_ONCE = 3;

export async function readTiff(
	data: ArrayBuffer,
	io: ReadIO,
	room: Room,
	utif: Utif,
	name = ''
): Promise<ReadOut> {
	let ifds: object[];
	try {
		ifds = utif.decode(data);
	} catch {
		throw new Refused(`Obrázek ${name} se nepodařilo otevřít.`);
	}
	const pages = ifds.length;
	if (pages === 0) throw new Refused(`Obrázek ${name} se nepodařilo otevřít.`);
	if (pages > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
	const title = name.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'Obrázek';
	const pieces: (Piece | null)[] = new Array(pages).fill(null);
	const unread: number[] = [];
	let next = 0;
	// Each page is decoded only when its turn comes, so a long scan holds few decoded pages.
	await Promise.all(
		Array.from({ length: Math.min(AT_ONCE, pages) }, async () => {
			while (next < pages) {
				const n = next++;
				const ifd = ifds[n] as { width: number; height: number; data?: unknown };
				try {
					utif.decodeImage(data, ifd);
					const picture = await io.fromPixels(utif.toRGBA8(ifd), ifd.width, ifd.height);

					const text = (await io.ocr(picture)).trim();
					if (text !== '')
						pieces[n] =
							pages === 1
								? { title, text }
								: { title: `Strana ${n + 1}`, text, unit: 'page', from: n + 1 };
				} catch {
					unread.push(n + 1);
				} finally {
					// utif2 hangs the decoded pixels on the page: let go of them now.
					delete ifd.data;
				}
			}
		})
	);
	unread.sort((a, b) => a - b);
	return {
		pieces: pieces.filter((p): p is Piece => p !== null),
		pages,
		unread: unread.map((n) => `Stranu ${n} se nepodařilo přečíst`)
	};
}
