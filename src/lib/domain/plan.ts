/**
 * The plan the AI makes before it writes the cards of an accepted proposal: one request,
 * thinking hard, that fixes for the course its terms, notation, how the pupil is
 * addressed and its running examples, and for each new card what it teaches, what it
 * assumes, which example it uses and which mistake its questions aim at.
 *
 * The plan is kept in the document, where a later single „Dopsat kartu“ reads it through
 * the dossier: the course's conventions in the course's `ai_context`, a lesson's in the
 * lesson's, and a card's in its `brief` („Záměr karty“). Only empty fields are filled;
 * what the teacher wrote there stays and the plan follows it.
 *
 * The model never sees an id: lessons and cards are numbered in the request, and
 * `PlanTargets` turns the numbers back into ids.
 */
import { z } from 'zod';
import type { CourseV2 } from './schema';
import type { CommandResult } from './commands';
import {
	audienceSchema,
	BRIEF_KEY,
	MAX_CONTEXT_CHARS,
	MAX_MATERIALS_CHARS,
	picturesSchema,
	sourceRefsOf,
	type PictureRef
} from './authoring';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const planCardSchema = z.object({
	/** Numbered from 1 over the whole plan. */
	card: z.number().int().min(1),
	kind: z.enum(['display', 'exercise', 'question']),
	title: z.string(),
	/** What the teacher wrote as the card's purpose; the plan keeps to it. */
	brief: z.string().optional(),
	sources: z.array(z.string()).optional()
});

export const planRequestSchema = z.object({
	schema: z.literal('eduai.plan-request/1'),
	course: z.object({ title: z.string(), language: z.string(), audience: audienceSchema }),
	lessons: z
		.array(
			z.object({
				lesson: z.number().int().min(1),
				name: z.string(),
				/** What the teacher wrote as the lesson's note for AI; the plan keeps to it. */
				note: z.string().optional(),
				cards: z.array(planCardSchema).min(1)
			})
		)
		.min(1),
	/** The course dossier (`dossier.ts`); a message of its own. */
	context: z.string().max(MAX_CONTEXT_CHARS),
	materials: z.string().max(MAX_MATERIALS_CHARS).optional(),
	/** Every picture of the materials: the plan decides where each is shown. */
	pictures: picturesSchema.optional()
});
export type PlanRequest = z.infer<typeof planRequestSchema>;

/** The plan as the model saves it (the `save_plan` tool). */
export const planSchema = z.object({
	conventions: z.string().trim().min(1),
	lessons: z.array(z.object({ lesson: z.number().int(), note: z.string() })),
	cards: z.array(z.object({ card: z.number().int(), brief: z.string() }))
});
export type Plan = z.infer<typeof planSchema>;

/** Which lesson and card each number in the plan stands for. */
export interface PlanTargets {
	/** Lesson ids, by plan number − 1. */
	lessons: string[];
	/** Card ids, by plan number − 1. */
	cards: string[];
}

/**
 * The plan's request for the cards the queue is about to write, in course order, grouped
 * by lesson. `undefined` when none of them is still in the course.
 */
export function buildPlanRequest(
	doc: CourseV2,
	cards: readonly { blockId: string; lessonId: string }[],
	context: string,
	materials = '',
	pictures: readonly PictureRef[] = []
): { request: PlanRequest; targets: PlanTargets } | undefined {
	const wanted = new Set(cards.map((c) => c.blockId));
	const byId = new Map(doc.blocks.map((b) => [b.block_id, b]));
	const targets: PlanTargets = { lessons: [], cards: [] };
	const lessons: PlanRequest['lessons'] = [];
	for (const lesson of doc.lessons) {
		const own = lesson.blocks.flatMap((ref) => {
			const block = byId.get(ref.block_id);
			return block !== undefined && wanted.has(block.block_id) ? [block] : [];
		});
		if (own.length === 0) continue;
		targets.lessons.push(lesson.lesson_id);
		const note = text(lesson.ai_context);
		lessons.push({
			lesson: targets.lessons.length,
			name: text(lesson.name),
			...(note !== '' ? { note } : {}),
			cards: own.map((block) => {
				targets.cards.push(block.block_id);
				// A card in two lessons is planned once, where it first stands.
				wanted.delete(block.block_id);
				const brief = text((block as Record<string, unknown>)[BRIEF_KEY]);
				const sources = sourceRefsOf(block);
				return {
					card: targets.cards.length,
					kind: block.type,
					title: text(block.name),
					...(brief !== '' ? { brief } : {}),
					...(materials !== '' && sources.length > 0 ? { sources } : {})
				};
			})
		});
	}
	if (lessons.length === 0) return undefined;
	const audience = audienceSchema.safeParse((doc as Record<string, unknown>).audience ?? {});
	return {
		request: {
			schema: 'eduai.plan-request/1',
			course: {
				title: text(doc.name),
				language: text(doc.language) || 'cs',
				audience: audience.success ? audience.data : {}
			},
			lessons,
			context,
			...(materials !== '' ? { materials } : {}),
			...(pictures.length > 0 ? { pictures: [...pictures] } : {})
		},
		targets
	};
}

/** `undefined` when the plan covers every card of the request once, else what to tell the model. */
export function planProblem(request: PlanRequest, plan: Plan): string | undefined {
	const cards = request.lessons.flatMap((l) => l.cards.map((c) => c.card));
	const lessons = new Set(request.lessons.map((l) => l.lesson));
	const seen = new Set<number>();
	for (const item of plan.cards) {
		if (!cards.includes(item.card))
			return `"cards" names card ${item.card}, which is not in the request (cards ${cards[0]}–${cards.at(-1)}).`;
		if (seen.has(item.card)) return `Card ${item.card} appears more than once in "cards".`;
		if (text(item.brief) === '') return `The brief of card ${item.card} is empty.`;
		seen.add(item.card);
	}
	const missing = cards.filter((n) => !seen.has(n));
	if (missing.length > 0)
		return `"cards" has no brief for card${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. Every card of the request gets one.`;
	const stray = plan.lessons.find((l) => !lessons.has(l.lesson));
	if (stray !== undefined)
		return `"lessons" names lesson ${stray.lesson}, which is not in the request.`;
	return undefined;
}

/**
 * The plan into the document: the conventions into the course's note for AI, a lesson's
 * note into the lesson's, a card's brief into the card. Only where nothing is written,
 * so this never overwrites the teacher, and a field filled since the plan was asked for
 * is left alone.
 */
export function applyPlan(doc: CourseV2, plan: Plan, targets: PlanTargets): CommandResult {
	const unchanged = { doc, description: 'Plán karet od AI' };
	// A course without the planned cards (one before they were inserted, in the history) is
	// not the one the plan is for.
	if (!targets.cards.some((id) => doc.blocks.some((b) => b.block_id === id))) return unchanged;
	let changed = false;
	let next = doc;
	const conventions = text(plan.conventions);
	if (conventions !== '' && text(doc.ai_context) === '') {
		next = { ...next, ai_context: conventions };
		changed = true;
	}
	const notes = new Map<string, string>();
	for (const item of plan.lessons) {
		const id = targets.lessons[item.lesson - 1];
		if (id !== undefined && text(item.note) !== '') notes.set(id, text(item.note));
	}
	if (notes.size > 0) {
		let any = false;
		const lessons = next.lessons.map((l) => {
			const note = notes.get(l.lesson_id);
			if (note === undefined || text(l.ai_context) !== '') return l;
			any = true;
			return { ...l, ai_context: note };
		});
		if (any) {
			next = { ...next, lessons };
			changed = true;
		}
	}
	const briefs = new Map<string, string>();
	for (const item of plan.cards) {
		const id = targets.cards[item.card - 1];
		if (id !== undefined && text(item.brief) !== '') briefs.set(id, text(item.brief));
	}
	if (briefs.size > 0) {
		let any = false;
		const blocks = next.blocks.map((b) => {
			const brief = briefs.get(b.block_id);
			if (brief === undefined || text((b as Record<string, unknown>)[BRIEF_KEY]) !== '') return b;
			any = true;
			return { ...b, [BRIEF_KEY]: brief };
		});
		if (any) {
			next = { ...next, blocks };
			changed = true;
		}
	}
	return { doc: changed ? next : doc, description: 'Plán karet od AI' };
}
