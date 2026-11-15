import { describe, expect, it } from 'vitest';
import { dropIndex, shiftOf, type DragState } from './drag-reorder';

const middles = [10, 30, 50, 70];

describe('dropIndex', () => {
	it('stays put until the carried middle passes a neighbour', () => {
		expect(dropIndex(middles, 1, 30)).toBe(1);
		expect(dropIndex(middles, 1, 11)).toBe(1);
		expect(dropIndex(middles, 1, 9)).toBe(0);
	});
	it('counts the rows above, never itself', () => {
		expect(dropIndex(middles, 0, 100)).toBe(3);
		expect(dropIndex(middles, 3, -5)).toBe(0);
		expect(dropIndex(middles, 2, 31)).toBe(2);
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
