import { z } from 'zod';
import { OUTLINE_KINDS, type Draft, type KeyMaker } from '$lib/domain/outline';

/**
 * The AI panel's outline, kept in the browser per course until „Vytvořit vybrané“ or
 * „Zahodit návrh“, so a reload does not lose what the teacher has shaped: the rows, their
 * ticks, the prompt it started from (none for one made by hand) and where it goes. Like the layout it
 * has keys of its own, never the draft's: the other tabs watch that one for edits.
 *
 * The outline's undo history is not kept, nor a request still being written.
 */
export const OUTLINE_KEY = 'edu-editor:outline:v1';

export const outlineKey = (courseId: string): string => `${OUTLINE_KEY}:${courseId}`;

const name = z.string().max(120);
const id = z.string().max(120);
const placeSchema = z.union([
	z.object({ kind: z.literal('new'), after: id.optional() }),
	z.object({
		kind: z.literal('into'),
		lessonId: id,
		at: z.union([z.literal('start'), z.literal('end'), z.object({ after: id })])
	})
]);
const storedSchema = z.object({
	format: z.literal(1),
	draft: z.object({
		scope: z.enum(['lessons', 'cards']),
		original: z.string().max(4000).optional(),
		place: placeSchema.optional(),
		lessons: z
			.array(
				z.object({
					name,
					on: z.boolean().optional(),
					cards: z
						.array(
							z.object({
								kind: z.enum(OUTLINE_KINDS),
								name,
								on: z.boolean(),
								sources: z.array(z.string().max(40)).max(12).optional()
							})
						)
						.max(60)
				})
			)
			.max(60)
	})
});

/**
 * What of the draft is worth keeping: every row, named or not (the teacher may lay out the
 * outline first and name it later). `null` when there is no row.
 */
export function keptDraft(draft: Draft): Draft | null {
	const lessons = draft.lessons;
	if (draft.scope === 'cards' ? (lessons[0]?.cards.length ?? 0) === 0 : lessons.length === 0)
		return null;
	return { ...draft, lessons: draft.scope === 'cards' ? lessons.slice(0, 1) : lessons };
}

export function serialiseOutline(draft: Draft): string {
	const { scope, original, place, lessons } = draft;
	return JSON.stringify({
		format: 1,
		draft: {
			scope,
			...(original !== undefined && original !== '' ? { original } : {}),
			...(place !== undefined ? { place } : {}),
			lessons: lessons.map(({ name, on, cards }) => ({
				name,
				...(on !== undefined ? { on } : {}),
				cards: cards.map(({ kind, name, on, sources }) => ({
					kind,
					name,
					on,
					...(sources !== undefined ? { sources } : {})
				}))
			}))
		}
	});
}

/** The stored outline with fresh row keys, or `null` for none and for one that does not parse. */
export function parseOutline(text: string | null, next: KeyMaker): Draft | null {
	if (text === null) return null;
	let stored: z.infer<typeof storedSchema>;
	try {
		stored = storedSchema.parse(JSON.parse(text));
	} catch {
		return null;
	}
	const { scope, original, place, lessons } = stored.draft;
	const draft: Draft = {
		scope,
		...(original !== undefined && original !== '' ? { original } : {}),
		...(place !== undefined ? { place } : {}),
		lessons: lessons.map((l) => ({
			key: next(),
			name: l.name,
			...(l.on !== undefined ? { on: l.on } : {}),
			cards: l.cards.map((c) => ({ ...c, key: next() }))
		}))
	};
	return keptDraft(draft);
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Storage can be missing or throw (private window, blocked site data, full). */
export function readOutline(storage: Store | undefined, courseId: string, next: KeyMaker) {
	try {
		const key = outlineKey(courseId);
		const text = storage?.getItem(key) ?? null;
		const draft = parseOutline(text, next);
		// One that no longer parses is dropped, quietly.
		if (draft === null && text !== null) storage?.removeItem(key);
		return draft;
	} catch {
		return null;
	}
}

export function writeOutline(storage: Store | undefined, courseId: string, draft: Draft | null) {
	try {
		const kept = draft === null ? null : keptDraft(draft);
		if (kept === null) storage?.removeItem(outlineKey(courseId));
		else storage?.setItem(outlineKey(courseId), serialiseOutline(kept));
	} catch {
		// A convenience: failing to keep it must never break the panel.
	}
}
