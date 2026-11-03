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
import { ALL_KEYS, FIXED_KEYS, PROFILES, TABS, TAB_BY_ID, keyFace } from './keypad-data';
import { ACCEPTANCE } from './acceptance-rows';
import { replaceSlots, toAppLatex } from '$lib/domain/app-latex';

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
	it('every key of a tab is in exactly one of its groups, and no group is empty', () => {
		for (const tab of TABS) {
			const grouped = tab.groups.flatMap((g) => g.keys);
			expect([...grouped].sort(), tab.id).toEqual(tab.keys.map((k) => k.id).sort());
			for (const g of tab.groups) {
				expect(g.name.trim(), tab.id).not.toBe('');
				expect(g.keys.length, `${tab.id}: ${g.name}`).toBeGreaterThan(0);
			}
		}
	});
	it('a template takes what was typed before it into one box at most', () => {
		// MathLive fills every `#@` with what precedes the caret: `2x` then a 2×2 matrix
		// was a matrix of four `2x`.
		for (const key of ALL_KEYS)
			expect((key.insert.match(/#@/g) ?? []).length, key.id).toBeLessThan(2);
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

describe('a template left empty draws its boxes in the text', () => {
	for (const key of ALL_KEYS.filter((k) => /#@|#\?/.test(k.insert) && !k.insert.includes('\\ce'))) {
		it(`${key.id} — ${key.name}`, () => {
			// Stored as the field writes it, then drawn the way `renderMath` draws it.
			const stored = toAppLatex(key.insert.replace(/#@|#\?/g, '\\placeholder{}'));
			const html = katex.renderToString(replaceSlots(stored, '\\htmlClass{math-slot}{\\square}'), {
				throwOnError: true,
				trust: ({ command }) => command === '\\htmlClass'
			});
			expect(html).toContain('math-slot');
		});
	}
});

describe('every template key draws its own shape, with a box for each slot', () => {
	for (const key of ALL_KEYS.filter((k) => keyFace(k) !== null)) {
		it(`${key.id} — ${key.name}`, () => {
			const html = katex.renderToString(keyFace(key)!, {
				throwOnError: true,
				trust: ({ command }) => command === '\\htmlClass'
			});
			if (/#[@?0]/.test(key.insert)) expect(html).toContain('key-slot');
		});
	}
	it('draws the limit under lim, as the app does', () => {
		const html = katex.renderToString(keyFace(ALL_KEYS.find((k) => k.id === 'limit')!)!, {
			trust: ({ command }) => command === '\\htmlClass'
		});
		expect(html).toContain('op-limits');
	});
	it('draws the vector as an arrow over a box, never a font’s combining mark', () => {
		const vec = ALL_KEYS.find((k) => k.id === 'vec')!;
		expect(keyFace(vec)).toBe('\\vec{\\htmlClass{key-slot}{\\square}}');
	});
});
