/**
 * Render CI for the keypad (§6): every key definition's LaTeX — and every acceptance
 * formula — is rendered through the production renderer (KaTeX, with the mhchem contrib
 * for `\ce`), and parsed by MathLive's own parser (the field's renderer, via its SSR
 * build). A key the renderers cannot draw fails here, not in a teacher's course.
 *
 * flutter_math_fork in the student app is a KaTeX port; the commands it lacks are mapped
 * in `domain/app-latex.ts` and listed in `docs/OPEN-PROBLEMS.md` (app-side).
 */
import { describe, expect, it } from 'vitest';
import katex from 'katex';
import 'katex/contrib/mhchem';
import { validateLatex } from 'mathlive/ssr';
import { ALL_KEYS, FIXED_KEYS, PROFILES, TABS, TAB_BY_ID } from './keypad-data';
import { ACCEPTANCE } from './acceptance-rows';

/** Placeholders of a key's insert become sample content, so the template renders. */
function sample(insert: string): string {
	let n = 0;
	return (
		insert
			.replace(/#0/g, 'x')
			.replace(/#@|#\?/g, () => (n++ === 0 ? 'a' : 'b'))
			// A lone trailing `^` (the chem gas arrow) becomes an empty superscript.
			.replace(/\^$/, '^{}')
	);
}

function renders(latex: string): void {
	katex.renderToString(latex, { displayMode: false, throwOnError: true, strict: false });
}

function parses(latex: string): void {
	const errors = validateLatex(latex) ?? [];
	expect(errors, `MathLive cannot parse: ${latex}`).toEqual([]);
}

describe('every key definition renders in the editor (KaTeX + mhchem)', () => {
	for (const key of ALL_KEYS) {
		it(`${key.id} — ${key.name}`, () => {
			expect(() => renders(sample(key.insert))).not.toThrow();
			parses(sample(key.insert));
		});
	}
});

describe('acceptance formulas (§8) render and parse', () => {
	for (const row of ACCEPTANCE) {
		it(`#${row.n} ${row.formula}`, () => {
			expect(() => renders(row.expected)).not.toThrow();
			parses(row.expected);
		});
	}
});

describe('v1 compatibility: what the old keyboard stored still renders', () => {
	it('÷ and ≈ keep drawing, the keyboard just no longer offers them', () => {
		expect(() => renders('a \\div b')).not.toThrow();
		expect(() => renders('a \\approx b')).not.toThrow();
		expect(() => renders('a \\colon b')).not.toThrow();
	});
});

describe('keypad data invariants (§4.1)', () => {
	it('ids are unique across all tabs', () => {
		const ids = ALL_KEYS.map((k) => k.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
	it('every key has a Czech name and at least one alias word', () => {
		for (const key of ALL_KEYS) {
			expect(key.name.trim().length, key.id).toBeGreaterThan(0);
			expect(key.aliases.length, key.id).toBeGreaterThan(0);
		}
	});
	it('fixed keys are the arrows-as-icons, backspace and enter — never `<` `>`', () => {
		expect(FIXED_KEYS.map((k) => k.id)).toEqual([
			'key-left',
			'key-right',
			'key-backspace',
			'key-enter'
		]);
		expect(FIXED_KEYS.find((k) => k.id === 'key-left')?.command).toBe('moveToPreviousChar');
	});
	it("profiles list existing tabs, in the brief's order", () => {
		const order = TABS.map((t) => t.id);
		for (const p of PROFILES) {
			for (const id of p.tabs) expect(order).toContain(id);
			expect(new Set(p.tabs).size, p.id).toBe(p.tabs.length);
		}
		expect(PROFILES.find((p) => p.id === 'zs')?.tabs).toEqual([
			'zaklad',
			'algebra',
			'geometrie',
			'recka'
		]);
		expect(PROFILES.find((p) => p.id === 'vse')?.tabs.length).toBe(TABS.length);
	});
	it('every tab has symbols, and a size the 4-row paging can carry', () => {
		for (const tab of TABS) {
			// The grid is 4 rows deep and pages horizontally past 10 columns (§4.1),
			// so a tab may hold more keys than one screen.
			expect(tab.keys.length, tab.id).toBeLessThanOrEqual(60);
			expect(
				tab.keys.some((k) => k.zone === 'symbol'),
				tab.id
			).toBe(true);
		}
	});
	it('tabs referenced by id exist', () => {
		for (const id of [
			'zaklad',
			'algebra',
			'geometrie',
			'mnoziny',
			'pokrocile',
			'recka',
			'fyzika',
			'chemie'
		])
			expect(TAB_BY_ID.has(id)).toBe(true);
	});
});
