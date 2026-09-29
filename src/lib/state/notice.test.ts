import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_MS, Notices } from './notice.svelte';

describe('the shared notice', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('holds one notice at a time, the newest', () => {
		const notices = new Notices();
		notices.show({ text: 'první' });
		notices.show({ text: 'druhá' });
		expect(notices.current?.text).toBe('druhá');
	});

	it('goes by itself after six seconds', () => {
		const notices = new Notices();
		notices.show({ text: 'Karta smazána' });
		vi.advanceTimersByTime(NOTICE_MS - 1);
		expect(notices.current).not.toBeNull();
		vi.advanceTimersByTime(1);
		expect(notices.current).toBeNull();
	});

	it('stays while it is paused and gets its full time again after', () => {
		const notices = new Notices();
		notices.show({ text: 'Karta smazána' });
		vi.advanceTimersByTime(NOTICE_MS - 100);
		notices.pause();
		vi.advanceTimersByTime(NOTICE_MS * 3);
		expect(notices.current).not.toBeNull();
		notices.resume();
		vi.advanceTimersByTime(NOTICE_MS - 1);
		expect(notices.current).not.toBeNull();
		vi.advanceTimersByTime(1);
		expect(notices.current).toBeNull();
	});

	it('a newer notice restarts the clock, and the older one cannot take it away early', () => {
		const notices = new Notices();
		notices.show({ text: 'první' });
		vi.advanceTimersByTime(NOTICE_MS - 10);
		notices.show({ text: 'druhá' });
		vi.advanceTimersByTime(20);
		expect(notices.current?.text).toBe('druhá');
	});

	it('can be dismissed', () => {
		const notices = new Notices();
		notices.show({ text: 'x' });
		notices.dismiss();
		expect(notices.current).toBeNull();
	});
});
