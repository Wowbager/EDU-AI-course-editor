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
	unnamedTicked,
	withScope,
	type Draft,
	type KeyMaker
} from '$lib/domain/outline';
import { CommandError } from '$lib/domain/commands';
import { emptyHistory, record, redo, retract, undo, type History } from '$lib/domain/history';
import { insertOutline } from '$lib/domain/outline-insert';
import { ai, askLesson, askOutline, askPlan, askSources, TEXT, type Problem } from './ai.svelte';
import {
	buildSourcesRequest,
	cardsWithoutSources,
	setSourceRefs,
	sourcesWanted
} from '$lib/domain/source-assign';
import { sourceRefsOf } from '$lib/domain/authoring';
import {
	buildDossier,
	lessonBaseline,
	lessonChanges,
	lessonSnapshot,
	withWritten
} from '$lib/domain/dossier';
import { buildLessonRequest, type AssistantTurnData } from '$lib/domain/lesson-writing';
import { fitsFully, pictureKeys, picturesFor, renderMaterials } from '$lib/domain/materials';
import { applyPlan, buildPlanRequest, type PlanRequest, type PlanTargets } from '$lib/domain/plan';
import { materials } from './materials.svelte';
import { WriteQueue, type RunContext, type RunResult, type Row } from './write-queue.svelte';
import { concurrencyFor } from '$lib/domain/write-concurrency';
import { makeSnapshot, restoreSnapshot } from '$lib/domain/write-snapshot';
import { dropSnapshot, loadSnapshot, saveSnapshot } from './write-snapshot-store';
import { readOutline, writeOutline } from './outline-store';
import type { DocStore } from './doc-store.svelte';
import type { CourseV2 } from '$lib/domain/schema';
import { hasNoContent } from '$lib/domain/starter';
import {
	DEFAULT_PLACE,
	fitToPlace,
	insertAtOf,
	samePlace,
	scopeOf,
	validPlace,
	type Place
} from '$lib/domain/placement';

const PROPOSAL_TEXT = {
	...TEXT,
	failed: 'Návrh se nepodařilo vytvořit. Zkus to znovu, třeba jinak napsané.'
} as const;

/** The protocol the page was loaded over, if the browser says. */
function pageProtocol(): string | undefined {
	try {
		const [entry] = performance.getEntriesByType('navigation');
		return (entry as PerformanceNavigationTiming | undefined)?.nextHopProtocol;
	} catch {
		return undefined;
	}
}

const storage = (): Storage | undefined =>
	typeof localStorage === 'undefined' ? undefined : localStorage;

/**
 * What is asked for when the teacher sends with only files attached; it is also the
 * request a course structure made from it keeps on the course.
 */
export const FROM_MATERIALS = 'Navrhni kurz z přiložených podkladů.';

/** What is asked when the teacher moves a proposal the AI made to another place. */
export const PLACE_CHANGED = 'Návrh patří na jiné místo (viz place): uprav ho pro ně.';

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
	/** Where the next proposal goes, until there is one: then it is the proposal's own. */
	#place = $state<Place>(DEFAULT_PLACE);
	/**
	 * What „Vytvořit vybrané“ just put in the course, for the tree to show where it went.
	 * `stamp` tells one creation from the next.
	 */
	landed = $state<{ lessonIds: string[]; blockIds: string[]; stamp: number } | null>(null);
	/** Counts every step, so a step can be taken back only while it is still the last one. */
	#steps = 0;
	/** A row just added for the teacher to name: the outline's tree opens it as a field. */
	typing = $state<{ key: string; step: number } | null>(null);
	asking = $state(false);
	/** The proposal on screen is still being written, lesson by lesson. */
	incoming = $state(false);
	/** A sentence for the teacher, or empty. */
	problem = $state('');
	/**
	 * „Vytvořit vybrané“ was clicked with a ticked row still unnamed (`unnamedTicked`): 0 when
	 * not, else bumped on each such click, for the tree to put the cursor in that row.
	 */
	namesWanted = $state(0);
	/** Bumped to make a request that was sent before „Zahodit návrh“ ignore its answer. */
	#generation = 0;
	#key: KeyMaker = keyMaker();
	#store: DocStore | null = null;
	/**
	 * The course the queue's cards belong to. The editor shows one course at a time, so the
	 * queue holds only that one: leaving the course saves its cards and empties the queue.
	 */
	#owner: string | null = null;
	/** The lessons being written: ended when the teacher leaves their course. */
	#lessonAborts = new Set<AbortController>();

	queue = new WriteQueue((rows, context) => this.#write(rows, context), {
		concurrency: concurrencyFor(pageProtocol())
	});
	/** Ends the plan's request when the teacher stops before it is made. */
	#planAbort: AbortController | null = null;
	/** The plan is being made: the cards wait for it. */
	planning = $state(false);
	/**
	 * The plan of the cards being written, and the model's turn that made it, handed back
	 * with each lesson so it starts from the plan's own reasoning. Kept with the unfinished
	 * cards (`write-snapshot-store.ts`), so it is back after a reload.
	 */
	#plan: {
		course: string;
		request: PlanRequest;
		turn: AssistantTurnData;
		seal?: string;
		targets: PlanTargets;
	} | null = null;

	/** A lesson's cards, in one conversation. */
	async #write(rows: Row[], context: RunContext): Promise<RunResult> {
		const stopped = context.stopped;
		const report: RunContext['report'] = (row, state) => {
			// A row of a queue that was emptied (the teacher left the course) is not kept again.
			if (!this.queue.rows.includes(row)) return;
			context.report(row, state);
			this.#save();
		};
		const course = this.#owner;
		const store = this.#store;
		if (store === null || course === null || rows.length === 0) return { problem: 'other' };
		// The store shows another course: these cards stay unwritten.
		const here = () => store.doc.course_id === course;
		if (!here()) return { problem: 'other' };
		const lessonId = rows[0].lessonId;
		await materials.ready(course);
		if (!here()) return { problem: 'other' };
		const doc = store.doc;
		// The plan is for the cards it planned: a later batch, or a card added since, has none.
		// A plan kept from before the server sealed it is not taken back: the cards go without.
		const known = this.#plan?.course === doc.course_id ? this.#plan : null;
		const plan =
			known?.seal !== undefined && rows.every((r) => known.targets.cards.includes(r.blockId))
				? known
				: null;
		const sections = materials.sections;
		const refs = rows.flatMap((r) =>
			sourceRefsOf(doc.blocks.find((b) => b.block_id === r.blockId))
		);
		const built = buildLessonRequest(
			doc,
			lessonId,
			rows.map((r) => r.blockId),
			{
				// With the plan the conversation has the course already; it needs the lesson as it is.
				context:
					plan !== null ? lessonSnapshot(doc, lessonId) : buildDossier(doc, undefined, lessonId),
				// The plan's request has the materials in full when they all fit.
				materials:
					plan !== null && fitsFully(sections)
						? ''
						: renderMaterials(sections, { for: 'lesson', refs }),
				// The plan's conversation has shown every picture already; without it a card may
				// show only the pictures sent with it, the ones its lesson draws on.
				pictures: plan !== null ? [] : picturesFor(sections, { for: 'lesson', refs }),
				pictureKeys:
					plan !== null
						? pictureKeys(sections)
						: picturesFor(sections, { for: 'lesson', refs }).map((p) => p.key),
				...(plan !== null ? { plan } : {})
			}
		);
		// A card with nothing left to write (or gone) is done with.
		const carried = new Set(built?.ids ?? []);
		for (const row of rows) if (!carried.has(row.blockId)) report(row, 'done');
		if (built === undefined) return 'done';
		const byTurn = built.ids.map((id) => rows.find((r) => r.blockId === id)!);
		const abort = new AbortController();
		this.#lessonAborts.add(abort);
		// What the conversation knows of the lesson; the teacher's edits since come with each card.
		let taught = lessonBaseline(doc, lessonId);
		const end = await askLesson(
			built.request,
			(event) => {
				const row = byTurn[event.card];
				if (row === undefined) return;
				// The store shows another course now: nothing more goes into it.
				if (!here()) {
					report(row, 'failed');
					return abort.abort();
				}
				if (event.type === 'writing') return report(row, 'writing');
				if (event.type === 'card') {
					const result = ai.apply(store, row.blockId, row.lessonId, event.answer, { quiet: true });
					taught = withWritten(taught, store.doc, row.blockId);
					report(row, result.status === 'problem' ? 'failed' : 'done');
				} else report(row, 'failed');
				// Stopped: the card being written was finished; no further one is started.
				if (stopped()) abort.abort();
			},
			abort.signal,
			{
				changed: () => {
					const seen = lessonChanges(taught, store.doc, lessonId);
					taught = seen.baseline;
					return seen.text;
				}
			}
		).finally(() => this.#lessonAborts.delete(abort));
		if (end === 'done') return 'done';
		if (end.problem === 'rate')
			return {
				problem: 'rate',
				...(end.retryAfter !== undefined ? { retryAfter: end.retryAfter } : {})
			};
		if (end.problem === 'busy') await ai.detect();
		return { problem: end.problem === 'budget' ? 'budget' : 'other' };
	}

	/** Where the proposal on screen goes, or the next one. */
	get place(): Place {
		return this.draft?.place ?? this.#place;
	}

	/**
	 * The teacher chose another place. With no proposal it is where the next one goes. A
	 * proposal the AI made is asked for again, made for the new place; one made by hand
	 * moves there (one undo step), its cards regrouped when the place takes the other kind.
	 */
	choose(store: DocStore, place: Place): void {
		if (this.asking || samePlace(place, this.place)) return;
		const draft = this.draft;
		if (draft === null) {
			this.#place = place;
			return;
		}
		if (draft.original !== undefined && draft.original !== '') {
			void this.send(store, PLACE_CHANGED, place);
			return;
		}
		this.change({ ...withScope(draft, scopeOf(store.doc, place), this.#key), place });
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
		this.#namesGiven(next);
		const stepped = !this.incoming;
		if (stepped) this.#step(record(this.#history, this.draft));
		this.draft = next;
		return stepped ? this.#steps : -1;
	}

	/** Once no ticked row lacks a name, the next one asks again only at the next click. */
	#namesGiven(next: Draft | null): void {
		if (next === null || !unnamedTicked(next)) this.namesWanted = 0;
	}

	/** A change that belongs to the last step, like the name of a row it added. */
	amend(next: Draft): void {
		this.#namesGiven(next);
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
		this.#namesGiven(back.value);
		this.draft = back.value;
	}

	undo(): boolean {
		const back = this.canUndo ? undo(this.#history, this.draft) : undefined;
		if (back === undefined) return false;
		this.#step(back.history);
		// Undone or redone, a row without a name is asked for again only at the next click.
		this.namesWanted = 0;
		this.draft = back.value;
		return true;
	}

	redo(): boolean {
		const next = this.canRedo ? redo(this.#history, this.draft) : undefined;
		if (next === undefined) return false;
		this.#step(next.history);
		this.namesWanted = 0;
		this.draft = next.value;
		return true;
	}

	/**
	 * The course on screen. Another course brings its own outline (or none) and a history
	 * of its own; a request still running for the one before is forgotten.
	 */
	follow(courseId: string, store?: DocStore): void {
		if (store !== undefined) this.#store = store;
		if (courseId === this.#course) return;
		this.#leave();
		this.#generation++;
		this.asking = false;
		this.incoming = false;
		this.problem = '';
		this.#course = courseId;
		this.namesWanted = 0;
		this.#place = DEFAULT_PLACE;
		this.landed = null;
		this.planning = false;
		this.#step(emptyHistory());
		this.typing = null;
		this.#draft = readOutline(storage(), courseId, this.#key);
		if (store !== undefined) void this.#restore(store, courseId);
	}

	/**
	 * The teacher goes to another course: the queue's unfinished cards are kept for the course
	 * they belong to (they come back as „Dopsat zbytek“ there), its lessons end, the queue
	 * is emptied.
	 */
	#leave(): void {
		if (this.#owner !== null) this.#save();
		this.#owner = null;
		this.#plan = null;
		this.queue.stop();
		this.#planAbort?.abort();
		for (const abort of this.#lessonAborts) abort.abort();
		this.queue.clear();
	}

	/** The unfinished cards of a course, kept before a reload, wait for „Dopsat zbytek“. */
	async #restore(store: DocStore, courseId: string): Promise<void> {
		if (this.queue.rows.length > 0) return;
		const found = await loadSnapshot(courseId);
		if (found === undefined) return;
		const back = restoreSnapshot(found, store.doc, Date.now());
		// The teacher moved on, or created a batch while this was read: it is theirs now.
		if (this.#course !== courseId || store.doc.course_id !== courseId) return;
		if (this.queue.rows.length > 0) return;
		if (back === undefined) return void dropSnapshot(courseId);
		this.#store = store;
		this.#owner = courseId;
		this.#plan = back.plan;
		this.queue.restore(back.rows);
	}

	/** Keeps the cards not written yet, or forgets the batch when none is left. */
	#save(): void {
		const course = this.#owner;
		if (course === null) return;
		const snapshot = makeSnapshot(course, this.queue.rows, this.#plan, Date.now());
		void (snapshot === undefined ? dropSnapshot(course) : saveSnapshot(snapshot));
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
		// A finished batch is over once the teacher starts something else.
		this.#clearFinished();
		const empty = { ...emptyDraft(scope, this.#key), place: this.#place };
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
	async send(store: DocStore, text: string, moveTo?: Place): Promise<void> {
		const prompt = text.trim() || (this.fromMaterials(store.doc) ? FROM_MATERIALS : '');
		if (prompt === '' || this.asking) return;
		const previous = this.draft;
		const current = previous === null ? undefined : toOutline(previous, 'all');
		const place = validPlace(store.doc, moveTo ?? this.place);
		const request = buildOutlineRequest(
			store.doc,
			place,
			prompt,
			current === undefined ? undefined : { current, original: previous?.original ?? '' },
			materials.sections
		);
		// A finished batch is over once the teacher asks for something else.
		this.#clearFinished();
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
				building = { ...emptyDraft(event.scope, this.#key), place };
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
			if (fresh && !some) {
				this.draft = null;
				this.namesWanted = 0;
			}
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
	 * outline on screen, at least one file has been read, and the course has nothing of the
	 * teacher's yet. In a course with content it would propose the same course again.
	 */
	fromMaterials(doc: CourseV2): boolean {
		return this.draft === null && materials.files.length > 0 && hasNoContent(doc);
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
		if (this.draft === null || this.asking) return;
		// Nothing goes in without its name: the teacher names those rows, or unticks them.
		if (unnamedTicked(this.draft)) {
			this.namesWanted++;
			return;
		}
		const ticked = toOutline(this.draft, 'ticked');
		if (ticked === undefined) return;
		const outline = fitToPlace(store.doc, ticked, this.place);
		// The request that made a course structure is kept on the course for the cards' dossier.
		const request = outline.scope === 'lessons' ? this.draft?.original : undefined;
		// Where the teacher chose; a lesson or card deleted meanwhile falls back (`validPlace`).
		const before = new Set(store.doc.lessons.map((l) => l.lesson_id));
		const at = insertAtOf(store.doc, this.place, outline.scope);
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
		this.namesWanted = 0;
		this.forget();
		this.problem = '';
		// The next proposal goes to the default place again, not to this one's.
		this.#place = DEFAULT_PLACE;
		this.landed = {
			lessonIds: store.doc.lessons.map((l) => l.lesson_id).filter((id) => !before.has(id)),
			blockIds: added.map((c) => c.blockId),
			stamp: (this.landed?.stamp ?? 0) + 1
		};
		// The cards wait for the plan, and before it, when the materials are too long for a
		// card to get them all, for the model to name the sources of the cards with none.
		const sections = materials.sections;
		const unsourced = sourcesWanted(sections) ? cardsWithoutSources(store.doc, added) : [];
		this.#owner = store.doc.course_id;
		this.#plan = null;
		this.queue.start(
			added,
			added.map((c) => c.blockId)
		);
		this.#save();
		void this.#prepare(store, added, unsourced, sections);
	}

	/** Sources where they are missing, then the plan; then the cards are written. */
	async #prepare(
		store: DocStore,
		added: { blockId: string; lessonId: string }[],
		unsourced: { blockId: string; lessonId: string }[],
		sections: typeof materials.sections
	): Promise<void> {
		const course = store.doc.course_id;
		try {
			if (unsourced.length > 0) await this.#source(store, unsourced, sections);
			if (store.doc.course_id !== course) return;
			this.planning = true;
			await this.#makePlan(store, added, sections);
		} finally {
			if (this.#course === course || this.#course === null) this.planning = false;
			// Not the cards of another course that share these ids.
			if (this.#owner === course) this.queue.release(added.map((c) => c.blockId));
		}
	}

	/**
	 * The plan, kept in the document where the teacher left a field empty, without an
	 * undo step of its own (`DocStore.amend`): an undo of the insert takes it with the cards.
	 * When it cannot be made the cards are written without it.
	 */
	async #makePlan(
		store: DocStore,
		added: { blockId: string; lessonId: string }[],
		sections: typeof materials.sections
	): Promise<void> {
		const course = store.doc.course_id;
		const built = buildPlanRequest(
			store.doc,
			added,
			buildDossier(store.doc, undefined, added[0]?.lessonId),
			renderMaterials(sections, { for: 'outline' }),
			picturesFor(sections, { for: 'outline' })
		);
		if (built === undefined) return;
		// Stopped while the sources were named: no plan is asked for.
		if (!this.queue.running) return;
		const abort = new AbortController();
		this.#planAbort = abort;
		const answer = await askPlan(built.request, abort.signal).catch(() => undefined);
		if (this.#planAbort === abort) this.#planAbort = null;
		// Stopped meanwhile: the teacher asked for nothing more to be written, the plan too.
		if (abort.signal.aborted || !this.queue.running) return;
		if (answer === undefined || 'problem' in answer || store.doc.course_id !== course) return;
		store.amend((doc) => applyPlan(doc, answer.plan, built.targets));
		this.#plan = {
			course,
			request: built.request,
			turn: answer.turn,
			...(answer.seal !== undefined ? { seal: answer.seal } : {}),
			targets: built.targets
		};
		this.#save();
	}

	/**
	 * Name the sources of `cards` and keep them on the cards as if they had come with them
	 * (no undo step of their own, `DocStore.amend`). When that fails they are written
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
		}
	}

	stop() {
		this.queue.stop();
		this.#planAbort?.abort();
	}

	/** „Dopsat zbytek“. */
	resume(store: DocStore) {
		this.#store = store;
		this.queue.resume();
	}

	/** The queue's rows, once every card is written, are done with. */
	#clearFinished(): void {
		if (this.queue.writing || this.queue.rest.length > 0) return;
		this.queue.clear();
		this.#save();
	}
}

export const aiPanel = new AiPanel();
