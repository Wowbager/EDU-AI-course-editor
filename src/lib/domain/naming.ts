/**
 * Turns document ids back into what a teacher actually sees.
 *
 * `validate.ts` is keyed by `lesson_id` / `block_id` / step and option `id`s because
 * that is what the document is built from internally — but plan §8 and the comments
 * in `PreviewColumn.svelte` are explicit that a teacher is never shown an id: a step
 * is "Krok 3", a card is named by its own text, never by `block_id`. Every place that
 * used to interpolate a raw id into a message a teacher reads goes through here
 * instead, so there is exactly one rule for "what do we call this" rather than one
 * per call site drifting from the others.
 *
 * These are cheap, targeted lookups (`find`/`indexOf` over the one array that
 * matters — a lesson's bindings, a block's steps, a question's options), not a
 * rebuild of `DocIndex`: naming a handful of issues does not justify walking the
 * whole document graph again for each one.
 */
import type { BlockStep, BlockV2, CourseV2, LessonV2, QuestionConfig, QuestionOption } from './schema';
import { blockPreview } from './derive';

const DEFAULT_CARD_MAX = 40;

/** Upper-cases the first character only — for a label that opens a sentence. */
export function capitalize(text: string): string {
	return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** `lesson.name`, or "Lekce 2" by the lesson's 1-based position in the course. */
export function lessonLabel(doc: CourseV2, lesson: LessonV2): string {
	if (typeof lesson.name === 'string' && lesson.name.trim() !== '') return lesson.name.trim();
	const position = doc.lessons.indexOf(lesson) + 1;
	return `Lekce ${position > 0 ? position : '?'}`;
}

/** Same as `lessonLabel`, from an id that might not resolve (e.g. a dangling target). */
export function lessonLabelById(doc: CourseV2, lessonId: string): string | undefined {
	const lesson = doc.lessons.find((l) => l.lesson_id === lessonId);
	return lesson === undefined ? undefined : lessonLabel(doc, lesson);
}

/**
 * What `blockPreview` already calls the card — its author-given title, else the
 * first line of its own text, else "Karta 3" by its 1-based position. The position
 * is counted within `lessonId`'s binding list when one is given (a block can be
 * bound to several lessons, so "which lesson" changes the count), otherwise within
 * `doc.blocks`. `blockPreview` only falls back to the position when there is neither
 * a title nor any text, so an authored or written-to card is unaffected by it.
 */
export function blockLabel(
	doc: CourseV2,
	block: BlockV2,
	opts: { lessonId?: string; max?: number } = {}
): string {
	const lesson = opts.lessonId !== undefined
		? doc.lessons.find((l) => l.lesson_id === opts.lessonId)
		: undefined;
	const positionInLesson = lesson?.blocks.findIndex((b) => b.block_id === block.block_id) ?? -1;
	const position = positionInLesson >= 0 ? positionInLesson + 1 : doc.blocks.indexOf(block) + 1;
	return blockPreview(block, opts.max ?? DEFAULT_CARD_MAX, position > 0 ? position : undefined);
}

/** Same as `blockLabel`, from an id that might not resolve (e.g. a dangling target). */
export function blockLabelById(
	doc: CourseV2,
	blockId: string,
	opts: { lessonId?: string; max?: number } = {}
): string | undefined {
	const block = doc.blocks.find((b) => b.block_id === blockId);
	return block === undefined ? undefined : blockLabel(doc, block, opts);
}

/** The step's 1-based position within its block — the number `stepLabel` names. */
export function stepPosition(block: BlockV2, step: BlockStep): number {
	return block.steps.indexOf(step) + 1;
}

/**
 * `"krok 2"` — the 1-based position of the step within its block, matching the
 * `Krok {position}` chip `StepEditor.svelte` already shows the teacher. Lower-case,
 * because it is written to sit inside a sentence ("Krok 2 …" only at the very start
 * of one, where callers capitalise it themselves with `capitalize`).
 *
 * Czech declines "krok" by case ("kroku", "kroku", …), so a message that already
 * supplies the declined noun — "v kroku 2", "ke kroku 2" — should interpolate
 * `stepPosition` on its own rather than this, which only reads correctly in the
 * nominative ("Krok 2 …", the subject of a sentence).
 */
export function stepLabel(block: BlockV2, step: BlockStep): string {
	const position = stepPosition(block, step);
	return `krok ${position > 0 ? position : '?'}`;
}

/** Same as `stepLabel`, from an id that might not resolve (e.g. a dangling target). */
export function stepLabelById(block: BlockV2, stepId: string): string | undefined {
	const step = block.steps.find((s) => s.id === stepId);
	return step === undefined ? undefined : stepLabel(block, step);
}

const OPTION_TEXT_MAX = 40;

/**
 * `odpověď „Čitatel je 5“` by the option's own text, or `"2. odpověď"` by its
 * 1-based position among the question's options when the text is empty (which is
 * itself something another check already flags — `E_MC_EMPTY_OPTION_TEXT`).
 */
export function optionLabel(
	question: QuestionConfig | undefined,
	option: QuestionOption,
	opts: { max?: number } = {}
): string {
	const text = (option.text ?? '').trim();
	if (text !== '') {
		const max = opts.max ?? OPTION_TEXT_MAX;
		const short = text.length > max ? `${text.slice(0, max)}…` : text;
		return `odpověď „${short}“`;
	}
	const options = question?.options ?? [];
	const position = options.indexOf(option) + 1;
	return `${position > 0 ? position : '?'}. odpověď`;
}

/** Same as `optionLabel`, from an id that might not resolve (e.g. a dangling target). */
export function optionLabelById(
	question: QuestionConfig | undefined,
	optionId: string,
	opts: { max?: number } = {}
): string | undefined {
	const option = question?.options?.find((o) => o.id === optionId);
	return option === undefined ? undefined : optionLabel(question, option, opts);
}
