/** A picture or photo of a material: read as one page. */
import { Refused, type ReadIO, type ReadOut } from './types';

/** What heic2any does, as far as it is used here. */
export type HeicConverter = (options: {
	blob: Blob;
	toType: string;
	quality: number;
}) => Promise<Blob | Blob[]>;

const isHeic = (name: string) => /\.hei[cf]$/i.test(name);

export async function readImage(
	file: Blob & { name: string },
	io: ReadIO,
	heic?: () => Promise<HeicConverter>
): Promise<ReadOut> {
	let picture: Blob;
	try {
		picture = await io.shrink(file);
	} catch {
		// HEIC is what phones save; only some browsers can draw it. Chrome cannot: convert it.
		if (!isHeic(file.name) || heic === undefined)
			throw new Refused(`Obrázek ${file.name} se nepodařilo otevřít.`);
		try {
			const converted = await (await heic())({ blob: file, toType: 'image/jpeg', quality: 0.9 });
			picture = await io.shrink(Array.isArray(converted) ? converted[0] : converted);
		} catch {
			throw new Refused('Fotku ve formátu HEIC se nepodařilo otevřít. Ulož ji jako JPG.');
		}
	}
	const text = (await io.ocr(picture)).trim();
	const title = file.name.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'Obrázek';
	return { pieces: text === '' ? [] : [{ title, text }], pages: 1, unread: [] };
}

/** The size a picture is drawn at: its longest side at most `side`, never enlarged. */
export function fitSide(width: number, height: number, side: number) {
	const scale = Math.min(1, side / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}
