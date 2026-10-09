#!/usr/bin/env node
/**
 * Fails before `npm run dev` / `npm run build` when `node_modules` is not what
 * `package-lock.json` asks for.
 *
 * After a pull that adds a dependency, the dev server still starts — Vite only says
 * "Failed to run dependency scan" among its other start-up lines — and the first page
 * load is a 500 with "Cannot find module". That is what a merge adding the visual
 * editor's packages looked like to someone who had not re-run `npm install`. This
 * check says so in one line, before anything starts.
 *
 * Only the direct dependencies are compared, by version: that is what a pull changes,
 * and it costs one small file read each. A fresh `npm ci` (CI, Docker) always passes.
 *
 * Plain `.mjs` for the same reason as `inject-player-shim.mjs`: it runs before
 * anything is compiled.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} root the directory holding `package.json`
 * @returns {{ name: string, wanted: string, installed: string | null }[]}
 */
export function staleDependencies(root) {
	const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
	const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
	const stale = [];
	for (const name of names) {
		const wanted = lock.packages?.[`node_modules/${name}`]?.version;
		if (!wanted) continue;
		const file = join(root, 'node_modules', name, 'package.json');
		const installed = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version : null;
		if (installed !== wanted) stale.push({ name, wanted, installed });
	}
	return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const stale = staleDependencies(process.cwd());
	if (stale.length) {
		const list = stale
			.map((d) => `  ${d.name}: ${d.installed ?? 'missing'}, package-lock.json has ${d.wanted}`)
			.join('\n');
		console.error(
			`node_modules does not match package-lock.json:\n${list}\n\nRun \`npm install\` and start again.`
		);
		process.exit(1);
	}
}
