import { describe, expect, it } from 'vitest';
import { keyMaker, type Draft } from '$lib/domain/outline';
import {
	keptDraft,
	parseOutline,
	readOutline,
	serialiseOutline,
	writeOutline
} from './outline-store';

const draft: Draft = {
	scope: 'lessons',
	original: 'Kurz o zlomcích',
	lessons: [
		{
			key: 'a',
			name: 'Polovina',
			cards: [
				{ key: 'b', kind: 'display', name: 'Co je půlka', on: true, sources: ['0123abcd.1'] },
				{ key: 'c', kind: 'exercise', name: 'Příklady', on: false },
				{ key: 'd', kind: 'question', name: '', on: true }
			]
		},
		{ key: 'e', name: 'Moje lekce', cards: [], on: false },
		{ key: 'f', name: '', cards: [] }
	]
};

describe('the outline kept in the browser', () => {
	it('comes back with its rows, ticks, sources and prompt, under new keys, unnamed rows too', () => {
		const back = parseOutline(serialiseOutline(draft), keyMaker())!;
		expect(back.original).toBe('Kurz o zlomcích');
		expect(back.lessons.map((l) => l.name)).toEqual(['Polovina', 'Moje lekce', '']);
		expect(back.lessons[0].cards.map(({ name, on, sources }) => ({ name, on, sources }))).toEqual([
			{ name: 'Co je půlka', on: true, sources: ['0123abcd.1'] },
			{ name: 'Příklady', on: false, sources: undefined },
			{ name: '', on: true, sources: undefined }
		]);
		expect(back.lessons[1].on).toBe(false);
		expect(back.lessons[0].key).toBe('d1');
	});

	it('is nothing for nothing, for one that does not parse, and for one with no row', () => {
		expect(parseOutline(null, keyMaker())).toBeNull();
		expect(parseOutline('{', keyMaker())).toBeNull();
		expect(parseOutline('{"format":2}', keyMaker())).toBeNull();
		const empty: Draft = { scope: 'cards', lessons: [{ key: 'a', name: '', cards: [] }] };
		expect(keptDraft(empty)).toBeNull();
	});

	it('is written per course, removed when there is none, and survives a storage that throws', () => {
		const items = new Map<string, string>();
		const storage = {
			getItem: (k: string) => items.get(k) ?? null,
			setItem: (k: string, v: string) => void items.set(k, v),
			removeItem: (k: string) => void items.delete(k)
		};
		writeOutline(storage, 'A', draft);
		writeOutline(storage, 'B', draft);
		expect([...items.keys()]).toEqual(['edu-editor:outline:v1:A', 'edu-editor:outline:v1:B']);
		writeOutline(storage, 'A', null);
		expect(readOutline(storage, 'A', keyMaker())).toBeNull();
		expect(readOutline(storage, 'B', keyMaker())?.lessons).toHaveLength(3);
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(readOutline(broken, 'A', keyMaker())).toBeNull();
		expect(() => writeOutline(broken, 'A', draft)).not.toThrow();
		expect(readOutline(undefined, 'A', keyMaker())).toBeNull();
	});
});
