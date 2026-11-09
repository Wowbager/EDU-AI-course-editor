import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';
import { ImageFiles } from './files';

/**
 * Where the server keeps uploaded images: `DATA_DIR`, same as version files.
 * In development defaults to `.data/` in the checkout.
 */
let files: ImageFiles | null = null;
export function imageFiles(): ImageFiles {
	files ??= new ImageFiles(resolve(env.DATA_DIR || '.data'));
	return files;
}
