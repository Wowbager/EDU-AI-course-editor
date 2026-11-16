/**
 * Naming the sources of cards that have none, when the materials are too long to send
 * whole.
 *
 * A card is written from its own sections in full and only the titles of the others
 * when the materials do not all fit in one request (`renderMaterials`, `fitsFully`). A
 * card the teacher added to the outline by hand has no sources, so it would be written
 * from titles alone. Before such cards are written, one request asks the model which
 * sections each of them draws on (`/ai/sources`), and the answer is kept on the cards as
 * their `source_refs`, as if the outline had named them.
 *
 * When everything fits, every card is given every section in full and nothing is asked.
 */
import { z } from 'zod';
import { sourceRefsOf, SOURCE_REFS_KEY, MAX_MATERIALS_CHARS } from './authoring';
import { fitsFully, renderMaterials, type Section } from './materials';
import { MAX_CARDS, MAX_SOURCES, OUTLINE_KINDS } from './outline';
import type { CommandResult } from './commands';
import type { BlockV2, CourseV2 } from './schema';

export const sourcesRequestSchema = z.object({
	schema: z.literal('eduai.sources-request/1'),
	course: z.object({ title: z.string().max(200), language: z.string().max(20) }),
	/** The cards, each with a short id of this request only (never a block id). */
	cards: z
		.array(
			z.object({
				id: z.string().min(1).max(8),
				kind: z.enum(OUTLINE_KINDS),
				name: z.string().max(200),
				lesson: z.string().max(200)
			})
		)
		.min(1)
		.max(MAX_CARDS),
	/** The materials' index, as `renderMaterials` makes it for an outline. */
	materials: z.string().min(1).max(MAX_MATERIALS_CHARS),
	material_keys: z.array(z.string().max(40)).min(1).max(400)
});
export type SourcesRequest = z.infer<typeof sourcesRequestSchema>;

/** What the model answers, before unknown cards and keys are dropped. */
export const sourcesAnswerSchema = z.object({
	cards: z.array(z.object({ id: z.string().max(8), sources: z.array(z.string().max(40)) })).max(200)
});

/** The sources the model named for each card, by the request's card id. */
export type Assigned = { id: string; sources: string[] }[];

/** Whether cards without sources need them named: the materials do not all fit. */
export const sourcesWanted = (sections: readonly Section[]): boolean =>
	sections.length > 0 && !fitsFully(sections);

/** Of the cards just added, those still in the course with no sources of their own. */
export function cardsWithoutSources<T extends { blockId: string }>(
	doc: CourseV2,
	added: readonly T[]
): T[] {
	return added.filter((a) => {
		const block = doc.blocks.find((b) => b.block_id === a.blockId);
		return block !== undefined && sourceRefsOf(block).length === 0;
	});
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The request for `cards` (in course order); its card ids are their places, from 1. */
export function buildSourcesRequest(
	doc: CourseV2,
	cards: readonly { blockId: string; lessonId: string }[],
	sections: readonly Section[]
): SourcesRequest {
	return {
		schema: 'eduai.sources-request/1',
		course: { title: text(doc.name).slice(0, 200), language: text(doc.language) || 'cs' },
		cards: cards.slice(0, MAX_CARDS).map((c, i) => {
			const block = doc.blocks.find((b) => b.block_id === c.blockId);
			const lesson = doc.lessons.find((l) => l.lesson_id === c.lessonId);
			return {
				id: String(i + 1),
				kind: block?.type ?? 'display',
				name: text(block?.name).slice(0, 200),
				lesson: text(lesson?.name).slice(0, 200)
			};
		}),
		materials: renderMaterials(sections, { for: 'outline' }),
		material_keys: sections.map((s) => s.key)
	};
}

/**
 * The answer with only what can be used: cards of the request, keys of the materials (a
 * key the model made up is dropped, as in a proposal), at most `MAX_SOURCES` each, and
 * no card left with none.
 */
export function usableSources(request: SourcesRequest, answer: unknown): Assigned {
	const parsed = sourcesAnswerSchema.safeParse(answer);
	if (!parsed.success) return [];
	const ids = new Set(request.cards.map((c) => c.id));
	const keys = new Set(request.material_keys);
	const seen = new Set<string>();
	return parsed.data.cards.flatMap(({ id, sources }) => {
		if (!ids.has(id) || seen.has(id)) return [];
		seen.add(id);
		const known = [...new Set(sources)].filter((k) => keys.has(k)).slice(0, MAX_SOURCES);
		return known.length > 0 ? [{ id, sources: known }] : [];
	});
}

/**
 * The cards' sources as the request named them (`assigned`, by the request's card ids,
 * which are places in `cards`). A card that is gone, or has sources of its own by now,
 * is left as it is.
 */
export function setSourceRefs(
	doc: CourseV2,
	cards: readonly { blockId: string }[],
	assigned: Assigned
): CommandResult {
	const byBlock = new Map<string, string[]>();
	for (const { id, sources } of assigned) {
		const card = cards[Number(id) - 1];
		if (card !== undefined && sources.length > 0) byBlock.set(card.blockId, sources);
	}
	let changed = false;
	const blocks = doc.blocks.map((b): BlockV2 => {
		const sources = byBlock.get(b.block_id);
		if (sources === undefined || sourceRefsOf(b).length > 0) return b;
		changed = true;
		return { ...b, [SOURCE_REFS_KEY]: [...sources] };
	});
	return {
		doc: changed ? { ...doc, blocks } : doc,
		description: 'Kartám přiřazeny podklady'
	};
}
