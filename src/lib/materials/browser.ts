/**
 * What reading a file needs from the browser: the libraries (loaded on first use), a
 * canvas to draw a PDF page or shrink a photo, and the server to read a picture.
 */
import { workspaceKey } from '$lib/state/versions/server';
import type { Libraries } from './read';
import { fitSide } from './image';
import type { ReadIO } from './types';
import { PICTURE_BYTES, PICTURE_SIDE } from '$lib/domain/materials';
import { uploadImage } from '$lib/api/images';

/** The longest side of a picture sent for reading, in pixels. */
const SIDE = 1600;
/** Pictures sent as they are when they are this small. */
const AS_IS_BYTES = 3 * 1024 * 1024;
/** Pictures sent to the server at the same time (the server's limit is 40 requests a minute). */
const CONCURRENT = 3;

export const libraries: Libraries = {
	mammoth: async () =>
		(
			(await import('mammoth/mammoth.browser.js')) as unknown as {
				default: Parameters<typeof import('./docx').readDocx>[3];
			}
		).default,
	jszip: async () => (await import('jszip')).default,
	turndown: async () => ({
		TurndownService: (await import('turndown')).default,
		gfm: (await import('@joplin/turndown-plugin-gfm')).gfm
	}),
	mathml: async () => {
		const { MathMLToLaTeX } = await import('mathml-to-latex');
		return (mathml) => MathMLToLaTeX.convert(mathml);
	},
	pdfjs: async () => {
		const pdfjs = await import('pdfjs-dist');
		pdfjs.GlobalWorkerOptions.workerSrc = (
			await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
		).default;
		return pdfjs as unknown as Parameters<typeof import('./pdf').readPdf>[3];
	},
	xlsx: async () => await import('xlsx'),
	utif: async () => {
		const module = await import('utif2');
		return (module.default ?? module) as unknown as Parameters<typeof import('./tiff').readTiff>[3];
	},
	heic: async () => {
		const module = await import('heic2any');
		return (module.default ?? module) as unknown as import('./image').HeicConverter;
	}
};

const white = (width: number, height: number) => {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d')!;
	context.fillStyle = '#fff';
	context.fillRect(0, 0, width, height);
	return { canvas, context };
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
	new Promise<Blob>((resolve, reject) =>
		canvas.toBlob((b) => (b === null ? reject(new Error('no picture')) : resolve(b)), type, quality)
	);

/** The picture, PNG, or JPEG when the PNG would be too big to send. */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
	const png = await toBlob(canvas, 'image/png');
	return png.size <= AS_IS_BYTES ? png : toBlob(canvas, 'image/jpeg', 0.88);
}

const pause = (seconds: number) => new Promise((r) => setTimeout(r, seconds * 1000));

/** Runs at most `CONCURRENT` of the jobs at once. */
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(job: () => Promise<T>): Promise<T> {
	if (active >= CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
	active++;
	try {
		return await job();
	} finally {
		active--;
		waiting.shift()?.();
	}
}

/** Times a page is asked for again when the server is busy or over its limit. */
const RETRIES = 3;

/**
 * One picture to the server's reader. A 429, or a 503 that says when to come back, is waited out, as long as the server
 * says (`Retry-After`) or a growing while (2, 4, 8 s), and asked again before the page is
 * given up; anything else fails at once.
 */
export async function readOnServer(
	picture: Blob,
	options: { fetcher?: typeof fetch; wait?: (seconds: number) => Promise<unknown> } = {}
): Promise<string> {
	const key = workspaceKey();
	if (!key) throw new Error('no workspace');
	const fetcher = options.fetcher ?? fetch;
	const wait = options.wait ?? pause;
	for (let attempt = 0; ; attempt++) {
		const response = await fetcher('/ai/read', {
			method: 'POST',
			headers: { 'content-type': picture.type, 'x-editor-workspace': key },
			body: picture
		});
		// A 503 without Retry-After is a server with no AI at all: waiting will not help.
		const busy =
			response.status === 429 ||
			(response.status === 503 && response.headers.get('retry-after') !== null);
		if (busy && attempt < RETRIES) {
			const after = Number(response.headers.get('retry-after'));
			await wait(Math.min(Number.isFinite(after) && after > 0 ? after : 2 ** (attempt + 1), 70));
			continue;
		}
		if (!response.ok) throw new Error(String(response.status));
		const body = (await response.json()) as { text?: unknown };
		return typeof body.text === 'string' ? body.text : '';
	}
}

export const browserIO: ReadIO = {
	ocr: (picture) => slot(() => readOnServer(picture)),

	async shrink(picture) {
		let bitmap: ImageBitmap;
		try {
			bitmap = await createImageBitmap(picture);
		} catch {
			throw new Error('cannot decode');
		}
		try {
			const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
			const sendable = /^image\/(png|jpeg|webp)$/.test(picture.type);
			if (scale === 1 && sendable && picture.size <= AS_IS_BYTES) return picture;
			const { canvas, context } = white(
				Math.round(bitmap.width * scale),
				Math.round(bitmap.height * scale)
			);
			context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			return await toBlob(canvas, 'image/jpeg', 0.88);
		} finally {
			bitmap.close();
		}
	},

	async fitPicture(picture) {
		let bitmap: ImageBitmap;
		try {
			bitmap = await createImageBitmap(picture);
		} catch {
			throw new Error('cannot decode');
		}
		try {
			const size = fitSide(bitmap.width, bitmap.height, PICTURE_SIDE);
			const kept = /^image\/(png|jpeg|webp)$/.test(picture.type);
			if (size.width === bitmap.width && kept && picture.size <= PICTURE_BYTES) return picture;
			const { canvas, context } = white(size.width, size.height);
			context.imageSmoothingQuality = 'high';
			context.drawImage(bitmap, 0, 0, size.width, size.height);
			const jpeg = await toBlob(canvas, 'image/jpeg', 0.85);
			return jpeg.size <= PICTURE_BYTES ? jpeg : toBlob(canvas, 'image/jpeg', 0.6);
		} finally {
			bitmap.close();
		}
	},

	async keep(picture, name) {
		const type = picture.type || 'image/jpeg';
		// The store names the file by its type: a photo made into a JPEG is a .jpg.
		const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
		const meta = await uploadImage(new File([picture], base, { type }));
		return meta.id;
	},

	async fromPixels(rgba, width, height) {
		// putImageData replaces pixels, so the pixels go on a scratch canvas and are drawn,
		// scaled down, over white: transparent ones then come out white, not black.
		const source = document.createElement('canvas');
		try {
			source.width = width;
			source.height = height;
			source
				.getContext('2d')!
				.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
			const size = fitSide(width, height, SIDE);
			const { canvas, context } = white(size.width, size.height);
			// A scan shrinks several times over: thin strokes stay readable for the reader.
			context.imageSmoothingQuality = 'high';
			context.drawImage(source, 0, 0, size.width, size.height);
			return await encode(canvas);
		} finally {
			// A full-size page is large; let it go whether or not the page was read.
			source.width = source.height = 0;
		}
	},

	async renderPage(page) {
		const p = page as {
			getViewport(o: { scale: number }): { width: number; height: number };
			render(o: {
				canvas: HTMLCanvasElement;
				canvasContext: CanvasRenderingContext2D;
				viewport: unknown;
			}): {
				promise: Promise<void>;
			};
		};
		const base = p.getViewport({ scale: 1 });
		const viewport = p.getViewport({
			scale: Math.min(3, SIDE / Math.max(base.width, base.height))
		});
		const { canvas, context } = white(Math.round(viewport.width), Math.round(viewport.height));
		await p.render({ canvas, canvasContext: context, viewport }).promise;
		return encode(canvas);
	}
};
