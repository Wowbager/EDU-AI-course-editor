import { describe, expect, it } from 'vitest';
import { dropIndex, shiftOf, type DragState } from './drag-reorder';

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
