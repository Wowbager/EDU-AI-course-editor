/**
 * What an uploaded picture may be. One list for the server's check, for the picker's
 * own check before anything is sent, and for the line that tells the teacher.
 *
 * The size is what the deployment lets through: the server's body limit and the
 * proxy's (`BODY_SIZE_LIMIT` in `Dockerfile`, `client_max_body_size` in `nginx.conf`)
 * are 8 MB, so a larger promise here would be refused before it reached this check.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const IMAGE_TYPES = [
	{ mime: 'image/jpeg', ext: '.jpg', label: 'JPG' },
	{ mime: 'image/png', ext: '.png', label: 'PNG' },
	{ mime: 'image/gif', ext: '.gif', label: 'GIF' },
	{ mime: 'image/webp', ext: '.webp', label: 'WebP' },
	{ mime: 'image/svg+xml', ext: '.svg', label: 'SVG' },
	{ mime: 'image/avif', ext: '.avif', label: 'AVIF' },
	{ mime: 'image/bmp', ext: '.bmp', label: 'BMP' }
] as const;

/** For a file input's `accept`: only what the server will take. */
export const IMAGE_ACCEPT = IMAGE_TYPES.map((type) => type.mime).join(',');

const MEGABYTES = MAX_IMAGE_BYTES / 1024 / 1024;

/** The line under the upload button. */
export const IMAGE_LIMITS_TEXT = `${IMAGE_TYPES.map((type) => type.label).join(', ')} — nejvýš ${MEGABYTES} MB`;

/** Why a picture was not taken, in the words a teacher is told. */
export type ImageProblem = 'too-big' | 'wrong-type' | 'full' | 'several';

export const IMAGE_PROBLEM_TEXT: Record<ImageProblem, string> = {
	'too-big': `Obrázek je větší než ${MEGABYTES} MB. Zmenši ho a zkus to znovu.`,
	'wrong-type': 'Tenhle soubor nahrát nejde. Použij obrázek JPG, PNG, GIF nebo WebP.',
	full: 'Galerie je plná. Smaž obrázky, které už nepotřebuješ, a zkus to znovu.',
	several: 'Vyber jen jeden obrázek.'
};

/** The check the server makes, made before sending: a refused file is never uploaded. */
export function imageProblem(file: { type: string; size: number }): ImageProblem | null {
	if (!IMAGE_TYPES.some((type) => type.mime === file.type)) return 'wrong-type';
	if (file.size > MAX_IMAGE_BYTES) return 'too-big';
	return null;
}
