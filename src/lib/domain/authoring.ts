/**
 * Writing a card with AI: what counts as still empty, what the model is asked, and how
 * its answer lands in the document.
 *
 * The AI writes a whole card: an ordered list of steps. Steps the teacher already has
 * come back as `keep`, with only their empty parts filled; new steps are inserted around
 * them.
 *
 * One rule holds it together: **a field that is filled is never overwritten; only an
 * empty one is written.** `missingParts` is the single place that decides what "empty"
 * means. The button asks it whether to show, the request asks it what to send as given,
 * the server asks it what the model may return, and `fillCard` asks it again at the
 * moment of writing, so a field the teacher typed into while the model was thinking is
 * left alone.
 *
 * What the AI needs beyond the pupil's content rides in the document as keys the app
 * ignores: the course's `audience`, a card's `brief` (one line on what it is for) and
 * `field_origin` (which parts the AI wrote and nobody has changed since, keyed
 * `<step id>.<part>`).
 */
import { z } from 'zod';
import type { BlockStep, BlockV2, CourseV2, QuestionConfig, QuestionOption } from './schema';
import type { CommandResult } from './commands';
import { CommandError } from './commands';
import { nextStepIds, type Reservations } from './ids';

export const BRIEF_KEY = 'brief';
export const ORIGIN_KEY = 'field_origin';
export const AUDIENCE_KEY = 'audience';
/** The keys of the teacher's materials a card was planned from (`materials.ts`). */
export const SOURCE_REFS_KEY = 'source_refs';
/**
 * The teacher's request for a course, saved once on the course when an AI proposal of a
 * structure is accepted. A key the app ignores, like `audience`; the dossier carries it to
 * every card the AI writes.
 */
export const REQUEST_KEY = 'authoring_request';

/** Block keys that belong to the first block of a merged card only (`groups.ts`). */
export const AUTHORING_BLOCK_KEYS = [
	BRIEF_KEY,
	'note',
	ORIGIN_KEY,
	'review',
	SOURCE_REFS_KEY
] as const;

/** The section keys a card names as its sources, or none. */
export function sourceRefsOf(card: BlockV2 | undefined): string[] {
	const value = (card as Record<string, unknown> | undefined)?.[SOURCE_REFS_KEY];
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** A part of a step the AI can write. */
export const SLOTS = ['content', 'question', 'feedback', 'hint', 'help', 'solution'] as const;
export type Slot = (typeof SLOTS)[number];
export type Completeness = 'stub' | 'partial' | 'ready';
export type StepKind = 'text' | 'question' | 'media';

export const GEN_QUESTION_TYPES = ['yes_no', 'number', 'mcq_1', 'mcq_n', 'open'] as const;
export type GenQuestionType = (typeof GEN_QUESTION_TYPES)[number];

export type CardKind = BlockV2['type'];

/**
 * How many steps a card may end up with. The prompt asks for the usual size; these are
 * the hard limits the server enforces, wide enough that a count the teacher states in
 * the brief ("10 příkladů") is not refused.
 */
export const CARD_BOUNDS: Record<
	CardKind,
	{ texts: [number, number]; questions: [number, number] }
> = {
	display: { texts: [1, 10], questions: [0, 0] },
	exercise: { texts: [0, 8], questions: [1, 12] },
	question: { texts: [0, 8], questions: [1, 6] }
};

/** Longest dossier the server takes: 150k tokens at about 3 characters each, with room. */
export const MAX_CONTEXT_CHARS = 600_000;

/** Longest text of the teacher's materials one request carries (`materials.ts`). */
export const MAX_MATERIALS_CHARS = 700_000;

/** Pictures the teacher attached (`materials.ts`): each goes with every proposal and plan. */
export const MAX_PICTURES = 10;
/** An id in the image store (`server/images/files.ts`, `IMAGE_ID_RE`). */
export const PICTURE_ID = /^[0-9a-f-]{36}(?:-[A-Za-z0-9_-]{1,60})?\.[a-z0-9]{2,5}$/i;
/** A section's key in the materials (`materials.ts`). */
const SECTION_KEY = /^[0-9a-f]{8}\.\d{1,4}$/;
/** A picture that goes with a request: its section's key and its id in the image store. */
export const pictureRefSchema = z.object({
	key: z.string().regex(SECTION_KEY),
	id: z.string().regex(PICTURE_ID)
});
export type PictureRef = z.infer<typeof pictureRefSchema>;
/** The pictures sent with a request; the server puts each in front of the model. */
export const picturesSchema = z.array(pictureRefSchema).max(MAX_PICTURES);
/** The keys of the pictures a card may show (`write_card`'s picture steps). */
export const pictureKeysSchema = z.array(z.string().regex(SECTION_KEY)).max(MAX_PICTURES);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const filled = (value: unknown): boolean => text(value) !== '';

const stepKind = (step: BlockStep): StepKind =>
	step.type === 'text' ? 'text' : step.type === 'question' ? 'question' : 'media';

// ───────────────────────────────── what is empty ─────────────────────────────────

const optionsOf = (q: QuestionConfig | undefined): QuestionOption[] => q?.options ?? [];
const isChoice = (q: QuestionConfig | undefined) =>
	q?.type === 'multiple_choice' || q?.type === 'true_false';

/** A choice question nobody has written an answer into yet. */
const untouchedChoice = (q: QuestionConfig | undefined): boolean =>
	q === undefined || (q.type === 'multiple_choice' && optionsOf(q).every((o) => !filled(o.text)));

/**
 * Whether a question step has its task in words: its own text, or a written text step
 * above it, after the previous question.
 */
function hasTask(card: BlockV2, step: BlockStep): boolean {
	if (filled(step.content)) return true;
	for (let i = card.steps.indexOf(step) - 1; i >= 0; i--) {
		const above = card.steps[i];
		if (above.type === 'question') return false;
		if (above.type === 'text' && filled(above.content)) return true;
	}
	return false;
}

/** Which parts of one step are still empty, in `SLOTS` order. */
function missingOf(card: BlockV2, step: BlockStep): Slot[] {
	if (step.type === 'text') return filled(step.content) ? [] : ['content'];
	if (step.type !== 'question') return [];
	const q = step.question;
	const missing: Slot[] = [];
	const noText = !hasTask(card, step);
	if (noText) missing.push('content');

	let noQuestion: boolean;
	if (q === undefined || q.type === 'multiple_choice') noQuestion = untouchedChoice(q);
	// Ano/Ne always has its two answers; without a statement the marked one means nothing.
	else if (q.type === 'true_false') noQuestion = noText;
	else if (q.type === 'numeric') noQuestion = typeof q.correct_number !== 'number';
	else noQuestion = !filled(q.correct_answer);
	if (noQuestion) missing.push('question');
	else if (isChoice(q) && optionsOf(q).some((o) => filled(o.text) && !filled(o.feedback)))
		missing.push('feedback');

	if (!filled(step.hint) && !filled(card.hint)) missing.push('hint');
	if (!filled(step.help) && !filled(card.help)) missing.push('help');
	if (!filled(q?.solution)) missing.push('solution');
	return missing;
}

export interface StepGap {
	stepId: string;
	kind: StepKind;
	missing: Slot[];
}

/** The steps of the card that still have an empty part, with which parts. */
export function missingParts(card: BlockV2): StepGap[] {
	return card.steps.flatMap((step) => {
		const missing = missingOf(card, step);
		return missing.length > 0 ? [{ stepId: step.id, kind: stepKind(step), missing }] : [];
	});
}

const ALL: Record<'text' | 'question', readonly Slot[]> = {
	text: ['content'],
	question: ['content', 'question', 'hint', 'help', 'solution']
};

/**
 * `stub`: nothing written yet. `partial`: something is, something is not. `ready`:
 * nothing to add. A card with no step at all is a stub.
 */
export function completeness(card: BlockV2): Completeness {
	if (card.steps.length === 0) return 'stub';
	const gaps = missingParts(card);
	if (gaps.length === 0) return 'ready';
	const untouched =
		gaps.length === card.steps.length &&
		gaps.every((g) => g.kind !== 'media' && g.missing.length === ALL[g.kind].length);
	return untouched ? 'stub' : 'partial';
}

// ───────────────────────────────── the request ─────────────────────────────────

const genOptionSchema = z.object({
	text: z.string().trim().min(1),
	correct: z.boolean(),
	feedback: z.string().trim().min(1)
});

export const genQuestionSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('yes_no'),
		answer: z.boolean(),
		feedback_true: z.string().trim().min(1),
		feedback_false: z.string().trim().min(1)
	}),
	z.object({
		type: z.literal('number'),
		answer: z.number(),
		tolerance: z.number().min(0).optional()
	}),
	z.object({
		type: z.literal('mcq_1'),
		options: z.array(genOptionSchema).min(3).max(4),
		do_not_shuffle: z.boolean().optional()
	}),
	z.object({
		type: z.literal('mcq_n'),
		options: z.array(genOptionSchema).min(4).max(6),
		do_not_shuffle: z.boolean().optional()
	}),
	z.object({ type: z.literal('open'), answer: z.string().trim().min(1) })
]);
export type GenQuestion = z.infer<typeof genQuestionSchema>;

/** What the model may add to a step the teacher started: only parts that were empty. */
export const fillSchema = z.object({
	content_md: z.string().trim().min(1).optional(),
	question: genQuestionSchema.optional(),
	/** One reaction per answer the teacher wrote, in their order. */
	option_feedback: z.array(z.string()).optional(),
	hint_md: z.string().trim().min(1).optional(),
	help_md: z.string().trim().min(1).optional(),
	solution_md: z.string().trim().min(1).optional()
});
export type Fill = z.infer<typeof fillSchema>;

/** The key each part has in a `Fill`, and in `field_origin` after the step's id. */
export const SLOT_KEY: Record<Slot, keyof Fill> = {
	content: 'content_md',
	question: 'question',
	feedback: 'option_feedback',
	hint: 'hint_md',
	help: 'help_md',
	solution: 'solution_md'
};

const keepSchema = z.object({ keep: z.string(), fill: fillSchema.optional() });
const newTextSchema = z.object({ kind: z.literal('text'), content_md: z.string().trim().min(1) });
const newQuestionSchema = z.object({
	kind: z.literal('question'),
	content_md: z.string().trim().min(1),
	question: genQuestionSchema,
	hint_md: z.string().trim().min(1),
	help_md: z.string().trim().min(1),
	solution_md: z.string().trim().min(1)
});

/** One of the teacher's pictures, as a picture step of its own (`picture` is its key). */
const newPictureSchema = z.object({
	kind: z.literal('picture'),
	picture: z.string(),
	alt: z.string().trim().min(1)
});

/** `eduai.gen-card/2`: the card, step by step. */
export const generatedCardSchema = z.object({
	steps: z.array(z.union([keepSchema, newTextSchema, newQuestionSchema, newPictureSchema])).min(1)
});
export type GeneratedCard = z.infer<typeof generatedCardSchema>;
export type GeneratedStep = GeneratedCard['steps'][number];

export const audienceSchema = z.object({
	grade: z.number().int().optional(),
	purpose: z.enum(['intro', 'practice', 'exam_prep']).optional(),
	prior_knowledge: z.string().optional(),
	register: z.string().optional()
});

const requestStepSchema = z.object({
	id: z.string(),
	kind: z.enum(['text', 'question', 'media']),
	content_md: z.string().optional(),
	/** Fixed by the teacher's choice of question type; absent when the model may choose. */
	question_type: z.enum(GEN_QUESTION_TYPES).optional(),
	question: z.unknown().optional(),
	hint_md: z.string().optional(),
	help_md: z.string().optional(),
	solution_md: z.string().optional(),
	/** The parts of this step that are empty; the model fills exactly these. */
	missing: z.array(z.enum(SLOTS))
});
export type RequestStep = z.infer<typeof requestStepSchema>;

export const genRequestSchema = z.object({
	schema: z.literal('eduai.gen-request/2'),
	mode: z.enum(['generate', 'complete']),
	course: z.object({
		title: z.string(),
		language: z.string(),
		audience: audienceSchema
	}),
	lesson: z.object({ name: z.string(), takeaway: z.string().optional() }),
	card: z.object({
		kind: z.enum(['display', 'exercise', 'question']),
		title: z.string(),
		brief: z.string().optional(),
		steps: z.array(requestStepSchema)
	}),
	/** The course dossier (`dossier.ts`). The server sends it as a message of its own. */
	context: z.string().max(MAX_CONTEXT_CHARS),
	/** The teacher's materials as `renderMaterials` makes them; a message of its own, after the dossier. */
	materials: z.string().max(MAX_MATERIALS_CHARS).optional(),
	/** The pictures among them the card may show. */
	picture_keys: pictureKeysSchema.optional()
});
export type GenRequest = z.infer<typeof genRequestSchema>;

/** The question as the request states it; `feedback` is absent where the teacher wrote none. */
function givenQuestion(q: QuestionConfig): { type: GenQuestionType; [key: string]: unknown } {
	if (q.type === 'numeric')
		return { type: 'number', answer: q.correct_number, tolerance: q.tolerance ?? 0 };
	if (q.type === 'open') return { type: 'open', answer: q.correct_answer };
	const options = optionsOf(q)
		.filter((o) => filled(o.text))
		.map((o) => ({
			text: text(o.text),
			correct: o.is_correct === true,
			...(filled(o.feedback) ? { feedback: text(o.feedback) } : {})
		}));
	if (q.type === 'true_false') return { type: 'yes_no', options };
	return { type: q.allow_multiple === true ? 'mcq_n' : 'mcq_1', options };
}

function fixedType(q: QuestionConfig | undefined): GenQuestionType | undefined {
	if (q === undefined || untouchedChoice(q))
		return q?.allow_multiple === true ? 'mcq_n' : undefined;
	if (q.type === 'numeric') return 'number';
	if (q.type === 'open') return 'open';
	if (q.type === 'true_false') return 'yes_no';
	return q.allow_multiple === true ? 'mcq_n' : 'mcq_1';
}

const stringAt = (node: unknown, key: string): string | undefined => {
	const value = (node as Record<string, unknown> | undefined)?.[key];
	return filled(value) ? text(value) : undefined;
};

function requestStep(card: BlockV2, step: BlockStep, missing: Slot[]): RequestStep {
	const out: RequestStep = { id: step.id, kind: stepKind(step), missing };
	const content = stringAt(step, 'content');
	if (content !== undefined) out.content_md = content;
	if (out.kind !== 'question') return out;
	if (!missing.includes('question') && step.question !== undefined)
		out.question = givenQuestion(step.question);
	const hint = stringAt(step, 'hint') ?? stringAt(card, 'hint');
	const help = stringAt(step, 'help') ?? stringAt(card, 'help');
	const solution = stringAt(step.question, 'solution');
	if (hint !== undefined) out.hint_md = hint;
	if (help !== undefined) out.help_md = help;
	if (solution !== undefined) out.solution_md = solution;
	const fixed = fixedType(step.question);
	if (fixed !== undefined) out.question_type = fixed;
	return out;
}

/**
 * The request for one card, or `undefined` when there is nothing for AI to write.
 * `context` is the course dossier (`buildDossier`).
 */
export function buildGenRequest(
	doc: CourseV2,
	blockId: string,
	lessonId?: string,
	context = '',
	materials = ''
): GenRequest | undefined {
	const card = doc.blocks.find((b) => b.block_id === blockId);
	if (card === undefined) return undefined;
	const state = completeness(card);
	if (state === 'ready') return undefined;

	const lesson =
		doc.lessons.find((l) => l.lesson_id === lessonId) ??
		doc.lessons.find((l) => l.blocks.some((b) => b.block_id === blockId));
	const raw = (doc as Record<string, unknown>)[AUDIENCE_KEY];
	const audience = audienceSchema.safeParse(raw ?? {});
	const gaps = new Map(missingParts(card).map((g) => [g.stepId, g.missing]));
	const brief = stringAt(card, BRIEF_KEY);

	return {
		schema: 'eduai.gen-request/2',
		mode: state === 'stub' ? 'generate' : 'complete',
		course: {
			title: text(doc.name),
			language: text(doc.language) || 'cs',
			audience: audience.success ? audience.data : {}
		},
		lesson: {
			name: text(lesson?.name),
			...(filled(lesson?.description) ? { takeaway: text(lesson?.description) } : {})
		},
		card: {
			kind: card.type,
			title: text(card.name),
			...(brief !== undefined ? { brief } : {}),
			steps: card.steps.map((step) => requestStep(card, step, gaps.get(step.id) ?? []))
		},
		context,
		...(materials !== '' ? { materials } : {})
	};
}

/**
 * Whether the card says enough for AI to write it: a name or a line on what it is for,
 * or content of its own to continue from.
 */
export function canGenerate(block: BlockV2): boolean {
	const state = completeness(block);
	if (state === 'ready') return false;
	return (
		filled(block.name) ||
		filled((block as Record<string, unknown>)[BRIEF_KEY]) ||
		state === 'partial'
	);
}

// ───────────────────────────────── checking the answer ─────────────────────────────────

/**
 * Why a text that is shown as typed (an open answer, a card or lesson name) cannot hold
 * what it holds, or `undefined`. The app draws these fields as plain text: a `$`, a LaTeX
 * command or Markdown would reach the pupil, and the teacher, as raw characters.
 */
export function plainTextProblem(value: string): string | undefined {
	if (/\$/.test(value)) return 'it holds a $ sign';
	if (/\\[a-zA-Z]+/.test(value)) return 'it holds a LaTeX command';
	if (/\*\*|__|`/.test(value)) return 'it holds Markdown (**, __ or a backtick)';
	if (/^\s*(#{1,6}\s|[-*+]\s)/m.test(value)) return 'a line starts as a heading or a list';
	return undefined;
}

/** The right number of right answers for the type; the model's word is not taken for it. */
export function questionIsSound(gen: GenQuestion): boolean {
	if (gen.type === 'mcq_1') return gen.options.filter((o) => o.correct).length === 1;
	if (gen.type === 'mcq_n') {
		const right = gen.options.filter((o) => o.correct).length;
		return right >= 2 && right < gen.options.length;
	}
	return true;
}

const KEY_SLOT = new Map<string, Slot>(SLOTS.map((slot) => [SLOT_KEY[slot], slot]));
const clip = (value: string) => (value.length > 40 ? `${value.slice(0, 40)}…` : value);

function fillProblem(step: RequestStep, fill: Fill): string | undefined {
	const given = Object.keys(fill).filter((key) => fill[key as keyof Fill] !== undefined);
	const asked = new Set(step.missing.map((slot) => SLOT_KEY[slot] as string));
	const extra = given.filter((key) => !asked.has(key));
	if (extra.length > 0)
		return `Step "${step.id}": ${extra.join(', ')} ${extra.length > 1 ? 'are' : 'is'} already written by the teacher and must not be given. Fill only: ${
			[...asked].join(', ') || 'nothing'
		}.`;
	const left = step.missing.filter((slot) => fill[SLOT_KEY[slot]] === undefined);
	if (left.length > 0)
		return `Step "${step.id}": these empty parts are missing from its "fill": ${left
			.map((slot) => SLOT_KEY[slot])
			.join(', ')}.`;
	if (fill.question !== undefined) {
		if (step.question_type !== undefined && fill.question.type !== step.question_type)
			return `Step "${step.id}": use the question type "${step.question_type}".`;
		if (!questionIsSound(fill.question)) return unsound(step.id);
		const plain = plainAnswer(fill.question, `Step "${step.id}"`);
		if (plain !== undefined) return plain;
	}
	if (fill.option_feedback !== undefined) {
		const options = (step.question as { options?: unknown[] } | undefined)?.options ?? [];
		if (fill.option_feedback.length !== options.length)
			return `Step "${step.id}": option_feedback must have exactly one text per given option (${options.length}).`;
	}
	return undefined;
}

const plainAnswer = (gen: GenQuestion, where: string): string | undefined => {
	if (gen.type !== 'open') return undefined;
	const why = plainTextProblem(gen.answer);
	return why === undefined
		? undefined
		: `${where}: the answer of an open question is plain text, but ${why}. Write it as typed text, such as 21/30 or x = 5, one accepted answer per line.`;
};

const unsound = (where: string) =>
	`${where}: the number of correct options does not fit the question type (mcq_1: exactly one; mcq_n: at least two, and at least one wrong).`;

/**
 * `undefined` when the answer can be written, else one sentence for the model that names
 * the mistake: every existing step once, in order, as `keep`; only empty parts filled;
 * a sound question; a card of a size its kind allows.
 */
export function cardProblem(request: GenRequest, answer: GeneratedCard): string | undefined {
	const existing = new Map(request.card.steps.map((s) => [s.id, s]));
	const expected = request.card.steps.map((s) => s.id);
	const kept = answer.steps.flatMap((s) => ('keep' in s ? [s.keep] : []));

	for (const id of kept)
		if (!existing.has(id))
			return `"keep" refers to "${clip(id)}", which is not a step of this card. Existing steps: ${expected.join(', ') || 'none'}.`;
	const seen = new Set<string>();
	for (const id of kept) {
		if (seen.has(id))
			return `Step "${id}" appears more than once. Each existing step appears exactly once as {"keep":"<id>"}.`;
		seen.add(id);
	}
	const absent = expected.find((id) => !seen.has(id));
	if (absent !== undefined)
		return `Existing step "${absent}" is missing from your answer. Every existing step must appear exactly once as {"keep":"<id>"}, so that nothing the teacher wrote is lost.`;
	if (kept.some((id, i) => id !== expected[i]))
		return `Existing steps must keep their original order (${expected.join(', ')}); new steps go before, between or after them.`;

	for (const item of answer.steps) {
		if ('keep' in item) {
			const problem = fillProblem(existing.get(item.keep)!, item.fill ?? {});
			if (problem !== undefined) return problem;
		} else if (item.kind === 'question') {
			if (request.card.kind === 'display')
				return 'A "display" card has text steps only; do not add question steps.';
			if (!questionIsSound(item.question)) return unsound('A new question step');
			const plain = plainAnswer(item.question, 'A new question step');
			if (plain !== undefined) return plain;
		} else if (item.kind === 'picture') {
			const keys = request.picture_keys ?? [];
			if (!keys.includes(item.picture))
				return keys.length === 0
					? 'The teacher attached no pictures: a picture step can only show one of them. Leave it out.'
					: `"${clip(item.picture)}" is not one of the teacher's pictures (${keys.join(', ')}). A picture step shows one of them, by its key.`;
		}
	}

	const bounds = CARD_BOUNDS[request.card.kind];
	const texts = answer.steps.filter((s) => !('keep' in s) && s.kind === 'text').length;
	const questions = answer.steps.filter((s) => !('keep' in s) && s.kind === 'question').length;
	const own = (kind: StepKind) => request.card.steps.filter((s) => s.kind === kind).length;
	const totalTexts = texts + own('text');
	const totalQuestions = questions + own('question');
	const [minT, maxT] = bounds.texts;
	const [minQ, maxQ] = bounds.questions;
	if (totalTexts < minT || totalTexts > Math.max(maxT, own('text')))
		return `A "${request.card.kind}" card has ${minT}–${maxT} text steps; your answer has ${totalTexts}.`;
	if (totalQuestions < minQ || totalQuestions > Math.max(maxQ, own('question')))
		return `A "${request.card.kind}" card has ${minQ}–${maxQ} question steps; your answer has ${totalQuestions}.`;
	return undefined;
}

// ───────────────────────────────── writing the answer ─────────────────────────────────

const OPTION_IDS = 'abcdefghijklmnopqrstuvwxyz';

/** A random source in [0, 1); tests pass a fixed one. */
export type Random = () => number;

/** Fisher–Yates on a copy. */
function shuffled<T>(items: readonly T[], random: Random): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * A question the model wrote whole. Choice options come in a random order unless the model
 * says their order means something (`do_not_shuffle`): models put the right answer first.
 * Ids go by final position.
 */
function questionFrom(
	previous: QuestionConfig | undefined,
	gen: GenQuestion,
	random: Random
): QuestionConfig {
	const base: QuestionConfig = {
		show_answers: true,
		show_solution: true,
		...previous
	} as QuestionConfig;
	delete base.options;
	delete base.allow_multiple;
	delete base.correct_number;
	delete base.tolerance;
	delete base.correct_answer;
	switch (gen.type) {
		case 'yes_no':
			return {
				...base,
				type: 'true_false',
				options: [
					{ id: 'true', text: 'Ano', is_correct: gen.answer, feedback: gen.feedback_true },
					{ id: 'false', text: 'Ne', is_correct: !gen.answer, feedback: gen.feedback_false }
				]
			};
		case 'number':
			return {
				...base,
				type: 'numeric',
				correct_number: gen.answer,
				...(gen.tolerance !== undefined && gen.tolerance > 0 ? { tolerance: gen.tolerance } : {})
			};
		case 'open':
			return { ...base, type: 'open', correct_answer: gen.answer };
		default:
			return {
				...base,
				type: 'multiple_choice',
				...(gen.type === 'mcq_n' ? { allow_multiple: true } : {}),
				options: (gen.do_not_shuffle === true ? gen.options : shuffled(gen.options, random)).map(
					(o, i) => ({
						id: OPTION_IDS[i],
						text: o.text,
						is_correct: o.correct,
						feedback: o.feedback
					})
				)
			};
	}
}

type Origins = Record<string, 'teacher' | 'ai'>;

const originsOf = (block: BlockV2): Origins => {
	const value = (block as Record<string, unknown>)[ORIGIN_KEY];
	return typeof value === 'object' && value !== null ? (value as Origins) : {};
};

/** `field_origin`'s key for one part of one step. */
const originKey = (stepId: string, key: string) => `${stepId}.${key}`;

/** Fill the parts of `step` that are empty now and that the model gave. */
function applyFill(
	step: BlockStep,
	missing: ReadonlySet<Slot>,
	fill: Fill,
	random: Random
): { step: BlockStep; written: string[] } {
	const written: string[] = [];
	let next = step;
	if (missing.has('content') && fill.content_md !== undefined) {
		next = { ...next, content: fill.content_md };
		written.push('content_md');
	}
	if (next.type === 'question') {
		const gen = fill.question;
		const fixed = fixedType(next.question);
		if (
			missing.has('question') &&
			gen !== undefined &&
			questionIsSound(gen) &&
			(fixed === undefined || fixed === gen.type)
		) {
			next = { ...next, question: questionFrom(next.question, gen, random) };
			written.push('question');
		}
		const feedback = fill.option_feedback;
		if (missing.has('feedback') && feedback !== undefined && next.question !== undefined) {
			// One reaction per written answer, in order. If the teacher added or removed an
			// answer meanwhile, the order no longer says which is whose.
			const answers = optionsOf(next.question).filter((o) => filled(o.text)).length;
			if (answers === feedback.length) {
				let at = -1;
				let changed = false;
				const options = optionsOf(next.question).map((o) => {
					if (!filled(o.text)) return o;
					at++;
					if (filled(o.feedback) || !filled(feedback[at])) return o;
					changed = true;
					return { ...o, feedback: text(feedback[at]) };
				});
				if (changed) {
					next = { ...next, question: { ...next.question, options } };
					written.push('option_feedback');
				}
			}
		}
		if (missing.has('hint') && fill.hint_md !== undefined) {
			next = { ...next, hint: fill.hint_md };
			written.push('hint_md');
		}
		if (missing.has('help') && fill.help_md !== undefined) {
			next = { ...next, help: fill.help_md };
			written.push('help_md');
		}
		if (missing.has('solution') && fill.solution_md !== undefined && next.question !== undefined) {
			next = { ...next, question: { ...next.question, solution: fill.solution_md } };
			written.push('solution_md');
		}
	}
	return { step: next, written };
}

/** A step the model made up; `id` and `order` are the caller's. */
function newStep(
	item: Exclude<GeneratedStep, { keep: string }>,
	id: string,
	random: Random,
	pictures: Readonly<Record<string, string>>
): BlockStep | undefined {
	if (item.kind === 'text') return { id, type: 'text', content: item.content_md };
	if (item.kind === 'picture') {
		const url = pictures[item.picture];
		return url === undefined ? undefined : { id, type: 'image', image: { url, alt: item.alt } };
	}
	if (!questionIsSound(item.question)) return undefined;
	return {
		id,
		type: 'question',
		content: item.content_md,
		hint: item.hint_md,
		help: item.help_md,
		question: { ...questionFrom(undefined, item.question, random), solution: item.solution_md }
	};
}

export interface WrittenCount {
	/** Steps the AI added or filled. */
	steps: number;
	/** Of those, the ones that are questions. */
	questions: number;
}

/**
 * Write what the model returned into the card. Parts filled since the request was made
 * are skipped, so this can never overwrite the teacher; a `keep` for a step that has
 * been deleted since is dropped; a new step goes next to the nearest step it was kept
 * beside (after the one before it, else before the one after it). One command, one undo
 * step. A picture step shows the teacher's picture at its address in `pictures` (by key);
 * one whose picture is not there is left out.
 */
export function fillCard(
	doc: CourseV2,
	blockId: string,
	answer: GeneratedCard,
	reserved?: Reservations,
	random: Random = Math.random,
	pictures: Readonly<Record<string, string>> = {}
): CommandResult & { written: WrittenCount } {
	const block = doc.blocks.find((b) => b.block_id === blockId);
	if (block === undefined) throw new CommandError(`Karta „${blockId}“ v kurzu není.`, { blockId });
	const nothing = { doc, description: 'Karta se nezměnila', written: { steps: 0, questions: 0 } };

	const current = block.steps;
	const byId = new Map(current.map((s) => [s.id, s]));
	const gaps = new Map(missingParts(block).map((g) => [g.stepId, new Set(g.missing)]));
	const origins: Origins = { ...originsOf(block) };
	const count: WrittenCount = { steps: 0, questions: 0 };

	const added = answer.steps.filter((s) => !('keep' in s)).length;
	const ids = nextStepIds(current, added, blockId, reserved);

	const filledSteps = new Map<string, BlockStep>();
	const before = new Map<string, BlockStep[]>();
	const after = new Map<string, BlockStep[]>();
	const tail: BlockStep[] = [];
	const push = (map: Map<string, BlockStep[]>, key: string, step: BlockStep) =>
		map.set(key, [...(map.get(key) ?? []), step]);
	const survivor = (item: GeneratedStep | undefined) =>
		item !== undefined && 'keep' in item && byId.has(item.keep) ? item.keep : undefined;

	let nextId = 0;
	answer.steps.forEach((item, i) => {
		if ('keep' in item) {
			const step = byId.get(item.keep);
			if (step === undefined) return;
			const result = applyFill(step, gaps.get(step.id) ?? new Set(), item.fill ?? {}, random);
			if (result.written.length === 0) return;
			filledSteps.set(step.id, result.step);
			for (const key of result.written) origins[originKey(step.id, key)] = 'ai';
			count.steps++;
			if (step.type === 'question') count.questions++;
			return;
		}
		const id = ids[nextId++];
		const step = newStep(item, id, random, pictures);
		if (step === undefined) return;
		for (const key of item.kind === 'text'
			? ['content_md']
			: item.kind === 'picture'
				? []
				: ['content_md', 'question', 'hint_md', 'help_md', 'solution_md'])
			origins[originKey(id, key)] = 'ai';
		count.steps++;
		if (step.type === 'question') count.questions++;
		let prior: string | undefined;
		for (let j = i - 1; j >= 0 && prior === undefined; j--) prior = survivor(answer.steps[j]);
		if (prior !== undefined) return void push(after, prior, step);
		let following: string | undefined;
		for (let j = i + 1; j < answer.steps.length && following === undefined; j++)
			following = survivor(answer.steps[j]);
		if (following !== undefined) return void push(before, following, step);
		tail.push(step);
	});
	if (count.steps === 0) return nothing;

	let steps = current.flatMap((s) => [
		...(before.get(s.id) ?? []),
		filledSteps.get(s.id) ?? s,
		...(after.get(s.id) ?? [])
	]);
	steps = [...steps, ...tail];
	if (steps.length !== current.length) steps = steps.map((s, i) => ({ ...s, order: i + 1 }));

	const next = { ...block, steps, [ORIGIN_KEY]: origins } as BlockV2;
	return {
		doc: { ...doc, blocks: doc.blocks.map((b) => (b === block ? next : b)) },
		ref: { blockId },
		description: 'Karta dopsána pomocí AI',
		origin: 'ai',
		written: count
	};
}

const plural = (n: number, one: string, few: string, many: string) =>
	`${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

/** „Dopsáno: 3 kroky, 2 otázky.“ */
export function describeWritten({ steps, questions }: WrittenCount): string {
	const parts = [plural(steps, 'krok', 'kroky', 'kroků')];
	if (questions > 0) parts.push(plural(questions, 'otázka', 'otázky', 'otázek'));
	return `Dopsáno: ${parts.join(', ')}.`;
}

// ───────────────────────────────── who wrote what ─────────────────────────────────

/** What one part of a step holds, as one comparable string. */
function partValue(step: BlockStep, key: string): string {
	const q = step.question;
	switch (key) {
		case 'content_md':
			return text(step.content);
		case 'question':
			return JSON.stringify([
				q?.type,
				q?.allow_multiple,
				q?.correct_answer,
				q?.correct_number,
				q?.tolerance,
				optionsOf(q).map((o) => [o.text, o.is_correct === true])
			]);
		case 'option_feedback':
			return JSON.stringify(optionsOf(q).map((o) => o.feedback ?? null));
		case 'hint_md':
			return text(step.hint);
		case 'help_md':
			return text(step.help);
		default:
			return text(q?.solution);
	}
}

/** The blocks that make up the teacher's card this block belongs to (`groups.ts`). */
function cardBlocks(doc: CourseV2, key: string): BlockV2[] {
	return doc.blocks.filter((b) => (b.group ?? b.block_id) === key);
}

function findStep(blocks: readonly BlockV2[], id: string): BlockStep | undefined {
	for (const block of blocks) {
		const step = block.steps.find((s) => s.id === id);
		if (step !== undefined) return step;
	}
	return undefined;
}

/**
 * After an edit that was not the AI's: a part the AI wrote and the edit changed is the
 * teacher's from now on, and the mark of a step that is gone is dropped. Returns `after`
 * itself when nothing changed hands. A card of several blocks keeps its marks on the
 * first one, so its steps are looked up across all of them.
 */
export function settleOrigins(before: CourseV2, after: CourseV2): CourseV2 {
	if (before.blocks === after.blocks) return after;
	let changed = false;
	const blocks = after.blocks.map((block) => {
		const origins = originsOf(block);
		if (Object.keys(origins).length === 0) return block;
		const key = block.group ?? block.block_id;
		const now = cardBlocks(after, key);
		const was = cardBlocks(before, key);
		if (now.length === was.length && now.every((b, i) => b === was[i])) return block;
		const next: Origins = { ...origins };
		let moved = false;
		for (const [mark, who] of Object.entries(origins)) {
			const dot = mark.indexOf('.');
			if (who !== 'ai' || dot < 0) continue;
			const stepId = mark.slice(0, dot);
			const part = mark.slice(dot + 1);
			const old = findStep(was, stepId);
			if (old === undefined) continue;
			const step = findStep(now, stepId);
			if (step === undefined) {
				delete next[mark];
				moved = true;
			} else if (partValue(old, part) !== partValue(step, part)) {
				next[mark] = 'teacher';
				moved = true;
			}
		}
		if (!moved) return block;
		changed = true;
		return { ...block, [ORIGIN_KEY]: next } as BlockV2;
	});
	return changed ? { ...after, blocks } : after;
}
