/**
 * A picture made small enough to keep before it is uploaded: at most `MAX_IMAGE_BYTES`,
 * and `MAX_IMAGE_SIDE` pixels on its longest side when it had to be redrawn. The server
 * refuses anything bigger (`server/images/files.ts`), so this is where a phone's 5 MB
 * photo becomes a few hundred kilobytes.
 */
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from './limits';

/** What to do with a picture: keep it as it is, or draw it again. */
export function shrinkPlan(file: { type: string; size: number }): 'as-is' | 'redraw' {
	// An animated GIF would lose its animation on a canvas; `imageProblem` refuses a big one.
	if (file.type === 'image/gif') return 'as-is';
	if (file.size <= MAX_IMAGE_BYTES && file.type !== 'image/bmp') return 'as-is';
	return 'redraw';
}

/**
 * The type a redrawn picture is kept as: a photo stays a JPEG; anything that may be
 * transparent becomes a WebP, which keeps the transparency, or a PNG where the browser
 * cannot write WebP.
 */
export function redrawType(type: string): 'image/jpeg' | 'image/webp' {
	return type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
}

/** The sides a picture is drawn at, its longest side at most `side`. */
export function fitWithin(width: number, height: number, side: number) {
	const scale = Math.min(1, side / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

const QUALITY = 0.85;
/** Below this side a picture is not made smaller, only its quality lower. */
const SMALLEST_SIDE = 400;
const LOWEST_QUALITY = 0.5;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
	new Promise<Blob>((resolve, reject) =>
		canvas.toBlob((b) => (b === null ? reject(new Error('no picture')) : resolve(b)), type, quality)
	);

/**
 * The file to upload in place of `file`. Rejects for a picture the browser cannot open.
 * A small picture is still opened, to keep one with a huge side from going as it is.
 * An animated WebP or PNG that has to be redrawn keeps only its first frame.
 */
export async function shrinkForUpload(file: File): Promise<File> {
	if (file.type === 'image/gif') return file;
	const bitmap = await createImageBitmap(file);
	try {
		const longest = Math.max(bitmap.width, bitmap.height);
		if (shrinkPlan(file) === 'as-is' && longest <= MAX_IMAGE_SIDE) return file;
		const wanted = redrawType(file.type);
		let side = MAX_IMAGE_SIDE;
		let quality = QUALITY;
		for (;;) {
			const size = fitWithin(bitmap.width, bitmap.height, side);
			const canvas = document.createElement('canvas');
			canvas.width = size.width;
			canvas.height = size.height;
			const context = canvas.getContext('2d')!;
			context.imageSmoothingQuality = 'high';
			let blob = await toBlob(
				drawOnto(canvas, context, bitmap, wanted === 'image/jpeg'),
				wanted,
				quality
			);
			// A browser that cannot write WebP hands back a PNG, which may be too big;
			// then a JPEG over white.
			const usable = blob.type === wanted || blob.type === 'image/png';
			if (wanted !== 'image/jpeg' && (blob.size > MAX_IMAGE_BYTES || !usable))
				blob = await toBlob(drawOnto(canvas, context, bitmap, true), 'image/jpeg', quality);
			if (blob.size <= MAX_IMAGE_BYTES) return named(file, blob);
			// Smaller first; at the smallest side, lower quality; past that, the server says no.
			if (side > SMALLEST_SIDE) side = Math.max(SMALLEST_SIDE, Math.round(side * 0.75));
			else if (quality > LOWEST_QUALITY) quality = LOWEST_QUALITY;
			else return named(file, blob);
		}
	} finally {
		bitmap.close();
	}
}

/** `bitmap` drawn over the whole canvas, over white when it is to become a JPEG. */
function drawOnto(
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
	bitmap: ImageBitmap,
	white: boolean
): HTMLCanvasElement {
	context.clearRect(0, 0, canvas.width, canvas.height);
	if (white) {
		context.fillStyle = '#fff';
		context.fillRect(0, 0, canvas.width, canvas.height);
	}
	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	return canvas;
}

const EXTENSION: Record<string, string> = {
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'image/png': '.png'
};

/** The redrawn picture under the teacher's name for it, with the extension it now has. */
function named(file: File, blob: Blob): File {
	const base = file.name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
	return new File([blob], `${base}${EXTENSION[blob.type] ?? ''}`, { type: blob.type });
}
