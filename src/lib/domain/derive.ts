/**
 * Values the author controls indirectly: XP (§10) and duration (§4).
 *
 * The editor shows these live because both are promises to the student that move
 * whenever a step is added or removed.
 */
import type { BlockStep, BlockV2, CourseV2, LessonV2, QuestionConfig } from './schema';
import type { DocIndex } from './index-doc';
import { looksLikeMarkdown, parseMarkdown } from './markdown';
import { ALWAYS_MARKDOWN, SNIFFED, type DocNode } from './markdown/doc';
import { plainMath } from './plain-math';

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
 * §10 — the most XP a block can award, which the app shows as the lesson's reward:
 * +1 per content step, +8 per question step, never below 1 (`course_model.dart`,
 * `_calculateBlockMaxXp`; a legacy `evaluation` step counts as a question). A pupil
 * earns 8 for a question whose score is full (`scoreKoef >= 1`) and 5 otherwise
 * (`block_step_engine.dart`, `_completeBlock`). An authored `xp` is read by nothing.
 */
export function derivedBlockXp(block: BlockV2): number {
	let xp = 0;
	for (const step of block.steps) {
		const type: string = step.type;
		xp += type === 'question' || type === 'evaluation' ? 8 : 1;
	}
	if (block.steps.length === 0) xp = block.type === 'display' ? 1 : 8;
	return Math.max(xp, 1);
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
		if (block === undefined) {
			xp += 1; // `course_model.dart`: an unknown block gives the minimum
			continue;
		}
		resolved++;
		const minutes = blockDurationMinutes(block);
		if (minutes !== undefined && minutes > 0) {
			total += minutes;
			withDuration++;
		}
		xp += derivedBlockXp(block);
		questionStepCount += block.steps.filter((s) => s.type === 'question').length;
	}

	const blockCount = lesson.blocks.length;
	const durationEstimated = withDuration === 0;
	const durationMinutes = durationEstimated ? clamp(blockCount * 4, 5, 60) : clamp(total, 1, 120);

	return {
		durationMinutes,
		durationEstimated,
		durationPartial: withDuration > 0 && withDuration < resolved,
		xp: Math.max(xp, 1),
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
	return {
		durationMinutes,
		xp,
		lessonCount: doc.lessons.length,
		blockCount: doc.blocks.length,
		cappedXp
	};
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

/**
 * Whether any lesson flags its binding of the block for practice — the legacy flag
 * (`bindingFlag` of `isPracticeBlock`) for a card that more than one lesson binds.
 */
export function bindingFlagsPractice(doc: CourseV2, blockId: string): boolean {
	return doc.lessons.some((lesson) =>
		lesson.blocks.some((b) => b.block_id === blockId && b.default_practice === true)
	);
}

/**
 * Whether a step's own "Zařadit do cvičení" is worth offering. The flag on a step is
 * only a way to put the card into practice (`isPracticeBlock`); when the card's own
 * flag or a lesson's binding already does, the step's switch changes nothing, so it
 * stays out of the way. A step whose flag is already on keeps its switch, so it can
 * still be turned off.
 */
export function stepPracticeOffered(doc: CourseV2, block: BlockV2, step: BlockStep): boolean {
	if (step.default_practice === true) return true;
	return block.default_practice !== true && !bindingFlagsPractice(doc, block.block_id);
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const truncate = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * The name a card has when its author has not given it one: the first line of its
 * own text.
 *
 * Kept separate from `blockPreview` for one reason — the title field on the card
 * has to show this as its placeholder, so that an author who has not filled it in
 * can see what the card is currently called and that clearing the field goes back
 * to it. A second copy of the rule in the component would drift from this one.
 *
 * `position` is the card's place in its lesson, and it is used only when there is
 * no text at all. Three freshly added cards are otherwise all called "Karta bez
 * textu" and are indistinguishable in the tree; "Karta 3" is where it is. Nothing
 * is written to the document to produce it — an empty card stays empty, so the
 * name follows the card when it is reordered instead of going stale.
 */
export function derivedBlockName(block: BlockV2, max = 70, position?: number): string {
	const source = block.steps.find((step) => (step.content ?? '').trim() !== '');
	const text = firstSentence(plainFirstLine(source?.content ?? ''));
	if (text === '') return position === undefined ? 'Karta bez textu' : `Karta ${position}`;
	return truncate(text, max);
}

/**
 * The first line of some Markdown, as words: the syntax stripped, whitespace
 * collapsed. Shared by the card's name and a folded step's summary line, so that
 * the two never disagree about what the author wrote.
 */
export function plainFirstLine(markdown: string): string {
	// The one reading of the text is the markdown domain's: what the visual editor
	// would show, so a plain text keeps every `*` and `_` it was typed with and
	// OPEN-PROBLEMS #55's escapes are undone there.
	// Only the head is parsed: this runs for every tree row and step summary on every
	// edit. Whether the app would show the whole text as Markdown is decided on all of it.
	const dialect = looksLikeMarkdown(markdown) ? ALWAYS_MARKDOWN : SNIFFED;
	const { doc } = parseMarkdown(head(markdown), dialect);
	return (
		docLines(doc)
			.map((line) => line.replace(/\s+/g, ' ').trim())
			.find((line) => line !== '') ?? ''
	);
}

const HEAD_CHARS = 500;

/**
 * The start of a text that holds its first line: up to the first blank line, or
 * `HEAD_CHARS`, whichever is shorter. A cut never lands inside a formula or a link.
 */
function head(markdown: string): string {
	const text = markdown.replace(/^\s+/, '');
	const blank = /\n[ \t]*\n/.exec(text);
	let end = blank === null ? text.length : blank.index;
	if (end > HEAD_CHARS) {
		end = HEAD_CHARS;
		const cut = text.slice(0, end);
		if ((cut.match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1) {
			const close = text.indexOf('$', end);
			end = close < 0 ? text.length : close + 1;
		} else if (cut.lastIndexOf('[') > cut.lastIndexOf(')')) {
			const close = text.indexOf(')', end);
			end = close < 0 ? end : close + 1;
		}
	}
	return text.slice(0, end);
}

/**
 * The document as lines of words: every block, table row and hard break starts a
 * new one. An image reads as its description and a formula as its LaTeX, without the
 * `$` that wrote it ("Zlomek \frac{a}{b} popisuje…" is easier to recognise than the
 * same with delimiters). A link is its words; the address is not part of them.
 */
function docLines(root: DocNode): string[] {
	const lines: string[] = [''];
	const newLine = () => {
		if (lines[lines.length - 1] !== '') lines.push('');
	};
	const walk = (node: DocNode) => {
		if (node.type === 'text') lines[lines.length - 1] += node.text ?? '';
		else if (node.type === 'math')
			lines[lines.length - 1] += plainMath(String(node.attrs?.latex ?? ''));
		else if (node.type === 'image') lines[lines.length - 1] += String(node.attrs?.alt ?? '');
		else if (node.type === 'hardBreak') newLine();
		else if (node.type === 'tableRow') {
			const cells = (node.content ?? []).map((cell) => docLines(cell).join(' ').trim());
			lines[lines.length - 1] += cells.join(' | ');
			newLine();
		} else {
			node.content?.forEach(walk);
			newLine();
		}
	};
	walk(root);
	return lines;
}

/**
 * A card whose text is one paragraph has a first line that is the whole paragraph,
 * and the tree then names it "Dnes se naučíme, co je to fotosyntéza. Je to proces,
 * při …". The first sentence is the name an author would have given it.
 *
 * Only a full stop, "!", "?" or "…" followed by a space and a capital letter ends a
 * sentence here, so "3.5", "1. díl" and "tj. voda" do not; and a "sentence" shorter
 * than a few words is more likely an abbreviation or a numbered heading than a
 * name, so the line is kept whole then.
 */
const SENTENCE_END = /[.!?…](?=\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/gu;
const MIN_SENTENCE = 16;

function firstSentence(line: string): string {
	for (const match of line.matchAll(SENTENCE_END)) {
		if (match.index + 1 >= MIN_SENTENCE) return line.slice(0, match.index + 1);
	}
	return line;
}

/**
 * The one line a folded step shows in place of its body.
 *
 * It used to be the raw field — Markdown asterisks included, and for a picture the
 * whole address, so a teacher read "https://upload.wiki…" where they had put a photo
 * of a leaf. Text is the same plain first line the card's name uses; a picture is
 * its description, or failing that its file name; video and audio are their file
 * name. Truncation is the caller's business (CSS), because the room varies.
 */
export function stepSummary(step: BlockStep): string {
	const text = plainFirstLine(step.content ?? '');
	if (step.type === 'text') return text;
	if (step.type === 'question') {
		// A question whose prompt is the text step above it is recognised by its answers.
		if (text !== '') return text;
		return (step.question?.options ?? [])
			.map((option) => plainFirstLine(option.text))
			.filter((option) => option !== '')
			.join(' · ');
	}
	if (step.type === 'image') {
		const alt = (step.image?.alt ?? '').trim();
		return alt !== '' ? alt : mediaFileName(step.image?.url) || text;
	}
	if (step.type === 'video') return mediaFileName(step.video?.url) || text;
	if (step.type === 'audio') return mediaFileName(step.audio?.url) || text;
	return text;
}

/** "https://upload.wikimedia.org/…/Leaf%201.jpg?x=1" → "Leaf 1.jpg". */
export function mediaFileName(url: string | undefined): string {
	const raw = (url ?? '').trim();
	if (raw === '') return '';
	try {
		const parsed = new URL(raw);
		const last = parsed.pathname
			.split('/')
			.filter((part) => part !== '')
			.at(-1);
		if (last === undefined) return parsed.hostname;
		try {
			return decodeURIComponent(last);
		} catch {
			return last;
		}
	} catch {
		// Not an absolute address — a relative path or something half-typed.
		return (
			raw
				.split(/[?#]/)[0]
				.split('/')
				.filter((part) => part !== '')
				.at(-1) ?? raw
		);
	}
}

/**
 * What a card is called — the author's own title when it has one, the first line
 * of its text when it does not.
 *
 * A teacher is never shown a `block_id` (§8), so every place that has to name a
 * card comes here: the tree, the card header, and the branch labels the preview is
 * handed. Three call sites, one rule, or the same card would be called three
 * different things on one screen — which is also why the authored title is read
 * here and not only in the header that edits it.
 *
 * An absent title and an empty one are the same thing on purpose: clearing the
 * field deletes the key (§ "parsing never injects defaults"), and a document that
 * carried `"name": ""` on every card would fail the round trip the first time it
 * was saved.
 */
export function blockPreview(block: BlockV2, max = 70, position?: number): string {
	const authored = (block.name ?? '').trim();
	// Display only: the authored text may carry LaTeX, and it stays that way in the document.
	if (authored !== '') return truncate(plainMath(authored), max);
	return derivedBlockName(block, max, position);
}

/**
 * Whether an answer's own outcome — where it leads (`go_to`) and its grade (`mark`) —
 * counts for this question. It does only when the pupil picks one answer.
 *
 * Mirrors the app: `BlockStepEngine._evaluateStep` takes its `goToValue` and
 * `markValue` from the chosen option only in the last branch, the single-select /
 * true-false one (`block_step_engine.dart`). The `allowMultiple` branch above it
 * judges the whole set and reads neither, and `numeric` and `open` questions never
 * look at their options' outcomes. `_continueAfterSolution` likewise follows only
 * `selectedOptionId`, which a multi-select never sets, and `QuizPage._checkAnswer`
 * (`quiz_page.dart`) reads no outcome on an option either way. A multi-select
 * question can still branch on the question as a whole (`next_actions`), which is not
 * an option's value.
 *
 * (`score_koef` is skipped in the multi-select branch too; that column is
 * advanced-only and not part of this rule.)
 */
export function optionOutcomesApply(
	question: Pick<QuestionConfig, 'type' | 'allow_multiple'> | undefined
): boolean {
	if (question === undefined) return true;
	if (question.allow_multiple === true) return false;
	return question.type === 'multiple_choice' || question.type === 'true_false';
}
