import { afterEach, describe, expect, it, vi } from 'vitest';

/** A canvas that records its size and whose 2D context can be made to fail on drawing. */
function fakeCanvas(failDraw: boolean) {
	const context = {
		fillStyle: '',
		imageSmoothingQuality: 'low',
		fillRect() {},
		putImageData() {},
		drawImage() {
			if (failDraw) throw new Error('draw failed');
		}
	};
	return {
		width: 0,
		height: 0,
		context,
		getContext: () => context,
		toBlob: (done: (b: Blob | null) => void) => done(new Blob(['x']))
	};
}

describe('browserIO.fromPixels', () => {
	afterEach(() => vi.unstubAllGlobals());

	async function run(failDraw: boolean) {
		const made: ReturnType<typeof fakeCanvas>[] = [];
		vi.stubGlobal('document', {
			createElement: () => {
				const canvas = fakeCanvas(failDraw);
				made.push(canvas);
				return canvas;
			}
		});
		vi.stubGlobal(
			'ImageData',
			class {
				constructor(
					public data: Uint8ClampedArray,
					public width: number,
					public height: number
				) {}
			}
		);
		const { browserIO } = await import('../browser');
		const result = browserIO.fromPixels(new Uint8Array(5000 * 7000 * 4), 5000, 7000);
		return { result, made };
	}

	it('lets the full-size page go when drawing it fails', async () => {
		const { result, made } = await run(true);
		await expect(result).rejects.toThrow('draw failed');
		expect(made[0].width).toBe(0);
		expect(made[0].height).toBe(0);
	});

	it('shrinks a scan with high smoothing and lets the full-size page go', async () => {
		const { result, made } = await run(false);
		await result;
		expect(made[0].width).toBe(0);
		expect(made[1].width).toBe(1143);
		expect(made[1].context.imageSmoothingQuality).toBe('high');
	});
});
