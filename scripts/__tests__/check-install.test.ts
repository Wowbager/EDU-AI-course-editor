import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { staleDependencies } from '../check-install.mjs';

let root: string;

function project(installed: Record<string, string>) {
	root = mkdtempSync(join(tmpdir(), 'check-install-'));
	const json = (path: string, value: unknown) => {
		mkdirSync(join(root, path, '..'), { recursive: true });
		writeFileSync(join(root, path), JSON.stringify(value));
	};
	json('package.json', {
		dependencies: { marked: '^18.1.0', '@tiptap/core': '^3.31.4' },
		devDependencies: { vite: '^8.0.16' }
	});
	json('package-lock.json', {
		packages: {
			'': {},
			'node_modules/marked': { version: '18.1.0' },
			'node_modules/@tiptap/core': { version: '3.31.4' },
			'node_modules/vite': { version: '8.3.0' }
		}
	});
	for (const [name, version] of Object.entries(installed))
		json(`node_modules/${name}/package.json`, { name, version });
	return root;
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('staleDependencies', () => {
	it('passes an install that matches the lockfile', () => {
		const dir = project({ marked: '18.1.0', '@tiptap/core': '3.31.4', vite: '8.3.0' });
		expect(staleDependencies(dir)).toEqual([]);
	});

	it('names a dependency a pull added and nobody installed', () => {
		// What `npm run dev` hit after the visual editor was merged: a 500 on every page.
		const dir = project({ vite: '8.3.0' });
		expect(staleDependencies(dir)).toEqual([
			{ name: 'marked', wanted: '18.1.0', installed: null },
			{ name: '@tiptap/core', wanted: '3.31.4', installed: null }
		]);
	});

	it('names a dependency installed at another version', () => {
		const dir = project({ marked: '18.1.0', '@tiptap/core': '3.31.4', vite: '8.0.16' });
		expect(staleDependencies(dir)).toEqual([
			{ name: 'vite', wanted: '8.3.0', installed: '8.0.16' }
		]);
	});
});
