/**
 * The AI panel's proposal: a structure the model suggests and the teacher shapes
 * before anything reaches the course.
 *
 * It is one of two things, and the model decides which from the prompt:
 *  - `lessons`: a course structure, lessons with cards under them;
 *  - `cards`: cards for the lesson the teacher is in.
 * Every card is a kind, a name and one line on what it is for (its `brief`, which the
 * card keeps and the whole-card writer reads, `authoring.ts`).
 *
 * The wire shape (`outlineSchema`) is what the model returns and what the editor sends
 * back with "Co změnit?". The draft is the same thing with a local key and a tick on every
 * item, which is only ever on screen and never in the course. `toOutline` turns the ticked
 * part of a draft back into the wire shape, and `insertOutline` (`outline-insert.ts`) is
 * the one command that puts it in the document.
 */
import { z } from 'zod';
import { audienceSchema, AUDIENCE_KEY, MAX_CONTEXT_CHARS } from './authoring';
import { buildDossier } from './dossier';
import type { CourseV2 } from './schema';

export const OUTLINE_KINDS = ['display', 'question', 'exercise'] as const;
export type OutlineKind = (typeof OUTLINE_KINDS)[number];

export const MAX_LESSONS = 12;
export const MAX_CARDS_PER_LESSON = 15;
export const MAX_CARDS = 60;
export const MAX_PROMPT_CHARS = 4000;

const line = (max: number) => z.string().trim().min(1).max(max);

export const outlineCardSchema = z.object({
	kind: z.enum(OUTLINE_KINDS),
	name: line(120),
	brief: line(300)
});
export type OutlineCard = z.infer<typeof outlineCardSchema>;

export const outlineLessonSchema = z.object({
	name: line(120),
	/** What the pupil knows or can do after the lesson; may be left out. */
	takeaway: z.string().trim().max(300).optional(),
	cards: z.array(outlineCardSchema).min(1).max(MAX_CARDS_PER_LESSON)
});
export type OutlineLesson = z.infer<typeof outlineLessonSchema>;

const outlineShape = z.discriminatedUnion('scope', [
	z.object({
		scope: z.literal('lessons'),
		lessons: z.array(outlineLessonSchema).min(1).max(MAX_LESSONS)
	}),
	z.object({
		scope: z.literal('cards'),
		cards: z.array(outlineCardSchema).min(1).max(MAX_CARDS_PER_LESSON)
	})
]);
export type Outline = z.infer<typeof outlineShape>;
export const outlineSchema = outlineShape.refine((o) => cardCount(o) <= MAX_CARDS, {
	message: `at most ${MAX_CARDS} cards in all`
});

export const cardCount = (outline: Outline): number =>
	outline.scope === 'cards'
		? outline.cards.length
		: outline.lessons.reduce((sum, lesson) => sum + lesson.cards.length, 0);

export const outlineRequestSchema = z.object({
	schema: z.literal('eduai.outline-request/1'),
	/** What the teacher asked for, or, with `current`, what they want changed. */
	prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
	/** The first prompt of this proposal, when `prompt` is a change to it. */
	original: z.string().max(MAX_PROMPT_CHARS).optional(),
	course: z.object({ title: z.string(), language: z.string(), audience: audienceSchema }),
	/** Where the cards would go: the lesson and card the teacher has selected, by name. */
	target: z.object({
		lesson: z.string().optional(),
		card: z.string().optional(),
		/** How many lessons the course has now; with none, cards have no lesson to go to. */
		lessons: z.number().int().min(0)
	}),
	/** The proposal as the teacher has it now, to be reworked. */
	current: outlineSchema.optional(),
	context: z.string().max(MAX_CONTEXT_CHARS)
});
export type OutlineRequest = z.infer<typeof outlineRequestSchema>;

/**
 * Why an answer that has the right shape still cannot be used, or `undefined`. It goes
 * back to the model as it is.
 */
export function outlineProblem(request: OutlineRequest, outline: Outline): string | undefined {
	if (outline.scope === 'cards' && request.target.lessons === 0)
		return 'The course has no lesson yet, so cards have nowhere to go. Use "scope":"lessons".';
	return undefined;
}

// ───────────────────────────────── the draft ─────────────────────────────────

export interface DraftCard extends OutlineCard {
	key: string;
	on: boolean;
}
export interface DraftLesson {
	key: string;
	/** Empty for a `cards` proposal, whose one group is not a lesson. */
	name: string;
	takeaway: string;
	cards: DraftCard[];
}
export interface Draft {
	scope: Outline['scope'];
	lessons: DraftLesson[];
}

export type KeyMaker = () => string;

/** Counter keys for a draft's rows. Only for `{#each}` and drag, never shown or saved. */
export function keyMaker(): KeyMaker {
	let n = 0;
	return () => `d${++n}`;
}

const cardKey = (card: OutlineCard) => `${card.kind}\n${card.name}`;

/**
 * A draft from the model's proposal, everything ticked. With `previous`, an item the
 * model kept, with the same kind and name, keeps the teacher's tick; everything the
 * model changed or added starts ticked. A rename the teacher made is carried by the
 * model (it saw the new name in `current`), so it arrives under that name.
 */
export function draftOf(outline: Outline, next: KeyMaker, previous?: Draft): Draft {
	const unticked = new Set(
		(previous?.lessons ?? []).flatMap((l) => l.cards.filter((c) => !c.on).map(cardKey))
	);
	const cards = (list: readonly OutlineCard[]): DraftCard[] =>
		list.map((card) => ({ ...card, key: next(), on: !unticked.has(cardKey(card)) }));
	if (outline.scope === 'cards')
		return {
			scope: 'cards',
			lessons: [{ key: next(), name: '', takeaway: '', cards: cards(outline.cards) }]
		};
	return {
		scope: 'lessons',
		lessons: outline.lessons.map((lesson) => ({
			key: next(),
			name: lesson.name,
			takeaway: lesson.takeaway ?? '',
			cards: cards(lesson.cards)
		}))
	};
}

/** The draft as the wire shape: the ticked cards only, or all of them. */
export function toOutline(draft: Draft, only: 'ticked' | 'all' = 'all'): Outline | undefined {
	const keep = (cards: DraftCard[]): OutlineCard[] =>
		cards
			.filter((c) => only === 'all' || c.on)
			.map(({ kind, name, brief }) => ({ kind, name: name.trim(), brief: brief.trim() }))
			.filter((c) => c.name !== '');
	if (draft.scope === 'cards') {
		const cards = keep(draft.lessons[0]?.cards ?? []);
		return cards.length === 0 ? undefined : { scope: 'cards', cards };
	}
	const lessons = draft.lessons.flatMap((lesson) => {
		const cards = keep(lesson.cards);
		const name = lesson.name.trim();
		if (cards.length === 0 || name === '') return [];
		const takeaway = lesson.takeaway.trim();
		return [{ name, ...(takeaway !== '' ? { takeaway } : {}), cards }];
	});
	return lessons.length === 0 ? undefined : { scope: 'lessons', lessons };
}

/** Whether anything is ticked, which is when „Vytvořit vybrané“ has something to do. */
export const anyTicked = (draft: Draft): boolean => toOutline(draft, 'ticked') !== undefined;

export type Tick = 'all' | 'some' | 'none';
export function lessonTick(lesson: DraftLesson): Tick {
	const on = lesson.cards.filter((c) => c.on).length;
	return on === 0 ? 'none' : on === lesson.cards.length ? 'all' : 'some';
}

// The edits are pure: each returns a new draft, so the panel's state is replaced, not mutated.

const mapLesson = (draft: Draft, key: string, fn: (l: DraftLesson) => DraftLesson): Draft => ({
	...draft,
	lessons: draft.lessons.map((l) => (l.key === key ? fn(l) : l))
});
const mapCard = (draft: Draft, key: string, fn: (c: DraftCard) => DraftCard): Draft => ({
	...draft,
	lessons: draft.lessons.map((l) => ({
		...l,
		cards: l.cards.map((c) => (c.key === key ? fn(c) : c))
	}))
});

/** Ticking a lesson ticks all its cards; unticking it unticks them. */
export function setLessonTick(draft: Draft, lessonKey: string, on: boolean): Draft {
	return mapLesson(draft, lessonKey, (l) => ({ ...l, cards: l.cards.map((c) => ({ ...c, on })) }));
}
export const setCardTick = (draft: Draft, cardKey: string, on: boolean): Draft =>
	mapCard(draft, cardKey, (c) => ({ ...c, on }));
export const renameDraftLesson = (draft: Draft, lessonKey: string, name: string): Draft =>
	mapLesson(draft, lessonKey, (l) => ({ ...l, name }));
export const renameDraftCard = (draft: Draft, cardKey: string, name: string): Draft =>
	mapCard(draft, cardKey, (c) => ({ ...c, name }));

export const removeLesson = (draft: Draft, lessonKey: string): Draft => ({
	...draft,
	lessons: draft.lessons.filter((l) => l.key !== lessonKey)
});
/** A lesson left with no cards goes too (of a `lessons` draft; a `cards` draft keeps its group). */
export function removeCard(draft: Draft, cardKey: string): Draft {
	const lessons = draft.lessons.map((l) => ({
		...l,
		cards: l.cards.filter((c) => c.key !== cardKey)
	}));
	return {
		...draft,
		lessons: draft.scope === 'cards' ? lessons : lessons.filter((l) => l.cards.length > 0)
	};
}

const moved = <T>(list: readonly T[], from: number, to: number): T[] => {
	if (from < 0 || from >= list.length) return [...list];
	const out = [...list];
	const [item] = out.splice(from, 1);
	out.splice(Math.min(Math.max(to, 0), out.length), 0, item);
	return out;
};

/** A card to another place in its own lesson. `to` is the index it ends at. */
export const moveCard = (draft: Draft, lessonKey: string, from: number, to: number): Draft =>
	mapLesson(draft, lessonKey, (l) => ({ ...l, cards: moved(l.cards, from, to) }));
export const moveLesson = (draft: Draft, from: number, to: number): Draft => ({
	...draft,
	lessons: moved(draft.lessons, from, to)
});

// ───────────────────────────────── the request ─────────────────────────────────

/** What the teacher has selected; the same two fields as the editor's selection. */
export interface OutlineSelection {
	lessonId?: string;
	blockId?: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The request for a proposal: the prompt, the proposal being changed if there is one,
 * and where the teacher is. The dossier is anchored on the selected card, or on the
 * first card of the selected lesson, so that the lesson it is in is told in full.
 */
export function buildOutlineRequest(
	doc: CourseV2,
	selection: OutlineSelection | null | undefined,
	prompt: string,
	change?: { current: Outline; original: string }
): OutlineRequest {
	const card = doc.blocks.find((b) => b.block_id === selection?.blockId);
	const lesson =
		doc.lessons.find((l) => l.lesson_id === selection?.lessonId) ??
		doc.lessons.find((l) => l.blocks.some((b) => b.block_id === card?.block_id));
	const anchor = card?.block_id ?? lesson?.blocks[0]?.block_id;
	const audience = audienceSchema.safeParse((doc as Record<string, unknown>)[AUDIENCE_KEY] ?? {});
	return {
		schema: 'eduai.outline-request/1',
		prompt: prompt.trim(),
		...(change !== undefined ? { original: change.original, current: change.current } : {}),
		course: {
			title: text(doc.name),
			language: text(doc.language) || 'cs',
			audience: audience.success ? audience.data : {}
		},
		target: {
			...(lesson !== undefined && text(lesson.name) !== '' ? { lesson: text(lesson.name) } : {}),
			...(card !== undefined && text(card.name) !== '' ? { card: text(card.name) } : {}),
			lessons: doc.lessons.length
		},
		context: buildDossier(doc, anchor ?? '', lesson?.lesson_id)
	};
}
