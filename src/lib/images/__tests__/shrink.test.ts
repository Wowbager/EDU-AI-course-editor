import { describe, expect, it } from 'vitest';
import { fitWithin, redrawType, shrinkPlan } from '../shrink';
import { imageProblem, MAX_IMAGE_BYTES, MAX_PICKED_BYTES } from '../limits';

describe('shrinkPlan', () => {
	it('keeps a small picture as it is and redraws a big one or a BMP', () => {
		expect(shrinkPlan({ type: 'image/png', size: 200_000 })).toBe('as-is');
		expect(shrinkPlan({ type: 'image/jpeg', size: MAX_IMAGE_BYTES })).toBe('as-is');
		expect(shrinkPlan({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 })).toBe('redraw');
		expect(shrinkPlan({ type: 'image/bmp', size: 10_000 })).toBe('redraw');
	});

	it('never redraws a GIF, which would lose its animation; a big one is refused before', () => {
		expect(shrinkPlan({ type: 'image/gif', size: 5 * MAX_IMAGE_BYTES })).toBe('as-is');
		expect(imageProblem({ type: 'image/gif', size: MAX_IMAGE_BYTES + 1 })).toBe('big-gif');
		expect(imageProblem({ type: 'image/gif', size: MAX_IMAGE_BYTES })).toBeNull();
	});

	it('lets a teacher pick a big photo, which is then made small', () => {
		expect(imageProblem({ type: 'image/jpeg', size: 12 * 1024 * 1024 })).toBeNull();
		expect(imageProblem({ type: 'image/jpeg', size: MAX_PICKED_BYTES + 1 })).toBe('too-big');
	});
});

describe('redrawType', () => {
	it('keeps a photo a JPEG and whatever may be transparent a WebP', () => {
		expect(redrawType('image/jpeg')).toBe('image/jpeg');
		expect(redrawType('image/png')).toBe('image/webp');
		expect(redrawType('image/bmp')).toBe('image/webp');
	});
});

describe('fitWithin', () => {
	it('scales the longest side down and never up', () => {
		expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
		expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
		expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
	});
});
