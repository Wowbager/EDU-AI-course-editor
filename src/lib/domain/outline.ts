/**
 * The AI panel's proposal: a structure the model suggests and the teacher shapes
 * before anything reaches the course.
 *
 * It is one of two things, and the model decides which from the prompt:
 *  - `lessons`: a course structure, lessons with cards under them;
 *  - `cards`: cards for the lesson the teacher is in.
 * Every card is a kind and a name; the lessons are names. Nothing else is asked of the
 * model, which is most of what made a proposal slow. What the card is for comes from its
 * name, the outline around it and the teacher's request (`REQUEST_KEY`).
 *
 * The wire shape (`outlineSchema`) is what the model returns and what the editor sends
 * back with "Co změnit?". The draft is the same thing with a local key and a tick on every
 * item, which is only ever on screen and never in the course. `toOutline` turns the ticked
 * part of a draft back into the wire shape, and `insertOutline` (`outline-insert.ts`) is
 * the one command that puts it in the document.
 */
import { z } from 'zod';
import {
	audienceSchema,
	AUDIENCE_KEY,
	MAX_CONTEXT_CHARS,
	MAX_MATERIALS_CHARS,
	plainTextProblem,
	REQUEST_KEY
} from './authoring';

export { REQUEST_KEY };
import { buildDossier } from './dossier';
import { renderMaterials, type Section } from './materials';
import type { CourseV2 } from './schema';

export const OUTLINE_KINDS = ['display', 'question', 'exercise'] as const;
export type OutlineKind = (typeof OUTLINE_KINDS)[number];

export const MAX_LESSONS = 12;
export const MAX_CARDS_PER_LESSON = 15;
export const MAX_CARDS = 60;
export const MAX_PROMPT_CHARS = 4000;

const line = (max: number) => z.string().trim().min(1).max(max);

export const MAX_SOURCES = 12;

export const outlineCardSchema = z.object({
	kind: z.enum(OUTLINE_KINDS),
	name: line(120),
	/** Keys of the materials' sections the card is written from (`materials.ts`). */
	sources: z.array(z.string().max(40)).max(MAX_SOURCES).optional()
});
export type OutlineCard = z.infer<typeof outlineCardSchema>;

export const outlineLessonSchema = z.object({
	name: line(120),
	cards: z.array(outlineCardSchema).min(1).max(MAX_CARDS_PER_LESSON)
});
export type OutlineLesson = z.infer<typeof outlineLessonSchema>;

/** `lesson`: what a lesson must hold; the model's lessons have cards, the teacher's may not yet. */
const shapeOf = (lesson: typeof outlineLessonSchema) =>
	z.discriminatedUnion('scope', [
		z.object({
			scope: z.literal('lessons'),
			lessons: z.array(lesson).min(1).max(MAX_LESSONS)
		}),
		z.object({
			scope: z.literal('cards'),
			cards: z.array(outlineCardSchema).min(1).max(MAX_CARDS_PER_LESSON)
		})
	]);
const outlineShape = shapeOf(outlineLessonSchema);
export type Outline = z.infer<typeof outlineShape>;
export const outlineSchema = outlineShape.refine((o) => cardCount(o) <= MAX_CARDS, {
	message: `at most ${MAX_CARDS} cards in all`
});
/**
 * The proposal the teacher has, sent back with "Co změnit?": a lesson they started by
 * hand may have no cards yet.
 */
export const currentOutlineSchema = shapeOf(
	outlineLessonSchema.extend({ cards: z.array(outlineCardSchema).max(MAX_CARDS_PER_LESSON) })
).refine((o) => cardCount(o) <= MAX_CARDS, { message: `at most ${MAX_CARDS} cards in all` });

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
	current: currentOutlineSchema.optional(),
	context: z.string().max(MAX_CONTEXT_CHARS),
	/** The teacher's materials as `renderMaterials` makes them (index, and the text when it fits). */
	materials: z.string().max(MAX_MATERIALS_CHARS).optional(),
	/** The keys of those sections: what a card's `sources` may name. */
	material_keys: z.array(z.string().max(40)).max(400).optional()
});
export type OutlineRequest = z.infer<typeof outlineRequestSchema>;

/**
 * Why an answer that has the right shape still cannot be used, or `undefined`. It goes
 * back to the model as it is.
 */
export function outlineProblem(request: OutlineRequest, outline: Outline): string | undefined {
	const scope = scopeProblem(request, outline.scope);
	if (scope !== undefined) return scope;
	const names =
		outline.scope === 'cards'
			? outline.cards.map((c) => c.name)
			: outline.lessons.flatMap((l) => [l.name, ...l.cards.map((c) => c.name)]);
	for (const name of names) {
		const why = plainTextProblem(name);
		if (why !== undefined) return nameProblem(name, why);
	}
	return undefined;
}

export function scopeProblem(request: OutlineRequest, scope: Outline['scope']): string | undefined {
	if (scope === 'cards' && request.target.lessons === 0)
		return 'The course has no lesson yet, so cards have nowhere to go. Use "scope":"lessons".';
	return undefined;
}

export const nameProblem = (name: string, why: string): string =>
	`The name "${name.slice(0, 40)}" must be plain text, but ${why}. Names of cards and lessons have no $ signs and no Markdown.`;

// ───────────────────────────────── the stream ─────────────────────────────────

/**
 * What the route sends the browser, one JSON object per line, as the model writes: the
 * scope, then a lesson (or a card, for `cards`) at a time, then `done`.
 */
export type OutlineEvent =
	| { type: 'scope'; scope: Outline['scope'] }
	/** `at`: a line asked for again goes back to its own place, not at the end. */
	| { type: 'lesson'; lesson: OutlineLesson; at?: number }
	| { type: 'card'; card: OutlineCard; at?: number }
	| { type: 'done' }
	| { type: 'failed'; problem?: 'busy' | 'failed' };

export const outlineEventSchema: z.ZodType<OutlineEvent> = z.union([
	z.object({ type: z.literal('scope'), scope: z.enum(['lessons', 'cards']) }),
	z.object({
		type: z.literal('lesson'),
		lesson: outlineLessonSchema,
		at: z.number().int().min(0).optional()
	}),
	z.object({
		type: z.literal('card'),
		card: outlineCardSchema,
		at: z.number().int().min(0).optional()
	}),
	z.object({ type: z.literal('done') }),
	z.object({ type: z.literal('failed'), problem: z.enum(['busy', 'failed']).optional() })
]);

/** `list` with `item` at `at` (or at the end, or as far as the list goes). */
const placed = <T>(list: readonly T[], item: T, at?: number): T[] => {
	const out = [...list];
	out.splice(at === undefined ? out.length : Math.min(at, out.length), 0, item);
	return out;
};

/** The proposal so far, with one more event; `null` until the scope is known. */
export function applyEvent(so: Outline | null, event: OutlineEvent): Outline | null {
	switch (event.type) {
		case 'scope':
			return event.scope === 'cards'
				? { scope: 'cards', cards: [] }
				: { scope: 'lessons', lessons: [] };
		case 'lesson':
			return so?.scope === 'lessons'
				? { ...so, lessons: placed(so.lessons, event.lesson, event.at) }
				: so;
		case 'card':
			return so?.scope === 'cards' ? { ...so, cards: placed(so.cards, event.card, event.at) } : so;
		default:
			return so;
	}
}

const scopeLine = z.object({ scope: z.enum(['lessons', 'cards']) });

/**
 * One line of the model's answer: the scope, a lesson or a card, or what is wrong with
 * it. A line that fails is not the end of the proposal: it is asked for again at the
 * end, on its own.
 */
export function readLine(
	json: unknown
): { event: OutlineEvent } | { problem: string; scope?: undefined } {
	const scope = scopeLine.safeParse(json);
	if (scope.success) return { event: { type: 'scope', scope: scope.data.scope } };
	const lesson = outlineLessonSchema.safeParse(json);
	const card = outlineCardSchema.safeParse(json);
	const isLesson = typeof json === 'object' && json !== null && 'cards' in json;
	const parsed = isLesson ? lesson : card;
	if (!parsed.success)
		return {
			problem: parsed.error.issues
				.slice(0, 3)
				.map((i) => `${i.path.join('.') || 'line'}: ${i.message}`)
				.join('; ')
		};
	if (isLesson && lesson.success) {
		for (const name of [lesson.data.name, ...lesson.data.cards.map((c) => c.name)]) {
			const why = plainTextProblem(name);
			if (why !== undefined) return { problem: nameProblem(name, why) };
		}
		return { event: { type: 'lesson', lesson: lesson.data } };
	}
	if (card.success) {
		const why = plainTextProblem(card.data.name);
		if (why !== undefined) return { problem: nameProblem(card.data.name, why) };
		return { event: { type: 'card', card: card.data } };
	}
	return { problem: 'not a lesson or a card' };
}

/**
 * Lines out of text that arrives in pieces: a line is handed on when its newline
 * arrives, and what is left when the text ends is a line too. Lines that are not JSON
 * objects (a code fence, a comment) are skipped; a damaged object is reported.
 */
export function lineSplitter(
	onLine: (json: unknown, raw: string) => void,
	onDamaged: (raw: string) => void
): { feed(piece: string): void; end(): void } {
	let rest = '';
	const take = (raw: string) => {
		const text = raw.trim();
		if (!text.startsWith('{')) return;
		try {
			onLine(JSON.parse(text), text);
		} catch {
			onDamaged(text);
		}
	};
	return {
		feed(piece) {
			rest += piece;
			let at: number;
			while ((at = rest.indexOf('\n')) >= 0) {
				take(rest.slice(0, at));
				rest = rest.slice(at + 1);
			}
		},
		end() {
			take(rest);
			rest = '';
		}
	};
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
	cards: DraftCard[];
	/** The tick of a lesson that has no cards (yet); one with cards is ticked through them. */
	on?: boolean;
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

/** The cards the teacher unticked, by kind and name, to carry over to a reworked proposal. */
export function untickedOf(previous?: Draft): ReadonlySet<string> {
	return new Set(
		(previous?.lessons ?? []).flatMap((l) => l.cards.filter((c) => !c.on).map(cardKey))
	);
}

export function emptyDraft(scope: Outline['scope'], next: KeyMaker): Draft {
	return {
		scope,
		lessons: scope === 'cards' ? [{ key: next(), name: '', cards: [] }] : []
	};
}

const draftCards = (list: readonly OutlineCard[], next: KeyMaker, unticked: ReadonlySet<string>) =>
	list.map((card) => ({ ...card, key: next(), on: !unticked.has(cardKey(card)) }));

/** The draft with one more lesson (or, in a `cards` draft, card) from the stream. */
export function addToDraft(
	draft: Draft,
	event: OutlineEvent,
	next: KeyMaker,
	unticked: ReadonlySet<string> = new Set()
): Draft {
	if (event.type === 'lesson' && draft.scope === 'lessons')
		return {
			...draft,
			lessons: placed(
				draft.lessons,
				{
					key: next(),
					name: event.lesson.name,
					cards: draftCards(event.lesson.cards, next, unticked)
				},
				event.at
			)
		};
	if (event.type === 'card' && draft.scope === 'cards')
		return {
			...draft,
			lessons: [
				{
					...draft.lessons[0],
					cards: placed(
						draft.lessons[0].cards,
						draftCards([event.card], next, unticked)[0],
						event.at
					)
				}
			]
		};
	return draft;
}

/**
 * A draft from a whole proposal, everything ticked. With `previous`, a card the model
 * kept, with the same kind and name, keeps the teacher's tick; everything the model
 * changed or added starts ticked. A rename the teacher made is carried by the model (it
 * saw the new name in `current`), so it arrives under that name.
 */
export function draftOf(outline: Outline, next: KeyMaker, previous?: Draft): Draft {
	const unticked = untickedOf(previous);
	let draft = emptyDraft(outline.scope, next);
	if (outline.scope === 'cards')
		for (const card of outline.cards)
			draft = addToDraft(draft, { type: 'card', card }, next, unticked);
	else
		for (const lesson of outline.lessons)
			draft = addToDraft(draft, { type: 'lesson', lesson }, next, unticked);
	return draft;
}

/** The draft as the wire shape: the ticked cards only, or all of them. */
export function toOutline(draft: Draft, only: 'ticked' | 'all' = 'all'): Outline | undefined {
	const keep = (cards: DraftCard[]): OutlineCard[] =>
		cards
			.filter((c) => only === 'all' || c.on)
			.map(({ kind, name, sources }) => ({
				kind,
				name: name.trim(),
				...(sources !== undefined && sources.length > 0 ? { sources } : {})
			}))
			.filter((c) => c.name !== '');
	if (draft.scope === 'cards') {
		const cards = keep(draft.lessons[0]?.cards ?? []);
		return cards.length === 0 ? undefined : { scope: 'cards', cards };
	}
	// A lesson the teacher made and left without cards is still a lesson, ticked on its own.
	const lessons = draft.lessons.flatMap((lesson) => {
		const cards = keep(lesson.cards);
		const name = lesson.name.trim();
		const bare = lesson.cards.length === 0 && (only === 'all' || lesson.on !== false);
		if ((cards.length === 0 && !bare) || name === '') return [];
		return [{ name, cards }];
	});
	return lessons.length === 0 ? undefined : { scope: 'lessons', lessons };
}

/** Whether anything is ticked, which is when „Vytvořit vybrané“ has something to do. */
export const anyTicked = (draft: Draft): boolean => toOutline(draft, 'ticked') !== undefined;

export type Tick = 'all' | 'some' | 'none';
export function lessonTick(lesson: DraftLesson): Tick {
	if (lesson.cards.length === 0) return lesson.on === false ? 'none' : 'all';
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
	return mapLesson(draft, lessonKey, (l) => ({
		...l,
		on,
		cards: l.cards.map((c) => ({ ...c, on }))
	}));
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
/** The lesson stays, with no cards if this was its last: a lesson may be made card by card. */
export const removeCard = (draft: Draft, cardKey: string): Draft => ({
	...draft,
	lessons: draft.lessons.map((l) => ({ ...l, cards: l.cards.filter((c) => c.key !== cardKey) }))
});

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

// The teacher's own outline: rows added by hand, and a card's kind changed.

const draftCardCount = (draft: Draft): number =>
	draft.lessons.reduce((sum, l) => sum + l.cards.length, 0);

/**
 * Whether one more card fits in the lesson: the limits are the ones the model works to,
 * so a hand-made outline can still be sent with „Co změnit?“.
 */
export function canAddCard(draft: Draft, lessonKey: string): boolean {
	const lesson = draft.lessons.find((l) => l.key === lessonKey);
	return (
		lesson !== undefined &&
		lesson.cards.length < MAX_CARDS_PER_LESSON &&
		draftCardCount(draft) < MAX_CARDS
	);
}
export const canAddLesson = (draft: Draft): boolean =>
	draft.scope === 'lessons' && draft.lessons.length < MAX_LESSONS;

/** A new lesson with no name yet, at `at` (or the end), ticked. */
export function addDraftLesson(draft: Draft, key: string, at?: number): Draft {
	if (!canAddLesson(draft)) return draft;
	return { ...draft, lessons: placed(draft.lessons, { key, name: '', cards: [], on: true }, at) };
}

/**
 * A new card with no name yet, at `at` in the lesson (or its end), ticked. It is of the
 * kind of the card above it in the lesson, or the first kind when there is none. It has
 * no sources: those are only ever the model's.
 */
export function addDraftCard(draft: Draft, lessonKey: string, key: string, at?: number): Draft {
	if (!canAddCard(draft, lessonKey)) return draft;
	return mapLesson(draft, lessonKey, (l) => {
		const index = at === undefined ? l.cards.length : Math.min(Math.max(at, 0), l.cards.length);
		const kind = l.cards[index - 1]?.kind ?? OUTLINE_KINDS[0];
		return { ...l, cards: placed(l.cards, { key, kind, name: '', on: true }, index) };
	});
}

/** The card's kind; its name, tick and sources stay. */
export const setDraftKind = (draft: Draft, cardKey: string, kind: OutlineKind): Draft =>
	mapCard(draft, cardKey, (c) => ({ ...c, kind }));

/** Where a card is: its lesson's index and its own. */
export function findCard(draft: Draft, cardKey: string): { lesson: number; card: number } | null {
	for (const [lesson, l] of draft.lessons.entries()) {
		const card = l.cards.findIndex((c) => c.key === cardKey);
		if (card >= 0) return { lesson, card };
	}
	return null;
}

/**
 * A card into a lesson, its own or another, at the index it ends at there (clamped; `end`
 * appends). A lesson that is full takes no card from another, and the draft is unchanged.
 */
export function moveCardTo(
	draft: Draft,
	cardKey: string,
	lessonKey: string,
	index: number | 'end'
): Draft {
	const at = findCard(draft, cardKey);
	const target = draft.lessons.findIndex((l) => l.key === lessonKey);
	if (at === null || target < 0) return draft;
	if (target !== at.lesson && draft.lessons[target].cards.length >= MAX_CARDS_PER_LESSON)
		return draft;
	const card = draft.lessons[at.lesson].cards[at.card];
	const lessons = draft.lessons.map((l, i) =>
		i === at.lesson ? { ...l, cards: l.cards.filter((c) => c.key !== cardKey) } : l
	);
	const into = lessons[target];
	const place =
		index === 'end' ? into.cards.length : Math.min(Math.max(index, 0), into.cards.length);
	lessons[target] = { ...into, cards: placed(into.cards, card, place) };
	return { ...draft, lessons };
}

/**
 * A card one place up or down, the keyboard's drag: past the start or end of its lesson
 * it goes to the end of the lesson above or the start of the one below. At the very
 * start or end of the outline it stays.
 */
export function stepCard(draft: Draft, cardKey: string, by: -1 | 1): Draft {
	const at = findCard(draft, cardKey);
	if (at === null) return draft;
	const lesson = draft.lessons[at.lesson];
	const to = at.card + by;
	if (to >= 0 && to < lesson.cards.length) return moveCard(draft, lesson.key, at.card, to);
	const next = draft.lessons[at.lesson + by];
	if (next === undefined) return draft;
	return moveCardTo(draft, cardKey, next.key, by < 0 ? 'end' : 0);
}

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
	change?: { current: Outline; original: string },
	/** The course's materials, when it has any. */
	materials: readonly Section[] = []
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
		// An outline the teacher made by hand has no first prompt.
		...(change !== undefined
			? {
					...(change.original.trim() !== '' ? { original: change.original } : {}),
					current: change.current
				}
			: {}),
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
		context: buildDossier(doc, anchor ?? '', lesson?.lesson_id),
		...(materials.length > 0
			? {
					materials: renderMaterials(materials, { for: 'outline' }),
					material_keys: materials.map((s) => s.key)
				}
			: {})
	};
}

/** A proposal this small shows all its lessons open; a long one only the first. */
export const OPEN_ALL_UP_TO = 20;
export function lessonStartsOpen(draft: Draft, index: number): boolean {
	const cards = draft.lessons.reduce((sum, l) => sum + l.cards.length, 0);
	return cards <= OPEN_ALL_UP_TO || index === 0;
}

/**
 * `opened` with the default settled for every lesson not yet in it. A lesson's default is
 * decided once, when it first appears, and kept: a proposal that grows while it streams,
 * or shrinks as the teacher removes cards, never folds or opens a lesson under them.
 */
export function settleOpen(
	opened: Readonly<Record<string, boolean>>,
	draft: Draft
): Record<string, boolean> {
	const next = { ...opened };
	draft.lessons.forEach((lesson, index) => {
		if (!(lesson.key in next)) next[lesson.key] = lessonStartsOpen(draft, index);
	});
	return next;
}
