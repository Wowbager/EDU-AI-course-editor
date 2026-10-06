/**
 * The document store: one parsed `CourseV2`, its derived index, its validation, and
 * an undo log. Every mutation goes through `apply`, which runs a command, records the
 * change and re-derives everything downstream (plan §4).
 *
 * Two documents live here. `source` is the course as it is exported, saved and
 * played, with every question in its own block. `doc` is what the editor shows and
 * edits: in the Učitel and Metodik modes the blocks of one question card merged into
 * the card the teacher wrote (`domain/groups.ts`); in Pokročilý the source itself.
 * `apply` runs a command on `doc` and writes the result back into `source`. Undo,
 * drafts, versions, export and the player all work on `source`.
 *
 * The store also owns the id reservations: the set of block, lesson and step ids this
 * session has handed out, including for things since deleted. The document cannot
 * remember them, and reusing one would hand a new step a deleted step's student
 * answers (§3 invariants 1 and 2).
 */
import type { CourseV2 } from '$lib/domain/schema';
import { refKey, type Ref } from '$lib/domain/ref';
import { notANumberMessage, parseNumberDraft, type NumberDraft } from '$lib/domain/number-input';
import { buildIndex, type DocIndex } from '$lib/domain/index-doc';
import { stepReservation, type Reservations } from '$lib/domain/ids';
import { validate, type ValidationResult } from '$lib/domain/validate';
import {
	courseVersionState,
	type CourseVersionState,
	type Publication,
	type VersionIndex,
	type VersionMeta
} from '$lib/domain/versions';
import { courseTotals, type CourseTotals } from '$lib/domain/derive';
import { emptyCourse, serialise } from '$lib/domain/document';
import {
	blockOfStep,
	cardIdOf,
	fromView,
	groupOf,
	groupsOf,
	resplitChanged,
	splitQuestionCards,
	toView
} from '$lib/domain/groups';
import type { SkillConfig } from '$lib/domain/skill-config';
import type { CommandResult } from '$lib/domain/commands';
import type { Mode } from '$lib/ui/fields';
import { allows, isFeedbackRef } from '$lib/ui/fields';
import { fieldKey, issueKey, madeUnreachable } from '$lib/ui/issue-visibility';
import { issueSets, matchesRef, shownAt } from '$lib/screen/issues';
import { cutOffText } from '$lib/screen/notices';
import { resolveOpen } from '$lib/screen/open';
import type { DraftStatus, HistoryInput, OpenState, SkillConfigStatus } from '$lib/screen/types';
import { PreviewState } from './preview-state.svelte';
import { ScreenModel } from './screen.svelte';
import { StepView } from './step-view.svelte';
import { UiState } from './ui-state.svelte';
import { AiState } from './ai-state.svelte';

/** Who made a change: the teacher at the keyboard, or the AI agent through a tool. */
export type Origin = 'teacher' | 'ai';

export interface UndoEntry {
	description: string;
	before: CourseV2;
	after: CourseV2;
	ref?: Ref;
	/** Who made the change; the undo list says "AI" for the agent's. */
	origin: Origin;
	/** The AI action this entry is, for `aiActions`; unset for the teacher's edits. */
	actionId?: string;
}

/** What a `transaction` is recorded as. */
export interface TransactionMeta {
	origin: Origin;
	actionId?: string;
	/** Czech; replaces the description of the command(s) in the undo log. */
	description?: string;
}

/** One change the AI made, as the action log and the AI panel list it. */
export interface AiAction {
	actionId: string;
	/** Czech. */
	description: string;
	ref?: Ref;
	revisionBefore: number;
	revisionAfter: number;
	/** Taken back by undo; redo puts it back. */
	undone: boolean;
}

/** What the AI session restores: the course and the ids handed out when it started. */
export interface AiCheckpoint {
	source: CourseV2;
	reservations: { blocks: string[]; lessons: string[]; steps: string[] };
	revision: number;
}

/** The label of the durable version saved before the first AI change of a session. */
export const AI_CHECKPOINT_LABEL = 'Před úpravami AI';

/** The editing modes live with the field table that defines them. */
export type { Mode } from '$lib/ui/fields';

const MAX_UNDO = 200;

export type { DraftStatus, OpenState, SkillConfigStatus };
export { resolveOpen };

/** What the store reads of the `VersionStore` it is attached to. */
export interface History {
	index: VersionIndex;
	courseId: string | null;
	loading: boolean;
	versions?: readonly (VersionMeta & { keptIn: string[] })[];
	published?: Publication | null;
	backends?: readonly string[];
	unavailable?: readonly string[];
	dialogOpen?: boolean;
}

export class DocStore {
	/** The course as exported: one block per question. */
	source = $state<CourseV2>(emptyCourse('NEW', 'Nový kurz'));
	#skillConfig = $state.raw<SkillConfig | null>(null);
	#skillStatus = $state<SkillConfigStatus>('loading');
	/**
	 * The course's skill list, and what is known about it. `null` only while it is
	 * `loading` or after it `failed`: a check that needs the list is not run silently
	 * in those states, and the screen says which one it is.
	 */
	get skillConfig(): SkillConfig | null {
		return this.#skillConfig;
	}
	set skillConfig(config: SkillConfig | null) {
		this.#skillConfig = config;
		this.#skillStatus = config === null ? 'failed' : config.is_default ? 'default' : 'loaded';
	}
	get skillConfigStatus(): SkillConfigStatus {
		return this.#skillStatus;
	}

	#mode = $state<Mode>('teacher');
	#selection = $state<Ref | null>(null);
	#showFeedback = $state(true);

	/** Which panels are open (`screen.ui`). */
	ui = new UiState();
	/** The AI assistant's drawer and conversation (`screen.ai`). */
	ai = new AiState();
	/** What the preview column has learned about the player (`screen.preview`). */
	preview = new PreviewState();
	/** Which steps of the open card are folded, and whether one is being dragged (`screen.card`). */
	steps = new StepView();
	/** The autosave of the draft, reported by the `DraftSession`; null before it exists. */
	draftStatus = $state<DraftStatus | null>(null);
	/**
	 * The exact JSON handed to the browser by the last download. The draft lives in
	 * `localStorage` and nowhere else, so the top bar says whether the work on screen
	 * has ever left the browser; comparing the text rather than counting edits is what
	 * makes it honest (type a sentence and undo it, and the file is current again).
	 */
	exportedJson = $state<string | null>(null);

	/**
	 * What the editor shows and edits. In Pokročilý the source; otherwise each
	 * question card as one card. Never assigned: edits go through `apply`.
	 */
	doc = $derived<CourseV2>(this.#mode === 'advanced' ? this.source : toView(this.source));

	/**
	 * The editing mode. Switching between Pokročilý and the others moves the
	 * selection between a card and the block that holds the selected step.
	 */
	get mode(): Mode {
		return this.#mode;
	}
	set mode(next: Mode) {
		if (next !== this.#mode) this.#revision++;
		const ref = this.#selection;
		// Through the source, in the mode being left, then into the new one's view.
		const inSource = ref === null ? null : this.toSource(ref);
		this.#mode = next;
		if (inSource !== null) this.#selection = this.toView(inSource);
	}

	/**
	 * Whether what the pupil is told aside from the question — option feedback, hints,
	 * help, the solution — is on screen (`feedback` in `ui/fields.ts`). A view
	 * preference, like the mode: one flag for the whole course, kept with the draft,
	 * and untouched by `load`.
	 */
	get showFeedback(): boolean {
		return this.#showFeedback;
	}
	set showFeedback(next: boolean) {
		this.#showFeedback = next;
	}

	/**
	 * Switch to `next` and return `ref` — a place in what the editor showed — as the
	 * same place in what it shows now. A jump that changes the mode goes through here,
	 * or it lands on the card instead of the block that holds the step.
	 */
	switchMode(next: Mode, ref: Ref): Ref {
		const inSource = this.toSource(ref);
		this.mode = next;
		return this.toView(inSource);
	}

	/** A ref into the source, for one into what the editor shows. */
	toSource(ref: Ref): Ref {
		if (this.#mode === 'advanced' || ref.blockId === undefined) return ref;
		return {
			...ref,
			blockId: blockOfStep(this.source, ref.blockId, ref.stepId)
		};
	}

	/**
	 * A ref into what the editor shows, for one into the source — what the player
	 * reports is always the source's.
	 */
	toView(ref: Ref): Ref {
		if (this.#mode === 'advanced' || ref.blockId === undefined) return ref;
		return { ...ref, blockId: cardIdOf(this.source, ref.blockId) };
	}

	/**
	 * What is selected. Setting it is also how the store learns a card was left:
	 * moving to another card marks the previous one as touched, which is when its
	 * unfinished content may start showing as such (`ui/issue-visibility.ts`).
	 * Selection moves on every edit too, so "left" means the card changed, not the ref.
	 */
	get selection(): Ref | null {
		return this.#selection;
	}
	set selection(ref: Ref | null) {
		// The card that was open, which is not always the one the ref names: a selection
		// of only a lesson opens its first card.
		const left = this.#selection?.blockId ?? this.open.card?.block_id;
		if (left !== undefined && left !== ref?.blockId) this.touchCard(left);
		this.#selection = ref;
	}

	/**
	 * Text typed into a number field that is not a number, by `refKey` of the field.
	 * It never reaches the document (NaN would export as `null`); the field shows it
	 * with an error under it, and it is dropped when a valid number is typed, on
	 * Escape, on undo/redo and on `load`.
	 */
	drafts = $state<Readonly<Record<string, string>>>({});

	/** What the number field at `ref` has been typed, if that is not a number. */
	draftAt(ref: Ref): string | undefined {
		return this.drafts[refKey(ref)];
	}

	/** The Czech line under a number field whose text is not a number. */
	draftErrorAt(ref: Ref): string | undefined {
		const text = this.draftAt(ref);
		return text === undefined ? undefined : notANumberMessage(text);
	}

	/**
	 * A number field was typed into. Returns what the text means; the caller writes
	 * the value only for `ok` and `empty`. Unreadable text is kept as a draft instead.
	 */
	enterNumber(ref: Ref, raw: string | undefined): NumberDraft {
		const parsed = parseNumberDraft(raw);
		const key = refKey(ref);
		if (parsed.status === 'invalid') {
			this.drafts = { ...this.drafts, [key]: parsed.text };
		} else this.discardDraft(ref);
		return parsed;
	}

	discardDraft(ref: Ref) {
		const key = refKey(ref);
		if (!(key in this.drafts)) return;
		const { [key]: _gone, ...rest } = this.drafts;
		this.drafts = rest;
	}

	/** Cards the author has left and fields they have blurred, this session. */
	touchedCards = $state<ReadonlySet<string>>(new Set());
	/** A card and its blocks count as one: leaving it in either mode leaves both. */
	#related(blockId: string): string[] {
		const card = cardIdOf(this.source, blockId);
		const members = groupsOf(this.source).get(card) ?? [];
		return [card, blockId, ...members.map((m) => m.block_id)];
	}
	touchedFields = $state<ReadonlySet<string>>(new Set());

	/**
	 * The issues the export review listed when the author opened it (`issueKey`s),
	 * or null while there is no review to act on. Those show inline from then on:
	 * the author is fixing them now, not writing. A problem that arises afterwards
	 * keeps its own timing, so a card added mid-review is not red at birth. Cleared
	 * by a download and by `load`.
	 */
	#reviewed = $state<ReadonlySet<string> | null>(null);

	/** Whether the author has looked at the review and not yet exported. */
	get reviewing(): boolean {
		return this.#reviewed !== null;
	}

	/** The keys of what the review listed, or null while there is none. */
	get reviewedKeys(): ReadonlySet<string> | null {
		return this.#reviewed;
	}

	/** The author opened the export review: what it lists is now to be fixed. */
	beginReview() {
		const { errors, warnings } = this.validation;
		this.#reviewed = new Set([...errors, ...warnings].map(issueKey));
	}

	/** The course went out; what was left over is advice again, not a to-do list. */
	endReview() {
		this.#reviewed = null;
	}

	/**
	 * Bumped when the selection came from somewhere the author was not looking — a
	 * click in the preview, a jump from the validation panel. The editor scrolls to
	 * the target only then, so that ordinary typing (which also moves the selection)
	 * never yanks the page around.
	 */
	reveal = $state(0);

	/** The version last published, for the "not bumped" warning and the publish diff. */
	lastPublished = $state<{ version: number; doc: CourseV2 } | null>(null);
	dirty = $state(false);

	#undo = $state<UndoEntry[]>([]);
	#redo = $state<UndoEntry[]>([]);

	#reservedBlocks = new Set<string>();
	#reservedLessons = new Set<string>();
	#reservedSteps = new Set<string>();

	#revision = $state(0);
	/**
	 * Counts every change to what an agent could have read: the document (an edit, undo,
	 * redo, a load) and the mode, which changes the view's cards. It only grows. An AI
	 * write names the revision it read (`expected_revision`) and is refused when this has
	 * moved, so it never overwrites what the teacher did in the meantime.
	 */
	get revision(): number {
		return this.#revision;
	}

	index = $derived<DocIndex>(buildIndex(this.doc));

	/**
	 * What is open in the editor column and the preview: the one place the selection
	 * is resolved. A ref does not always carry a `lessonId` (`setField` answers with
	 * one addressed at the block; a click in the preview reports what it can see), so
	 * the lesson comes from the selected card when the ref is silent, and only then
	 * from the first lesson. A card is always open when the course has one: with no
	 * (or a stale) selection it is the lesson's first card. A card in no lesson is
	 * `orphaned`: editable, but the student never reaches it.
	 */
	open = $derived<OpenState>(resolveOpen(this.doc, this.index, this.#selection));
	validation = $derived<ValidationResult>(
		validate(this.doc, this.skillConfig, {
			lastPublishedVersion: this.lastPublished?.version
		})
	);
	totals = $derived<CourseTotals>(courseTotals(this.doc, this.index));
	/** Errors block export; warnings never do (§3 invariant 5). */
	canPublish = $derived(this.validation.errors.length === 0);

	get undoStack(): readonly UndoEntry[] {
		return this.#undo;
	}
	get canUndo(): boolean {
		return this.#undo.length > 0;
	}
	get canRedo(): boolean {
		return this.#redo.length > 0;
	}

	/**
	 * Ids already handed out. Step ids are reserved under each block and, for a
	 * question card, under the card too, since the view mints them per card.
	 */
	get reservations(): Reservations {
		return {
			blocks: this.#reservedBlocks,
			lessons: this.#reservedLessons,
			steps: this.#reservedSteps
		};
	}

	/** Replace the document wholesale — a new course, or an import. */
	load(doc: CourseV2, options: { published?: { version: number; doc: CourseV2 } } = {}) {
		this.endEdit();
		this.source = doc;
		this.#revision++;
		this.#aiSession = null;
		this.aiActions = [];
		this.#undo = [];
		this.#redo = [];
		this.#reservedBlocks = new Set();
		this.#reservedLessons = new Set();
		this.#reservedSteps = new Set();
		this.#reserve(doc);
		this.selection = null;
		this.dirty = false;
		this.lastPublished = options.published ?? null;
		this.touchedCards = new Set();
		this.touchedFields = new Set();
		this.#reviewed = null;
		this.drafts = {};
		// The list belongs to the course that was open; the page asks for the new one's.
		this.#skillConfig = null;
		this.#skillStatus = 'loading';
	}

	touchCard(blockId: string) {
		const ids = this.#related(blockId);
		if (ids.every((id) => this.touchedCards.has(id))) return;
		this.touchedCards = new Set([...this.touchedCards, ...ids]);
	}

	touchField(ref: Ref) {
		const key = fieldKey(ref);
		if (this.touchedFields.has(key)) return;
		this.touchedFields = new Set([...this.touchedFields, key]);
	}

	/**
	 * The issues the editor lists and shows (`screen/issues.ts` `issueSets`). `listed`:
	 * every error, and the warnings not held back by the Zpětná vazba toggle; the topbar
	 * count and the validation panel read it, the export review and the banner read
	 * `validation`, which is all of them. `shown`: what may be marked inline right now,
	 * once its timing allows (`ui/issue-visibility.ts`).
	 */
	#sets = $derived(
		issueSets(
			this.validation,
			this.#showFeedback,
			{ cards: this.touchedCards, fields: this.touchedFields },
			this.#reviewed
		)
	);
	listed = $derived(this.#sets.listed);
	shown = $derived(this.#sets.shown);

	/** Whether the file on disk is what is on screen. */
	backedUp = $derived(this.exportedJson !== null && this.exportedJson === this.exportJson());

	/**
	 * What the last change to an answer's "Kam dál" cut off, said under that answer
	 * while the change is the last edit (`screen.notices.cut_off`).
	 */
	cutOff = $state.raw<{ entry: UndoEntry; optionId: string; text: string } | null>(null);

	/**
	 * Run `change` (a `store.apply` on an answer's "Kam dál", or removing the answer)
	 * and, if it left a step or card unreachable that was reachable, remember it as the
	 * notice under that answer. `optionId` is empty for a removed answer, which has no
	 * row left. The next edit of any kind clears it, so its "Vrátit zpět" can only ever
	 * undo this change.
	 */
	trackReach(optionId: string, change: () => void) {
		const before = this.doc;
		const top = this.undoStack.at(-1);
		change();
		const entry = this.undoStack.at(-1);
		this.cutOff = null;
		if (entry === undefined || entry === top) return;
		const lost = madeUnreachable(before, this.doc);
		if (lost.length === 0) return;
		const text = cutOffText(this.doc, lost, allows('step', 'id', this.#mode));
		if (text !== null) this.cutOff = { entry, optionId, text };
	}

	/** The file went out: remember what it held. */
	markExported(json: string) {
		this.exportedJson = json;
	}

	/** The screen model: what the teacher sees, as data (`$lib/screen`). */
	screen = new ScreenModel(this);

	/**
	 * Run a command and record it. The command is given the document and the current
	 * reservations; anything it throws reaches the caller unchanged, so the UI can
	 * show a `CommandError` (for instance "this step still has branches pointing at
	 * it") without the store having half-applied it.
	 */
	apply(command: (doc: CourseV2, reserved: Reservations) => CommandResult): CommandResult {
		const view = this.doc;
		const result = command(view, this.reservations);
		if (result.doc === view) return result;
		// Pokročilý edits the source directly; a card it touched is split again,
		// so a question added there gets its own block like anywhere else.
		const next =
			this.#mode === 'advanced'
				? resplitChanged(this.source, result.doc, this.reservations)
				: fromView(this.source, view, result.doc, this.reservations);
		return this.#record(result, next);
	}

	/**
	 * Run a command on the source itself — for what only makes sense there: splitting
	 * an imported course, restoring a saved version, the advanced author's toggle.
	 * Its `ref`, if any, is the source's and is shown as the view's.
	 */
	applySource(command: (doc: CourseV2, reserved: Reservations) => CommandResult): CommandResult {
		const result = command(this.source, this.reservations);
		if (result.doc === this.source) return result;
		const ref = result.ref === undefined ? undefined : result.ref;
		const recorded = this.#record({ ...result, ref: undefined }, result.doc);
		if (ref !== undefined) this.selection = this.toView(ref);
		return recorded;
	}

	/**
	 * Give every question of the course its own block, as the teacher's view would
	 * have written it (`splitQuestionCards`). Run after an import, a restored draft
	 * or a restored version, so a course from elsewhere plays each question as its
	 * own card too. It is an ordinary undoable edit. Returns what it did.
	 */
	splitQuestions(): { split: string[]; keptTogether: string[] } {
		let outcome = { split: [] as string[], keptTogether: [] as string[] };
		this.applySource((doc, reserved) => {
			const result = splitQuestionCards(doc, reserved);
			outcome = { split: result.split, keptTogether: result.keptTogether };
			return {
				doc: result.doc,
				description: 'Otázky rozděleny do samostatných karet'
			};
		});
		return outcome;
	}

	#record(result: CommandResult, next: CourseV2): CommandResult {
		const before = this.source;
		if (next === before) return result;
		this.source = next;
		this.#revision++;
		this.#reserve(next);
		const last = this.#undo.at(-1);
		if (this.#edit?.entry && last === this.#edit.entry) {
			const entry = {
				...last,
				after: next,
				ref: this.#tx !== undefined ? (result.ref ?? last.ref) : last.ref
			};
			this.#undo = [...this.#undo.slice(0, -1), entry];
			this.#edit.entry = this.#undo.at(-1);
		} else {
			this.#undo = [
				...this.#undo,
				{
					description: result.description,
					before,
					after: next,
					ref: result.ref,
					origin: this.#tx?.meta.origin ?? 'teacher',
					actionId: this.#tx?.actionId
				}
			].slice(-MAX_UNDO);
			if (this.#edit) this.#edit.entry = this.#undo.at(-1);
		}
		this.#redo = [];
		this.dirty = true;
		if (result.ref !== undefined) {
			const ref = this.#inSameLesson(result.ref);
			// The agent's edit brings its card into view without counting the card the
			// teacher was on as left: that would paint their unfinished cards red.
			if (this.#tx?.meta.origin === 'ai') this.follow(ref);
			else this.selection = ref;
		}
		return result;
	}

	/**
	 * A ref from a command or an undo entry addresses a card and does not say which
	 * of its lessons it was reached through (`setField` returns the ref it was
	 * given, and entries are recorded that way). Taken as it is, editing a card two
	 * lessons share would move the screen to the first of them. Keep the lesson
	 * being worked in while it still holds the card.
	 */
	#inSameLesson(ref: Ref): Ref {
		const lessonId = this.open.lesson?.lesson_id;
		if (ref.lessonId !== undefined || ref.blockId === undefined || lessonId === undefined) {
			return ref;
		}
		const owners = this.index.lessonsByBlock.get(ref.blockId) ?? [];
		return owners.includes(lessonId) ? { ...ref, lessonId } : ref;
	}

	undo() {
		this.endEdit();
		const entry = this.#undo.at(-1);
		if (entry === undefined) return;
		this.#undo = this.#undo.slice(0, -1);
		this.#redo = [...this.#redo, entry];
		this.drafts = {};
		this.source = entry.before;
		this.#revision++;
		this.#markUndone(entry, true);
		this.dirty = true;
		if (entry.ref !== undefined) this.selection = this.#inSameLesson(entry.ref);
	}

	redo() {
		this.endEdit();
		const entry = this.#redo.at(-1);
		if (entry === undefined) return;
		this.#redo = this.#redo.slice(0, -1);
		this.#undo = [...this.#undo, entry];
		this.drafts = {};
		this.source = entry.after;
		this.#revision++;
		this.#markUndone(entry, false);
		this.#reserve(entry.after);
		this.dirty = true;
		if (entry.ref !== undefined) this.selection = this.#inSameLesson(entry.ref);
	}

	/**
	 * Groups the keystrokes of one editing session into a single undo entry.
	 *
	 * A field commits on every input (so drafts persist before blur), which would
	 * otherwise push one undo entry per character. The field opens the session on
	 * focus and closes it on blur or Enter; a session that nets out to no change —
	 * the author typed and pressed Escape — leaves no entry behind at all.
	 */
	#edit?: { before: CourseV2; entry?: UndoEntry };

	beginEdit() {
		this.endEdit();
		this.#edit = { before: this.source };
	}

	endEdit() {
		const edit = this.#edit;
		this.#edit = undefined;
		if (!edit?.entry || this.#undo.at(-1) !== edit.entry) return;
		if (JSON.stringify(edit.before) === JSON.stringify(this.source)) {
			this.#undo = this.#undo.slice(0, -1);
		}
	}

	// ───────────────────────────── transactions and the AI session ─────────────────────────────

	#tx?: { meta: TransactionMeta; actionId: string | undefined };
	#actionCounter = 0;
	#aiSession: AiCheckpoint | null = null;

	/** What the AI has done this session, oldest first; `load` and a revert empty it. */
	aiActions = $state<readonly AiAction[]>([]);

	/**
	 * Saves the course as it was before the AI's first change of a session, as one
	 * durable version named `AI_CHECKPOINT_LABEL`. Injected because the `VersionStore`
	 * lives outside this class; called only when the course has unsaved work, and a
	 * failure never stops the change.
	 */
	onBeforeAiSession: ((source: CourseV2, label: string) => void | Promise<void>) | null = null;

	/** Whether an AI session has begun, so that `revertAiSession` has something to restore. */
	get hasAiSession(): boolean {
		return this.#aiSession !== null;
	}

	/**
	 * Run `fn` — any number of `apply` calls — as one change: exactly one undo entry
	 * (carrying `origin` and `actionId`), or none when it nets out to no change. If `fn`
	 * throws, the document, the undo log, the reservations and the selection are put back
	 * as they were and the error reaches the caller, so a batch is all or nothing. A
	 * transaction inside another joins it. Synchronous on purpose: nothing else can edit
	 * between its first and last command.
	 */
	transaction<T>(fn: () => T, meta: TransactionMeta): T {
		if (this.#tx !== undefined) return fn();
		this.endEdit();
		const saved = {
			source: this.source,
			undo: this.#undo,
			redo: this.#redo,
			selection: this.#selection,
			dirty: this.dirty,
			revision: this.#revision,
			drafts: this.drafts,
			session: this.#aiSession,
			reserved: {
				blocks: new Set(this.#reservedBlocks),
				lessons: new Set(this.#reservedLessons),
				steps: new Set(this.#reservedSteps)
			}
		};
		const actionId =
			meta.actionId ?? (meta.origin === 'ai' ? `ai-${++this.#actionCounter}` : undefined);
		this.#tx = { meta, actionId };
		this.#edit = { before: this.source };
		let result: T;
		try {
			result = fn();
		} catch (error) {
			this.source = saved.source;
			this.#undo = saved.undo;
			this.#redo = saved.redo;
			this.#selection = saved.selection;
			this.dirty = saved.dirty;
			this.#revision = saved.revision;
			this.drafts = saved.drafts;
			this.#aiSession = saved.session;
			this.#reservedBlocks = saved.reserved.blocks;
			this.#reservedLessons = saved.reserved.lessons;
			this.#reservedSteps = saved.reserved.steps;
			this.#edit = undefined;
			this.#tx = undefined;
			throw error;
		}
		const edit = this.#edit;
		this.#edit = undefined;
		this.#tx = undefined;
		const entry = edit?.entry;
		if (entry === undefined || this.#undo.at(-1) !== entry) return result;
		if (JSON.stringify(edit?.before) === JSON.stringify(this.source)) {
			// Nets out to nothing: as if it had not run, the revision included.
			this.source = saved.source;
			this.#undo = saved.undo;
			this.#redo = saved.redo;
			this.dirty = saved.dirty;
			this.#revision = saved.revision;
			return result;
		}
		if (meta.origin === 'ai') {
			this.#startSession(saved.source, saved.reserved, saved.revision, saved.dirty);
		}
		const named = { ...entry, description: meta.description ?? entry.description };
		this.#undo = [...this.#undo.slice(0, -1), named];
		if (meta.origin === 'ai' && actionId !== undefined) {
			this.aiActions = [
				...this.aiActions,
				{
					actionId,
					description: named.description,
					ref: named.ref,
					revisionBefore: saved.revision,
					revisionAfter: this.#revision,
					undone: false
				}
			];
		}
		return result;
	}

	/**
	 * Remember the course and the ids handed out, now, if no session has begun
	 * (`transaction` does it for the first AI change, from the course as it was before
	 * that change). `revertAiSession` restores it. Returns whether it began one.
	 */
	beginAiSession(): boolean {
		return this.#startSession(
			this.source,
			{
				blocks: this.#reservedBlocks,
				lessons: this.#reservedLessons,
				steps: this.#reservedSteps
			},
			this.#revision,
			this.dirty
		);
	}

	/**
	 * Saves the course as it was first, as one durable version (`onBeforeAiSession`),
	 * only when it has unsaved work; a version that cannot be saved never stops the change.
	 */
	#startSession(
		source: CourseV2,
		reserved: { blocks: Set<string>; lessons: Set<string>; steps: Set<string> },
		revision: number,
		dirty: boolean
	): boolean {
		if (this.#aiSession !== null) return false;
		this.#aiSession = {
			source,
			reservations: {
				blocks: [...reserved.blocks],
				lessons: [...reserved.lessons],
				steps: [...reserved.steps]
			},
			revision
		};
		const hook = this.onBeforeAiSession;
		if (hook !== null && dirty) {
			try {
				Promise.resolve(hook(source, AI_CHECKPOINT_LABEL)).catch(() => {});
			} catch {
				// Not saved; the change goes on.
			}
		}
		return true;
	}

	/**
	 * Put the course back as it was when the AI session began, as one ordinary undoable
	 * entry (like restoring a version): the teacher's own edits since then go too, and
	 * "Zpět" brings everything back. The ids handed out since stay reserved, because an
	 * id is never given twice (§3 invariants 1 and 2). The session and its log end.
	 * Returns false when there is no session or nothing differs.
	 */
	revertAiSession(): boolean {
		const session = this.#aiSession;
		if (session === null) return false;
		this.endEdit();
		this.#aiSession = null;
		this.aiActions = [];
		if (session.source === this.source) return false;
		this.applySource(() => ({ doc: session.source, description: 'Vráceny změny AI' }));
		return true;
	}

	/** The session is over without a revert: the teacher keeps the changes. */
	endAiSession() {
		this.#aiSession = null;
		this.aiActions = [];
	}

	/** Undo the last change if the AI made it. Returns that action, or undefined and nothing changed. */
	undoLastAiAction(): AiAction | undefined {
		const entry = this.#undo.at(-1);
		if (entry?.origin !== 'ai') return undefined;
		this.undo();
		return this.aiActions.find((a) => a.actionId === entry.actionId);
	}

	#markUndone(entry: UndoEntry, undone: boolean) {
		if (entry.actionId === undefined) return;
		this.aiActions = this.aiActions.map((a) =>
			a.actionId === entry.actionId ? { ...a, undone } : a
		);
	}

	/** Restore identity reservations, including IDs deleted before a reload. */
	restoreReservations(reserved: { blocks: string[]; lessons: string[]; steps: string[] }) {
		for (const id of reserved.blocks) this.#reservedBlocks.add(id);
		for (const id of reserved.lessons) this.#reservedLessons.add(id);
		for (const id of reserved.steps) this.#reservedSteps.add(id);
	}

	/**
	 * Select something and ask the editor to bring it into view. A jump onto a
	 * feedback field turns feedback back on, first: there is nothing to scroll to in
	 * a field that is not drawn, and it stays on, because the teacher asked to go
	 * there. Following a played run does not.
	 */
	revealAt(ref: Ref) {
		if (!this.#showFeedback && isFeedbackRef(ref)) this.#showFeedback = true;
		this.selection = ref;
		this.reveal++;
	}

	/**
	 * Follow a played run: select the step the pupil is on and bring it into view,
	 * without counting the card the run moved off as left. Playing through a lesson
	 * is not finishing its cards, and marking them touched would paint every
	 * unfinished one red behind the author's back (`ui/issue-visibility.ts`).
	 */
	follow(ref: Ref) {
		this.#selection = ref;
		this.reveal++;
	}

	/** Shown issues addressed at a given place — what the inline markers show. */
	issuesAt(ref: Ref) {
		return shownAt(this.shown, ref);
	}

	/**
	 * The same, as the model's own items: `index` is the place in `screen.issues.items`
	 * that draws it (`data-screen="issues.items[index].message"`).
	 */
	markersAt(ref: Ref): { index: number; severity: 'error' | 'warning'; message: string }[] {
		return this.screen.issues.items.flatMap((item, index) =>
			item.visibility === 'shown' && matchesRef(item.ref, ref)
				? [{ index, severity: item.severity, message: item.message }]
				: []
		);
	}

	/**
	 * The version history this store's course is read against. It is read, never
	 * written, here: the `VersionStore` owns loading and saving.
	 */
	#history = $state.raw<History | null>(null);

	attachHistory(history: History) {
		this.#history = history;
	}

	/** The history as plain data, for the screen model; null before one is attached. */
	get historyInput(): HistoryInput | null {
		const h = this.#history;
		if (h === null || h.versions === undefined) return null;
		return {
			index: h.index,
			versions: h.versions.map((v) => ({ ...v })),
			published: h.published ?? null,
			backends: h.backends ?? [],
			unavailable: h.unavailable ?? [],
			loading: h.loading,
			dialogOpen: h.dialogOpen ?? false
		};
	}

	/**
	 * Which version the working copy is and what the top bar says about it. Not
	 * loaded until the history of *this* course has been read.
	 */
	versionState = $derived<CourseVersionState>(
		courseVersionState(
			this.#history?.index ?? { courseId: '', versions: [] },
			$state.snapshot(this.source) as CourseV2,
			this.#history !== null &&
				this.#history.courseId === this.source.course_id &&
				!this.#history.loading
		)
	);

	/**
	 * The document as it is downloaded: the course as exported, carrying the number it
	 * will be saved as. While the history loads the number is not known, and the
	 * document keeps the one it has; `versionState.loaded` says whether to trust it.
	 */
	export(): Record<string, unknown> {
		const { next } = this.versionState;
		return serialise(next === undefined ? this.source : { ...this.source, version: next });
	}

	/** `export()` as the text of the file. */
	exportJson(): string {
		return JSON.stringify(this.export(), null, 2);
	}

	#reserve(doc: CourseV2) {
		for (const lesson of doc.lessons) this.#reservedLessons.add(lesson.lesson_id);
		for (const block of doc.blocks) {
			this.#reservedBlocks.add(block.block_id);
			const card = groupOf(block);
			if (card !== undefined) this.#reservedBlocks.add(card);
			for (const step of block.steps) {
				this.#reservedSteps.add(stepReservation(block.block_id, step.id));
				if (card !== undefined) this.#reservedSteps.add(stepReservation(card, step.id));
			}
		}
	}
}
