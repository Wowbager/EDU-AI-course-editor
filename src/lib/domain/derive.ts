/**
 * Values the author controls indirectly: XP (§10) and duration (§4).
 *
 * The editor shows these live because both are promises to the student that move
 * whenever a step is added or removed.
 */
import type { BlockV2, CourseV2, LessonV2 } from './schema';
import type { DocIndex } from './index-doc';

/** `"3 min"` / `"3"` / `3` → 3. Undefined when the block declares no duration. */
export function blockDurationMinutes(block: BlockV2): number | undefined {
	const raw = block.duration;
	if (typeof raw === 'number') return raw;
	if (typeof raw === 'string') {
		const m = /(\d+)/.exec(raw);
		if (m) return Number(m[1]);
	}
	const fallback = (block as Record<string, unknown>).duration_minutes;
	return typeof fallback === 'number' ? fallback : undefined;
}

/**
 * §10 — what the platform awards when `xp` is omitted: +1 per content step,
 * +8 per question step, never below 1.
 */
export function derivedBlockXp(block: BlockV2): number {
	let xp = 0;
	for (const step of block.steps) xp += step.type === 'question' ? 8 : 1;
	if (block.steps.length === 0) xp = block.type === 'display' ? 1 : 8;
	return Math.max(xp, 1);
}

/** The XP a block actually awards: authored if present, derived otherwise. */
export function effectiveBlockXp(block: BlockV2): number {
	return typeof block.xp === 'number' ? block.xp : derivedBlockXp(block);
}

export interface LessonTotals {
	/** Sum of block durations, clamped 1–120; estimated at ~4 min/block when none declare one. */
	durationMinutes: number;
	/** True when the figure is an estimate because no block declares a duration. */
	durationEstimated: boolean;
	/** §14 warning 2: some blocks declare a duration and some do not. */
	durationPartial: boolean;
	xp: number;
	blockCount: number;
	questionStepCount: number;
}

export function lessonTotals(lesson: LessonV2, index: DocIndex): LessonTotals {
	let total = 0;
	let withDuration = 0;
	let xp = 0;
	let questionStepCount = 0;
	let resolved = 0;

	for (const binding of lesson.blocks) {
		const block = index.blocksById.get(binding.block_id);
		if (block === undefined) continue;
		resolved++;
		const minutes = blockDurationMinutes(block);
		if (minutes !== undefined && minutes > 0) {
			total += minutes;
			withDuration++;
		}
		xp += effectiveBlockXp(block);
		questionStepCount += block.steps.filter((s) => s.type === 'question').length;
	}

	const blockCount = lesson.blocks.length;
	const durationEstimated = withDuration === 0;
	const durationMinutes = durationEstimated
		? clamp(blockCount * 4, 5, 60)
		: clamp(total, 1, 120);

	return {
		durationMinutes,
		durationEstimated,
		durationPartial: withDuration > 0 && withDuration < resolved,
		xp,
		blockCount,
		questionStepCount
	};
}

export interface CourseTotals {
	/** Sum of lesson durations. `estimated_minutes` overrides it on the course card. */
	durationMinutes: number;
	xp: number;
	lessonCount: number;
	blockCount: number;
	/** XP a student can actually earn, after the course-level `max_xp` cap (§3.4). */
	cappedXp: number;
}

export function courseTotals(doc: CourseV2, index: DocIndex): CourseTotals {
	let durationMinutes = 0;
	let xp = 0;
	for (const lesson of doc.lessons) {
		const totals = lessonTotals(lesson, index);
		durationMinutes += totals.durationMinutes;
		xp += totals.xp;
	}
	const cappedXp = typeof doc.max_xp === 'number' ? Math.min(xp, doc.max_xp) : xp;
	return { durationMinutes, xp, lessonCount: doc.lessons.length, blockCount: doc.blocks.length, cappedXp };
}

/** §15 — the didactic summary shown per lesson. */
export interface LessonDidactics {
	bloom: Record<number, number>;
	questionTypes: Record<string, number>;
	practiceShare: number;
	/** Share of wrong options that carry feedback — the teaching-opportunity metric. */
	wrongOptionFeedbackShare: number;
	wrongOptionCount: number;
}

export function lessonDidactics(lesson: LessonV2, index: DocIndex): LessonDidactics {
	const bloom: Record<number, number> = {};
	const questionTypes: Record<string, number> = {};
	let practiceBlocks = 0;
	let resolved = 0;
	let wrongOptions = 0;
	let wrongOptionsWithFeedback = 0;

	for (const binding of lesson.blocks) {
		const block = index.blocksById.get(binding.block_id);
		if (block === undefined) continue;
		resolved++;

		const level = block.learning?.bloom_level;
		if (typeof level === 'number') bloom[level] = (bloom[level] ?? 0) + 1;
		if (isPracticeBlock(block, binding.default_practice === true)) practiceBlocks++;

		for (const step of block.steps) {
			const question = step.question;
			if (question === undefined) continue;
			questionTypes[question.type] = (questionTypes[question.type] ?? 0) + 1;
			for (const option of question.options ?? []) {
				if (option.is_correct === true) continue;
				wrongOptions++;
				if (typeof option.feedback === 'string' && option.feedback.trim() !== '') {
					wrongOptionsWithFeedback++;
				}
			}
		}
	}

	return {
		bloom,
		questionTypes,
		practiceShare: resolved === 0 ? 0 : practiceBlocks / resolved,
		wrongOptionFeedbackShare: wrongOptions === 0 ? 1 : wrongOptionsWithFeedback / wrongOptions,
		wrongOptionCount: wrongOptions
	};
}

/** §11 — a block enters Cvičení if the block, any step, or a binding flags it. */
export function isPracticeBlock(block: BlockV2, bindingFlag = false): boolean {
	return (
		block.default_practice === true ||
		bindingFlag ||
		block.steps.some((step) => step.default_practice === true)
	);
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * The first line of a card's own text — what the author recognises it by.
 *
 * A teacher is never shown a `block_id` (§8), so every place that has to name a
 * card names it by what it says: the tree, the card header, and the branch labels
 * the preview is handed. Three call sites, one rule, or the same card would be
 * called three different things on one screen.
 */
export function blockPreview(block: BlockV2, max = 70): string {
	const source = block.steps.find((step) => (step.content ?? '').trim() !== '');
	const text = (source?.content ?? '')
		// Markdown and LaTeX delimiters are syntax, not words. A card called
		// "Zlomek $\frac{a}{b}$ popisuje…" is harder to recognise than one called
		// "Zlomek \frac{a}{b} popisuje…", and much harder than the prose around it.
		.replace(/\$+/g, '')
		.replace(/[#*_`>]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (text === '') return 'Karta bez textu';
	return text.length > max ? `${text.slice(0, max)}…` : text;
}
