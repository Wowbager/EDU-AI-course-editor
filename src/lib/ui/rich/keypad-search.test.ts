/**
 * The keypad search (§5.3): Czech names and aliases, matched without diacritics —
 * `uhel` finds ∢, `nad` finds „n nad k“, `rovnovaha` finds ⇌, `interval` finds all four
 * interval templates, `jednotka` finds the unit template.
 */
import { describe, expect, it } from 'vitest';
import { searchKeys } from './keypad-data';

const ids = (query: string) => searchKeys(query).map((h) => h.key.id);

describe('searchKeys', () => {
	it('finds by Czech name without diacritics', () => {
		expect(ids('uhel')).toContain('measuredangle');
		expect(ids('uhel')).toContain('degree');
	});
	it('"nad" finds the binomial coefficient', () => {
		expect(ids('nad')).toContain('binom');
	});
	it('"rovnovaha" finds the equilibrium arrow', () => {
		expect(ids('rovnovaha')).toContain('ce-equilibrium');
	});
	it('"interval" finds all four interval templates', () => {
		const found = ids('interval');
		expect(found).toContain('interval-closed');
		expect(found).toContain('interval-open');
		expect(found).toContain('interval-left-open');
		expect(found).toContain('interval-right-open');
	});
	it('"jednotka" finds the number+unit template and the unit keys', () => {
		expect(ids('jednotka')).toContain('number-unit');
		expect(ids('jednotka')).toContain('unit-of');
		expect(ids('jednotka')).toContain('u-m');
	});
	it('matches aliases, not only the name', () => {
		expect(ids('tan')).toContain('tg');
		expect(ids('zlomek')).toContain('frac');
		expect(ids('odmocnina')).toContain('sqrt');
	});
	it('every word of a multi-word query must match', () => {
		expect(ids('n nad k')).toContain('binom');
		expect(ids('n nad nic')).toEqual([]);
	});
	it('empty query finds nothing', () => {
		expect(searchKeys('')).toEqual([]);
		expect(searchKeys('   ')).toEqual([]);
	});
	it('results carry the rendered symbol, the name and the tab', () => {
		const hit = searchKeys('uhel').find((h) => h.key.id === 'measuredangle')!;
		expect(hit.key.label).toBe('∢');
		expect(hit.key.name).toBe('Úhel');
		expect(hit.tab.name).toBe('Geometrie a goniometrie');
	});
});
