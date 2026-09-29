import { describe, expect, it } from 'vitest';
import { placeMenu, type Rect } from './placement';

const viewport = { width: 1000, height: 800 };
const menu = { width: 200, height: 150 };
// A 100x30 button at (300, 100).
const anchor: Rect = { left: 300, top: 100, right: 400, bottom: 130 };

describe('placeMenu', () => {
	it('bottom-start hangs below the anchor, left edges aligned', () => {
		expect(placeMenu(anchor, menu, viewport, 'bottom-start')).toEqual({ top: 134, left: 300 });
	});

	it('bottom-end hangs below the anchor, right edges aligned', () => {
		expect(placeMenu(anchor, menu, viewport, 'bottom-end')).toEqual({ top: 134, left: 200 });
	});

	it('right-start sits beside the anchor, top edges aligned', () => {
		expect(placeMenu(anchor, menu, viewport, 'right-start')).toEqual({ top: 100, left: 404 });
	});

	it('honours the gap', () => {
		expect(placeMenu(anchor, menu, viewport, 'bottom-start', 10)).toEqual({ top: 140, left: 300 });
	});

	it('flips above the anchor when it does not fit below', () => {
		const low: Rect = { left: 300, top: 700, right: 400, bottom: 730 };
		expect(placeMenu(low, menu, viewport, 'bottom-start')).toEqual({ top: 546, left: 300 });
	});

	it('stays below when it fits with the margin to spare', () => {
		const edge: Rect = { left: 300, top: 600, right: 400, bottom: 630 };
		// 634 + 150 + 8 = 792 <= 800
		expect(placeMenu(edge, menu, viewport, 'bottom-start').top).toBe(634);
	});

	it('flips left of the anchor when right-start does not fit on the right', () => {
		const right: Rect = { left: 860, top: 100, right: 960, bottom: 130 };
		expect(placeMenu(right, menu, viewport, 'right-start')).toEqual({ top: 100, left: 656 });
	});

	it('clamps to the left edge', () => {
		const far: Rect = { left: 20, top: 100, right: 60, bottom: 130 };
		expect(placeMenu(far, menu, viewport, 'bottom-end').left).toBe(8);
	});

	it('clamps to the top edge when flipped above and still too tall', () => {
		const tall = { width: 200, height: 600 };
		const mid: Rect = { left: 300, top: 300, right: 400, bottom: 330 };
		expect(placeMenu(mid, tall, viewport, 'bottom-start').top).toBe(8);
	});

	it('clamps to the right edge', () => {
		const far: Rect = { left: 950, top: 100, right: 990, bottom: 130 };
		expect(placeMenu(far, menu, viewport, 'bottom-start').left).toBe(792);
	});

	it('clamps right-start to the bottom edge instead of overflowing it', () => {
		const low: Rect = { left: 300, top: 700, right: 400, bottom: 730 };
		// 800 - 150 - 8
		expect(placeMenu(low, menu, viewport, 'right-start').top).toBe(642);
	});

	it('starts on screen when the menu is larger than the viewport', () => {
		const huge = { width: 2000, height: 2000 };
		expect(placeMenu(anchor, huge, viewport, 'bottom-start')).toEqual({ top: 8, left: 8 });
	});
});
