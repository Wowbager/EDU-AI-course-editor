/**
 * Writing a card with AI: what counts as still empty, what the model is asked, and how
 * its answer lands in the document.
 *
 * One rule holds it together: **a field that is filled is never overwritten; only an
 * empty one is written.** `missingSlots` is the single place that decides what "empty"
 * means. The button asks it whether to show, the request asks it what to send as given,
 * the server asks it what the model may return, and `fillBlock` asks it again at the
 * moment of writing, so a field the teacher typed into while the model was thinking is
 * left alone.
 *
 * What the AI needs beyond the pupil's content rides in the document as keys the app
 * ignores: the course's `audience`, a card's `brief` (one line on what it is for) and
 * `field_origin` (which slots the AI wrote and nobody has changed since).
 */
import { z } from 'zod';
import type { BlockStep, BlockV2, CourseV2, QuestionConfig, QuestionOption } from './schema';
import type { CommandResult } from './commands';
import { CommandError } from './commands';
import { isMerged } from './card-view';
import { nextStepId, type Reservations } from './ids';

export const BRIEF_KEY = 'brief';
export const ORIGIN_KEY = 'field_origin';
export const AUDIENCE_KEY = 'audience';

/** Block keys that belong to the first block of a merged card only (`groups.ts`). */
export const AUTHORING_BLOCK_KEYS = [
	BRIEF_KEY,
	'note',
	ORIGIN_KEY,
	'review',
	'source_refs'
] as const;

/** A part of a card the AI can write. */
export const SLOTS = ['content', 'question', 'feedback', 'hint', 'help', 'solution'] as const;
export type Slot = (typeof SLOTS)[number];
export type Completeness = 'stub' | 'partial' | 'ready';

export const GEN_QUESTION_TYPES = ['yes_no', 'number', 'mcq_1', 'mcq_n', 'open'] as const;
export type GenQuestionType = (typeof GEN_QUESTION_TYPES)[number];

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const filled = (value: unknown): boolean => text(value) !== '';

// ───────────────────────────────── what is empty ─────────────────────────────────

/**
 * The step the AI writes into: a Výklad card's first text step, any other card's one
 * question. A card with several questions, or one drawn from several blocks, is not
 * written by AI: which question a text belongs to is the teacher's to say.
 */
export function fillTarget(
	block: BlockV2
): { kind: 'display'; step?: BlockStep } | { kind: 'exercise'; step: BlockStep } | undefined {
	if (isMerged(block)) return undefined;
	if (block.type === 'display') {
		if (block.steps.some((s) => s.type === 'question')) return undefined;
		return { kind: 'display', step: block.steps.find((s) => s.type === 'text') };
	}
	const questions = block.steps.filter((s) => s.type === 'question');
	return questions.length === 1 ? { kind: 'exercise', step: questions[0] } : undefined;
}

const optionsOf = (q: QuestionConfig | undefined): QuestionOption[] => q?.options ?? [];
const isChoice = (q: QuestionConfig | undefined) =>
	q?.type === 'multiple_choice' || q?.type === 'true_false';

/** A choice question nobody has written an answer into yet. */
const untouchedChoice = (q: QuestionConfig | undefined): boolean =>
	q === undefined || (q.type === 'multiple_choice' && optionsOf(q).every((o) => !filled(o.text)));

/** The exercise's wording: text steps above the question, and the question's own. */
function exerciseText(block: BlockV2, step: BlockStep): string {
	const at = block.steps.indexOf(step);
	const above = block.steps
		.slice(0, at)
		.filter((s) => s.type === 'text')
		.map((s) => text(s.content));
	return [...above, text(step.content)].filter((t) => t !== '').join('\n\n');
}

/** Which slots of the card are still empty, in `SLOTS` order. Empty for a card AI does not write. */
export function missingSlots(block: BlockV2): Slot[] {
	const target = fillTarget(block);
	if (target === undefined) return [];
	if (target.kind === 'display') {
		const any = block.steps.some((s) => s.type === 'text' && filled(s.content));
		return any ? [] : ['content'];
	}
	const step = target.step;
	const q = step.question;
	const missing: Slot[] = [];
	const noText = exerciseText(block, step) === '';
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

	if (!filled(step.hint) && !filled(block.hint)) missing.push('hint');
	if (!filled(step.help) && !filled(block.help)) missing.push('help');
	if (!filled(q?.solution)) missing.push('solution');
	return missing;
}

const ALL: Record<'display' | 'exercise', readonly Slot[]> = {
	display: ['content'],
	exercise: ['content', 'question', 'hint', 'help', 'solution']
};

/** `stub`: nothing written yet. `partial`: something is, something is not. `ready`: nothing to add. */
export function completeness(block: BlockV2): Completeness {
	const target = fillTarget(block);
	if (target === undefined) return 'ready';
	const missing = missingSlots(block);
	if (missing.length === 0) return 'ready';
	return ALL[target.kind].every((slot) => missing.includes(slot)) ? 'stub' : 'partial';
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
	z.object({ type: z.literal('mcq_1'), options: z.array(genOptionSchema).min(3).max(4) }),
	z.object({ type: z.literal('mcq_n'), options: z.array(genOptionSchema).min(4).max(6) }),
	z.object({ type: z.literal('open'), answer: z.string().trim().min(1) })
]);
export type GenQuestion = z.infer<typeof genQuestionSchema>;

/** What the model wrote: only slots that were empty. */
export const generatedSchema = z.object({
	content_md: z.string().trim().min(1).optional(),
	question: genQuestionSchema.optional(),
	/** One reaction per answer the teacher wrote, in their order. */
	option_feedback: z.array(z.string()).optional(),
	hint_md: z.string().trim().min(1).optional(),
	help_md: z.string().trim().min(1).optional(),
	solution_md: z.string().trim().min(1).optional()
});
export type Generated = z.infer<typeof generatedSchema>;

/** The key each slot has in a `Generated`, and in `field_origin`. */
export const SLOT_KEY: Record<Slot, keyof Generated> = {
	content: 'content_md',
	question: 'question',
	feedback: 'option_feedback',
	hint: 'hint_md',
	help: 'help_md',
	solution: 'solution_md'
};

const audienceSchema = z.object({
	grade: z.number().int().optional(),
	purpose: z.enum(['intro', 'practice', 'exam_prep']).optional(),
	prior_knowledge: z.string().optional(),
	register: z.string().optional()
});

export const genRequestSchema = z.object({
	schema: z.literal('eduai.gen-request/1'),
	mode: z.enum(['generate', 'complete']),
	course: z.object({
		title: z.string(),
		language: z.string(),
		audience: audienceSchema
	}),
	lesson: z.object({
		name: z.string(),
		takeaway: z.string().optional(),
		neighbors: z.array(z.object({ kind: z.enum(['display', 'exercise']), title: z.string() }))
	}),
	block: z.object({
		kind: z.enum(['display', 'exercise']),
		title: z.string(),
		brief: z.string().optional(),
		/** Fixed by the teacher's choice of question type; absent when the model may choose. */
		question_type: z.enum(GEN_QUESTION_TYPES).optional(),
		missing: z.array(z.enum(SLOTS)).min(1),
		given: z.object({
			content_md: z.string().optional(),
			question: z.unknown().optional(),
			hint_md: z.string().optional(),
			help_md: z.string().optional(),
			solution_md: z.string().optional()
		})
	})
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

/** The request for one card, or `undefined` when there is nothing for AI to write. */
export function buildGenRequest(
	doc: CourseV2,
	blockId: string,
	lessonId?: string
): GenRequest | undefined {
	const block = doc.blocks.find((b) => b.block_id === blockId);
	if (block === undefined) return undefined;
	const target = fillTarget(block);
	const missing = missingSlots(block);
	if (target === undefined || missing.length === 0) return undefined;

	const lesson =
		doc.lessons.find((l) => l.lesson_id === lessonId) ??
		doc.lessons.find((l) => l.blocks.some((b) => b.block_id === blockId));
	const neighbors = (lesson?.blocks ?? [])
		.filter((b) => b.block_id !== blockId)
		.flatMap((b) => {
			const other = doc.blocks.find((x) => x.block_id === b.block_id);
			if (other === undefined) return [];
			// Only what the card really says: an empty card's stand-in name is not a title.
			const first = other.steps.map((step) => text(step.content)).find((t) => t !== '');
			const title = filled(other.name) ? text(other.name) : (first ?? '').slice(0, 70);
			return title === ''
				? []
				: [
						{ kind: other.type === 'display' ? ('display' as const) : ('exercise' as const), title }
					];
		});

	const raw = (doc as Record<string, unknown>)[AUDIENCE_KEY];
	const audience = audienceSchema.safeParse(raw ?? {});

	const given: GenRequest['block']['given'] = {};
	let questionType: GenQuestionType | undefined;
	if (target.kind === 'exercise') {
		const step = target.step;
		const words = exerciseText(block, step);
		if (words !== '') given.content_md = words;
		if (!missing.includes('question') && step.question !== undefined)
			given.question = givenQuestion(step.question);
		const hint = stringAt(step, 'hint') ?? stringAt(block, 'hint');
		const help = stringAt(step, 'help') ?? stringAt(block, 'help');
		const solution = stringAt(step.question, 'solution');
		if (hint !== undefined) given.hint_md = hint;
		if (help !== undefined) given.help_md = help;
		if (solution !== undefined) given.solution_md = solution;
		questionType = fixedType(step.question);
	}

	const brief = stringAt(block, BRIEF_KEY);
	return {
		schema: 'eduai.gen-request/1',
		mode: completeness(block) === 'stub' ? 'generate' : 'complete',
		course: {
			title: text(doc.name),
			language: text(doc.language) || 'cs',
			audience: audience.success ? audience.data : {}
		},
		lesson: {
			name: text(lesson?.name),
			...(filled(lesson?.description) ? { takeaway: text(lesson?.description) } : {}),
			neighbors
		},
		block: {
			kind: target.kind,
			title: text(block.name),
			...(brief !== undefined ? { brief } : {}),
			...(questionType !== undefined ? { question_type: questionType } : {}),
			missing,
			given
		}
	};
}

/**
 * Whether the card says enough for AI to write it: a name or a line on what it is for,
 * or content of its own to continue from.
 */
export function canGenerate(block: BlockV2): boolean {
	if (missingSlots(block).length === 0) return false;
	return (
		filled(block.name) ||
		filled((block as Record<string, unknown>)[BRIEF_KEY]) ||
		completeness(block) === 'partial'
	);
}

// ───────────────────────────────── writing the answer ─────────────────────────────────

/** Keep only what was asked for, and only in the shape the card can take. */
export function restrictGenerated(request: GenRequest, generated: Generated): Generated {
	const missing = new Set<Slot>(request.block.missing);
	const out: Generated = {};
	if (missing.has('content') && generated.content_md !== undefined)
		out.content_md = generated.content_md;
	if (request.block.kind === 'display') return out;
	const fixed = request.block.question_type;
	if (
		missing.has('question') &&
		generated.question !== undefined &&
		(fixed === undefined || generated.question.type === fixed)
	)
		out.question = generated.question;
	if (missing.has('feedback') && generated.option_feedback !== undefined)
		out.option_feedback = generated.option_feedback;
	if (missing.has('hint') && generated.hint_md !== undefined) out.hint_md = generated.hint_md;
	if (missing.has('help') && generated.help_md !== undefined) out.help_md = generated.help_md;
	if (missing.has('solution') && generated.solution_md !== undefined)
		out.solution_md = generated.solution_md;
	return out;
}

/** Whether every slot that was asked for came back. */
export function unanswered(request: GenRequest, generated: Generated): Slot[] {
	return request.block.missing.filter((slot) => generated[SLOT_KEY[slot]] === undefined);
}

const OPTION_IDS = 'abcdefghijklmnopqrstuvwxyz';

function questionFrom(previous: QuestionConfig | undefined, gen: GenQuestion): QuestionConfig {
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
				options: gen.options.map((o, i) => ({
					id: OPTION_IDS[i],
					text: o.text,
					is_correct: o.correct,
					feedback: o.feedback
				}))
			};
	}
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

type Origins = Record<string, 'teacher' | 'ai'>;

const originsOf = (block: BlockV2): Origins => {
	const value = (block as Record<string, unknown>)[ORIGIN_KEY];
	return typeof value === 'object' && value !== null ? (value as Origins) : {};
};

/**
 * Write what the model returned into the card's empty slots. A slot that has been
 * filled since the request was made is skipped, so this can never overwrite the
 * teacher. One command, one undo step.
 */
export function fillBlock(
	doc: CourseV2,
	blockId: string,
	generated: Generated,
	reserved?: Reservations
): CommandResult {
	const block = doc.blocks.find((b) => b.block_id === blockId);
	if (block === undefined) throw new CommandError(`Karta „${blockId}“ v kurzu není.`, { blockId });
	const target = fillTarget(block);
	const missing = new Set(missingSlots(block));
	const written: Slot[] = [];
	const unchanged: CommandResult = { doc, description: 'Karta se nezměnila' };
	if (target === undefined) return unchanged;

	let steps = block.steps;
	const mapStep = (id: string, fn: (s: BlockStep) => BlockStep) => {
		steps = steps.map((s) => (s.id === id ? fn(s) : s));
	};

	if (target.kind === 'display') {
		if (missing.has('content') && generated.content_md !== undefined) {
			const content = generated.content_md;
			if (target.step === undefined) {
				const id = steps.length === 0 ? 's1' : nextStepId(steps, blockId, reserved);
				const added: BlockStep = { id, type: 'text', content };
				steps = [added, ...steps].map((s, i) => ({ ...s, order: i + 1 }));
			} else mapStep(target.step.id, (s) => ({ ...s, content }));
			written.push('content');
		}
	} else {
		const id = target.step.id;
		if (missing.has('content') && generated.content_md !== undefined) {
			const content = generated.content_md;
			mapStep(id, (s) => ({ ...s, content }));
			written.push('content');
		}
		const gen = generated.question;
		const fixed = fixedType(target.step.question);
		if (
			missing.has('question') &&
			gen !== undefined &&
			questionIsSound(gen) &&
			(fixed === undefined || fixed === gen.type)
		) {
			mapStep(id, (s) => ({ ...s, question: questionFrom(s.question, gen) }));
			written.push('question');
		}
		const feedback = generated.option_feedback;
		if (missing.has('feedback') && feedback !== undefined) {
			let changed = false;
			mapStep(id, (s) => {
				if (s.question === undefined) return s;
				let at = -1;
				const options = optionsOf(s.question).map((o) => {
					if (!filled(o.text)) return o;
					at++;
					if (filled(o.feedback) || !filled(feedback[at])) return o;
					changed = true;
					return { ...o, feedback: text(feedback[at]) };
				});
				return changed ? { ...s, question: { ...s.question, options } } : s;
			});
			if (changed) written.push('feedback');
		}
		if (missing.has('hint') && generated.hint_md !== undefined) {
			const hint = generated.hint_md;
			mapStep(id, (s) => ({ ...s, hint }));
			written.push('hint');
		}
		if (missing.has('help') && generated.help_md !== undefined) {
			const help = generated.help_md;
			mapStep(id, (s) => ({ ...s, help }));
			written.push('help');
		}
		if (missing.has('solution') && generated.solution_md !== undefined) {
			const solution = generated.solution_md;
			mapStep(id, (s) =>
				s.question === undefined ? s : { ...s, question: { ...s.question, solution } }
			);
			written.push('solution');
		}
	}
	if (written.length === 0) return unchanged;

	const origins: Origins = { ...originsOf(block) };
	for (const slot of written) origins[SLOT_KEY[slot]] = 'ai';
	const next = { ...block, steps, [ORIGIN_KEY]: origins } as BlockV2;
	return {
		doc: { ...doc, blocks: doc.blocks.map((b) => (b === block ? next : b)) },
		ref: { blockId },
		description: 'Karta dopsána pomocí AI',
		origin: 'ai'
	};
}

// ───────────────────────────────── who wrote what ─────────────────────────────────

/** What a slot holds, as one comparable string. */
function slotValue(block: BlockV2, slot: Slot): string {
	const target = fillTarget(block);
	if (target === undefined) return '\u0000';
	if (target.kind === 'display')
		return slot === 'content' ? JSON.stringify(block.steps.map((s) => s.content ?? null)) : '';
	const step = target.step;
	const q = step.question;
	switch (slot) {
		case 'content':
			return exerciseText(block, step);
		case 'question':
			return JSON.stringify([
				q?.type,
				q?.allow_multiple,
				q?.correct_answer,
				q?.correct_number,
				q?.tolerance,
				optionsOf(q).map((o) => [o.text, o.is_correct === true])
			]);
		case 'feedback':
			return JSON.stringify(optionsOf(q).map((o) => o.feedback ?? null));
		case 'hint':
			return text(step.hint);
		case 'help':
			return text(step.help);
		default:
			return text(q?.solution);
	}
}

/**
 * After an edit that was not the AI's: a slot the AI wrote and the edit changed is the
 * teacher's from now on. Returns `after` itself when nothing changed hands.
 */
export function settleOrigins(before: CourseV2, after: CourseV2): CourseV2 {
	if (before.blocks === after.blocks) return after;
	const old = new Map(before.blocks.map((b) => [b.block_id, b]));
	let changed = false;
	const blocks = after.blocks.map((block) => {
		const was = old.get(block.block_id);
		if (was === undefined || was === block) return block;
		const origins = originsOf(block);
		const flipped = SLOTS.filter(
			(slot) => origins[SLOT_KEY[slot]] === 'ai' && slotValue(was, slot) !== slotValue(block, slot)
		);
		if (flipped.length === 0) return block;
		changed = true;
		const next: Origins = { ...origins };
		for (const slot of flipped) next[SLOT_KEY[slot]] = 'teacher';
		return { ...block, [ORIGIN_KEY]: next } as BlockV2;
	});
	return changed ? { ...after, blocks } : after;
}
