import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';
import { MaterialFiles } from './files';

/** Where the server keeps materials: beside the versions, under `DATA_DIR`. */
let files: MaterialFiles | null = null;
export function materialFiles(): MaterialFiles {
	files ??= new MaterialFiles(resolve(env.DATA_DIR || '.data'));
	return files;
}
