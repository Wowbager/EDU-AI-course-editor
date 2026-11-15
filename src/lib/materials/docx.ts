/**
 * A Word file into Markdown (mammoth), cut at its headings. Pictures inside are left
 * out; a file with no text at all but with pictures has them read instead.
 */
import { estimatePages, MAX_PAGES, splitMarkdown, type Piece } from '$lib/domain/materials';
import type JSZip from 'jszip';
import { equationsToPlaceholders, fillEquations } from './omml';
import { MIN_TEXT, Refused, TOO_MANY_PAGES, type ReadIO, type ReadOut, type Room } from './types';

type Mammoth = {
	convertToMarkdown(
		input: { arrayBuffer: ArrayBuffer },
		options?: unknown
	): Promise<{ value: string }>;
	images: { imgElement(fn: (image: Image) => Promise<{ src: string }>): unknown };
};
type Image = { contentType: string; readAsArrayBuffer(): Promise<ArrayBuffer> };

const MAX_PICTURES = 20;

export async function readDocx(
	data: ArrayBuffer,
	io: ReadIO,
	room: Room,
	mammoth: Mammoth,
	JSZipClass: typeof JSZip
): Promise<ReadOut> {
	// mammoth drops Word's equations; they are swapped for a word each before it reads the
	// file and become LaTeX again in its Markdown, where they stood.
	const zip = await JSZipClass.loadAsync(data);
	const documentXml = await zip.file('word/document.xml')?.async('string');
	let equations: ReturnType<typeof equationsToPlaceholders>['equations'] = [];
	if (documentXml?.includes('<m:oMath') === true) {
		const swapped = equationsToPlaceholders(documentXml);
		equations = swapped.equations;
		zip.file('word/document.xml', swapped.xml);
		data = await zip.generateAsync({ type: 'arraybuffer' });
	}
	const pictures: { type: string; data: ArrayBuffer }[] = [];
	const result = await mammoth.convertToMarkdown(
		{ arrayBuffer: data },
		{
			convertImage: mammoth.images.imgElement(async (image) => {
				const at = pictures.length;
				if (at < MAX_PICTURES)
					pictures.push({ type: image.contentType, data: await image.readAsArrayBuffer() });
				return { src: `img:${at}` };
			})
		}
	);
	// mammoth escapes Markdown characters in text (`\.`, `\_`); the model reads plain text.
	// (Unescaped first: the LaTeX that goes in afterwards keeps its backslashes.)
	const text = fillEquations(
		result.value
			.replace(/!\[[^\]]*\]\(img:\d+\)/g, '')
			.replace(/\\([\\`*_{}[\]()#+\-.!|>~$])/g, '$1'),
		equations
	)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	const pieces: Piece[] = [];
	const unread: string[] = [];
	if (text.length >= MIN_TEXT || pictures.length === 0) pieces.push(...splitMarkdown(text));
	else {
		// A scan saved as Word: the pictures are the pages.
		for (const [i, picture] of pictures.entries()) {
			try {
				const read = await io.ocr(
					await io.shrink(new Blob([picture.data], { type: picture.type }))
				);
				if (read.trim() !== '') pieces.push({ title: `Obrázek ${i + 1}`, text: read.trim() });
			} catch {
				unread.push(`Obrázek ${i + 1} se nepodařilo přečíst`);
			}
		}
	}
	const pages = Math.max(
		estimatePages(text),
		pictures.length > 0 && text === '' ? pictures.length : 1
	);
	if (pages > Math.min(room.pages, MAX_PAGES)) throw new Refused(TOO_MANY_PAGES(MAX_PAGES));
	return { pieces, pages, unread };
}
