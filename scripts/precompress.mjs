// Write a `.br` and a `.gz` beside every file of the player build that compresses,
// so nginx serves them as they are (`brotli_static`, `gzip_static` in nginx.conf)
// instead of gzipping each request on the fly at a low level.
//
// The player is most of what a teacher downloads: `main.dart.js` and CanvasKit's
// wasm are megabytes each. Compressing them once, at the highest levels, when the
// image is built, costs build time and saves every first load about a third.
//
//   node scripts/precompress.mjs <directory>
//
// Run it after anything that rewrites a file in the directory (the player shim is
// spliced into index.html first), or the compressed copy is of the old file.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** What a browser fetches and compresses. Not `.symbols` (debug), `.md`, images. */
const COMPRESSIBLE = /\.(js|mjs|wasm|json|html|css|svg|ttf|otf|frag|bin|txt)$|\/NOTICES$/;
/** Below this the headers outweigh the saving. */
const MIN_BYTES = 1024;
/** A copy that saves less than this is not worth a second file. */
const MIN_RATIO = 0.9;

const root = process.argv[2];
if (root === undefined) {
	console.error('usage: node scripts/precompress.mjs <directory>');
	process.exit(2);
}

async function* files(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* files(path);
		else if (entry.isFile()) yield path;
	}
}

async function compress(path) {
	const source = await readFile(path);
	const [br, gzipped] = await Promise.all([
		brotli(source, {
			params: {
				[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
				[constants.BROTLI_PARAM_SIZE_HINT]: source.length
			}
		}),
		gz(source, { level: constants.Z_BEST_COMPRESSION })
	]);
	let wrote = 0;
	if (br.length < source.length * MIN_RATIO) {
		await writeFile(`${path}.br`, br);
		wrote += br.length;
	}
	if (gzipped.length < source.length * MIN_RATIO) await writeFile(`${path}.gz`, gzipped);
	return { before: source.length, after: wrote || source.length };
}

const todo = [];
for await (const path of files(root)) {
	if (!COMPRESSIBLE.test(path.replaceAll('\\', '/'))) continue;
	if ((await stat(path)).size < MIN_BYTES) continue;
	todo.push(path);
}

// zlib's async calls run on libuv's thread pool (4 threads by default); a few at a
// time keeps them all busy without holding every file in memory at once.
let before = 0;
let after = 0;
const queue = [...todo];
await Promise.all(
	Array.from({ length: 4 }, async () => {
		for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
			const size = await compress(path);
			before += size.before;
			after += size.after;
		}
	})
);

const mb = (n) => (n / 1e6).toFixed(1);
console.log(`precompressed ${todo.length} files in ${root}: ${mb(before)} MB -> ${mb(after)} MB brotli`);
