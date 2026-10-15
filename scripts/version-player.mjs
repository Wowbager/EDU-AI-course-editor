// Put the player build under a path named by its contents, so every file but its
// page can be cached for good.
//
// No file of a Flutter build has a version in its name: `main.dart.js` and
// `canvaskit.wasm` are called that in every build. Served at fixed URLs they can
// only be revalidated (one request per file on every visit), or cached and risk a
// new `main.dart.js` running on an old CanvasKit. So the image moves everything but
// `index.html` into `<directory>/<hash>/`, where `<hash>` is taken from the files
// themselves, and points the page's `<base href>` there. nginx serves the page with
// `no-cache` and everything under a hash as `immutable` (nginx.conf). A new build is
// a new hash; nothing a browser cached for the old one is asked for again.
//
// The hash, not `PLAYER_REF`: the Flutter toolchain in the Dockerfile is `stable`,
// so the same commit can build different bytes.
//
//   node scripts/version-player.mjs <directory>
//
// Run it after the shim is spliced into index.html and before precompressing.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.argv[2];
if (root === undefined) {
	console.error('usage: node scripts/version-player.mjs <directory>');
	process.exit(2);
}
const PAGE = 'index.html';

async function* files(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* files(path);
		else if (entry.isFile()) yield path;
	}
}

// Every file but the page, by path and content: the page is served revalidated, and
// a change to it alone (the shim) does not need a new path for the rest.
const hash = createHash('sha256');
for await (const path of files(root)) {
	const name = relative(root, path).replaceAll('\\', '/');
	if (name === PAGE) continue;
	hash.update(name).update('\0').update(await readFile(path)).update('\0');
}
const version = hash.digest('hex').slice(0, 16);

const pagePath = join(root, PAGE);
const page = await readFile(pagePath, 'utf8');
const base = /<base\s+href="\/player\/"\s*\/?>/g;
const bases = page.match(base) ?? [];
if (bases.length !== 1) {
	// Refuse rather than ship a page whose files are somewhere it does not look.
	console.error(
		`version-player: expected one <base href="/player/"> in ${pagePath}, found ${bases.length}`
	);
	process.exit(1);
}

await mkdir(join(root, version));
for (const entry of await readdir(root)) {
	if (entry === PAGE || entry === version) continue;
	await rename(join(root, entry), join(root, version, entry));
}
await writeFile(pagePath, page.replace(base, `<base href="/player/${version}/">`));
console.log(`version-player: ${root} is served from /player/${version}/`);
