/**
 * The document index: lookup maps plus the reverse reference index.
 *
 * The reverse index is what makes delete-safety (§3 invariant 3) and the validation
 * panel cheap — "what points at this step?" is a map lookup, not a document walk.
 */
import type { BlockStep, BlockV2, CourseV2, LessonV2, QuestionConfig } from './schema';
import { GOTO_KEYWORDS } from './schema';
import type { Ref } from './ref';

export type ReferenceKind = 'go_to' | 'binding' | 'prerequisite';

/** One pointer at a target, and where it lives so it can be repaired. */
export interface Reference {
	kind: ReferenceKind;
	/** Where the pointer is written. */
	from: Ref;
	/** What it points at: a step in `blockId`, or a whole block. */
	to: { blockId: string; stepId?: string };
	/** The raw stored value, e.g. `"s3"` or `"L1_B2_casti"`. */
	value: string;
}

export interface DocIndex {
	lessonsById: Map<string, LessonV2>;
	blocksById: Map<string, BlockV2>;
	stepsByBlock: Map<string, Map<string, BlockStep>>;
	/** Which lessons bind a given block — a block can appear in several. */
	lessonsByBlock: Map<string, string[]>;
	/** All references, and the same list keyed by target for reverse lookup. */
	references: Reference[];
	referencesToBlock: Map<string, Reference[]>;
	referencesToStep: Map<string, Reference[]>;
}

const stepKey = (blockId: string, stepId: string) => `${blockId}::${stepId}`;

/**
 * View only (`groups.ts`): the blocks a merged question card stands for. The index
 * resolves each of them to the card, so a branch from another card into the card's
 * second question still resolves, and deleting the card finds it.
 */
export const MEMBERS_KEY = '_members';

export const isGoToKeyword = (value: string): boolean =>
	(GOTO_KEYWORDS as readonly string[]).includes(value);

export function buildIndex(doc: CourseV2): DocIndex {
	const lessonsById = new Map<string, LessonV2>();
	const blocksById = new Map<string, BlockV2>();
	const stepsByBlock = new Map<string, Map<string, BlockStep>>();
	const lessonsByBlock = new Map<string, string[]>();
	const references: Reference[] = [];

	for (const lesson of doc.lessons) {
		if (!lessonsById.has(lesson.lesson_id)) lessonsById.set(lesson.lesson_id, lesson);
	}
	for (const block of doc.blocks) {
		if (!blocksById.has(block.block_id)) blocksById.set(block.block_id, block);
		const steps = new Map<string, BlockStep>();
		for (const step of block.steps) if (!steps.has(step.id)) steps.set(step.id, step);
		stepsByBlock.set(block.block_id, steps);
	}
	/** A merged card's blocks, each resolving to the card. */
	const cardOf = new Map<string, string>();
	for (const block of doc.blocks) {
		const members = (block as Record<string, unknown>)[MEMBERS_KEY];
		if (!Array.isArray(members)) continue;
		for (const member of members) {
			if (typeof member !== 'string' || blocksById.has(member)) continue;
			blocksById.set(member, block);
			cardOf.set(member, block.block_id);
		}
	}
	const resolve = (blockId: string) => cardOf.get(blockId) ?? blockId;

	for (const lesson of doc.lessons) {
		for (const binding of lesson.blocks) {
			const list = lessonsByBlock.get(binding.block_id) ?? [];
			list.push(lesson.lesson_id);
			lessonsByBlock.set(binding.block_id, list);
			references.push({
				kind: 'binding',
				from: { lessonId: lesson.lesson_id, blockId: binding.block_id },
				to: { blockId: binding.block_id },
				value: binding.block_id
			});
		}
	}

	for (const block of doc.blocks) {
		const ownSteps = stepsByBlock.get(block.block_id);
		for (const step of block.steps) {
			for (const option of step.question?.options ?? []) {
				const value = option.go_to;
				if (typeof value !== 'string' || value === '' || isGoToKeyword(value)) continue;
				const to = ownSteps?.has(value)
					? { blockId: block.block_id, stepId: value }
					: { blockId: resolve(value) };
				references.push({
					kind: 'go_to',
					from: { blockId: block.block_id, stepId: step.id, optionId: option.id, field: 'go_to' },
					to,
					value
				});
			}
		}
		for (const [i, rule] of (block.learning?.prerequisites ?? []).entries()) {
			if (typeof rule.block_id !== 'string' || rule.block_id === '') continue;
			references.push({
				kind: 'prerequisite',
				from: { blockId: block.block_id, field: `learning.prerequisites.${i}.block_id` },
				to: { blockId: resolve(rule.block_id) },
				value: rule.block_id
			});
		}
	}

	const referencesToBlock = new Map<string, Reference[]>();
	const referencesToStep = new Map<string, Reference[]>();
	for (const reference of references) {
		if (reference.to.stepId !== undefined) {
			const key = stepKey(reference.to.blockId, reference.to.stepId);
			referencesToStep.set(key, [...(referencesToStep.get(key) ?? []), reference]);
		} else {
			const key = reference.to.blockId;
			referencesToBlock.set(key, [...(referencesToBlock.get(key) ?? []), reference]);
		}
	}

	return {
		lessonsById,
		blocksById,
		stepsByBlock,
		lessonsByBlock,
		references,
		referencesToBlock,
		referencesToStep
	};
}

/** Everything that points at a block — bindings, cross-block `go_to`, prerequisites. */
export function referencesToBlock(index: DocIndex, blockId: string): Reference[] {
	return index.referencesToBlock.get(blockId) ?? [];
}

/** Everything that points at a step. */
export function referencesToStep(index: DocIndex, blockId: string, stepId: string): Reference[] {
	return index.referencesToStep.get(stepKey(blockId, stepId)) ?? [];
}

/**
 * Whether an answer's own outcome — where it leads (`go_to`) and its grade (`mark`) —
 * counts for this question. It does only when the pupil picks one answer.
 *
 * Mirrors the app: `BlockStepEngine._confirmAnswer` takes its `goToValue` and
 * `markValue` from the chosen option only in the last branch, the single-select /
 * true-false one (`block_step_engine.dart:620-633`). The `allowMultiple` branch above
 * it (`:597-601`) judges the whole set and reads neither, and `numeric` and `open`
 * questions never look at their options' outcomes (`:602-619`). `_continueAfterSolution`
 * likewise follows only `selectedOptionId`, which a multi-select never sets
 * (`:735-747`), and `QuizPage._checkAnswer` (`quiz_page.dart:499-525`) reads no
 * outcome on an option either way. A multi-select question can still branch on the
 * question as a whole (`next_actions`), which is not an option's value.
 *
 * (`score_koef` is skipped in the multi-select branch too, `:598-601`; that column is
 * advanced-only and not part of this rule.)
 */
export function optionOutcomesApply(
	question: Pick<QuestionConfig, 'type' | 'allow_multiple'> | undefined
): boolean {
	if (question === undefined) return true;
	if (question.allow_multiple === true) return false;
	return question.type === 'multiple_choice' || question.type === 'true_false';
}

/**
 * Whether the player follows the `go_to` of this step's answers at all.
 *
 * `GoToResolver.resolve` (`lib/models/step_navigation.dart:208-211`) ignores a `go_to`
 * in an `exercise` card and nowhere else, so a `display` card with a question branches
 * too; and the answers' own targets are read only when the pupil picks one answer
 * (`optionOutcomesApply`). The export mode does not matter: the player looks at the
 * card's type, not at `exercise_v2`.
 */
export function goToIsFollowed(block: Pick<BlockV2, 'type'>, step: BlockStep): boolean {
	return (
		block.type !== 'exercise' && step.type === 'question' && optionOutcomesApply(step.question)
	);
}

/**
 * Step-graph successors, as the player walks them (§9). A question step's successors
 * are its options' targets, plus the next step for any option without one, where the
 * player follows them (`goToIsFollowed`).
 */
export function stepSuccessors(
	block: BlockV2,
	step: BlockStep
): { stepId: string; viaOption?: string }[] {
	const order = block.steps;
	const position = order.findIndex((s) => s.id === step.id);
	const next = position >= 0 && position + 1 < order.length ? order[position + 1].id : undefined;
	const out: { stepId: string; viaOption?: string }[] = [];
	const push = (stepId: string | undefined, viaOption?: string) => {
		if (stepId !== undefined) out.push({ stepId, viaOption });
	};

	// `GoToResolver.resolve`: linear in an exercise card, and for an answer set the
	// player does not read an option's target from (a multi-select, a typed answer).
	const options = goToIsFollowed(block, step) ? (step.question?.options ?? []) : [];

	if (options.length === 0) {
		push(next);
		return out;
	}

	for (const option of options) {
		const target = option.go_to;
		if (typeof target !== 'string' || target === '' || target === 'NEXT_STEP') {
			push(next, option.id);
		} else if (target === 'AGAIN') {
			push(step.id, option.id);
		} else if (target === 'END' || target === 'CHAT' || target === 'LECTURE') {
			// Leaves the step graph.
		} else if (order.some((s) => s.id === target)) {
			push(target, option.id);
		}
		// Anything else is a cross-block jump: outside this block's graph.
	}
	return out;
}

/** Step ids reachable from the block's first step by walking the step graph. */
export function reachableSteps(block: BlockV2): Set<string> {
	const reachable = new Set<string>();
	const first = block.steps[0];
	if (first === undefined) return reachable;

	const queue = [first.id];
	reachable.add(first.id);
	while (queue.length > 0) {
		const id = queue.shift()!;
		const step = block.steps.find((s) => s.id === id);
		if (step === undefined) continue;
		for (const successor of stepSuccessors(block, step)) {
			if (reachable.has(successor.stepId)) continue;
			reachable.add(successor.stepId);
			queue.push(successor.stepId);
		}
	}
	return reachable;
}
