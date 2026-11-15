import { describe, expect, it } from 'vitest';
import {
	cardPlace,
	dropIndex,
	rowGap,
	shiftOf,
	type DragState,
	type FlatRow
} from './drag-reorder';

const middles = [10, 30, 50, 70];

/** Rows 20 px tall; the carried one's edges when its middle is at `m`. */
const at = (from: number, m: number) => dropIndex(middles, from, m - 10, m + 10);

describe('dropIndex', () => {
	it("stays put until the carried edge passes a neighbour's middle", () => {
		expect(at(1, 30)).toBe(1);
		expect(at(1, 21)).toBe(1);
		expect(at(1, 19)).toBe(0);
		expect(at(1, 39)).toBe(1);
		expect(at(1, 41)).toBe(2);
	});
	it('never lets the carried row cover a neighbour that has not moved', () => {
		// Carried from the bottom to exactly over the row above: that row has given way.
		expect(at(3, 50)).toBe(2);
		expect(at(0, 30)).toBe(1);
	});
	it('counts the rows above, never itself', () => {
		expect(at(0, 100)).toBe(3);
		expect(at(3, -5)).toBe(0);
		expect(at(2, 51)).toBe(2);
	});
});

describe('shiftOf', () => {
	const drag = (from: number, to: number): DragState => ({
		from,
		to,
		offset: 7,
		step: 20,
		moved: true
	});
	it('moves nothing before the press has become a drag', () => {
		expect(shiftOf({ ...drag(0, 2), moved: false }, 1)).toBe(0);
		expect(shiftOf(null, 0)).toBe(0);
	});
	it('makes room for a row carried down and up', () => {
		const down = [0, 1, 2, 3].map((i) => shiftOf(drag(0, 2), i));
		expect(down).toEqual([7, -20, -20, 0]);
		const up = [0, 1, 2, 3].map((i) => shiftOf(drag(3, 1), i));
		expect(up).toEqual([0, 20, 20, 7]);
	});
});

describe('rowGap', () => {
	it('is the smallest space between neighbours, never below zero', () => {
		expect(rowGap([])).toBe(0);
		expect(rowGap([{ top: 0, bottom: 20 }])).toBe(0);
		// A lesson head, two cards, the next head further down.
		const rows = [
			{ top: 0, bottom: 30 },
			{ top: 32, bottom: 52 },
			{ top: 54, bottom: 74 },
			{ top: 84, bottom: 114 }
		];
		expect(rowGap(rows)).toBe(2);
		expect(
			rowGap([
				{ top: 0, bottom: 20 },
				{ top: 18, bottom: 38 }
			])
		).toBe(0);
	});
});

describe('cardPlace', () => {
	// Lesson 0 open with two cards, lesson 1 folded, lesson 2 open and empty, lesson 3 open with one card.
	const rows: FlatRow[] = [
		{ lesson: 0 },
		{ lesson: 0, card: 0 },
		{ lesson: 0, card: 1 },
		{ lesson: 1, folded: true },
		{ lesson: 2 },
		{ lesson: 3 },
		{ lesson: 3, card: 0 }
	];
	it('stays where it was when it has not moved', () => {
		expect(cardPlace(rows, 1, 1)).toEqual({ lesson: 0, index: 0 });
		expect(cardPlace(rows, 2, 2)).toEqual({ lesson: 0, index: 1 });
	});
	it('moves within its lesson', () => {
		expect(cardPlace(rows, 1, 2)).toEqual({ lesson: 0, index: 1 });
		expect(cardPlace(rows, 2, 1)).toEqual({ lesson: 0, index: 0 });
	});
	it("goes to the start of an open lesson right after its head, and to a folded lesson's end", () => {
		expect(cardPlace(rows, 1, 3)).toEqual({ lesson: 1, index: 'end' });
		expect(cardPlace(rows, 1, 4)).toEqual({ lesson: 2, index: 0 });
		expect(cardPlace(rows, 1, 5)).toEqual({ lesson: 3, index: 0 });
		expect(cardPlace(rows, 1, 6)).toEqual({ lesson: 3, index: 1 });
	});
	it('goes up into a lesson after its last card', () => {
		expect(cardPlace(rows, 6, 3)).toEqual({ lesson: 0, index: 2 });
		expect(cardPlace(rows, 6, 1)).toEqual({ lesson: 0, index: 0 });
	});
	it('reads a list of cards without heads as one lesson', () => {
		const flat: FlatRow[] = [0, 1, 2].map((card) => ({ lesson: 0, card }));
		expect(cardPlace(flat, 2, 0)).toEqual({ lesson: 0, index: 0 });
		expect(cardPlace(flat, 0, 2)).toEqual({ lesson: 0, index: 2 });
	});
});
