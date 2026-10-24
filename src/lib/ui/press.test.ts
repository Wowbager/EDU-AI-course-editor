import { describe, expect, it, vi } from 'vitest';
import { createPressTracker } from './press';

const fire = (target: EventTarget, type: string, fields: Record<string, unknown> = {}) =>
	target.dispatchEvent(Object.assign(new Event(type), fields));

describe('a press on the page', () => {
	it('runs what waits on it once it is released, not before', async () => {
		vi.useFakeTimers();
		const page = new EventTarget();
		const press = createPressTracker(page);
		const run = vi.fn();
		fire(page, 'pointerdown');
		press.afterPress(run);
		await vi.runAllTimersAsync();
		expect(run).not.toHaveBeenCalled();
		fire(page, 'pointerup');
		await vi.runAllTimersAsync();
		expect(run).toHaveBeenCalledOnce();
		expect(press.down).toBe(false);
		vi.useRealTimers();
	});

	it('ends when the release never reaches the page (it landed in the preview frame)', () => {
		const ends: [string, Record<string, unknown>][] = [
			['pointermove', { buttons: 0 }],
			['keydown', { key: 'Tab' }],
			['blur', {}]
		];
		for (const [type, fields] of ends) {
			const page = new EventTarget();
			const press = createPressTracker(page);
			fire(page, 'pointerdown');
			fire(page, type, fields);
			expect(press.down, type).toBe(false);
		}
	});

	it('goes on while a button is held or only a modifier is pressed', () => {
		const page = new EventTarget();
		const press = createPressTracker(page);
		fire(page, 'pointerdown');
		fire(page, 'pointermove', { buttons: 1 });
		fire(page, 'keydown', { key: 'Shift' });
		expect(press.down).toBe(true);
	});
});
