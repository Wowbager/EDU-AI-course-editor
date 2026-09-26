/**
 * Commands — the only way the document changes (plan §4).
 *
 * Each command is a pure function `(doc, args) => CommandResult`: a new document,
 * the `Ref` the editor should select afterwards, and a Czech description for the
 * undo log. Keeping them pure is what makes the §3 invariants testable as properties
 * rather than hoped for.
 *
 * Deletion is deliberately two-step. `planDelete*` returns everything that points at
 * the target; `delete*` refuses to run until each of those pointers has a repair.
 * Deleting without repair is a bug, not a warning (§3 invariant 3).
 */
import { applyVisibility, visibilityOf, VISIBILITY_LABEL, type Visibility } from './versions';
import type {
	BlockStep,
	BlockV2,
	CourseV2,
	LessonBlockBinding,
	LessonV2,
	QuestionConfig,
	QuestionOption,
	StepType
} from './schema';
import type { Ref } from './ref';
import { ELO_BASELINE } from './skill-config';
import {
	buildIndex,
	referencesToBlock,
	referencesToStep,
	type Reference
} from './index-doc';
import {
	duplicateBlockValue,
	newBlockId,
	newLessonId,
	nextBlockId,
	nextLessonId,
	nextOptionId,
	nextStepId,
	type Reservations
} from './ids';

export interface CommandResult {
	doc: CourseV2;
	/** Where the editor should put the selection after the change. */
	ref?: Ref;
	/** Shown in the undo log, in Czech. */
	description: string;
}

export class CommandError extends Error {
	constructor(
		message: string,
		readonly ref?: Ref
	) {
		super(message);
		this.name = 'CommandError';
	}
}

// ───────────────────────────────── immutable helpers ─────────────────────────────────

const mapLesson = (doc: CourseV2, lessonId: string, fn: (l: LessonV2) => LessonV2): CourseV2 => ({
	...doc,
	lessons: doc.lessons.map((l) => (l.lesson_id === lessonId ? fn(l) : l))
});

const mapBlock = (doc: CourseV2, blockId: string, fn: (b: BlockV2) => BlockV2): CourseV2 => ({
	...doc,
	blocks: doc.blocks.map((b) => (b.block_id === blockId ? fn(b) : b))
});

const mapStep = (
	doc: CourseV2,
	blockId: string,
	stepId: string,
	fn: (s: BlockStep) => BlockStep
): CourseV2 =>
	mapBlock(doc, blockId, (block) => ({
		...block,
		steps: block.steps.map((s) => (s.id === stepId ? fn(s) : s))
	}));

const requireBlock = (doc: CourseV2, blockId: string): BlockV2 => {
	const block = doc.blocks.find((b) => b.block_id === blockId);
	if (block === undefined) throw new CommandError(`Blok „${blockId}“ v kurzu není.`, { blockId });
	return block;
};

const requireLesson = (doc: CourseV2, lessonId: string): LessonV2 => {
	const lesson = doc.lessons.find((l) => l.lesson_id === lessonId);
	if (lesson === undefined) throw new CommandError(`Lekce „${lessonId}“ v kurzu není.`, { lessonId });
	return lesson;
};

/** Rewrite `order` to match array position. Never touches ids (§3 invariant 2). */
const renumberOrder = <T extends { order?: number }>(items: T[]): T[] =>
	items.map((item, i) => ({ ...item, order: i + 1 }));

/**
 * Whether a reorder left every item where it was. A drag dropped where it started
 * is not an edit: it must not leave an undo entry behind or mark the course dirty,
 * and renumbering would still "change" an imported file whose `order` has gaps.
 */
const sameSequence = <T>(before: readonly T[], after: readonly T[]): boolean =>
	before.length === after.length && before.every((item, i) => item === after[i]);

// ──────────────────────────────────── generic field ────────────────────────────────────

const ID_FIELDS = new Set(['course_id', 'lesson_id', 'block_id', 'id']);

/**
 * Set one field, addressed by `Ref`. `ref.field` may be a dotted path inside the
 * addressed node, e.g. `gpf.relation_vector` or `question.solution`.
 *
 * Ids are refused: renaming one has to rewrite every reference, which is what
 * `renameBlock` / `renameLesson` / `renameStep` are for.
 */
export function setField(doc: CourseV2, ref: Ref, value: unknown): CommandResult {
	const field = ref.field;
	if (field === undefined) throw new CommandError('Chybí název pole.', ref);
	const head = field.split('.')[0];
	if (ID_FIELDS.has(head) && field === head) {
		throw new CommandError(
			`Pole „${field}“ je identifikátor — použij přejmenování, aby se přepsaly i všechny odkazy.`,
			ref
		);
	}

	const apply = <T extends object>(node: T): T => deepSet(node, field.split('.'), value) as T;
	const description = `Změna pole ${field}`;

	if (ref.optionId !== undefined && ref.blockId !== undefined && ref.stepId !== undefined) {
		return {
			doc: mapOption(doc, ref.blockId, ref.stepId, ref.optionId, apply),
			ref,
			description
		};
	}
	if (ref.stepId !== undefined && ref.blockId !== undefined) {
		return { doc: mapStep(doc, ref.blockId, ref.stepId, apply), ref, description };
	}
	if (ref.lessonId !== undefined && ref.blockId !== undefined) {
		return {
			doc: mapLesson(doc, ref.lessonId, (lesson) => ({
				...lesson,
				blocks: lesson.blocks.map((b) => (b.block_id === ref.blockId ? apply(b) : b))
			})),
			ref,
			description
		};
	}
	if (ref.blockId !== undefined) {
		return { doc: mapBlock(doc, ref.blockId, apply), ref, description };
	}
	if (ref.lessonId !== undefined) {
		return { doc: mapLesson(doc, ref.lessonId, apply), ref, description };
	}
	return { doc: apply(doc), ref, description };
}

function mapOption(
	doc: CourseV2,
	blockId: string,
	stepId: string,
	optionId: string,
	fn: (o: QuestionOption) => QuestionOption
): CourseV2 {
	return mapStep(doc, blockId, stepId, (step) => {
		if (step.question === undefined) return step;
		return {
			...step,
			question: {
				...step.question,
				options: (step.question.options ?? []).map((o) => (o.id === optionId ? fn(o) : o))
			}
		};
	});
}

/** Immutable set along a dotted path. `undefined` deletes the key. */
function deepSet(node: object, path: string[], value: unknown): object {
	const [head, ...rest] = path;
	if (rest.length === 0) {
		const next = { ...(node as Record<string, unknown>) };
		if (value === undefined) delete next[head];
		else next[head] = value;
		return next;
	}
	const child = (node as Record<string, unknown>)[head];
	const childObject = typeof child === 'object' && child !== null ? (child as object) : {};
	return { ...(node as Record<string, unknown>), [head]: deepSet(childObject, rest, value) };
}

// ──────────────────────────────────────── lessons ────────────────────────────────────────

export const DEFAULT_LESSON_NAME = 'Nová lekce';

/**
 * "Nová lekce", then "Nová lekce 2", "Nová lekce 3" …
 *
 * The number comes from the names already in the course, never from
 * `doc.lessons.length`: a course whose lessons are called "Úvod" and "Fotosyntéza"
 * has no "Nová lekce" in it, so the next one is "Nová lekce" and not "Nová lekce 3".
 * The point of the suffix is to tell the placeholder names apart in the sidebar —
 * numbering the ones that are already named would be noise, and would also drift
 * the moment a lesson is renamed or deleted.
 *
 * It is a suggestion, not an identity: two lessons may end up with the same name
 * after a rename and nothing in the format minds, because a lesson is keyed by
 * `lesson_id`.
 */
export function nextDefaultLessonName(doc: CourseV2, base = DEFAULT_LESSON_NAME): string {
	const taken = new Set(doc.lessons.map((lesson) => (lesson.name ?? '').trim()));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base} ${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/**
 * `name` stays optional and an explicit one still wins — the import path and the
 * tests name lessons themselves. Only the *default* is derived.
 */
export function addLesson(
	doc: CourseV2,
	name?: string,
	reserved?: Reservations
): CommandResult {
	const lessonId = newLessonId(doc, reserved);
	const lessonName = name ?? nextDefaultLessonName(doc);
	const lesson: LessonV2 = {
		lesson_id: lessonId,
		version: 1,
		name: lessonName,
		order: doc.lessons.length + 1,
		blocks: []
	};
	return {
		doc: { ...doc, lessons: renumberOrder([...doc.lessons, lesson]) },
		ref: { lessonId },
		description: `Přidána lekce „${lessonName}“`
	};
}

export function duplicateLesson(
	doc: CourseV2,
	lessonId: string,
	reserved?: Reservations
): CommandResult {
	const lesson = requireLesson(doc, lessonId);
	const copyId = nextLessonId(lessonId, doc, reserved);
	// Bindings are copied as-is: the blocks themselves stay shared, which is the
	// behaviour the format is built for (§5).
	const copy: LessonV2 = {
		...lesson,
		lesson_id: copyId,
		name: `${lesson.name ?? lessonId} (kopie)`
	};
	const at = doc.lessons.findIndex((l) => l.lesson_id === lessonId);
	const lessons = [...doc.lessons];
	lessons.splice(at + 1, 0, copy);
	return {
		doc: { ...doc, lessons: renumberOrder(lessons) },
		ref: { lessonId: copyId },
		description: `Duplikována lekce „${lesson.name ?? lessonId}“`
	};
}

export function deleteLesson(doc: CourseV2, lessonId: string): CommandResult {
	const lesson = requireLesson(doc, lessonId);
	return {
		doc: { ...doc, lessons: renumberOrder(doc.lessons.filter((l) => l.lesson_id !== lessonId)) },
		description: `Smazána lekce „${lesson.name ?? lessonId}“`
	};
}

export function reorderLessons(doc: CourseV2, orderedIds: string[]): CommandResult {
	const byId = new Map(doc.lessons.map((l) => [l.lesson_id, l]));
	const reordered = orderedIds.map((id) => byId.get(id)).filter((l): l is LessonV2 => l !== undefined);
	for (const lesson of doc.lessons) if (!orderedIds.includes(lesson.lesson_id)) reordered.push(lesson);
	if (sameSequence(doc.lessons, reordered)) return { doc, description: 'Pořadí lekcí se nezměnilo' };
	return {
		doc: { ...doc, lessons: renumberOrder(reordered) },
		description: 'Změněno pořadí lekcí'
	};
}

// ──────────────────────────────────────── bindings ────────────────────────────────────────

/** Bind an existing block into a lesson — the shared-block case (§5). */
export function bindBlock(doc: CourseV2, lessonId: string, blockId: string, at?: number): CommandResult {
	const lesson = requireLesson(doc, lessonId);
	requireBlock(doc, blockId);
	// Repeated assignment is a no-op, preserving binding settings and undo history.
	if (lesson.blocks.some((binding) => binding.block_id === blockId)) {
		return { doc, ref: { lessonId, blockId }, description: 'Karta už je v této lekci' };
	}
	return {
		doc: mapLesson(doc, lessonId, (lesson) => {
			const bindings = [...lesson.blocks];
			const binding: LessonBlockBinding = { block_id: blockId, order: bindings.length + 1 };
			bindings.splice(at ?? bindings.length, 0, binding);
			return { ...lesson, blocks: renumberOrder(bindings) };
		}),
		ref: { lessonId, blockId },
		description: `Blok „${blockId}“ vložen do lekce „${lessonId}“`
	};
}

export function unbindBlock(doc: CourseV2, lessonId: string, blockId: string): CommandResult {
	return {
		doc: mapLesson(doc, lessonId, (lesson) => ({
			...lesson,
			blocks: renumberOrder(lesson.blocks.filter((b) => b.block_id !== blockId))
		})),
		description: `Blok „${blockId}“ odebrán z lekce „${lessonId}“`
	};
}

export function reorderBindings(doc: CourseV2, lessonId: string, orderedIds: string[]): CommandResult {
	const lesson = requireLesson(doc, lessonId);
	const remaining = [...lesson.blocks];
	const reordered: LessonBlockBinding[] = [];
	for (const id of orderedIds) {
		const at = remaining.findIndex((b) => b.block_id === id);
		if (at >= 0) reordered.push(...remaining.splice(at, 1));
	}
	reordered.push(...remaining);
	if (sameSequence(lesson.blocks, reordered)) return { doc, description: 'Pořadí karet se nezměnilo' };
	return {
		doc: mapLesson(doc, lessonId, (l) => ({ ...l, blocks: renumberOrder(reordered) })),
		description: 'Změněno pořadí bloků v lekci'
	};
}

/** Move a block from one lesson to another, keeping its per-lesson presentation. */
export function moveBlockToLesson(
	doc: CourseV2,
	blockId: string,
	fromLessonId: string,
	toLessonId: string,
	at?: number
): CommandResult {
	const from = requireLesson(doc, fromLessonId);
	requireLesson(doc, toLessonId);
	const binding = from.blocks.find((b) => b.block_id === blockId);
	if (binding === undefined) {
		throw new CommandError(`Blok „${blockId}“ v lekci „${fromLessonId}“ není.`, { lessonId: fromLessonId, blockId });
	}

	let next = mapLesson(doc, fromLessonId, (lesson) => ({
		...lesson,
		blocks: renumberOrder(lesson.blocks.filter((b) => b.block_id !== blockId))
	}));
	next = mapLesson(next, toLessonId, (lesson) => {
		const bindings = [...lesson.blocks];
		bindings.splice(at ?? bindings.length, 0, { ...binding });
		return { ...lesson, blocks: renumberOrder(bindings) };
	});

	return {
		doc: next,
		ref: { lessonId: toLessonId, blockId },
		description: `Blok „${blockId}“ přesunut do lekce „${toLessonId}“`
	};
}

// ───────────────────────────────────────── blocks ─────────────────────────────────────────

/**
 * Add a block and bind it into a lesson. The block type follows from the card the
 * teacher chose to add; it is never edited as a raw field (plan §5, M4).
 *
 * Deliberately *not* given a default `name` the way `addLesson` is. A lesson has
 * nothing but its name in the tree, so an unnamed one is unreadable; a card has its
 * own first line, and the only case where several cards look alike is the few
 * seconds between adding them and typing into them. Writing "Karta 3" into the
 * document to cover that would put a title on every card an author never asked for,
 * would be exported, and would go stale the moment the card moved. `blockPreview`
 * takes the card's position instead and shows it only while the card is empty —
 * same legibility, nothing written.
 */
export function addBlock(
	doc: CourseV2,
	lessonId: string,
	type: BlockV2['type'],
	at?: number,
	reserved?: Reservations
): CommandResult {
	requireLesson(doc, lessonId);
	const blockId = newBlockId(doc, lessonId, reserved);
	const block: BlockV2 = {
		export_type: 'block_v2',
		block_id: blockId,
		version: 1,
		// No `status`: nothing in the app or the API reads a card's status, and a new
		// card carrying "draft" made every card open with a warning chip the teacher
		// had no way to clear. Whether a course is out is the course's business.
		type,
		steps:
			type === 'display'
				? [{ id: 's1', type: 'text', order: 1, content: '' }]
				: [{ id: 's1', type: 'question', order: 1, question: emptyQuestion() }]
	};
	if (doc.language !== undefined) block.language = doc.language;

	const withBlock: CourseV2 = { ...doc, blocks: [...doc.blocks, block] };
	const bound = bindBlock(withBlock, lessonId, blockId, at);
	return {
		doc: bound.doc,
		ref: { lessonId, blockId },
		description: `Přidána karta typu ${type}`
	};
}

const emptyQuestion = (): QuestionConfig => ({
	type: 'multiple_choice',
	show_answers: true,
	show_solution: true,
	options: [
		{ id: 'a', text: '', is_correct: true },
		{ id: 'b', text: '', is_correct: false }
	]
});

/**
 * §3 invariant 4 — the copy gets a fresh `block_id`, its step ids restart at `s1`,
 * and `go_to` targets that pointed inside the original are dropped.
 */
export function duplicateBlock(
	doc: CourseV2,
	blockId: string,
	lessonId?: string,
	reserved?: Reservations
): CommandResult {
	const block = requireBlock(doc, blockId);
	const copyId = nextBlockId(blockId, doc, reserved);
	const copy = duplicateBlockValue(block, copyId);

	let next: CourseV2 = { ...doc, blocks: [...doc.blocks, copy] };
	if (lessonId !== undefined) {
		const lesson = requireLesson(next, lessonId);
		const at = lesson.blocks.findIndex((b) => b.block_id === blockId);
		next = bindBlock(next, lessonId, copyId, at >= 0 ? at + 1 : undefined).doc;
	}
	return {
		doc: next,
		ref: { lessonId, blockId: copyId },
		description: `Duplikován blok „${blockId}“`
	};
}

/** Everything that would break if this block went away. */
export function planDeleteBlock(doc: CourseV2, blockId: string): Reference[] {
	const index = buildIndex(doc);
	return referencesToBlock(index, blockId);
}

export interface Repair {
	reference: Reference;
	/** `clear` removes the pointer; `redirect` rewrites it to `to`. */
	action: 'clear' | 'redirect';
	to?: string;
}

/**
 * Delete a block. Every inbound reference must be covered by a repair — a binding, a
 * cross-block `go_to`, or a prerequisite. Nothing is left dangling.
 */
export function deleteBlock(doc: CourseV2, blockId: string, repairs: Repair[] = []): CommandResult {
	requireBlock(doc, blockId);
	const outstanding = planDeleteBlock(doc, blockId).filter(
		(reference) => !repairs.some((r) => sameReference(r.reference, reference))
	);
	if (outstanding.length > 0) {
		throw new CommandError(
			`Na blok „${blockId}“ odkazuje ${outstanding.length} míst(o) v kurzu. Nejdřív je přesměruj nebo zruš, jinak by žák uvízl.`,
			{ blockId }
		);
	}

	const repaired = applyRepairs(doc, repairs);
	return {
		doc: { ...repaired, blocks: repaired.blocks.filter((b) => b.block_id !== blockId) },
		description: `Smazán blok „${blockId}“`
	};
}

/** Rename a block and rewrite every pointer at it, so nothing dangles. */
export function renameBlock(doc: CourseV2, blockId: string, newBlockIdValue: string): CommandResult {
	requireBlock(doc, blockId);
	if (doc.blocks.some((b) => b.block_id === newBlockIdValue)) {
		throw new CommandError(`Blok s id „${newBlockIdValue}“ už v kurzu je.`, { blockId });
	}

	const next: CourseV2 = {
		...doc,
		lessons: doc.lessons.map((lesson) => ({
			...lesson,
			blocks: lesson.blocks.map((b) => (b.block_id === blockId ? { ...b, block_id: newBlockIdValue } : b))
		})),
		blocks: doc.blocks.map((block) => {
			const renamed = block.block_id === blockId ? { ...block, block_id: newBlockIdValue } : { ...block };
			const prerequisites = renamed.learning?.prerequisites;
			if (prerequisites !== undefined) {
				renamed.learning = {
					...renamed.learning,
					prerequisites: prerequisites.map((rule) =>
						rule.block_id === blockId ? { ...rule, block_id: newBlockIdValue } : rule
					)
				};
			}
			return {
				...renamed,
				steps: renamed.steps.map((step) => rewriteStepGoTo(step, (target, ownStepIds) =>
					!ownStepIds.has(target) && target === blockId ? newBlockIdValue : target
				, new Set(renamed.steps.map((s) => s.id))))
			};
		})
	};

	return {
		doc: next,
		ref: { blockId: newBlockIdValue },
		description: `Blok „${blockId}“ přejmenován na „${newBlockIdValue}“`
	};
}

export function renameLesson(doc: CourseV2, lessonId: string, newLessonIdValue: string): CommandResult {
	requireLesson(doc, lessonId);
	if (doc.lessons.some((l) => l.lesson_id === newLessonIdValue)) {
		throw new CommandError(`Lekce s id „${newLessonIdValue}“ už v kurzu je.`, { lessonId });
	}
	return {
		doc: mapLesson(doc, lessonId, (lesson) => ({ ...lesson, lesson_id: newLessonIdValue })),
		ref: { lessonId: newLessonIdValue },
		description: `Lekce „${lessonId}“ přejmenována na „${newLessonIdValue}“`
	};
}

// ────────────────────────────────────────── steps ──────────────────────────────────────────

export function addStep(
	doc: CourseV2,
	blockId: string,
	type: StepType,
	at?: number,
	reserved?: Reservations
): CommandResult {
	const block = requireBlock(doc, blockId);
	const id = nextStepId(block.steps, blockId, reserved);
	const step: BlockStep = { id, type, order: block.steps.length + 1 };
	if (type === 'text') step.content = '';
	if (type === 'question') step.question = emptyQuestion();
	if (type === 'image') step.image = { url: '', alt: '' };
	if (type === 'video') step.video = { url: '' };
	if (type === 'audio') step.audio = { url: '' };

	return {
		doc: mapBlock(doc, blockId, (b) => {
			const steps = [...b.steps];
			steps.splice(at ?? steps.length, 0, step);
			return { ...b, steps: renumberOrder(steps) };
		}),
		ref: { blockId, stepId: id },
		description: `Přidán krok „${id}“`
	};
}

/** A copy of a step gets a fresh id — ids are never reused (§3 invariant 2). */
export function duplicateStep(
	doc: CourseV2,
	blockId: string,
	stepId: string,
	reserved?: Reservations
): CommandResult {
	const block = requireBlock(doc, blockId);
	const source = block.steps.find((s) => s.id === stepId);
	if (source === undefined) throw new CommandError(`Krok „${stepId}“ v bloku není.`, { blockId, stepId });

	const id = nextStepId(block.steps, blockId, reserved);
	const copy: BlockStep = structuredClone(source);
	copy.id = id;

	return {
		doc: mapBlock(doc, blockId, (b) => {
			const steps = [...b.steps];
			steps.splice(steps.findIndex((s) => s.id === stepId) + 1, 0, copy);
			return { ...b, steps: renumberOrder(steps) };
		}),
		ref: { blockId, stepId: id },
		description: `Duplikován krok „${stepId}“`
	};
}

export function planDeleteStep(doc: CourseV2, blockId: string, stepId: string): Reference[] {
	const index = buildIndex(doc);
	return referencesToStep(index, blockId, stepId);
}

export function deleteStep(
	doc: CourseV2,
	blockId: string,
	stepId: string,
	repairs: Repair[] = []
): CommandResult {
	const block = requireBlock(doc, blockId);
	if (!block.steps.some((s) => s.id === stepId)) {
		throw new CommandError(`Krok „${stepId}“ v bloku není.`, { blockId, stepId });
	}
	const outstanding = planDeleteStep(doc, blockId, stepId).filter(
		(reference) => !repairs.some((r) => sameReference(r.reference, reference))
	);
	if (outstanding.length > 0) {
		throw new CommandError(
			`Na krok „${stepId}“ vede ${outstanding.length} větvení. Nejdřív je přesměruj, jinak by žák uvízl.`,
			{ blockId, stepId }
		);
	}

	const repaired = applyRepairs(doc, repairs);
	return {
		doc: mapBlock(repaired, blockId, (b) => ({
			...b,
			steps: renumberOrder(b.steps.filter((s) => s.id !== stepId))
		})),
		description: `Smazán krok „${stepId}“`
	};
}

/** Reordering rewrites `order` only — ids stay put (§3 invariant 2). */
export function reorderSteps(doc: CourseV2, blockId: string, orderedIds: string[]): CommandResult {
	const block = requireBlock(doc, blockId);
	const remaining = [...block.steps];
	const reordered: BlockStep[] = [];
	for (const id of orderedIds) {
		const at = remaining.findIndex((s) => s.id === id);
		if (at >= 0) reordered.push(...remaining.splice(at, 1));
	}
	reordered.push(...remaining);
	if (sameSequence(block.steps, reordered)) return { doc, description: 'Pořadí kroků se nezměnilo' };
	return {
		doc: mapBlock(doc, blockId, (b) => ({ ...b, steps: renumberOrder(reordered) })),
		description: 'Změněno pořadí kroků'
	};
}

// ───────────────────────────────────────── options ─────────────────────────────────────────

export function addOption(doc: CourseV2, blockId: string, stepId: string): CommandResult {
	const block = requireBlock(doc, blockId);
	const step = block.steps.find((s) => s.id === stepId);
	if (step?.question === undefined) {
		throw new CommandError(`Krok „${stepId}“ není otázka.`, { blockId, stepId });
	}
	const id = nextOptionId(step.question.options ?? []);
	return {
		doc: mapStep(doc, blockId, stepId, (s) => ({
			...s,
			question: { ...s.question!, options: [...(s.question!.options ?? []), { id, text: '', is_correct: false }] }
		})),
		ref: { blockId, stepId, optionId: id },
		description: 'Přidána odpověď'
	};
}

export function deleteOption(
	doc: CourseV2,
	blockId: string,
	stepId: string,
	optionId: string
): CommandResult {
	return {
		doc: mapStep(doc, blockId, stepId, (step) => {
			if (step.question === undefined) return step;
			return {
				...step,
				question: {
					...step.question,
					options: (step.question.options ?? []).filter((o) => o.id !== optionId)
				}
			};
		}),
		description: 'Smazána odpověď'
	};
}

export function reorderOptions(
	doc: CourseV2,
	blockId: string,
	stepId: string,
	orderedIds: string[]
): CommandResult {
	return {
		doc: mapStep(doc, blockId, stepId, (step) => {
			if (step.question === undefined) return step;
			const remaining = [...(step.question.options ?? [])];
			const reordered: QuestionOption[] = [];
			for (const id of orderedIds) {
				const at = remaining.findIndex((o) => o.id === id);
				if (at >= 0) reordered.push(...remaining.splice(at, 1));
			}
			return { ...step, question: { ...step.question, options: [...reordered, ...remaining] } };
		}),
		description: 'Změněno pořadí odpovědí'
	};
}

/**
 * Switch a question's type, seeding the shape that type requires (§14.1) so the
 * document is never briefly invalid in a way the author has to repair by hand.
 */
export function setQuestionType(
	doc: CourseV2,
	blockId: string,
	stepId: string,
	type: QuestionConfig['type']
): CommandResult {
	return {
		doc: mapStep(doc, blockId, stepId, (step) => {
			const previous = step.question ?? emptyQuestion();
			const next: QuestionConfig = { ...previous, type };

			if (type === 'true_false') {
				next.options = [
					{ id: 'true', text: 'Ano', is_correct: previous.options?.[0]?.is_correct ?? true },
					{ id: 'false', text: 'Ne', is_correct: false }
				];
				delete next.allow_multiple;
			} else if (type === 'multiple_choice') {
				if ((previous.options?.length ?? 0) < 2) next.options = emptyQuestion().options;
			} else {
				// open and numeric take no options.
				delete next.options;
				delete next.allow_multiple;
			}
			if (type !== 'numeric') {
				delete next.correct_number;
				delete next.tolerance;
			}
			if (type !== 'open') {
				delete next.correct_answer;
				delete next.allow_photo;
			}
			return { ...step, question: next };
		}),
		ref: { blockId, stepId },
		description: `Typ otázky změněn na ${type}`
	};
}

// ───────────────────────────────────────── repairs ─────────────────────────────────────────

const sameReference = (a: Reference, b: Reference): boolean =>
	a.kind === b.kind &&
	a.value === b.value &&
	a.from.blockId === b.from.blockId &&
	a.from.lessonId === b.from.lessonId &&
	a.from.stepId === b.from.stepId &&
	a.from.optionId === b.from.optionId &&
	a.from.field === b.from.field;

/** Apply a repair plan: clear or redirect each pointer, in one pass. */
export function applyRepairs(doc: CourseV2, repairs: Repair[]): CourseV2 {
	let next = doc;
	for (const repair of repairs) {
		const { reference } = repair;
		const to = repair.action === 'redirect' ? repair.to : undefined;
		if (repair.action === 'redirect' && (to === undefined || to === '')) {
			throw new CommandError('Přesměrování potřebuje cíl.', reference.from);
		}

		switch (reference.kind) {
			case 'binding': {
				const lessonId = reference.from.lessonId!;
				if (to === undefined) {
					next = unbindBlock(next, lessonId, reference.value).doc;
					break;
				}
				// Redirecting a binding to a card the lesson already holds is a *removal*,
				// not a rename. Rewriting the id in place produced two bindings for one
				// card in one lesson: the sidebar showed the card twice, the student was
				// taken through it twice, and nothing in §14 looks for it — the duplicate
				// ids are in `lessons[].blocks`, not in `blocks[]`, so `checkUniqueIds`
				// never sees them and the course still exported as valid.
				next = mapLesson(next, lessonId, (lesson) => {
					const alreadyBound = lesson.blocks.some((b) => b.block_id === to);
					const blocks = alreadyBound
						? lesson.blocks.filter((b) => b.block_id !== reference.value)
						: lesson.blocks.map((b) =>
								b.block_id === reference.value ? { ...b, block_id: to } : b
							);
					return { ...lesson, blocks: renumberOrder(blocks) };
				});
				break;
			}
			case 'go_to': {
				const { blockId, stepId, optionId } = reference.from;
				next = mapOption(next, blockId!, stepId!, optionId!, (option) => {
					if (to === undefined) {
						const { go_to: _cleared, ...rest } = option;
						void _cleared;
						return rest as QuestionOption;
					}
					return { ...option, go_to: to };
				});
				break;
			}
			case 'prerequisite': {
				const blockId = reference.from.blockId!;
				next = mapBlock(next, blockId, (block) => {
					const prerequisites = (block.learning?.prerequisites ?? []).flatMap((rule) => {
						if (rule.block_id !== reference.value) return [rule];
						return to === undefined ? [] : [{ ...rule, block_id: to }];
					});
					return { ...block, learning: { ...block.learning, prerequisites } };
				});
				break;
			}
		}
	}
	return next;
}

/** Rewrite every `go_to` in a step through `fn`. */
function rewriteStepGoTo(
	step: BlockStep,
	fn: (target: string, ownStepIds: Set<string>) => string,
	ownStepIds: Set<string>
): BlockStep {
	if (step.question?.options === undefined) return step;
	return {
		...step,
		question: {
			...step.question,
			options: step.question.options.map((option) =>
				typeof option.go_to === 'string' && option.go_to !== ''
					? { ...option, go_to: fn(option.go_to, ownStepIds) }
					: option
			)
		}
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge vector
// ─────────────────────────────────────────────────────────────────────────────

/** One topic a card trains: a dimension, how strongly, and how hard it is there. */
export interface BlockTopic {
	dimensionIndex: number;
	/** 1 weak, 2 strong. A topic with relation 0 is not a topic — remove it instead. */
	relation: 1 | 2;
	elo: number;
}

/** The descriptive classification the strongest topic implies. */
export interface TopicNaming {
	domain?: string;
	construct?: string;
	subconstruct?: string;
}

/**
 * Replace the whole set of topics a card trains, in one command.
 *
 * Three things this does that the old per-field writes could not:
 *
 *  - it is **one** undo entry, so picking a topic is one undo rather than five;
 *  - `gpf.domain` / `construct` / `subconstruct` are rewritten from the resulting
 *    set every time, so the human-readable classification cannot drift away from
 *    the vector the platform actually reads;
 *  - **every live relation gets an `elo_vector` entry.** `EloEngine.updateTask`
 *    skips any dimension whose difficulty is null or ≤ 0, so a relation written
 *    without a difficulty is a dimension that silently never moves — the card
 *    claims to measure something and then measures nothing.
 *
 * Passing an empty list clears the classification as well as the vectors, which is
 * the only way to say "this card trains nothing in particular".
 */
export function setTopics(
	doc: CourseV2,
	blockId: string,
	topics: readonly BlockTopic[],
	dimensionCount: number,
	naming: (index: number) => TopicNaming
): CommandResult {
	const ref: Ref = { blockId, field: 'gpf.relation_vector' };

	const sorted = [...topics].sort(
		(a, b) => b.relation - a.relation || a.dimensionIndex - b.dimensionIndex
	);

	const doc2 = mapBlock(doc, blockId, (block) => {
		const gpf = { ...(block.gpf ?? {}) };

		if (sorted.length === 0) {
			delete gpf.relation_vector;
			delete gpf.elo_vector;
			delete gpf.domain;
			delete gpf.construct;
			delete gpf.subconstruct;
		} else {
			const relation = Array.from({ length: dimensionCount }, () => 0);
			// Keep any difficulty the author has already tuned; only fill the gaps.
			const elo = Array.from(
				{ length: dimensionCount },
				(_, i) => block.gpf?.elo_vector?.[i] ?? ELO_BASELINE
			);
			for (const topic of sorted) {
				if (topic.dimensionIndex < 0 || topic.dimensionIndex >= dimensionCount) continue;
				relation[topic.dimensionIndex] = topic.relation;
				elo[topic.dimensionIndex] = topic.elo;
			}
			gpf.relation_vector = relation;
			gpf.elo_vector = elo;

			// The strongest topic names the card. Ties break on the lower index, so the
			// naming is stable as topics are added and removed.
			const { domain, construct, subconstruct } = naming(sorted[0].dimensionIndex);
			if (domain === undefined) delete gpf.domain;
			else gpf.domain = domain;
			if (construct === undefined) delete gpf.construct;
			else gpf.construct = construct;
			if (subconstruct === undefined) delete gpf.subconstruct;
			else gpf.subconstruct = subconstruct;
		}

		if (Object.keys(gpf).length === 0) {
			const next = { ...block };
			delete next.gpf;
			return next;
		}
		return { ...block, gpf };
	});

	const description =
		sorted.length === 0
			? 'Zrušení vazby karty na dovednosti'
			: `Dovednosti karty (${sorted.length})`;
	return { doc: doc2, ref, description };
}

/**
 * Read the topics off a block. The inverse of `setTopics`, and the single place
 * that decides what counts as a topic: a non-zero relation.
 */
export function blockTopics(block: BlockV2): BlockTopic[] {
	const relation = block.gpf?.relation_vector ?? [];
	const elo = block.gpf?.elo_vector ?? [];
	const topics: BlockTopic[] = [];
	for (let i = 0; i < relation.length; i++) {
		const value = relation[i];
		if (value !== 1 && value !== 2) continue;
		topics.push({ dimensionIndex: i, relation: value, elo: elo[i] ?? ELO_BASELINE });
	}
	return topics;
}

// ──────────────────────────────────────── versions ────────────────────────────────────────

/** Who can see the course once it is published (`domain/versions.ts`). */
export function setVisibility(doc: CourseV2, visibility: Visibility): CommandResult {
	if (visibilityOf(doc) === visibility) return { doc, description: 'Viditelnost se nezměnila' };
	return {
		doc: applyVisibility(doc, visibility),
		description: `Kurz: ${VISIBILITY_LABEL[visibility].label.toLowerCase()}`
	};
}

/**
 * Bring a saved version back as the working copy — an ordinary, undoable edit, so a
 * restore made by mistake is one "Zpět" away. The course keeps its identity and its
 * current visibility: those describe the course, not the version being returned to.
 */
export function restoreVersion(doc: CourseV2, saved: CourseV2, number: number): CommandResult {
	const restored: CourseV2 = { ...structuredClone(saved), course_id: doc.course_id, version: doc.version };
	if (doc.status === undefined) delete restored.status;
	else restored.status = doc.status;
	if (doc.logged_only === undefined) delete restored.logged_only;
	else restored.logged_only = doc.logged_only;
	return { doc: restored, description: `Obnovena verze ${number}` };
}
