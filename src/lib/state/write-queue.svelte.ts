/**
 * Writing many cards: a lesson at a time in one conversation, a few lessons at once, in
 * course order.
 *
 * The browser runs it (there is no job server): every card that is finished is in the
 * document at once, so it is saved like any edit, and a closed tab loses only the cards
 * not yet written. The runner takes a lesson's waiting cards together and reports each
 * card as it goes (`writing`, `done`, `failed`). `stop` starts no lesson and no card
 * after the ones being written; `resume` starts again with the cards that are not done.
 *
 * The runner says how the lesson ended. Refused for speed (`rate`), the lesson's
 * unfinished cards wait as long as the server said and are tried once more; a spent day
 * (`budget`) stops the queue, since every other card would fail the same way; so does a
 * second `rate` right after the wait. Then the card that was next is failed and the rest
 * wait for „Dopsat zbytek“. Any other problem fails the lesson's unfinished cards.
 *
 * A card can be held (`start`'s `held`): it waits, as any card does, and is not started
 * until it is released, while the others go on.
 */
export type RunResult =
	'done' | { problem: 'rate'; retryAfter?: number } | { problem: 'budget' | 'other' };

export type RowState = 'waiting' | 'writing' | 'done' | 'failed';
export interface Row {
	blockId: string;
	lessonId: string;
	/** The course the card is in; card ids repeat from course to course. */
	course?: string;
	state: RowState;
}

/** What the runner is given with a lesson's cards. */
export interface RunContext {
	/** Says how one of the cards is doing. */
	report(row: Row, state: RowState): void;
	/** The queue was stopped: write no further card. */
	stopped(): boolean;
}

/** Lessons written at once when nothing says otherwise (`domain/write-concurrency.ts`). */
export const CONCURRENCY = 4;
/** Without a `Retry-After`, and at most, in seconds. */
const DEFAULT_WAIT = 15;
const MAX_WAIT = 70;

/** A card by course and id: card ids repeat from course to course. */
const keyOf = (c: { blockId: string; course?: string }) => `${c.course}\0${c.blockId}`;

export class WriteQueue {
	rows = $state<Row[]>([]);
	/** Cards are being started. False when stopped, and when everything is started. */
	running = $state(false);
	/** Why the queue stopped by itself, if it did. */
	stoppedBy = $state<'budget' | 'rate' | null>(null);
	#inflight = 0;
	/** Cards not to be started yet. */
	#held = new Set<string>();
	/** Rows a running lesson has taken, waiting or not. */
	#claimed = new Set<Row>();

	constructor(
		private readonly run: (rows: Row[], context: RunContext) => Promise<RunResult>,
		private readonly options: {
			concurrency?: number;
			wait?: (seconds: number) => Promise<void>;
		} = {}
	) {}

	/** Cards not finished: still waiting, or failed. What „Dopsat zbytek“ is for. */
	get rest(): Row[] {
		return this.rows.filter((r) => r.state === 'waiting' || r.state === 'failed');
	}

	/**
	 * The cards still to be written or being written: the one set that says a card is
	 * waiting for AI. The editor reads it so that such a card shows no complaints
	 * (`issue-visibility.ts`); a card leaves it when it is written or has failed.
	 */
	get pending(): ReadonlySet<string> {
		return this.pendingFor(undefined);
	}

	/** `pending` for the cards of one course (all of them when none is named). */
	pendingFor(course: string | undefined): ReadonlySet<string> {
		return new Set(
			this.rows
				.filter(
					(r) =>
						(r.state === 'waiting' || r.state === 'writing') &&
						(course === undefined || r.course === course)
				)
				.map((r) => r.blockId)
		);
	}

	/** `rest` for the cards of one course: what „Dopsat zbytek“ offers there. */
	restFor(course: string): Row[] {
		return this.rest.filter((r) => r.course === course);
	}

	/**
	 * A card the teacher opens is written soon: its lesson's waiting cards go ahead of the
	 * other cards still waiting, in their order, since a lesson is written front to back.
	 */
	prioritise(blockId: string, course?: string) {
		const row = this.rows.find(
			(r) => r.blockId === blockId && r.course === course && this.#free(r)
		);
		const first = this.rows.findIndex((r) => this.#free(r));
		if (row === undefined || first < 0) return;
		const ahead = this.rows.filter((r) => this.#free(r) && r.lessonId === row.lessonId);
		if (ahead.every((r, i) => this.rows[first + i] === r)) return;
		const others = this.rows.slice(first).filter((r) => !ahead.includes(r));
		this.rows = [...this.rows.slice(0, first), ...ahead, ...others];
	}

	get writing(): boolean {
		return this.running || this.#inflight > 0;
	}

	/**
	 * A new batch joins what the old one left: finished rows go, but cards still being
	 * written, waiting or failed stay (and stay covered by `resume`), ahead of the new ones.
	 */
	start(
		cards: readonly { blockId: string; lessonId: string; course?: string }[],
		/** Cards that wait until `release`. */
		held: readonly string[] = []
	) {
		for (const c of cards) if (held.includes(c.blockId)) this.#held.add(keyOf(c));
		const kept = this.rows.filter((r) => r.state !== 'done');
		const known = new Set(kept.map(keyOf));
		this.rows = [
			...kept,
			...cards.filter((c) => !known.has(keyOf(c))).map((c) => ({ ...c, state: 'waiting' as const }))
		];
		this.stoppedBy = null;
		this.running = true;
		this.#pump();
	}

	stop() {
		this.running = false;
	}

	/** Held cards may be started now. */
	release(blockIds: readonly string[], course?: string) {
		for (const blockId of blockIds) this.#held.delete(keyOf({ blockId, course }));
		this.#pump();
	}

	/** Start again with what is not done, failed cards included; only a course's when named. */
	resume(course?: string) {
		for (const row of this.rows)
			if (row.state === 'failed' && (course === undefined || row.course === course))
				row.state = 'waiting';
		this.stoppedBy = null;
		this.running = true;
		this.#pump();
	}

	/**
	 * Cards left over from before a reload: failed, since nothing is being written, so
	 * „Dopsat zbytek“ offers them. Nothing starts. Ignored when the queue has rows.
	 */
	restore(cards: readonly { blockId: string; lessonId: string; course?: string }[]) {
		if (this.rows.length > 0 || this.writing) return;
		this.rows = cards.map((c) => ({ ...c, state: 'failed' as const }));
	}

	clear() {
		this.running = false;
		this.rows = [];
		this.stoppedBy = null;
		this.#held.clear();
		this.#claimed.clear();
	}

	/** Waiting, not held and not taken by a lesson being written. */
	#free(row: Row): boolean {
		return row.state === 'waiting' && !this.#held.has(keyOf(row)) && !this.#claimed.has(row);
	}

	#pump() {
		const limit = this.options.concurrency ?? CONCURRENCY;
		while (this.running && this.#inflight < limit) {
			const first = this.rows.find((r) => this.#free(r));
			if (first === undefined) break;
			const batch = this.rows.filter((r) => this.#free(r) && r.lessonId === first.lessonId);
			for (const row of batch) this.#claimed.add(row);
			this.#inflight++;
			void this.#lesson(batch).finally(() => {
				for (const row of batch) this.#claimed.delete(row);
				this.#inflight--;
				this.#pump();
			});
		}
		if (this.running && this.#inflight === 0 && !this.rows.some((r) => r.state === 'waiting'))
			this.running = false;
	}

	async #lesson(batch: Row[]) {
		const context: RunContext = {
			report: (row, state) => {
				if (this.rows.includes(row)) row.state = state;
			},
			stopped: () => !this.running
		};
		const left = () =>
			batch.filter(
				(r) => this.rows.includes(r) && (r.state === 'waiting' || r.state === 'writing')
			);
		let result = await this.run(batch, context);
		if (typeof result === 'object' && result.problem === 'rate') {
			for (const row of left()) row.state = 'waiting';
			const seconds = Math.min(result.retryAfter ?? DEFAULT_WAIT, MAX_WAIT);
			await (this.options.wait ?? ((s) => new Promise<void>((r) => setTimeout(r, s * 1000))))(
				seconds
			);
			// Stopped meanwhile: the cards are not started again.
			if (!this.running || left().length === 0) return;
			result = await this.run(left(), context);
		}
		const rest = left();
		if (result === 'done') {
			// Stopped half way: the cards not reached wait. Otherwise none should be left.
			for (const row of rest) row.state = this.running ? 'failed' : 'waiting';
			return;
		}
		if (result.problem === 'other') {
			for (const row of rest) row.state = 'failed';
			return;
		}
		// Refused again right after waiting, or the day is spent: every other card would be
		// too. Stop, with the rest waiting, so „Dopsat zbytek“ goes on later.
		rest.forEach((row, i) => (row.state = i === 0 ? 'failed' : 'waiting'));
		this.stoppedBy = result.problem;
		this.running = false;
	}
}
