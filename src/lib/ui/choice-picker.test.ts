import { describe, expect, it } from 'vitest';
import {
	filterGroups,
	firstToFocus,
	followPath,
	needsSearch,
	pickable,
	type PickerGroup,
	type PickerStep
} from './choice-picker';

const groups: PickerGroup[] = [
	{
		heading: 'Lekce 1',
		items: [
			{ id: 'a', name: 'Úvod do zlomků', detail: 'Lekce 1, karta 1' },
			{ id: 'b', name: 'Kolik je?', disabledReason: 'na tuhle kartu čeká' }
		]
	},
	{ heading: 'Čísla', items: [{ id: 'c', name: 'Desetinná čísla', hint: 'N2.1', current: true }] }
];

describe('the search', () => {
	it('keeps everything for an empty query', () => {
		expect(filterGroups(groups, '  ')).toEqual(groups);
	});

	it('ignores case and diacritics', () => {
		expect(filterGroups(groups, 'UVOD').flatMap((g) => g.items.map((i) => i.id))).toEqual(['a']);
		expect(filterGroups(groups, 'zlomku')[0].items[0].id).toBe('a');
	});

	it('needs every word, in any order', () => {
		expect(filterGroups(groups, 'zlomku uvod')).toHaveLength(1);
		expect(filterGroups(groups, 'zlomku kolik')).toHaveLength(0);
	});

	it('also searches the second line and the code', () => {
		expect(filterGroups(groups, 'karta 1')[0].items[0].id).toBe('a');
		expect(filterGroups(groups, 'n2.1')[0].items[0].id).toBe('c');
	});

	it('keeps a whole group when its heading matches, and drops empty groups', () => {
		expect(filterGroups(groups, 'lekce 1')[0].items).toHaveLength(2);
		expect(filterGroups(groups, 'kolik').map((g) => g.heading)).toEqual(['Lekce 1']);
	});
});

describe('when there is a search field', () => {
	const many = (n: number): PickerGroup[] => [
		{ items: Array.from({ length: n }, (_, i) => ({ id: String(i), name: `Karta ${i}` })) }
	];
	it('only for more than eight items', () => {
		expect(needsSearch(many(8))).toBe(false);
		expect(needsSearch(many(9))).toBe(true);
	});
	it('counts across groups', () => {
		expect(needsSearch([...many(5), ...many(4)])).toBe(true);
	});
});

describe('what Enter and the focus take', () => {
	it('skips a disabled item', () => {
		expect(pickable(groups).map((i) => i.id)).toEqual(['a', 'c']);
	});
	it('focuses the current item, else the first', () => {
		expect(firstToFocus(groups)?.id).toBe('c');
		expect(firstToFocus([{ items: [{ id: 'x', name: 'X' }] }])?.id).toBe('x');
		expect(firstToFocus([])).toBeUndefined();
	});
});

describe('walking a path', () => {
	const levels: PickerStep = {
		title: 'Úroveň',
		groups: [{ items: [{ id: 'l1', name: 'Úroveň 1' }] }]
	};
	const skills: PickerStep = {
		title: 'Dovednost',
		groups: [{ heading: 'Čísla', items: [{ id: 'z', name: 'Zlomky', next: levels }] }]
	};
	const root: PickerStep = {
		title: 'Na co karta čeká?',
		groups: [{ items: [{ id: 'skill', name: 'Dovednost', next: skills }] }]
	};

	it('starts at the root', () => {
		expect(followPath(root, []).map((s) => s.title)).toEqual(['Na co karta čeká?']);
	});
	it('descends through the items named', () => {
		expect(followPath(root, ['skill', 'z']).map((s) => s.title)).toEqual([
			'Na co karta čeká?',
			'Dovednost',
			'Úroveň'
		]);
	});
	it('stops at a final item or one that is gone', () => {
		expect(followPath(root, ['skill', 'z', 'l1'])).toHaveLength(3);
		expect(followPath(root, ['skill', 'gone', 'x'])).toHaveLength(2);
	});
});
