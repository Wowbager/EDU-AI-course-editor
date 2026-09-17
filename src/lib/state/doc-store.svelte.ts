/**
 * The document store: one parsed `CourseV2`, its derived index, its validation, and
 * an undo log. Every mutation goes through `apply`, which runs a command, records the
 * change and re-derives everything downstream (plan §4).
 *
 * The store also owns the id reservations: the set of block, lesson and step ids this
 * session has handed out, including for things since deleted. The document cannot
 * remember them, and reusing one would hand a new step a deleted step's student
 * answers (§3 invariants 1 and 2).
 */
import type { CourseV2 } from '$lib/domain/schema';
import type { Ref } from '$lib/domain/ref';
import { buildIndex, type DocIndex } from '$lib/domain/index-doc';
import { stepReservation, type Reservations } from '$lib/domain/ids';
import { validate, type ValidationResult } from '$lib/domain/validate';
import { courseTotals, type CourseTotals } from '$lib/domain/derive';
import { emptyCourse, serialise } from '$lib/domain/document';
import type { SkillConfig } from '$lib/domain/skill-config';
import type { CommandResult } from '$lib/domain/commands';
import type { Mode } from '$lib/ui/fields';

export interface UndoEntry {
	description: string;
	before: CourseV2;
	after: CourseV2;
	ref?: Ref;
}

/** The editing modes live with the field table that defines them. */
export type { Mode } from '$lib/ui/fields';

const MAX_UNDO = 200;

export class DocStore {
	doc = $state<CourseV2>(emptyCourse('NEW', 'Nový kurz'));
	skillConfig = $state<SkillConfig | null>(null);
	mode = $state<Mode>('teacher');
	selection = $state<Ref | null>(null);

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
	validation = $derived<ValidationResult>(
		validate(this.doc, this.skillConfig, { lastPublishedVersion: this.lastPublished?.version })
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

	get reservations(): Reservations {
		return { blocks: this.#reservedBlocks, lessons: this.#reservedLessons, steps: this.#reservedSteps };
	}

	/** Replace the document wholesale — a new course, or an import. */
	load(doc: CourseV2, options: { published?: { version: number; doc: CourseV2 } } = {}) {
		this.doc = doc;
		this.#undo = [];
		this.#redo = [];
		this.#reservedBlocks = new Set();
		this.#reservedLessons = new Set();
		this.#reservedSteps = new Set();
		this.#reserve(doc);
		this.selection = null;
		this.dirty = false;
		this.lastPublished = options.published ?? null;
	}

	/**
	 * Run a command and record it. The command is given the document and the current
	 * reservations; anything it throws reaches the caller unchanged, so the UI can
	 * show a `CommandError` (for instance "this step still has branches pointing at
	 * it") without the store having half-applied it.
	 */
	apply(command: (doc: CourseV2, reserved: Reservations) => CommandResult): CommandResult {
		const before = this.doc;
		const result = command(before, this.reservations);
		if (result.doc === before) return result;

		this.doc = result.doc;
		this.#reserve(result.doc);
		this.#undo = [...this.#undo, { description: result.description, before, after: result.doc, ref: result.ref }]
			.slice(-MAX_UNDO);
		this.#redo = [];
		this.dirty = true;
		if (result.ref !== undefined) this.selection = result.ref;
		return result;
	}

	undo() {
		const entry = this.#undo.at(-1);
		if (entry === undefined) return;
		this.#undo = this.#undo.slice(0, -1);
		this.#redo = [...this.#redo, entry];
		this.doc = entry.before;
		this.dirty = true;
		if (entry.ref !== undefined) this.selection = entry.ref;
	}

	redo() {
		const entry = this.#redo.at(-1);
		if (entry === undefined) return;
		this.#redo = this.#redo.slice(0, -1);
		this.#undo = [...this.#undo, entry];
		this.doc = entry.after;
		this.#reserve(entry.after);
		this.dirty = true;
		if (entry.ref !== undefined) this.selection = entry.ref;
	}

	/** Select something and ask the editor to bring it into view. */
	revealAt(ref: Ref) {
		this.selection = ref;
		this.reveal++;
	}

	/** Validation issues addressed at a given place — what the inline markers show. */
	issuesAt(ref: Ref) {
		const matches = (issue: { ref: Ref }) =>
			(ref.blockId === undefined || issue.ref.blockId === ref.blockId) &&
			(ref.lessonId === undefined || issue.ref.lessonId === ref.lessonId) &&
			(ref.stepId === undefined || issue.ref.stepId === ref.stepId) &&
			(ref.optionId === undefined || issue.ref.optionId === ref.optionId);
		return {
			errors: this.validation.errors.filter(matches),
			warnings: this.validation.warnings.filter(matches)
		};
	}

	/** The document as it would be published or downloaded. */
	export(): Record<string, unknown> {
		return serialise(this.doc);
	}

	#reserve(doc: CourseV2) {
		for (const lesson of doc.lessons) this.#reservedLessons.add(lesson.lesson_id);
		for (const block of doc.blocks) {
			this.#reservedBlocks.add(block.block_id);
			for (const step of block.steps) {
				this.#reservedSteps.add(stepReservation(block.block_id, step.id));
			}
		}
	}
}
