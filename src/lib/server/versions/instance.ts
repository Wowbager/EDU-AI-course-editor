import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';
import { VersionFiles } from './files';

/**
 * Where the server keeps versions: `DATA_DIR`, which the Docker image sets to the
 * `/data` volume. In development it defaults to `.data/` in the checkout, which is
 * gitignored.
 */
let files: VersionFiles | null = null;
export function versionFiles(): VersionFiles {
	files ??= new VersionFiles(resolve(env.DATA_DIR || '.data'));
	return files;
}
