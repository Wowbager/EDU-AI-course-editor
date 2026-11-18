/**
 * Writing the cards of one lesson in one conversation with the model, one card a turn:
 * what the browser sends (`LessonRequest`), and what comes back as the model writes
 * (`LessonEvent`, one per line).
 *
 * A card in the request is what `buildGenRequest` makes of it, without the dossier and
 * the materials, which the conversation holds once for all its cards. The model never
 * sees a card's id: the cards are in order, and the browser keeps which id is which
 * (`buildLessonRequest`'s `ids`).
 *
 * The plan (`plan.ts`) may come along: its request and the model's answer, as they were,
 * so the conversation starts with the plan itself (the server keeps nothing between
 * requests). Without it, the dossier and the briefs carry what the plan decided.
 */
import { z } from 'zod';
import type { CourseV2 } from './schema';
import {
	buildGenRequest,
	generatedCardSchema,
	genRequestSchema,
	MAX_CONTEXT_CHARS,
	MAX_MATERIALS_CHARS,
	pictureKeysSchema,
	picturesSchema,
	sourceRefsOf,
	type GeneratedCard,
	type GenRequest,
	type PictureRef
} from './authoring';
import { planRequestSchema, planSchema, type PlanRequest, type PlanTargets } from './plan';
import { MAX_CARDS, MAX_SOURCES } from './outline';

/**
 * The model's turn, to be sent back. The reasoning fields are only in turns made before
 * the server stopped keeping them; they are accepted and not sent on.
 */
export const assistantTurnSchema = z.object({
	role: z.literal('assistant'),
	content: z.string(),
	tool_calls: z
		.array(
			z.object({
				id: z.string(),
				type: z.literal('function'),
				function: z.object({ name: z.string(), arguments: z.string() })
			})
		)
		.optional(),
	reasoning_details: z.array(z.unknown()).optional(),
	reasoning_content: z.string().optional(),
	reasoning: z.string().optional()
});
export type AssistantTurnData = z.infer<typeof assistantTurnSchema>;

/** The plan's answer, at most this long as JSON. */
export const MAX_TURN_CHARS = 400_000;

/**
 * A message of a lesson's conversation after its opening: the card turns, the model's
 * answers and the tool results. Never a system message: the opening has the only one.
 */
export const turnMessageSchema = z.union([
	assistantTurnSchema,
	z.object({ role: z.literal('user'), content: z.string() }),
	z.object({ role: z.literal('tool'), tool_call_id: z.string(), content: z.string() })
]);
export type TurnMessage = z.infer<typeof turnMessageSchema>;

/**
 * The server's signature on a turn it hands back (`server/ai/seal.ts`): only what the
 * model said comes back as the model's.
 */
export const sealSchema = z.string().max(100);

/** What the earlier turns of a lesson's conversation may add up to, as JSON. */
export const MAX_RESUME_CHARS = 1_500_000;
/** What the teacher changed since the lesson began, as the card message carries it. */
export const MAX_CHANGED_CHARS = 40_000;

export const lessonCardSchema = genRequestSchema.shape.card.extend({
	/** The card's number in the plan, when the conversation starts with one. */
	plan_card: z.number().int().min(1).optional(),
	/** The keys of the materials' sections the card is written from. */
	draws_on: z.array(z.string()).max(MAX_SOURCES).optional()
});
export type LessonCard = z.infer<typeof lessonCardSchema>;

export const lessonRequestSchema = z.object({
	schema: z.literal('eduai.lesson-request/1'),
	course: genRequestSchema.shape.course,
	lesson: genRequestSchema.shape.lesson,
	cards: z.array(lessonCardSchema).min(1).max(MAX_CARDS),
	/** The dossier: of the course, or with a plan only the lesson as it is now. */
	context: z.string().max(MAX_CONTEXT_CHARS),
	materials: z.string().max(MAX_MATERIALS_CHARS).optional(),
	/** The pictures these cards draw on, when the plan did not already show them all. */
	pictures: picturesSchema.optional(),
	/** The keys of every picture of the materials: what a card may show. */
	picture_keys: pictureKeysSchema.optional(),
	/**
	 * The conversation goes on one card a turn, a request each, so that the browser can say
	 * what the teacher changed in between: card `next` is written after `messages` (what the
	 * earlier requests returned as `turn`), and `changed` goes into its message. The
	 * request is otherwise the one that began the lesson, unchanged: its opening is the
	 * conversation's prefix.
	 */
	resume: z
		.object({
			next: z.number().int().min(0),
			messages: z
				.array(turnMessageSchema)
				.refine((m) => JSON.stringify(m).length <= MAX_RESUME_CHARS, { message: 'too long' }),
			/** The server's seal on `messages`, from the last `turn` (`server/ai/seal.ts`). */
			seal: sealSchema.optional(),
			changed: z.string().max(MAX_CHANGED_CHARS).optional()
		})
		.optional(),
	plan: z
		.object({
			request: planRequestSchema,
			turn: assistantTurnSchema.refine((t) => JSON.stringify(t).length <= MAX_TURN_CHARS, {
				message: 'too long'
			}),
			/** The server's seal on `turn`, from the plan's answer. */
			seal: sealSchema.optional()
		})
		.optional()
});
export type LessonRequest = z.infer<typeof lessonRequestSchema>;

/** One card of the lesson as `cardProblem` checks it. */
export function cardRequestOf(request: LessonRequest, index: number): GenRequest {
	const { plan_card: _plan, draws_on: _sources, ...card } = request.cards[index];
	return {
		schema: 'eduai.gen-request/2',
		// Nothing written by the teacher yet: as `completeness` says 'stub'.
		mode: card.steps.every(
			(s) =>
				s.kind !== 'media' &&
				[s.content_md, s.question, s.hint_md, s.help_md, s.solution_md].every(
					(v) => v === undefined
				)
		)
			? 'generate'
			: 'complete',
		course: request.course,
		lesson: request.lesson,
		card,
		context: '',
		...(request.picture_keys !== undefined ? { picture_keys: request.picture_keys } : {})
	};
}

/**
 * The request for the cards `blockIds` of one lesson, in that order, and the ids of the
 * cards it carries (one with nothing left to write is left out). `undefined` when none is
 * left.
 */
export function buildLessonRequest(
	doc: CourseV2,
	lessonId: string,
	blockIds: readonly string[],
	options: {
		context: string;
		materials?: string;
		/** The pictures to send, and the keys of all of them (`picturesFor`, `pictureKeys`). */
		pictures?: readonly PictureRef[];
		pictureKeys?: readonly string[];
		plan?: { request: PlanRequest; turn: AssistantTurnData; seal?: string; targets: PlanTargets };
	}
): { request: LessonRequest; ids: string[] } | undefined {
	const ids: string[] = [];
	const cards: LessonCard[] = [];
	let head: GenRequest | undefined;
	const sourced = options.materials !== undefined && options.materials !== '';
	for (const blockId of blockIds) {
		const gen = buildGenRequest(doc, blockId, lessonId);
		if (gen === undefined) continue;
		head ??= gen;
		const block = doc.blocks.find((b) => b.block_id === blockId);
		const sources = sourceRefsOf(block);
		const planned = options.plan?.targets.cards.indexOf(blockId) ?? -1;
		ids.push(blockId);
		cards.push({
			...gen.card,
			...(planned >= 0 ? { plan_card: planned + 1 } : {}),
			...((sourced || options.plan?.request.materials !== undefined) && sources.length > 0
				? { draws_on: sources.slice(0, MAX_SOURCES) }
				: {})
		});
	}
	if (head === undefined) return undefined;
	return {
		request: {
			schema: 'eduai.lesson-request/1',
			course: head.course,
			lesson: head.lesson,
			cards,
			context: options.context,
			...(sourced ? { materials: options.materials } : {}),
			...(options.pictures !== undefined && options.pictures.length > 0
				? { pictures: [...options.pictures] }
				: {}),
			...(options.pictureKeys !== undefined && options.pictureKeys.length > 0
				? { picture_keys: [...options.pictureKeys] }
				: {}),
			...(options.plan !== undefined
				? {
						plan: {
							request: options.plan.request,
							turn: options.plan.turn,
							...(options.plan.seal !== undefined ? { seal: options.plan.seal } : {})
						}
					}
				: {})
		},
		ids
	};
}

// ───────────────────────────────── what comes back ─────────────────────────────────

/**
 * `writing`: card `card` (its index in the request) is being written; `card`: it is, here
 * it is; `card-failed`: it could not be, and the conversation goes on with the next;
 * `stopped`: the limits stopped the conversation before the next call (`retryAfter` in
 * seconds); `done` / `failed`: the end. A request with `resume` writes one card and sends
 * `turn` before `done`: the messages it added to the conversation, to be sent back.
 */
export type LessonEvent =
	| { type: 'writing'; card: number }
	| { type: 'card'; card: number; answer: GeneratedCard }
	| { type: 'card-failed'; card: number }
	| { type: 'turn'; messages: TurnMessage[]; seal?: string }
	| { type: 'stopped'; reason: 'rate' | 'budget'; retryAfter: number }
	| { type: 'done' }
	| { type: 'failed'; problem: 'busy' | 'failed' };

export const lessonEventSchema: z.ZodType<LessonEvent> = z.union([
	z.object({ type: z.literal('writing'), card: z.number().int().min(0) }),
	z.object({ type: z.literal('card'), card: z.number().int().min(0), answer: generatedCardSchema }),
	z.object({ type: z.literal('card-failed'), card: z.number().int().min(0) }),
	z.object({
		type: z.literal('turn'),
		messages: z.array(turnMessageSchema),
		seal: sealSchema.optional()
	}),
	z.object({
		type: z.literal('stopped'),
		reason: z.enum(['rate', 'budget']),
		retryAfter: z.number().min(0)
	}),
	z.object({ type: z.literal('done') }),
	z.object({ type: z.literal('failed'), problem: z.enum(['busy', 'failed']) })
]);

/** What the plan route answers: the plan, and the model's turn to hand back with each lesson. */
export type PlanEvent =
	| { type: 'plan'; plan: z.infer<typeof planSchema>; turn: AssistantTurnData; seal?: string }
	| { type: 'failed'; problem: 'busy' | 'failed' }
	| { type: 'stopped'; reason: 'rate' | 'budget'; retryAfter: number };

export const planEventSchema: z.ZodType<PlanEvent> = z.union([
	z.object({
		type: z.literal('plan'),
		plan: planSchema,
		turn: assistantTurnSchema,
		seal: sealSchema.optional()
	}),
	z.object({ type: z.literal('failed'), problem: z.enum(['busy', 'failed']) }),
	z.object({
		type: z.literal('stopped'),
		reason: z.enum(['rate', 'budget']),
		retryAfter: z.number().min(0)
	})
]);
