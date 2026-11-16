/**
 * What the AI panel holds between renders: the proposal the teacher is shaping and the
 * queue that writes the cards once they accept. It lives here and not in the component so
 * that switching to Náhled and back loses nothing.
 *
 * The proposal exists only here. It is never in the document: the course only changes
 * when „Vytvořit vybrané“ runs `insertOutline`, as one undo step.
 *
 * The outline has its own undo history: every change the teacher makes to it (`change`),
 * „Zahodit návrh“ and the AI replacing it is a step, until „Vytvořit vybrané“ ends it.
 * A proposal the AI is still writing is not stepped through lesson by lesson: it is one
 * step once it is there.
 *
 * The outline belongs to its course (`follow`): another course has its own, or none, and
 * the history starts again. It is kept in the browser per course (`outline-store.ts`), so
 * it is back after a reload, without its history.
 */
import {
	addDraftCard,
	addDraftLesson,
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
import { emptyHistory, record, redo, retract, undo, type History } from '$lib/domain/history';
import { insertOutline } from '$lib/domain/outline-insert';
import { ai, askOutline, askSources, TEXT, type Problem } from './ai.svelte';
import {
	buildSourcesRequest,
	cardsWithoutSources,
	setSourceRefs,
	sourcesWanted
} from '$lib/domain/source-assign';
import { materials } from './materials.svelte';
import { WriteQueue, type RunResult, type Row } from './write-queue.svelte';
import { readOutline, writeOutline } from './outline-store';
import type { DocStore } from './doc-store.svelte';

const PROPOSAL_TEXT = {
	...TEXT,
	failed: 'Návrh se nepodařilo vytvořit. Zkus to znovu, třeba jinak napsané.'
} as const;

const storage = (): Storage | undefined =>
	typeof localStorage === 'undefined' ? undefined : localStorage;

/**
 * What is asked for when the teacher sends with only files attached; it is also the
 * request a course structure made from it keeps on the course.
 */
export const FROM_MATERIALS = 'Navrhni kurz z přiložených podkladů.';

class AiPanel {
	#draft = $state<Draft | null>(null);
	/** The course the outline belongs to; none until the panel says (`follow`). */
	#course: string | null = null;

	/** The proposal being shaped, or none. Every change is kept for the course. */
	get draft(): Draft | null {
		return this.#draft;
	}
	set draft(next: Draft | null) {
		this.#draft = next;
		if (this.#course !== null) writeOutline(storage(), this.#course, next);
	}
	#history = $state<History<Draft | null>>(emptyHistory());
	/** Counts every step, so a step can be taken back only while it is still the last one. */
	#steps = 0;
	/** A row just added for the teacher to name: the outline's tree opens it as a field. */
	typing = $state<{ key: string; step: number } | null>(null);
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

	get canUndo(): boolean {
		return !this.asking && this.#history.past.length > 0;
	}
	get canRedo(): boolean {
		return !this.asking && this.#history.future.length > 0;
	}

	/** A key for a new row. */
	key(): string {
		return this.#key();
	}

	/**
	 * The teacher changed the outline: one undo step. Returns the step's number, for
	 * `takeBack`, or -1 when no step was made: nothing changed, or the AI is writing a
	 * fresh proposal, whose edits are not steps (the proposal arrives as one).
	 */
	change(next: Draft | null): number {
		if (next === this.draft) return -1;
		const stepped = !this.incoming;
		if (stepped) this.#step(record(this.#history, this.draft));
		this.draft = next;
		return stepped ? this.#steps : -1;
	}

	/** A change that belongs to the last step, like the name of a row it added. */
	amend(next: Draft): void {
		this.draft = next;
	}

	/**
	 * Step `step` did nothing after all (a row added and left without a name): it is taken
	 * back, and is not there to redo. Once another step came after it, `instead` is the
	 * change to make.
	 */
	takeBack(step: number, instead: Draft | null): void {
		const back = step === this.#steps ? retract(this.#history) : undefined;
		if (back === undefined) {
			this.change(instead);
			return;
		}
		this.#step(back.history);
		this.draft = back.value;
	}

	undo(): boolean {
		const back = this.canUndo ? undo(this.#history, this.draft) : undefined;
		if (back === undefined) return false;
		this.#step(back.history);
		this.draft = back.value;
		return true;
	}

	redo(): boolean {
		const next = this.canRedo ? redo(this.#history, this.draft) : undefined;
		if (next === undefined) return false;
		this.#step(next.history);
		this.draft = next.value;
		return true;
	}

	/**
	 * The course on screen. Another course brings its own outline (or none) and a history
	 * of its own; a request still running for the one before is forgotten.
	 */
	follow(courseId: string): void {
		if (courseId === this.#course) return;
		this.#generation++;
		this.asking = false;
		this.incoming = false;
		this.problem = '';
		this.#course = courseId;
		this.#step(emptyHistory());
		this.typing = null;
		this.#draft = readOutline(storage(), courseId, this.#key);
	}

	/** The outline's history is over: at „Vytvořit vybrané“. */
	forget(): void {
		this.#step(emptyHistory());
		this.typing = null;
	}

	#step(history: History<Draft | null>) {
		this.#history = history;
		this.#steps++;
	}

	/**
	 * The teacher starts an outline without the AI: a lesson, or a card for the lesson they
	 * are in, with its name to be typed.
	 */
	start(scope: Draft['scope']): void {
		if (this.draft !== null || this.asking) return;
		const empty = emptyDraft(scope, this.#key);
		const key = this.#key();
		const draft =
			scope === 'lessons'
				? addDraftLesson(empty, key)
				: addDraftCard(empty, empty.lessons[0].key, key);
		this.typing = { key, step: this.change(draft) };
	}

	/**
	 * Ask for a proposal, or, with one on screen, for it to be changed. A fresh proposal
	 * grows on screen as the model writes it, lesson by lesson. A change is built beside
	 * the old one, which stays (dimmed) until the new one is complete; it keeps the
	 * teacher's ticks on the cards the model kept (`addToDraft`). A failed request leaves
	 * the proposal as it was.
	 */
	async send(store: DocStore, text: string): Promise<void> {
		const prompt = text.trim() || (this.fromMaterials ? FROM_MATERIALS : '');
		if (prompt === '' || this.asking) return;
		const previous = this.draft;
		const current = previous === null ? undefined : toOutline(previous, 'all');
		const request = buildOutlineRequest(
			store.doc,
			store.selection,
			prompt,
			current === undefined ? undefined : { current, original: previous?.original ?? '' },
			materials.sections
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
				// A fresh proposal remembers what it was made from; a change keeps the first prompt.
				const original = fresh ? prompt : previous?.original;
				if (original !== undefined && original !== '') building = { ...building, original };
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
		if (fresh) {
			// The whole proposal is one step from the empty panel.
			this.#step(record(this.#history, null));
		} else if (got !== null) this.change(got);
	}

	#say(problem: Problem): string {
		return PROPOSAL_TEXT[ai.available ? problem : 'failed'];
	}

	/**
	 * Sending with an empty box asks for a proposal from the materials: when there is no
	 * outline on screen and at least one file has been read.
	 */
	get fromMaterials(): boolean {
		return this.draft === null && materials.files.length > 0;
	}

	/** „Zahodit návrh“: the proposal and its request go; nothing in the course changes. */
	discard() {
		this.#generation++;
		this.asking = false;
		this.incoming = false;
		this.change(null);
		this.problem = '';
	}

	/**
	 * „Vytvořit vybrané“: the ticked cards go into the course (one undo step), the
	 * proposal is done with, and the queue starts writing them.
	 */
	create(store: DocStore): void {
		const outline = this.draft === null ? undefined : toOutline(this.draft, 'ticked');
		if (outline === undefined || this.asking) return;
		// The request that made a course structure is kept on the course for the cards' dossier.
		const request = outline.scope === 'lessons' ? this.draft?.original : undefined;
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
			// Where the teacher is stays where they are: the new cards are in the tree, not forced
			// on them. Only when they stand in for the placeholder that was selected does the
			// selection move, to the first of them (`insertOutline`).
			store.apply((d, r) => {
				const result = insertOutline(d, outline, at, r, request);
				added = result.added;
				return result;
			});
		} catch (e) {
			if (!(e instanceof CommandError)) throw e;
			this.problem = 'Návrh se do kurzu nepodařilo vložit. Zkus to znovu.';
			return;
		}
		this.#store = store;
		this.draft = null;
		this.forget();
		this.problem = '';
		// Materials too long for a card to get them all: the cards with no sources of their
		// own wait until the model has named theirs; the others are written at once.
		const sections = materials.sections;
		const unsourced = sourcesWanted(sections) ? cardsWithoutSources(store.doc, added) : [];
		const held = unsourced.map((c) => c.blockId);
		this.queue.start(added, held);
		if (held.length > 0) void this.#source(store, unsourced, sections);
	}

	/**
	 * Name the sources of `cards` and keep them on the cards as if they had come with them
	 * (no undo step of their own, `DocStore.amend`); then they are written, with or
	 * without sources. Nothing about it is shown.
	 */
	async #source(
		store: DocStore,
		cards: { blockId: string; lessonId: string }[],
		sections: typeof materials.sections
	): Promise<void> {
		// The answer is for this course: card ids repeat from course to course.
		const course = store.doc.course_id;
		try {
			const request = buildSourcesRequest(store.doc, cards, sections);
			const assigned = await askSources(request);
			if (assigned.length > 0 && store.doc.course_id === course)
				store.amend((doc) => setSourceRefs(doc, cards, assigned));
		} catch {
			// Written without sources.
		} finally {
			this.queue.release(cards.map((c) => c.blockId));
		}
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
