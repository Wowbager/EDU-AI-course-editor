/**
 * Id minting. §3 invariants 1, 2 and 4 live here.
 *
 * Step ids are `s{max+1}` and are never reused or renumbered — a `go_to` target and
 * every saved student answer is keyed by them. Reordering rewrites `order` only.
 */
import type { BlockStep, BlockV2, CourseV2, QuestionOption } from './schema';

const STEP_ID = /^s(\d+)$/;

/**
 * Ids the session has handed out already, even for things since deleted.
 *
 * The document itself cannot remember a deleted step: nothing in the format records
 * one. Without this, deleting every step of a block and adding one back would mint
 * `s1` again — and a student's saved answer is keyed by `(block_id, step id)`, so the
 * new step would inherit the old one's answers. The editor therefore carries the set
 * of ids it has minted for as long as the document is open (see the document store).
 */
export interface Reservations {
	/** Every step id ever seen, as `blockId/stepId`. */
	steps: ReadonlySet<string>;
	/** Every block id ever seen. */
	blocks: ReadonlySet<string>;
	/** Every lesson id ever seen. */
	lessons: ReadonlySet<string>;
}

export const stepReservation = (blockId: string, stepId: string) => `${blockId}/${stepId}`;

const isTakenStep = (blockId: string, stepId: string, reserved?: Reservations) =>
	reserved?.steps.has(stepReservation(blockId, stepId)) === true;

/** The next free step id in a block: `s{max+1}` over ids ever seen, never a gap-fill. */
export function nextStepId(
	steps: readonly Pick<BlockStep, 'id'>[],
	blockId?: string,
	reserved?: Reservations
): string {
	let max = 0;
	for (const step of steps) {
		const m = STEP_ID.exec(step.id);
		if (m) max = Math.max(max, Number(m[1]));
	}
	if (blockId !== undefined && reserved !== undefined) {
		for (const key of reserved.steps) {
			const [ownerBlockId, stepId] = splitReservation(key);
			if (ownerBlockId !== blockId) continue;
			const m = STEP_ID.exec(stepId);
			if (m) max = Math.max(max, Number(m[1]));
		}
	}
	let candidate = max + 1;
	while (blockId !== undefined && isTakenStep(blockId, `s${candidate}`, reserved)) candidate++;
	return `s${candidate}`;
}

function splitReservation(key: string): [string, string] {
	const at = key.lastIndexOf('/');
	return [key.slice(0, at), key.slice(at + 1)];
}

/** Mint `count` fresh step ids at once, without colliding with each other. */
export function nextStepIds(
	steps: readonly Pick<BlockStep, 'id'>[],
	count: number,
	blockId?: string,
	reserved?: Reservations
): string[] {
	const out: string[] = [];
	const seen = [...steps];
	for (let i = 0; i < count; i++) {
		const id = nextStepId(seen, blockId, reserved);
		out.push(id);
		seen.push({ id });
	}
	return out;
}

/** The next free option id within a question: `a`, `b`, … then `o1`, `o2`, … */
export function nextOptionId(options: readonly Pick<QuestionOption, 'id'>[]): string {
	const taken = new Set(options.map((o) => o.id));
	for (let i = 0; i < 26; i++) {
		const id = String.fromCharCode(97 + i);
		if (!taken.has(id)) return id;
	}
	let n = 1;
	while (taken.has(`o${n}`)) n++;
	return `o${n}`;
}

/**
 * A fresh block id derived from `base`, unique in the course.
 * `L1_B3_poznej` → `L1_B3_poznej_copy` → `L1_B3_poznej_copy2` → …
 */
export function nextBlockId(
	base: string,
	course: Pick<CourseV2, 'blocks'>,
	reserved?: Reservations
): string {
	const taken = new Set([...course.blocks.map((b) => b.block_id), ...(reserved?.blocks ?? [])]);
	const stem = base.replace(/_copy\d*$/, '');
	let candidate = `${stem}_copy`;
	let n = 2;
	while (taken.has(candidate)) candidate = `${stem}_copy${n++}`;
	return candidate;
}

/** A fresh lesson id derived from `base`, unique in the course. */
export function nextLessonId(
	base: string,
	course: Pick<CourseV2, 'lessons'>,
	reserved?: Reservations
): string {
	const taken = new Set([...course.lessons.map((l) => l.lesson_id), ...(reserved?.lessons ?? [])]);
	const stem = base.replace(/_copy\d*$/, '');
	let candidate = `${stem}_copy`;
	let n = 2;
	while (taken.has(candidate)) candidate = `${stem}_copy${n++}`;
	return candidate;
}

/** A lesson id for a brand new lesson: `L1`, `L2`, … */
export function newLessonId(course: Pick<CourseV2, 'lessons'>, reserved?: Reservations): string {
	const taken = new Set([...course.lessons.map((l) => l.lesson_id), ...(reserved?.lessons ?? [])]);
	let n = course.lessons.length + 1;
	while (taken.has(`L${n}`)) n++;
	return `L${n}`;
}

/** A block id for a brand new block, scoped to its lesson: `L1_B3`. */
export function newBlockId(
	course: Pick<CourseV2, 'blocks'>,
	lessonId?: string,
	reserved?: Reservations
): string {
	const taken = new Set([...course.blocks.map((b) => b.block_id), ...(reserved?.blocks ?? [])]);
	const prefix = lessonId ? `${lessonId}_B` : 'B';
	let n = 1;
	while (taken.has(`${prefix}${n}`)) n++;
	return `${prefix}${n}`;
}

/**
 * Renumber a copied block's steps from `s1`, rewriting internal `go_to` targets.
 * §3 invariant 4: `go_to` targets that pointed *inside the original* and have no
 * counterpart in the copy are dropped rather than left dangling.
 */
export function renumberStepsForCopy(steps: readonly BlockStep[]): BlockStep[] {
	const idMap = new Map<string, string>();
	steps.forEach((step, i) => idMap.set(step.id, `s${i + 1}`));

	return steps.map((step, i) => {
		const next: BlockStep = { ...step, id: `s${i + 1}`, order: i + 1 };
		if (next.question?.options) {
			next.question = {
				...next.question,
				options: next.question.options.map((opt) => remapOptionGoTo(opt, idMap))
			};
		}
		void i;
		return next;
	});
}

function remapOptionGoTo(option: QuestionOption, idMap: Map<string, string>): QuestionOption {
	const target = option.go_to;
	if (!target) return option;
	if (idMap.has(target)) return { ...option, go_to: idMap.get(target)! };
	if (STEP_ID.test(target)) {
		// Pointed at a step id that the copy does not have — drop rather than dangle.
		const { go_to: _dropped, ...rest } = option;
		void _dropped;
		return rest as QuestionOption;
	}
	// A keyword or a cross-block target: still valid in the copy.
	return option;
}

/** Copy a block under a fresh id, with copied steps renumbered. */
export function duplicateBlockValue(block: BlockV2, newId: string): BlockV2 {
	return { ...block, block_id: newId, steps: renumberStepsForCopy(block.steps) };
}
