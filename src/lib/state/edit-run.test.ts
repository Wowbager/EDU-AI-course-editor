import { describe, expect, it } from 'vitest';
import { EditRun, type RunStore } from './edit-run';

function fakeStore() {
	const calls: string[] = [];
	const store: { -readonly [K in keyof RunStore]: RunStore[K] } & {
		calls: string[];
		closeFromElsewhere(): void;
	} = {
		calls,
		session: undefined as object | undefined,
		beginEdit() {
			calls.push('begin');
			this.session = {};
		},
		endEdit() {
			calls.push('end');
			this.session = undefined;
		},
		closeFromElsewhere() {
			this.session = undefined;
		}
	};
	return store;
}

describe('a run of typing', () => {
	it('opens once for many changes and ends once', () => {
		const store = fakeStore();
		const run = new EditRun(store);
		run.begin('a');
		run.begin('ab');
		run.begin('abc');
		run.end();
		run.end();
		expect(store.calls).toEqual(['begin', 'end']);
	});

	it('Escape gives back the value the run started from, and ends it', () => {
		const store = fakeStore();
		const run = new EditRun(store);
		run.begin('před');
		const applied: (string | undefined)[] = [];
		expect(run.revert((value) => applied.push(value))).toBe(true);
		// Applied while the session was open, so the store can drop the entry.
		expect(applied).toEqual(['před']);
		expect(store.calls).toEqual(['begin', 'end']);
		expect(run.open).toBe(false);
		// Nothing left to take back: Escape is the page's.
		expect(run.revert(() => applied.push('again'))).toBe(false);
		expect(applied).toEqual(['před']);
	});

	it('opens a new run when the store closed the old one elsewhere', () => {
		// Undo, an import, the view switching or another field end the store's session
		// without telling the field. Its next change must open a new one, not be lost
		// as an entry of its own per keystroke (Copilot, PR #3).
		const store = fakeStore();
		const run = new EditRun(store);
		run.begin('a');
		store.closeFromElsewhere();
		expect(run.open).toBe(false);
		run.begin('ab');
		expect(store.calls).toEqual(['begin', 'begin']);
		expect(store.session).toBeDefined();
		// …and Escape now takes back only the new run.
		let back: string | undefined;
		run.revert((value) => (back = value));
		expect(back).toBe('ab');
	});

	it('does not close a session the store has already given to someone else', () => {
		const store = fakeStore();
		const run = new EditRun(store);
		run.begin('a');
		store.closeFromElsewhere();
		store.beginEdit(); // another field
		store.calls.length = 0;
		const theirs = store.session;
		run.end();
		expect(store.calls).toEqual([]);
		expect(store.session).toBe(theirs);
	});
});
