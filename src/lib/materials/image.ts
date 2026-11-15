/** A picture or photo of a material: read as one page. */
import { Refused, type ReadIO, type ReadOut } from './types';

export async function readImage(file: Blob & { name: string }, io: ReadIO): Promise<ReadOut> {
	let picture: Blob;
	try {
		picture = await io.shrink(file);
	} catch {
		// HEIC is what phones save; only some browsers can draw it.
		throw new Refused(
			/\.heic$/i.test(file.name)
				? 'Fotku ve formátu HEIC tento prohlížeč neumí otevřít. Ulož ji jako JPG.'
				: `Obrázek ${file.name} se nepodařilo otevřít.`
		);
	}
	const text = (await io.ocr(picture)).trim();
	const title = file.name.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'Obrázek';
	return { pieces: text === '' ? [] : [{ title, text }], pages: 1, unread: [] };
}
