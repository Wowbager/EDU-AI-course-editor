/**
 * The document index: lookup maps plus the reverse reference index.
 *
 * The reverse index is what makes delete-safety (§3 invariant 3) and the validation
 * panel cheap — "what points at this step?" is a map lookup, not a document walk.
 */
import type { BlockStep, BlockV2, CourseV2, LessonV2 } from './schema';
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
					: { blockId: value };
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
				to: { blockId: rule.block_id },
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
 * Step-graph successors, as the player walks them (§9). A question step's successors
 * are its options' targets, plus the next step for any option without one.
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

	// §6.2 / §9: branching is ignored in exercise blocks — flow is always linear.
	const branching = block.type === 'question';
	const options = step.type === 'question' ? (step.question?.options ?? []) : [];

	if (!branching || options.length === 0) {
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
