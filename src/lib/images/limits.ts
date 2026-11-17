/**
 * What an uploaded picture may be. One list for the server's check, for the picker's
 * own check before anything is sent, and for the line that tells the teacher.
 *
 * A teacher may pick a photo up to `MAX_PICKED_BYTES`; the browser shrinks it
 * (`images/shrink.ts`) to what is kept, at most `MAX_IMAGE_BYTES` and
 * `MAX_IMAGE_SIDE` pixels, and the server takes no more than that.
 */
export const MAX_PICKED_BYTES = 25 * 1024 * 1024;
/** A kept picture's size at most: the server refuses a bigger one. */
export const MAX_IMAGE_BYTES = 1024 * 1024;
/** A kept picture's longest side, in pixels, once the browser has had to shrink it. */
export const MAX_IMAGE_SIDE = 2048;

/**
 * No SVG: it is a document that can carry a script, and a picture is kept on the
 * editor's own origin. The server checks the bytes too (`server/images/sniff.ts`).
 */
export const IMAGE_TYPES = [
	{ mime: 'image/jpeg', ext: '.jpg', label: 'JPG' },
	{ mime: 'image/png', ext: '.png', label: 'PNG' },
	{ mime: 'image/gif', ext: '.gif', label: 'GIF' },
	{ mime: 'image/webp', ext: '.webp', label: 'WebP' },
	{ mime: 'image/avif', ext: '.avif', label: 'AVIF' },
	{ mime: 'image/bmp', ext: '.bmp', label: 'BMP' }
] as const;

/** For a file input's `accept`: only what the server will take. */
export const IMAGE_ACCEPT = IMAGE_TYPES.map((type) => type.mime).join(',');

const MEGABYTES = MAX_PICKED_BYTES / 1024 / 1024;

/**
 * The kinds a teacher is told about, under the upload button and when a file is
 * refused: the four a phone or a computer saves. The rest of the list is taken too.
 */
const COMMON_TYPES = 'JPG, PNG, GIF nebo WebP';

/** The line under the upload button. */
export const IMAGE_LIMITS_TEXT = `${COMMON_TYPES}, nejvýš ${MEGABYTES} MB (GIF 1 MB)`;

/** Why a picture was not taken, in the words a teacher is told. */
export type ImageProblem =
	'too-big' | 'not-smaller' | 'big-gif' | 'wrong-type' | 'full' | 'several' | 'later' | 'no-room';

export const IMAGE_PROBLEM_TEXT: Record<ImageProblem, string> = {
	'too-big': `Obrázek je větší než ${MEGABYTES} MB. Zmenši ho a zkus to znovu.`,
	// The server's own limit: what the browser could not shrink, or a client that did not.
	'not-smaller': 'Obrázek se nepodařilo zmenšit pod 1 MB. Zmenši ho a zkus to znovu.',
	// An animation cannot be made smaller in the browser without losing it.
	'big-gif': 'Obrázek GIF může mít nejvýš 1 MB. Použij menší, nebo ho ulož jako JPG či PNG.',
	'wrong-type': `Tenhle soubor nahrát nejde. Použij obrázek ${COMMON_TYPES}.`,
	full: 'Galerie je plná. Smaž obrázky, které už nepotřebuješ, a zkus to znovu.',
	several: 'Vyber jen jeden obrázek.',
	later: 'Obrázek teď nejde nahrát. Zkus to prosím za chvíli.',
	'no-room': 'Na serveru teď není místo pro další obrázky. Zkus to prosím později.'
};

/** The check the server makes, made before sending: a refused file is never uploaded. */
export function imageProblem(file: { type: string; size: number }): ImageProblem | null {
	if (!IMAGE_TYPES.some((type) => type.mime === file.type)) return 'wrong-type';
	if (file.size > MAX_PICKED_BYTES) return 'too-big';
	if (file.type === 'image/gif' && file.size > MAX_IMAGE_BYTES) return 'big-gif';
	return null;
}
