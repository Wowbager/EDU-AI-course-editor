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
import type {
	BlockStep,
	BlockV2,
	CourseV2,
	LessonV2,
	QuestionConfig,
	QuestionOption
} from './schema';
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

/** Where a card is, for naming it. See `cardPlace`. */
export interface CardPlace {
	/** The lesson the position is counted in; undefined for a card in no lesson. */
	lesson: LessonV2 | undefined;
	/** 1-based: in `lesson` when there is one, else in `doc.blocks`. Undefined if not found. */
	position: number | undefined;
}

/**
 * The one rule for "where is this card", which the name of a card with no text
 * follows ("Karta 3"). The position is counted in `lessonId` when the card is in it;
 * else in the first lesson that has the card (a card can be in several, and a place
 * with no lesson to ask — a picker, a validation message — has to pick one the same
 * way everywhere); else the card is in no lesson and its position is in `doc.blocks`,
 * with `lesson` undefined so the caller can say "mimo lekce".
 */
export function cardPlace(
	doc: CourseV2,
	block: BlockV2,
	opts: { lessonId?: string } = {}
): CardPlace {
	const holds = (l: LessonV2) => l.blocks.some((b) => b.block_id === block.block_id);
	const given =
		opts.lessonId === undefined
			? undefined
			: doc.lessons.find((l) => l.lesson_id === opts.lessonId);
	const lesson = given !== undefined && holds(given) ? given : doc.lessons.find(holds);
	if (lesson !== undefined) {
		return {
			lesson,
			position: lesson.blocks.findIndex((b) => b.block_id === block.block_id) + 1
		};
	}
	const index = doc.blocks.indexOf(block);
	const position =
		(index >= 0 ? index : doc.blocks.findIndex((b) => b.block_id === block.block_id)) + 1;
	return { lesson: undefined, position: position > 0 ? position : undefined };
}

const UNKNOWN_CARD = 'Neznámá karta';

/**
 * What the card is called, everywhere: its author-given title, else the first line of
 * its own text, else "Karta 3" by `cardPlace`. The tree, the rail, the pickers, the
 * preview's branch labels and the validation messages all come here, so a card is
 * never one thing in the tree and another in Kontrola kurzu. Pass the block itself
 * when the id may be duplicated (the message about the duplicate names both).
 */
export function cardLabel(
	doc: CourseV2,
	card: BlockV2 | string,
	opts: { lessonId?: string; max?: number } = {}
): string {
	const block = typeof card === 'string' ? doc.blocks.find((b) => b.block_id === card) : card;
	if (block === undefined) return UNKNOWN_CARD;
	return blockPreview(block, opts.max ?? DEFAULT_CARD_MAX, cardPlace(doc, block, opts).position);
}

/** "část 2/3": which part of one teacher's card a block is (`domain/groups.ts`). */
export const partLabel = (index: number, total: number): string => `část ${index + 1}/${total}`;

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

/**
 * The step as a heading or a name on its own: "Krok 2", or its id in the mode that
 * shows ids (Pokročilý). One place for the per-mode decision, so the chip on the step,
 * the go-to picker and the "teď nikam nevede" notice never name one step two ways.
 */
export function stepName(
	block: BlockV2,
	step: BlockStep,
	opts: { showIds?: boolean } = {}
): string {
	return opts.showIds === true ? step.id : capitalize(stepLabel(block, step));
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

// ---------------------------------------------------------------------------
// Names that tell cards apart, wherever a teacher picks one.
//
// Two cards can share a name (two "Kolik je?", or several still-empty "Karta 1" in
// different lessons). A picker would then show two identical lines. So a card whose
// name another card shares also carries its place — "Lekce 2, karta 3", or "mimo
// lekce" — shown as a second line or after the name. Nothing is written to the
// document. The name itself is `cardLabel`.
// ---------------------------------------------------------------------------

export interface CardName {
	id: string;
	name: string;
	/** "Lekce 2, karta 3", or "mimo lekce". */
	place: string;
	/** Only the lesson: "Lekce 2", or "mimo lekce". */
	lesson: string;
	/** Another card has the same name, so `place` is needed to tell them apart. */
	collides: boolean;
	/** `name`, followed by `place` when the name alone would be ambiguous. */
	label: string;
}

export interface CardGroup {
	title: string;
	cards: CardName[];
}

const OUTSIDE = 'mimo lekce';
const sameName = (name: string) => name.trim().toLowerCase();

/**
 * Every card's name and place, by `cardPlace` with no lesson to ask: a card in several
 * lessons is placed where its first lesson has it.
 */
export function cardNames(doc: CourseV2, max = 50): Map<string, CardName> {
	const result = new Map<string, CardName>();
	for (const card of doc.blocks) {
		if (result.has(card.block_id)) continue;
		const { lesson, position } = cardPlace(doc, card);
		const where = lesson === undefined ? OUTSIDE : lessonLabel(doc, lesson);
		result.set(card.block_id, {
			id: card.block_id,
			name: cardLabel(doc, card, { max }),
			place: lesson === undefined ? OUTSIDE : `${where}, karta ${position}`,
			lesson: where,
			collides: false,
			label: ''
		});
	}

	const counts = new Map<string, number>();
	for (const c of result.values())
		counts.set(sameName(c.name), (counts.get(sameName(c.name)) ?? 0) + 1);
	for (const c of result.values()) {
		c.collides = (counts.get(sameName(c.name)) ?? 0) > 1;
		c.label = c.collides ? `${c.name} · ${c.place}` : c.name;
	}
	return result;
}

/** Cards by lesson in lesson order, those in no lesson last under „Karty mimo lekce“. */
export function cardGroups(
	doc: CourseV2,
	opts: { exclude?: ReadonlySet<string> | string; max?: number } = {}
): CardGroup[] {
	const names = cardNames(doc, opts.max);
	const skip = (id: string) =>
		typeof opts.exclude === 'string' ? opts.exclude === id : (opts.exclude?.has(id) ?? false);
	const seen = new Set<string>();
	const groups: CardGroup[] = [];
	for (const lesson of doc.lessons) {
		const cards: CardName[] = [];
		for (const binding of lesson.blocks) {
			const card = names.get(binding.block_id);
			if (card === undefined || seen.has(card.id)) continue;
			seen.add(card.id);
			if (!skip(card.id)) cards.push(card);
		}
		if (cards.length > 0) groups.push({ title: lessonLabel(doc, lesson), cards });
	}
	const loose = doc.blocks
		.filter((b) => !seen.has(b.block_id) && !skip(b.block_id))
		.map((b) => names.get(b.block_id)!);
	if (loose.length > 0) groups.push({ title: 'Karty mimo lekce', cards: loose });
	return groups;
}
