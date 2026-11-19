/**
 * „Moje karty“, the teacher's part of the backpack: copies of cards that outlive the
 * course they came from, so a card can be carried into another course.
 *
 * Every entry is a copy. Saving one never changes a course, and taking one out pastes a
 * new copy (`pasteBlock`, the same path as Ctrl+V of a copied card), so the backpack
 * keeps it for the next time. It stores the card as the teacher sees it (`store.doc`),
 * like the clipboard does.
 *
 * The other part of the backpack, „Z tohoto kurzu“, is not stored here: it is the open
 * course's own cards that no lesson shows, read from the document.
 */
import { z } from 'zod';
import { blockSchema, type BlockV2 } from './schema';
import { deepCopy } from './clone';
import type { CopiedFrom } from './commands';

const VERSION = 1;

export interface SavedCard {
	/** The entry's own key; not a card id, which can repeat across courses. */
	id: string;
	/** ISO time it was put in, newest first in the list. */
	savedAt: string;
	from: CopiedFrom;
	/** The course's name when the card was saved: the row's quiet second line. */
	courseName?: string;
	block: BlockV2;
}

const entrySchema = z.object({
	id: z.string(),
	savedAt: z.string(),
	from: z.object({ courseId: z.string().optional(), blockId: z.string().optional() }),
	courseName: z.string().optional(),
	block: blockSchema
});

const fileSchema = z.object({ version: z.literal(VERSION), cards: z.array(z.unknown()) });

/**
 * The stored backpack, or an empty one. An entry that no longer parses is dropped and
 * the rest are kept: one broken card must not empty the whole backpack.
 */
export function parseBackpack(text: string | null): SavedCard[] {
	if (text === null) return [];
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return [];
	}
	const file = fileSchema.safeParse(raw);
	if (!file.success) return [];
	const cards: SavedCard[] = [];
	for (const entry of file.data.cards) {
		const parsed = entrySchema.safeParse(entry);
		if (parsed.success) cards.push(parsed.data as SavedCard);
	}
	return cards;
}

/**
 * The stored backpack after `change`, as text to store, or null when it must not be
 * written: what is stored is a backpack of another version (a newer build's), which
 * this build would replace with its own idea of it. Entries this build cannot read
 * are kept as they are, after the ones it changed, so a card a newer build saved is
 * never lost by saving here. Text that is not JSON at all is replaced: nothing in it
 * could be read back by any build.
 */
export function rewriteBackpack(
	text: string | null,
	change: (cards: SavedCard[]) => SavedCard[]
): string | null {
	let entries: unknown[] = [];
	if (text !== null) {
		let raw: unknown;
		let json = true;
		try {
			raw = JSON.parse(text);
		} catch {
			json = false;
		}
		if (json) {
			const file = fileSchema.safeParse(raw);
			if (!file.success) return null;
			entries = file.data.cards;
		}
	}
	const cards: SavedCard[] = [];
	const unread: unknown[] = [];
	for (const entry of entries) {
		const parsed = entrySchema.safeParse(entry);
		if (parsed.success) cards.push(parsed.data as SavedCard);
		else unread.push(entry);
	}
	return JSON.stringify({ version: VERSION, cards: [...change(cards), ...unread] });
}

export function serializeBackpack(cards: SavedCard[]): string {
	return JSON.stringify({ version: VERSION, cards });
}

/** A copy of `block` at the top of the list. */
export function saveCard(
	cards: SavedCard[],
	block: BlockV2,
	where: { id: string; savedAt: string; from: CopiedFrom; courseName?: string }
): SavedCard[] {
	const entry: SavedCard = { ...where, block: deepCopy(block) };
	if (where.courseName === undefined) delete entry.courseName;
	return [entry, ...cards];
}

export function dropCard(cards: SavedCard[], id: string): SavedCard[] {
	return cards.filter((card) => card.id !== id);
}
