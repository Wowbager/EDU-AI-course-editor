import { describe, expect, it } from 'vitest';
import { WriteQueue, type RunContext, type RunResult, type Row } from './write-queue.svelte';

/** `n` cards, each a lesson of its own (B0 in L0, B1 in L1, ...). */
const cards = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ blockId: `B${i}`, lessonId: `L${i}` }));

/** `n` cards of one lesson, named `${lesson}-0`, `${lesson}-1`, ... */
const lesson = (lessonId: string, n: number) =>
	Array.from({ length: n }, (_, i) => ({ blockId: `${lessonId}-${i}`, lessonId }));

/**
 * A runner whose calls are finished by hand, so concurrency can be seen. A call is
 * named by its first card. Finishing with 'done' reports every card of the call as done
 * first, as a runner that wrote them all would.
 */
function manual() {
	const started: string[][] = [];
	const contexts = new Map<string, RunContext>();
	const batches = new Map<string, Row[]>();
	const pending = new Map<string, (r: RunResult) => void>();
	const run = (rows: Row[], context: RunContext) =>
		new Promise<RunResult>((resolve) => {
			const id = rows[0].blockId;
			started.push(rows.map((r) => r.blockId));
			contexts.set(id, context);
			batches.set(id, rows);
			pending.set(id, resolve);
		});
	const finish = async (id: string, result: RunResult = 'done', reportAll = true) => {
		if (result === 'done' && reportAll)
			for (const row of batches.get(id)!) contexts.get(id)!.report(row, 'done');
		pending.get(id)!(result);
		pending.delete(id);
		await new Promise((r) => setTimeout(r, 0));
	};
	const firsts = () => started.map((b) => b[0]);
	return { run, started, firsts, finish, pending, contexts, batches };
}

const states = (q: WriteQueue) => q.rows.map((r) => r.state);
const settle = async (q: WriteQueue) => {
	while (q.writing) await new Promise((r) => setTimeout(r, 1));
};

describe('the write queue', () => {
	it('starts four lessons at a time by default, in course order, and the next one as one finishes', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(6));
		expect(m.firsts()).toEqual(['B0', 'B1', 'B2', 'B3']);
		// Rows stay waiting until the runner says it is writing them.
		expect(states(q)).toEqual(Array(6).fill('waiting'));
		await m.finish('B1');
		expect(m.firsts()).toEqual(['B0', 'B1', 'B2', 'B3', 'B4']);
		for (const id of ['B0', 'B2', 'B3', 'B4', 'B5']) await m.finish(id);
		expect(states(q)).toEqual(Array(6).fill('done'));
		expect(q.running).toBe(false);
		expect(q.writing).toBe(false);
	});

	it('gives a lesson’s waiting cards to the runner in one call, in course order', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start([...lesson('L1', 3), ...lesson('L2', 2)]);
		expect(m.started).toEqual([
			['L1-0', 'L1-1', 'L1-2'],
			['L2-0', 'L2-1']
		]);
		await m.finish('L1-0');
		await m.finish('L2-0');
		expect(states(q)).toEqual(Array(5).fill('done'));
	});

	it('writes two lessons in parallel, and a third only when a slot is free', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 2 });
		q.start([...lesson('L1', 2), ...lesson('L2', 2), ...lesson('L3', 1)]);
		expect(m.firsts()).toEqual(['L1-0', 'L2-0']);
		await m.finish('L2-0');
		expect(m.firsts()).toEqual(['L1-0', 'L2-0', 'L3-0']);
		await m.finish('L1-0');
		await m.finish('L3-0');
		expect(q.running).toBe(false);
	});

	it('takes the cards of a lesson together even when other lessons lie between them', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 1 });
		q.start([
			{ blockId: 'A0', lessonId: 'A' },
			{ blockId: 'B0', lessonId: 'B' },
			{ blockId: 'A1', lessonId: 'A' }
		]);
		expect(m.started).toEqual([['A0', 'A1']]);
	});

	it('a card is reported writing, then done', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(lesson('L1', 2));
		const context = m.contexts.get('L1-0')!;
		const [a, b] = m.batches.get('L1-0')!;
		expect(states(q)).toEqual(['waiting', 'waiting']);
		context.report(a, 'writing');
		expect(states(q)).toEqual(['writing', 'waiting']);
		expect([...q.pending]).toEqual(['L1-0', 'L1-1']);
		context.report(a, 'done');
		context.report(b, 'writing');
		expect(states(q)).toEqual(['done', 'writing']);
		expect([...q.pending]).toEqual(['L1-1']);
		await m.finish('L1-0');
		expect(states(q)).toEqual(['done', 'done']);
	});

	it('knows which cards are waiting for AI: the waiting and the writing ones, until they are written or failed', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 1 });
		q.start(cards(3));
		expect([...q.pending]).toEqual(['B0', 'B1', 'B2']);
		await m.finish('B0');
		expect([...q.pending]).toEqual(['B1', 'B2']);
		await m.finish('B1', { problem: 'other' });
		expect([...q.pending]).toEqual(['B2']);
		await m.finish('B2');
		expect(q.pending.size).toBe(0);
	});

	it('a card that is opened brings its lesson’s waiting cards ahead of the rest, in their order', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 1 });
		q.start([...lesson('A', 2), ...lesson('B', 2), ...lesson('C', 2)]);
		expect(m.firsts()).toEqual(['A-0']);
		q.prioritise('C-1');
		expect(q.rows.map((r) => r.blockId)).toEqual(['A-0', 'A-1', 'C-0', 'C-1', 'B-0', 'B-1']);
		// Not for a lesson being written, nor an unknown card.
		q.prioritise('A-1');
		q.prioritise('nope');
		expect(q.rows.map((r) => r.blockId)).toEqual(['A-0', 'A-1', 'C-0', 'C-1', 'B-0', 'B-1']);
		await m.finish('A-0');
		expect(m.started[1]).toEqual(['C-0', 'C-1']);
		await m.finish('C-0');
		await m.finish('B-0');
		expect(states(q)).toEqual(Array(6).fill('done'));
	});

	it('prioritising skips a held card and leaves the order of the others alone', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 1 });
		q.start([...cards(1), { blockId: 'H', lessonId: 'LH' }, ...lesson('Z', 2)], ['H']);
		q.prioritise('H');
		expect(q.rows.map((r) => r.blockId)).toEqual(['B0', 'H', 'Z-0', 'Z-1']);
		// Z's cards are the first free ones already: nothing moves, the held card stays put.
		q.prioritise('Z-1');
		expect(q.rows.map((r) => r.blockId)).toEqual(['B0', 'H', 'Z-0', 'Z-1']);
	});

	it('never has more than the limit of lessons in flight', async () => {
		let now = 0;
		let peak = 0;
		const q = new WriteQueue(
			async (rows, { report }) => {
				peak = Math.max(peak, ++now);
				await new Promise((r) => setTimeout(r, 1));
				for (const row of rows) report(row, 'done');
				now--;
				return 'done';
			},
			{ concurrency: 3 }
		);
		q.start(cards(10));
		await settle(q);
		expect(peak).toBe(3);
		expect(states(q)).toEqual(Array(10).fill('done'));
	});

	it('stop starts no new lesson, lets the running ones finish, and resume writes the rest', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 3 });
		q.start(cards(6));
		q.stop();
		await m.finish('B0');
		await m.finish('B1');
		await m.finish('B2');
		expect(m.firsts()).toEqual(['B0', 'B1', 'B2']);
		expect(states(q)).toEqual(['done', 'done', 'done', 'waiting', 'waiting', 'waiting']);
		expect(q.running).toBe(false);
		expect(q.rest.map((r) => r.blockId)).toEqual(['B3', 'B4', 'B5']);

		q.resume();
		expect(m.firsts()).toEqual(['B0', 'B1', 'B2', 'B3', 'B4', 'B5']);
		for (const id of ['B3', 'B4', 'B5']) await m.finish(id);
		expect(states(q)).toEqual(Array(6).fill('done'));
	});

	it('a stop during a lesson leaves the cards not reached waiting, and resume continues them', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(lesson('L1', 3));
		const context = m.contexts.get('L1-0')!;
		const [a, b, c] = m.batches.get('L1-0')!;
		context.report(a, 'writing');
		context.report(a, 'done');
		context.report(b, 'writing');
		q.stop();
		expect(context.stopped()).toBe(true);
		// The runner finishes the card it was on and ends the lesson.
		context.report(b, 'done');
		await m.finish('L1-0', 'done', false);
		expect(states(q)).toEqual(['done', 'done', 'waiting']);
		expect(c.state).toBe('waiting');
		expect(q.rest.map((r) => r.blockId)).toEqual(['L1-2']);
		expect(q.running).toBe(false);

		q.resume();
		expect(m.started[1]).toEqual(['L1-2']);
		await m.finish('L1-2');
		expect(states(q)).toEqual(['done', 'done', 'done']);
	});

	it('the runner is told the queue is not stopped while it runs', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(1));
		expect(m.contexts.get('B0')!.stopped()).toBe(false);
	});

	it('a lesson that ends done with cards unfinished fails them, unless the queue was stopped', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(lesson('L1', 2));
		const [a] = m.batches.get('L1-0')!;
		m.contexts.get('L1-0')!.report(a, 'done');
		await m.finish('L1-0', 'done', false);
		expect(states(q)).toEqual(['done', 'failed']);
	});

	it('resume with lessons still being written does not start more than the limit', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 3 });
		q.start(cards(6));
		q.stop();
		q.resume();
		expect(m.firsts()).toEqual(['B0', 'B1', 'B2']);
		await m.finish('B0');
		expect(m.started).toHaveLength(4);
	});

	it('resume does not give the runner a lesson that is already running', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(lesson('L1', 2));
		q.stop();
		q.resume();
		expect(m.started).toHaveLength(1);
	});

	it('marks a failed lesson’s cards and goes on; resume tries them again', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 3 });
		q.start([...lesson('L1', 2), ...lesson('L2', 1)]);
		await m.finish('L1-0', { problem: 'other' });
		await m.finish('L2-0');
		expect(states(q)).toEqual(['failed', 'failed', 'done']);
		expect(q.running).toBe(false);
		expect(q.rest.map((r) => r.blockId)).toEqual(['L1-0', 'L1-1']);
		q.resume();
		expect(m.started[2]).toEqual(['L1-0', 'L1-1']);
		await m.finish('L1-0');
		expect(states(q)).toEqual(['done', 'done', 'done']);
	});

	it('a problem keeps the cards the lesson had finished', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(lesson('L1', 3));
		const [a, b] = m.batches.get('L1-0')!;
		m.contexts.get('L1-0')!.report(a, 'done');
		m.contexts.get('L1-0')!.report(b, 'writing');
		await m.finish('L1-0', { problem: 'other' });
		expect(states(q)).toEqual(['done', 'failed', 'failed']);
	});

	it('waits as long as the server said after a rate limit, then tries only the unfinished cards once more', async () => {
		const waits: number[] = [];
		const calls: string[][] = [];
		let first = true;
		const q = new WriteQueue(
			async (rows, { report }) => {
				calls.push(rows.map((r) => r.blockId));
				if (first) {
					first = false;
					report(rows[0], 'done');
					report(rows[1], 'writing');
					return { problem: 'rate', retryAfter: 7 };
				}
				for (const row of rows) report(row, 'done');
				return 'done';
			},
			{ wait: async (s) => void waits.push(s) }
		);
		q.start(lesson('L1', 3));
		await settle(q);
		expect(waits).toEqual([7]);
		expect(calls).toEqual([
			['L1-0', 'L1-1', 'L1-2'],
			['L1-1', 'L1-2']
		]);
		expect(states(q)).toEqual(['done', 'done', 'done']);
	});

	it('cards refused for speed wait, not write, while the queue waits', async () => {
		let release!: () => void;
		const q = new WriteQueue(
			async (rows, { report }) => {
				report(rows[0], 'writing');
				return { problem: 'rate' };
			},
			{ wait: () => new Promise<void>((r) => (release = r)) }
		);
		q.start(lesson('L1', 2));
		await new Promise((r) => setTimeout(r, 0));
		expect(states(q)).toEqual(['waiting', 'waiting']);
		q.stop();
		release();
		await new Promise((r) => setTimeout(r, 0));
	});

	it('a card refused twice is failed, and the wait is capped', async () => {
		const waits: number[] = [];
		const q = new WriteQueue(async () => ({ problem: 'rate', retryAfter: 600 }), {
			wait: async (s) => void waits.push(s)
		});
		q.start(cards(1));
		await settle(q);
		expect(states(q)).toEqual(['failed']);
		expect(waits).toEqual([70]);
	});

	it('waits 15 seconds when the server did not say how long', async () => {
		const waits: number[] = [];
		const q = new WriteQueue(async () => ({ problem: 'rate' }), {
			wait: async (s) => void waits.push(s)
		});
		q.start(cards(1));
		await settle(q);
		expect(waits).toEqual([15]);
	});

	it('a spent day stops the queue and says why', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 3 });
		q.start(cards(5));
		await m.finish('B0', { problem: 'budget' });
		expect(q.stoppedBy).toBe('budget');
		expect(q.running).toBe(false);
		await m.finish('B1');
		await m.finish('B2');
		expect(m.started).toHaveLength(3);
		expect(states(q)).toEqual(['failed', 'done', 'done', 'waiting', 'waiting']);
	});

	it('a spent day fails the lesson’s next card and leaves its other cards waiting', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(lesson('L1', 3));
		const [a] = m.batches.get('L1-0')!;
		m.contexts.get('L1-0')!.report(a, 'done');
		await m.finish('L1-0', { problem: 'budget' });
		expect(states(q)).toEqual(['done', 'failed', 'waiting']);
		expect(q.stoppedBy).toBe('budget');
	});

	it('a stop during a rate wait leaves the cards waiting, not retried', async () => {
		let release!: () => void;
		let calls = 0;
		const q = new WriteQueue(
			async () => {
				calls++;
				return { problem: 'rate' };
			},
			{ wait: () => new Promise<void>((r) => (release = r)) }
		);
		q.start(lesson('L1', 2));
		await new Promise((r) => setTimeout(r, 0));
		q.stop();
		release();
		await new Promise((r) => setTimeout(r, 0));
		expect(states(q)).toEqual(['waiting', 'waiting']);
		expect(calls).toBe(1);
	});

	it('clear forgets the rows; a card that finishes afterwards changes nothing', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 3 });
		q.start(cards(2));
		const [row] = m.batches.get('B0')!;
		q.clear();
		m.contexts.get('B0')!.report(row, 'done');
		await m.finish('B0', { problem: 'other' });
		expect(q.rows).toEqual([]);
	});

	it('a new batch keeps the unfinished rows of the old one and does not lose their results', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 3 });
		q.start(cards(2));
		await m.finish('B0', { problem: 'other' });
		// B1 is still being written when the next batch comes.
		q.start([
			{ blockId: 'N0', lessonId: 'M0' },
			{ blockId: 'N1', lessonId: 'M1' }
		]);
		expect(q.rows.map((r) => r.blockId)).toEqual(['B0', 'B1', 'N0', 'N1']);
		// One in flight from the old batch, so only two slots were free; B0 is failed.
		expect(m.firsts()).toEqual(['B0', 'B1', 'N0', 'N1']);
		await m.finish('B1');
		await m.finish('N0');
		await m.finish('N1');
		expect(states(q)).toEqual(['failed', 'done', 'done', 'done']);
		expect(q.rest.map((r) => r.blockId)).toEqual(['B0']);
	});

	it('a new batch drops the finished rows', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 3 });
		q.start(cards(1));
		await m.finish('B0');
		q.start([{ blockId: 'N0', lessonId: 'L0' }]);
		expect(q.rows.map((r) => r.blockId)).toEqual(['N0']);
	});

	it('a second rate limit after the wait pauses the queue with the rest waiting', async () => {
		const calls: string[][] = [];
		const q = new WriteQueue(
			async (rows) => {
				calls.push(rows.map((r) => r.blockId));
				return { problem: 'rate' };
			},
			{ wait: async () => {}, concurrency: 1 }
		);
		q.start([...lesson('L1', 3), ...lesson('L2', 1)]);
		await settle(q);
		expect(states(q)).toEqual(['failed', 'waiting', 'waiting', 'waiting']);
		expect(q.stoppedBy).toBe('rate');
		expect(calls).toEqual([
			['L1-0', 'L1-1', 'L1-2'],
			['L1-0', 'L1-1', 'L1-2']
		]);
		q.resume();
		expect(q.stoppedBy).toBeNull();
	});

	it('holds cards until they are released, and writes the others meanwhile', async () => {
		const m = manual();
		const q = new WriteQueue(m.run, { concurrency: 2 });
		q.start(cards(4), ['B0', 'B2']);
		expect(m.firsts()).toEqual(['B1', 'B3']);
		expect(q.pending).toEqual(new Set(['B0', 'B1', 'B2', 'B3']));
		await m.finish('B1');
		await m.finish('B3');
		// Held cards keep the queue running, waiting.
		expect(q.running).toBe(true);
		expect(m.firsts()).toEqual(['B1', 'B3']);
		expect(states(q)).toEqual(['waiting', 'done', 'waiting', 'done']);
		q.release(['B0', 'B2']);
		expect(m.firsts()).toEqual(['B1', 'B3', 'B0', 'B2']);
		await m.finish('B0');
		await m.finish('B2');
		expect(states(q)).toEqual(Array(4).fill('done'));
		expect(q.running).toBe(false);
	});

	it('a lesson with a held card is not written without it; released, the lesson goes in one call', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(lesson('L1', 3), ['L1-1']);
		expect(m.started).toEqual([['L1-0', 'L1-2']]);
		await m.finish('L1-0');
		q.release(['L1-1']);
		expect(m.started[1]).toEqual(['L1-1']);
		await m.finish('L1-1');
		expect(states(q)).toEqual(['done', 'done', 'done']);
	});

	it('a stopped queue starts nothing on release; resume does', async () => {
		const m = manual();
		const q = new WriteQueue(m.run);
		q.start(cards(1), ['B0']);
		q.stop();
		q.release(['B0']);
		expect(m.started).toEqual([]);
		q.resume();
		expect(m.firsts()).toEqual(['B0']);
	});
});
