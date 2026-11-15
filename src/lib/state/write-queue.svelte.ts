/**
 * Writing many cards, a few at a time, in course order.
 *
 * The browser runs it (there is no job server): every card that is finished is in the
 * document at once, so it is saved like any edit, and a closed tab loses only the cards
 * not yet started. `stop` stops *starting* cards; the ones being written finish. `resume`
 * starts again with the cards that are not done.
 *
 * The runner does the writing and says how it went. A request the server refused for
 * speed (`rate`) waits as long as the server said and tries once more; a spent day
 * (`budget`) stops the queue, since every other card would fail the same way.
 */
export type RunResult =
	'done' | { problem: 'rate'; retryAfter?: number } | { problem: 'budget' | 'other' };

export type RowState = 'waiting' | 'writing' | 'done' | 'failed';
export interface Row {
	blockId: string;
	lessonId: string;
	state: RowState;
}

export const CONCURRENCY = 3;
/** Without a `Retry-After`, and at most, in seconds. */
const DEFAULT_WAIT = 15;
const MAX_WAIT = 70;

export class WriteQueue {
	rows = $state<Row[]>([]);
	/** Cards are being started. False when stopped, and when everything is started. */
	running = $state(false);
	/** Why the queue stopped by itself, if it did. */
	stoppedBy = $state<'budget' | null>(null);
	#inflight = 0;

	constructor(
		private readonly run: (row: Row) => Promise<RunResult>,
		private readonly options: {
			concurrency?: number;
			wait?: (seconds: number) => Promise<void>;
		} = {}
	) {}

	/** Cards not finished: still waiting, or failed. What „Dopsat zbytek“ is for. */
	get rest(): Row[] {
		return this.rows.filter((r) => r.state === 'waiting' || r.state === 'failed');
	}

	get writing(): boolean {
		return this.running || this.#inflight > 0;
	}

	/** A new batch replaces the rows of the old one; cards still being written finish. */
	start(cards: readonly { blockId: string; lessonId: string }[]) {
		this.rows = cards.map((c) => ({ ...c, state: 'waiting' }));
		this.stoppedBy = null;
		this.running = true;
		this.#pump();
	}

	stop() {
		this.running = false;
	}

	/** Start again with what is not done, failed cards included. */
	resume() {
		for (const row of this.rows) if (row.state === 'failed') row.state = 'waiting';
		this.stoppedBy = null;
		this.running = true;
		this.#pump();
	}

	clear() {
		this.running = false;
		this.rows = [];
		this.stoppedBy = null;
	}

	#pump() {
		const limit = this.options.concurrency ?? CONCURRENCY;
		while (this.running && this.#inflight < limit) {
			const row = this.rows.find((r) => r.state === 'waiting');
			if (row === undefined) break;
			row.state = 'writing';
			this.#inflight++;
			void this.#one(row).finally(() => {
				this.#inflight--;
				this.#pump();
			});
		}
		if (this.running && this.#inflight === 0 && !this.rows.some((r) => r.state === 'waiting'))
			this.running = false;
	}

	async #one(row: Row) {
		let result = await this.run(row);
		if (typeof result === 'object' && result.problem === 'rate') {
			const seconds = Math.min(result.retryAfter ?? DEFAULT_WAIT, MAX_WAIT);
			await (this.options.wait ?? ((s) => new Promise<void>((r) => setTimeout(r, s * 1000))))(
				seconds
			);
			// Stopped meanwhile: the card is not started again.
			if (!this.running || !this.rows.includes(row)) {
				if (this.rows.includes(row)) row.state = 'waiting';
				return;
			}
			result = await this.run(row);
		}
		if (!this.rows.includes(row)) return;
		if (result === 'done') row.state = 'done';
		else {
			row.state = 'failed';
			if (result.problem === 'budget') {
				this.stoppedBy = 'budget';
				this.running = false;
			}
		}
	}
}
