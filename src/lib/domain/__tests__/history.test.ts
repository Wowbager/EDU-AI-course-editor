import { describe, expect, it } from 'vitest';
import { emptyHistory, record, redo, retract, undo, type History } from '../history';

describe('history', () => {
	it('undoes and redoes steps in order', () => {
		let h: History<string> = emptyHistory();
		let now = 'a';
		h = record(h, now);
		now = 'b';
		h = record(h, now);
		now = 'c';
		let back = undo(h, now)!;
		expect(back.value).toBe('b');
		back = undo(back.history, back.value)!;
		expect(back.value).toBe('a');
		expect(undo(back.history, back.value)).toBeUndefined();
		const again = redo(back.history, back.value)!;
		expect(again.value).toBe('b');
		expect(redo(again.history, again.value)!.value).toBe('c');
	});

	it('forgets what was undone once a new step is taken', () => {
		let h = record(emptyHistory<number>(), 1);
		h = undo(h, 2)!.history;
		expect(h.future).toEqual([2]);
		h = record(h, 1);
		expect(h.future).toEqual([]);
		expect(redo(h, 3)).toBeUndefined();
	});

	it('keeps at most the limit, dropping the oldest', () => {
		let h = emptyHistory<number>();
		for (let i = 0; i < 10; i++) h = record(h, i, 3);
		expect(h.past).toEqual([7, 8, 9]);
	});

	it('takes back the last step without leaving it to redo', () => {
		let h = record(emptyHistory<string | null>(), null);
		h = record(h, 'x');
		const back = retract(h)!;
		expect(back.value).toBe('x');
		expect(back.history).toEqual({ past: [null], future: [] });
		expect(retract(emptyHistory())).toBeUndefined();
	});
});
