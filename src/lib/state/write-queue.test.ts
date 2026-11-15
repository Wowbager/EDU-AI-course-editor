import { describe, expect, it } from 'vitest';
import { WriteQueue, type RunResult } from './write-queue.svelte';

const cards = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ blockId: `B${i}`, lessonId: 'L1' }));

/** A runner whose calls are finished by hand, so concurrency can be seen. */
function manual() {
	const started: string[] = [];
	const pending = new Map<string, (r: RunResult) => void>();
	const run = (row: { blockId: string }) =>
		new Promise<RunResult>((resolve) => {
			started.push(row.blockId);
			pending.set(row.blockId, resolve);
		});
	const finish = async (id: string, result: RunResult = 'done') => {
		pending.get(id)!(result);
		pending.delete(id);
		await new Promise((r) => setTimeout(r, 0));
	};
	return { run, started, finish, pending };
}

const states = (q: WriteQueue) => q.rows.map((r) => r.state);

describe('the write queue', () => {
	it('starts three at a time, in course order, and the next one as one finishes', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(5));
		expect(m.started).toEqual(['B0', 'B1', 'B2']);
		expect(states(q)).toEqual(['writing', 'writing', 'writing', 'waiting', 'waiting']);
		await m.finish('B1');
		expect(m.started).toEqual(['B0', 'B1', 'B2', 'B3']);
		await m.finish('B0');
		await m.finish('B2');
		await m.finish('B3');
		await m.finish('B4');
		expect(states(q)).toEqual(Array(5).fill('done'));
		expect(q.running).toBe(false);
		expect(q.writing).toBe(false);
		expect(m.started.length).toBe(5);
	});

	it('never has more than the limit in flight', async () => {
		let now = 0;
		let peak = 0;
		const q = new WriteQueue(
			async () => {
				peak = Math.max(peak, ++now);
				await new Promise((r) => setTimeout(r, 1));
				now--;
				return 'done';
			},
			{ concurrency: 3 }
		);
		q.start(cards(10));
		while (q.writing) await new Promise((r) => setTimeout(r, 2));
		expect(peak).toBe(3);
		expect(states(q)).toEqual(Array(10).fill('done'));
	});

	it('stop starts nothing new, lets the running ones finish, and resume writes the rest', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(6));
		q.stop();
		await m.finish('B0');
		await m.finish('B1');
		await m.finish('B2');
		expect(m.started).toEqual(['B0', 'B1', 'B2']);
		expect(states(q)).toEqual(['done', 'done', 'done', 'waiting', 'waiting', 'waiting']);
		expect(q.running).toBe(false);
		expect(q.rest.map((r) => r.blockId)).toEqual(['B3', 'B4', 'B5']);

		q.resume();
		expect(m.started).toEqual(['B0', 'B1', 'B2', 'B3', 'B4', 'B5']);
		for (const id of ['B3', 'B4', 'B5']) await m.finish(id);
		expect(states(q)).toEqual(Array(6).fill('done'));
	});

	it('resume with cards still being written does not start more than the limit', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(6));
		q.stop();
		q.resume();
		expect(m.started).toEqual(['B0', 'B1', 'B2']);
		await m.finish('B0');
		expect(m.started).toHaveLength(4);
	});

	it('marks a failed card and goes on; resume tries it again', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(2));
		await m.finish('B0', { problem: 'other' });
		await m.finish('B1');
		expect(states(q)).toEqual(['failed', 'done']);
		expect(q.running).toBe(false);
		expect(q.rest.map((r) => r.blockId)).toEqual(['B0']);
		q.resume();
		expect(states(q)).toEqual(['writing', 'done']);
		await m.finish('B0');
		expect(states(q)).toEqual(['done', 'done']);
	});

	it('waits as long as the server said after a rate limit, then tries that card once more', async () => {
		const waits: number[] = [];
		const calls: string[] = [];
		let first = true;
		const q = new WriteQueue(
			async (row) => {
				calls.push(row.blockId);
				if (row.blockId === 'B0' && first) {
					first = false;
					return { problem: 'rate', retryAfter: 7 };
				}
				return 'done';
			},
			{ wait: async (s) => void waits.push(s) }
		);
		q.start(cards(2));
		while (q.writing) await new Promise((r) => setTimeout(r, 1));
		expect(waits).toEqual([7]);
		expect(calls.filter((c) => c === 'B0')).toHaveLength(2);
		expect(states(q)).toEqual(['done', 'done']);
	});

	it('a card refused twice is failed, and the wait is capped', async () => {
		const waits: number[] = [];
		const q = new WriteQueue(async () => ({ problem: 'rate', retryAfter: 600 }), {
			wait: async (s) => void waits.push(s)
		});
		q.start(cards(1));
		while (q.writing) await new Promise((r) => setTimeout(r, 1));
		expect(states(q)).toEqual(['failed']);
		expect(waits).toEqual([70]);
	});

	it('a spent day stops the queue and says why', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(5));
		await m.finish('B0', { problem: 'budget' });
		expect(q.stoppedBy).toBe('budget');
		expect(q.running).toBe(false);
		await m.finish('B1');
		await m.finish('B2');
		expect(m.started).toHaveLength(3);
		expect(states(q)).toEqual(['failed', 'done', 'done', 'waiting', 'waiting']);
	});

	it('a stop during a rate wait leaves the card waiting, not retried', async () => {
		let release!: () => void;
		const q = new WriteQueue(async () => ({ problem: 'rate' }), {
			wait: () => new Promise<void>((r) => (release = r))
		});
		q.start(cards(1));
		await new Promise((r) => setTimeout(r, 0));
		q.stop();
		release();
		await new Promise((r) => setTimeout(r, 0));
		expect(states(q)).toEqual(['waiting']);
	});

	it('clear forgets the rows; a card that finishes afterwards changes nothing', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(2));
		q.clear();
		await m.finish('B0');
		expect(q.rows).toEqual([]);
	});

	it('a new batch keeps the unfinished rows of the old one and does not lose their results', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(2));
		await m.finish('B0', { problem: 'other' });
		// B1 is still being written when the next batch comes.
		q.start([
			{ blockId: 'N0', lessonId: 'L2' },
			{ blockId: 'N1', lessonId: 'L2' }
		]);
		expect(q.rows.map((r) => r.blockId)).toEqual(['B0', 'B1', 'N0', 'N1']);
		expect(states(q)).toEqual(['failed', 'writing', 'writing', 'writing']);
		// One in flight from the old batch, so only two slots were free.
		expect(m.started).toEqual(['B0', 'B1', 'N0', 'N1']);
		await m.finish('B1');
		await m.finish('N0');
		await m.finish('N1');
		expect(states(q)).toEqual(['failed', 'done', 'done', 'done']);
		expect(q.rest.map((r) => r.blockId)).toEqual(['B0']);
	});

	it('a new batch drops the finished rows', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(1));
		await m.finish('B0');
		q.start([{ blockId: 'N0', lessonId: 'L1' }]);
		expect(q.rows.map((r) => r.blockId)).toEqual(['N0']);
	});

	it('a second rate limit after the wait pauses the queue with the rest waiting', async () => {
		const calls: string[] = [];
		const q = new WriteQueue(
			async (row) => {
				calls.push(row.blockId);
				return { problem: 'rate' };
			},
			{ wait: async () => {}, concurrency: 1 }
		);
		q.start(cards(3));
		while (q.writing) await new Promise((r) => setTimeout(r, 1));
		expect(states(q)).toEqual(['failed', 'waiting', 'waiting']);
		expect(q.stoppedBy).toBe('rate');
		expect(calls).toEqual(['B0', 'B0']);
		q.resume();
		expect(q.stoppedBy).toBeNull();
	});
});
