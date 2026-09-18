#!/usr/bin/env node
/**
 * Splices `src/lib/preview/player-shim.js` into the Flutter player's `index.html`,
 * as the first thing in `<head>` — see that file's own doc comment for why it has
 * to run before Flutter's bootstrap script, and `src/routes/preview-image` for what
 * it's a workaround for.
 *
 * Both places that serve the player use this same module, so the fix can't drift
 * between them:
 *  - `vite-plugin-player.ts` calls `injectPlayerShim` in-process for every request
 *    to `index.html` during `npm run dev`.
 *  - the Dockerfile runs this file as a CLI (`node inject-player-shim.mjs <html>
 *    <shim.js>`) once, at image build time, against the built player's `index.html`.
 *
 * Plain `.mjs`, not `.ts`: it has to run standalone under plain Node in the Docker
 * build stage, with no bundler or `ts-node` available there.
 */
import { readFileSync, writeFileSync } from 'node:fs';

export const SHIM_START = '<!-- edu-preview-image-shim:start -->';
export const SHIM_END = '<!-- edu-preview-image-shim:end -->';

/** @param {string} literal @returns {string} */
function escapeRegExp(literal) {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns `html` with `shimSource` inlined as the first script in `<head>`, wrapped
 * in `SHIM_START`/`SHIM_END` markers.
 *
 * Idempotent: if the markers are already present (e.g. this ran twice against the
 * same file, or is re-run against dev's already-patched output), the block between
 * them is replaced in place rather than a second copy being appended — the source
 * that ships is whatever `shimSource` currently is, never a stale first injection.
 *
 * Fails loudly — throws, rather than returning `html` unchanged — if it cannot find
 * a `<head>` tag to insert into. A silent no-op here would produce a player build
 * that looks fine and quietly still calls the unreliable Laravel proxy, which is
 * exactly the failure this whole feature exists to avoid.
 *
 * @param {string} html
 * @param {string} shimSource
 * @returns {string}
 */
export function injectPlayerShim(html, shimSource) {
	const block = `${SHIM_START}\n<script>\n${shimSource}\n</script>\n${SHIM_END}`;
	const existing = new RegExp(`${escapeRegExp(SHIM_START)}[\\s\\S]*?${escapeRegExp(SHIM_END)}`);
	if (existing.test(html)) {
		return html.replace(existing, block);
	}

	const headMatch = /<head[^>]*>/i.exec(html);
	if (!headMatch) {
		throw new Error(
			'inject-player-shim: no <head> tag found in the player HTML. Refusing to guess where ' +
				'the shim belongs — the Flutter build output format may have changed.'
		);
	}
	const insertAt = headMatch.index + headMatch[0].length;
	return html.slice(0, insertAt) + '\n' + block + '\n' + html.slice(insertAt);
}

// ── CLI entry point ──────────────────────────────────────────────────────────────
// `node inject-player-shim.mjs <index.html path> <shim.js path>` — used by the
// Dockerfile. Reads both files, injects, and writes the result back to the same
// `index.html` path. Exits non-zero (and prints why) on any failure, so a build
// with a missing or unreadable file fails the Docker build rather than shipping an
// unpatched player.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
	const [, , htmlPath, shimPath] = process.argv;
	if (!htmlPath || !shimPath) {
		console.error('usage: node inject-player-shim.mjs <index.html path> <shim.js path>');
		process.exit(1);
	}
	try {
		const html = readFileSync(htmlPath, 'utf-8');
		const shimSource = readFileSync(shimPath, 'utf-8');
		writeFileSync(htmlPath, injectPlayerShim(html, shimSource), 'utf-8');
		console.log(`[inject-player-shim] injected ${shimPath} into ${htmlPath}`);
	} catch (error) {
		console.error(`[inject-player-shim] failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
