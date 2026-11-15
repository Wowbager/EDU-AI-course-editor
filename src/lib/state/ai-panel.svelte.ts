/**
 * What the AI panel holds between renders: the proposal the teacher is shaping and the
 * queue that writes the cards once they accept. It lives here and not in the component so
 * that switching to Náhled and back loses nothing.
 *
 * The proposal exists only here. It is never in the document: the course only changes
 * when „Vytvořit vybrané“ runs `insertOutline`, as one undo step.
 */
import {
	addToDraft,
	buildOutlineRequest,
	emptyDraft,
	keyMaker,
	untickedOf,
	toOutline,
	type Draft,
	type KeyMaker
} from '$lib/domain/outline';
import { CommandError } from '$lib/domain/commands';
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
	/** The prompt the proposal started from; a change is sent with it. */
	#original = '';
	asking = $state(false);
	/** The proposal on screen is still being written, lesson by lesson. */
	incoming = $state(false);
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
	 * Ask for a proposal, or, with one on screen, for it to be changed. A fresh proposal
	 * grows on screen as the model writes it, lesson by lesson. A change is built beside
	 * the old one, which stays (dimmed) until the new one is complete; it keeps the
	 * teacher's ticks on the cards the model kept (`addToDraft`). A failed request leaves
	 * the proposal as it was.
	 */
	async send(store: DocStore, text: string): Promise<void> {
		const prompt = text.trim();
		if (prompt === '' || this.asking) return;
		const previous = this.draft;
		const current = previous === null ? undefined : toOutline(previous, 'all');
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
		const fresh = previous === null;
		this.incoming = fresh;
		const unticked = untickedOf(previous ?? undefined);
		// A fresh proposal is built in `this.draft` itself, so what the teacher ticks or
		// renames while it is still arriving is not lost to the next lesson.
		let building: Draft | null = null;
		const outcome = await askOutline(request, (event) => {
			if (generation !== this.#generation) return;
			if (event.type === 'scope') {
				building = emptyDraft(event.scope, this.#key);
				if (fresh) this.draft = building;
				return;
			}
			if (fresh) {
				if (this.draft !== null) this.draft = addToDraft(this.draft, event, this.#key, unticked);
			} else if (building !== null) building = addToDraft(building, event, this.#key, unticked);
		});
		if (generation !== this.#generation) return;
		this.asking = false;
		this.incoming = false;
		const got = (fresh ? this.draft : building) as Draft | null;
		const some = got !== null && got.lessons.some((l) => l.cards.length > 0);
		if (outcome !== 'done') {
			this.problem = this.#say(outcome.problem);
			// What a fresh proposal had written before the failure stays; an empty one goes.
			if (fresh && !some) this.draft = null;
			if (!(fresh && some)) return;
		}
		if (fresh) this.#original = prompt;
		else if (got !== null) this.draft = got;
	}

	#say(problem: Problem): string {
		return PROPOSAL_TEXT[ai.available ? problem : 'failed'];
	}

	/** „Zahodit návrh“: the proposal and its request go; nothing in the course changes. */
	discard() {
		this.#generation++;
		this.asking = false;
		this.incoming = false;
		this.draft = null;
		this.problem = '';
		this.#original = '';
	}

	/**
	 * „Vytvořit vybrané“: the ticked cards go into the course (one undo step), the
	 * proposal is done with, and the queue starts writing them.
	 */
	create(store: DocStore): void {
		const outline = this.draft === null ? undefined : toOutline(this.draft, 'ticked');
		if (outline === undefined || this.asking) return;
		// The request that made a course structure is kept on the course for the cards' dossier.
		const request = outline.scope === 'lessons' ? this.#original : undefined;
		// The selection may have gone (a lesson deleted meanwhile): then the end of the course.
		const { selection, doc } = store;
		const at = {
			lessonId: doc.lessons.some((l) => l.lesson_id === selection?.lessonId)
				? selection?.lessonId
				: undefined,
			blockId: doc.blocks.some((b) => b.block_id === selection?.blockId)
				? selection?.blockId
				: undefined
		};
		let added: { blockId: string; lessonId: string }[] = [];
		try {
			store.endEdit();
			// Where the teacher is stays where they are: the new cards are in the tree, not forced on them.
			store.apply((d, r) => {
				const result = insertOutline(d, outline, at, r, request);
				added = result.added;
				return { ...result, ref: undefined };
			});
		} catch (e) {
			if (!(e instanceof CommandError)) throw e;
			this.problem = 'Návrh se do kurzu nepodařilo vložit. Zkus to znovu.';
			return;
		}
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
	}
}

export const aiPanel = new AiPanel();
