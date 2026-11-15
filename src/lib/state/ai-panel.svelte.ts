/**
 * What the AI panel holds between renders: the proposal the teacher is shaping, the last
 * thing they asked, and the queue that writes the cards once they accept. It lives here
 * and not in the component so that switching to Náhled and back loses nothing.
 *
 * The proposal exists only here. It is never in the document: the course only changes
 * when „Vytvořit vybrané“ runs `insertOutline`, as one undo step.
 */
import {
	buildOutlineRequest,
	draftOf,
	keyMaker,
	toOutline,
	type Draft,
	type KeyMaker
} from '$lib/domain/outline';
import { insertOutline } from '$lib/domain/outline-insert';
import { ai, askOutline, TEXT, type Problem } from './ai.svelte';
import { WriteQueue, type RunResult, type Row } from './write-queue.svelte';
import type { DocStore } from './doc-store.svelte';

const PROPOSAL_TEXT = {
	...TEXT,
	failed: 'Návrh se nepodařilo vytvořit. Zkus to znovu, třeba jinak napsané.'
} as const;

class AiPanel {
	/** The proposal being shaped, or none. */
	draft = $state<Draft | null>(null);
	/** The last instruction, shown as one quiet line above the box. */
	last = $state('');
	/** The prompt the proposal started from; a change is sent with it. */
	#original = '';
	asking = $state(false);
	/** A sentence for the teacher, or empty. */
	problem = $state('');
	/** Bumped to make a request that was sent before „Zahodit návrh“ ignore its answer. */
	#generation = 0;
	#key: KeyMaker = keyMaker();
	#store: DocStore | null = null;

	queue = new WriteQueue((row) => this.#write(row));

	async #write(row: Row): Promise<RunResult> {
		const store = this.#store;
		if (store === null) return { problem: 'other' };
		const result = await ai.write(store, row.blockId, row.lessonId, { quiet: true });
		if (result.status !== 'problem') return 'done';
		if (result.problem === 'rate')
			return {
				problem: 'rate',
				...(result.retryAfter !== undefined ? { retryAfter: result.retryAfter } : {})
			};
		return { problem: result.problem === 'budget' ? 'budget' : 'other' };
	}

	/**
	 * Ask for a proposal, or, with one on screen, for it to be changed. A change keeps
	 * the teacher's ticks on the cards the model kept (`draftOf`) and replaces the rest.
	 * A failed request leaves the proposal as it was.
	 */
	async send(store: DocStore, text: string): Promise<void> {
		const prompt = text.trim();
		if (prompt === '' || this.asking) return;
		const current = this.draft === null ? undefined : toOutline(this.draft, 'all');
		const request = buildOutlineRequest(
			store.doc,
			store.selection,
			prompt,
			current === undefined ? undefined : { current, original: this.#original || prompt }
		);
		// A finished batch is over once the teacher asks for something else.
		if (!this.queue.writing && this.queue.rest.length === 0) this.queue.clear();
		const generation = ++this.#generation;
		this.asking = true;
		this.problem = '';
		this.last = prompt;
		const outcome = await askOutline(request);
		if (generation !== this.#generation) return;
		this.asking = false;
		if ('problem' in outcome) {
			this.problem = this.#say(outcome.problem);
			return;
		}
		if (current === undefined) this.#original = prompt;
		this.draft = draftOf(outcome.outline, this.#key, this.draft ?? undefined);
	}

	#say(problem: Problem): string {
		return PROPOSAL_TEXT[ai.available ? problem : 'failed'];
	}

	/** „Zahodit návrh“: the proposal and its request go; nothing in the course changes. */
	discard() {
		this.#generation++;
		this.asking = false;
		this.draft = null;
		this.last = '';
		this.problem = '';
		this.#original = '';
	}

	/**
	 * „Vytvořit vybrané“: the ticked cards go into the course (one undo step), the
	 * proposal is done with, and the queue starts writing them.
	 */
	create(store: DocStore): void {
		const outline = this.draft === null ? undefined : toOutline(this.draft, 'ticked');
		if (outline === undefined) return;
		const at = { lessonId: store.selection?.lessonId, blockId: store.selection?.blockId };
		store.endEdit();
		let added: { blockId: string; lessonId: string }[] = [];
		// Where the teacher is stays where they are: the new cards are in the tree, not forced on them.
		store.apply((d, r) => {
			const result = insertOutline(d, outline, at, r);
			added = result.added;
			return { ...result, ref: undefined };
		});
		this.#store = store;
		this.draft = null;
		this.problem = '';
		this.#original = '';
		this.queue.start(added);
	}

	stop() {
		this.queue.stop();
	}

	/** „Dopsat zbytek“. */
	resume(store: DocStore) {
		this.#store = store;
		this.queue.resume();
	}

	/** The queue's rows are done with: the panel is empty again. */
	finish() {
		this.queue.clear();
		this.last = '';
	}
}

export const aiPanel = new AiPanel();
