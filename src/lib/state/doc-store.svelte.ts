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
import { isFeedbackRef } from '$lib/ui/fields';
import { fieldKey, heldBack, isVisible, issueKey } from '$lib/ui/issue-visibility';
import type { Issue } from '$lib/domain/validate';

export interface UndoEntry {
	description: string;
	before: CourseV2;
	after: CourseV2;
	ref?: Ref;
}

/** The editing modes live with the field table that defines them. */
export type { Mode } from '$lib/ui/fields';

const MAX_UNDO = 200;

/** What `DocStore.open` resolves the selection to. */
export interface OpenState {
	lesson: CourseV2['lessons'][number] | undefined;
	card: CourseV2['blocks'][number] | undefined;
	/** The card's entry in the open lesson's block list. */
	binding: CourseV2['lessons'][number]['blocks'][number] | undefined;
	/** A card in no lesson at all. */
	orphaned: boolean;
	/** 1-based place of the card in the open lesson; undefined when it is not in it. */
	position: number | undefined;
}

export function resolveOpen(doc: CourseV2, index: DocIndex, selection: Ref | null): OpenState {
	let lesson: OpenState['lesson'];
	const owner =
		selection?.blockId !== undefined
			? (index.lessonsByBlock.get(selection.blockId) ?? [])[0]
			: undefined;
	if (selection?.lessonId !== undefined) {
		lesson = doc.lessons.find((l) => l.lesson_id === selection.lessonId);
	} else if (owner !== undefined) {
		lesson = doc.lessons.find((l) => l.lesson_id === owner);
	} else if (
		selection?.blockId !== undefined &&
		doc.blocks.some((b) => b.block_id === selection.blockId)
	) {
		// A card in no lesson at all. Belonging to the first lesson would be a lie.
		lesson = undefined;
	} else {
		lesson = doc.lessons[0];
	}
	const selected =
		selection?.blockId !== undefined
			? doc.blocks.find((b) => b.block_id === selection.blockId)
			: undefined;
	const card =
		selected ??
		(lesson !== undefined
			? doc.blocks.find((b) => b.block_id === lesson.blocks[0]?.block_id)
			: undefined);
	const binding =
		card === undefined ? undefined : lesson?.blocks.find((b) => b.block_id === card.block_id);
	const orphaned =
		card !== undefined && (index.lessonsByBlock.get(card.block_id) ?? []).length === 0;
	const i = binding === undefined || lesson === undefined ? -1 : lesson.blocks.indexOf(binding);
	return { lesson, card, binding, orphaned, position: i < 0 ? undefined : i + 1 };
}

export class DocStore {
	/** The course as exported: one block per question. */
	source = $state<CourseV2>(emptyCourse('NEW', 'Nový kurz'));
	skillConfig = $state<SkillConfig | null>(null);
	#mode = $state<Mode>('teacher');
	#selection = $state<Ref | null>(null);
	#showFeedback = $state(true);

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
		const left = this.#selection?.blockId;
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

	#shown = (issue: Issue) =>
		isVisible(issue, { cards: this.touchedCards, fields: this.touchedFields }, this.#reviewed);

	/**
	 * The issues the editor lists while the author is writing: every error, and the
	 * warnings that are not about a field the Zpětná vazba toggle has hidden
	 * (`heldBack`). The topbar count and the validation panel read this; the export
	 * review and the banner read `validation`, which is all of them.
	 */
	listed = $derived({
		errors: this.validation.errors,
		warnings: this.validation.warnings.filter((issue) => !heldBack(issue, this.#showFeedback))
	});

	/**
	 * The issues that may be on screen right now. Inline markers read this: what is
	 * listed, and then only once its timing allows (`ui/issue-visibility.ts`).
	 */
	shown = $derived({
		errors: this.listed.errors.filter(this.#shown),
		warnings: this.listed.warnings.filter(this.#shown)
	});

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
		this.#reserve(next);
		const last = this.#undo.at(-1);
		if (this.#edit?.entry && last === this.#edit.entry) {
			const entry = { ...last, after: result.doc };
			this.#undo = [...this.#undo.slice(0, -1), entry];
			this.#edit.entry = this.#undo.at(-1);
		} else {
			this.#undo = [
				...this.#undo,
				{
					description: result.description,
					before,
					after: result.doc,
					ref: result.ref
				}
			].slice(-MAX_UNDO);
			if (this.#edit) this.#edit.entry = this.#undo.at(-1);
		}
		this.#redo = [];
		this.dirty = true;
		if (result.ref !== undefined) this.selection = this.#inSameLesson(result.ref);
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
		const lessonId = this.#selection?.lessonId;
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
		const matches = (issue: { ref: Ref }) => {
			let matrix = [0, 0, 0, 0, 0];
			if (ref.lessonId) matrix[0] = ref.lessonId === issue.ref.lessonId ? 1 : -1;
			if (ref.blockId) matrix[1] = ref.blockId === issue.ref.blockId ? 1 : -1;
			if (ref.stepId) matrix[2] = ref.stepId === issue.ref.stepId ? 1 : -1;
			if (ref.optionId) matrix[3] = ref.optionId === issue.ref.optionId ? 1 : -1;
			if (ref.field) matrix[4] = ref.field === issue.ref.field ? 1 : -1;

			if (matrix.some((x) => x === -1)) return false;
			return matrix.some((x) => x === 1);
		};

		return {
			errors: this.shown.errors.filter(matches),
			warnings: this.shown.warnings.filter(matches)
		};
	}

	/** The document as it would be published or downloaded. */
	export(): Record<string, unknown> {
		return serialise(this.source);
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
