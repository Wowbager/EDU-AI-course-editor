/**
 * The import guard. What the teacher sees and what an AI agent is told come from one
 * screen model (`src/lib/screen`), so a component may not work a displayed value out
 * for itself. This fails the build when one starts to:
 *
 *  - a read-side import from `$lib/domain/` — `derive`, `naming`, `validate`,
 *    `index-doc`, `groups`, `issue-groups` — which is how a component would compute
 *    names, counts, totals or issues. Commands (writing), `import type`, ids, refs and
 *    the number-input parser (writing) are fine;
 *  - `store.mode ===` / `!==`: which mode shows what is declared in `ui/fields.ts`;
 *  - `Number(` / `parseFloat(`: text becomes a number through `parseNumberDraft`;
 *  - a `<script module>` that exports functions: display logic hiding in a component.
 *
 * Files the model does not reach yet are in `PENDING`. The list only shrinks: a pending
 * file that has become clean fails here, so it has to be taken off.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const SCANNED = ['src/lib/editor', 'src/lib/ui', 'src/routes'];

/**
 * Files the model does not reach yet. Part 3 of Round 14 emptied it; it stays so that a
 * file which cannot be migrated at once is listed on purpose, with its reason, instead of
 * being quietly let through — and `the list is empty` below fails the build while it is
 * not.
 */
const PENDING = new Set<string>([]);

const READ_MODULES = ['derive', 'naming', 'validate', 'index-doc', 'groups', 'issue-groups'];

function files(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(`${root}/${dir}`)) {
		const path = `${dir}/${name}`;
		if (statSync(`${root}/${path}`).isDirectory()) out.push(...files(path));
		else if (name.endsWith('.svelte')) out.push(path);
	}
	return out;
}

/** What a file does that the guard forbids, one line each. */
export function violations(source: string): string[] {
	const found: string[] = [];
	// Comments say things like "Number(…)" and "store.mode ===" on purpose.
	const code = source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '');

	for (const match of code.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
		const [, typeOnly, clause, from] = match;
		if (typeOnly !== undefined) continue;
		const module = /^\$lib\/domain\/([\w-]+)$/.exec(from)?.[1];
		if (module === undefined || !READ_MODULES.includes(module)) continue;
		// `import { type X, y }`: only the values count.
		const values = clause
			.replace(/[{}]/g, '')
			.split(',')
			.map((part) => part.trim())
			.filter((part) => part !== '' && !part.startsWith('type '));
		if (values.length > 0) found.push(`imports ${values.join(', ')} from $lib/domain/${module}`);
	}
	if (
		/store\.mode\s*[!=]==?/.test(code) ||
		/\bmode\s*[!=]==?\s*['"](teacher|metodik|advanced)['"]/.test(code)
	) {
		found.push('compares store.mode');
	}
	if (/\bNumber\(/.test(code)) found.push('calls Number(');
	if (/\bparseFloat\(/.test(code)) found.push('calls parseFloat(');
	for (const module of code.matchAll(/<script\b[^>]*\bmodule\b[^>]*>([\s\S]*?)<\/script>/g)) {
		if (
			/\bexport\s+(async\s+)?(function|const\s+\w+\s*=\s*(async\s*)?\(|const\s+\w+\s*=\s*\w+;)/.test(
				module[1]
			)
		) {
			found.push('exports functions from <script module>');
		}
	}
	return found;
}

describe('the guard itself', () => {
	it('flags the read-side imports, and only those', () => {
		expect(violations("import { cardLabel } from '$lib/domain/naming';")).toHaveLength(1);
		expect(violations("import { lessonTotals, type X } from '$lib/domain/derive';")).toHaveLength(
			1
		);
		expect(violations("import type { BlockV2 } from '$lib/domain/schema';")).toEqual([]);
		expect(violations("import { type Issue } from '$lib/domain/validate';")).toEqual([]);
		expect(violations("import { addBlock, setField } from '$lib/domain/commands';")).toEqual([]);
		expect(violations("import { serialise } from '$lib/domain/document';")).toEqual([]);
		expect(violations("import { refKey } from '$lib/domain/ref';")).toEqual([]);
	});

	it('flags mode comparisons, Number( and parseFloat(', () => {
		expect(violations("if (store.mode === 'advanced') {}")).toEqual(['compares store.mode']);
		expect(violations('if (store.mode !== x) {}')).toEqual(['compares store.mode']);
		expect(violations("allows('step', 'id', store.mode)")).toEqual([]);
		expect(violations("if (mode === 'advanced') {}")).toEqual(['compares store.mode']);
		expect(violations('const n = Number(raw);')).toEqual(['calls Number(']);
		expect(violations('const n = parseFloat(raw);')).toEqual(['calls parseFloat(']);
		expect(violations('// Number(x) and store.mode === y are fine in a comment')).toEqual([]);
		expect(violations('const d = Number.isInteger(n);')).toEqual([]);
	});

	it('flags exported functions in a module script, not types', () => {
		const module = (body: string) => `<script module lang="ts">${body}</script>`;
		expect(violations(module('export function f() {}'))).toHaveLength(1);
		expect(violations(module('export const f = (a: number) => a;'))).toHaveLength(1);
		expect(violations(module('export const f = other;'))).toHaveLength(1);
		expect(violations(module('export type T = string; export interface I {}'))).toEqual([]);
		expect(violations('<script lang="ts">export let x;</script>')).toEqual([]);
	});
});

describe('the components that draw the screen', () => {
	const all = SCANNED.flatMap(files).sort();
	const bad = new Map<string, string[]>();
	for (const path of all) {
		const found = violations(readFileSync(`${root}/${path}`, 'utf8'));
		if (found.length > 0) bad.set(path, found);
	}

	it('compute no displayed value, apart from the files still to be migrated', () => {
		const unexpected = [...bad].filter(([path]) => !PENDING.has(path));
		expect(unexpected.map(([path, found]) => `${path}: ${found.join('; ')}`)).toEqual([]);
	});

	it('keep the pending list honest: a file that is clean comes off it', () => {
		const clean = [...PENDING].filter((path) => !bad.has(path));
		expect(clean).toEqual([]);
	});

	it('has nothing pending: every component draws from the model', () => {
		expect([...PENDING]).toEqual([]);
	});

	it('names only files that exist', () => {
		expect([...PENDING].filter((path) => !all.includes(path))).toEqual([]);
	});
});
