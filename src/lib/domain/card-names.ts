/**
 * Names that tell cards apart, wherever a teacher picks one.
 *
 * A card is called what `blockPreview` calls it, and two cards can share that name
 * (two "Kolik je?", or several still-empty "Karta 1" in different lessons). The
 * pickers would then show two identical lines. So a card whose name another card
 * shares also carries its place — "Lekce 2, karta 3", or "mimo lekce" — and the lists
 * show it as a second line or after the name. Nothing is written to the document.
 */
import type { BlockV2, CourseV2 } from './schema';
import { blockPreview } from './derive';
import { lessonLabel } from './naming';

export interface CardName {
	id: string;
	name: string;
	/** "Lekce 2, karta 3", or "mimo lekce". */
	place: string;
	/** Only the lesson: "Lekce 2", or "mimo lekce". */
	lesson: string;
	/** Another card has the same name, so `place` is needed to tell them apart. */
	collides: boolean;
	/** `name`, followed by `place` when the name alone would be ambiguous. */
	label: string;
}

export interface CardGroup {
	title: string;
	cards: CardName[];
}

const OUTSIDE = 'mimo lekce';
const sameName = (name: string) => name.trim().toLowerCase();

/**
 * Every card's name and place. A card in several lessons is placed where its first
 * lesson has it. The position in the name's fallback ("Karta 3") is the one in that
 * lesson, as in the tree.
 */
export function cardNames(doc: CourseV2, max = 50): Map<string, CardName> {
	const byId = new Map(doc.blocks.map((b) => [b.block_id, b]));
	const result = new Map<string, CardName>();
	const add = (card: BlockV2, lesson: string, place: string, position?: number) => {
		result.set(card.block_id, {
			id: card.block_id,
			name: blockPreview(card, max, position),
			place,
			lesson,
			collides: false,
			label: ''
		});
	};
	for (const lesson of doc.lessons) {
		const where = lessonLabel(doc, lesson);
		lesson.blocks.forEach((binding, i) => {
			const card = byId.get(binding.block_id);
			if (card === undefined || result.has(card.block_id)) return;
			add(card, where, `${where}, karta ${i + 1}`, i + 1);
		});
	}
	for (const card of doc.blocks) if (!result.has(card.block_id)) add(card, OUTSIDE, OUTSIDE);

	const counts = new Map<string, number>();
	for (const c of result.values())
		counts.set(sameName(c.name), (counts.get(sameName(c.name)) ?? 0) + 1);
	for (const c of result.values()) {
		c.collides = (counts.get(sameName(c.name)) ?? 0) > 1;
		c.label = c.collides ? `${c.name} · ${c.place}` : c.name;
	}
	return result;
}

/** Cards by lesson in lesson order, those in no lesson last under „Karty mimo lekce“. */
export function cardGroups(
	doc: CourseV2,
	opts: { exclude?: ReadonlySet<string> | string; max?: number } = {}
): CardGroup[] {
	const names = cardNames(doc, opts.max);
	const skip = (id: string) =>
		typeof opts.exclude === 'string' ? opts.exclude === id : (opts.exclude?.has(id) ?? false);
	const seen = new Set<string>();
	const groups: CardGroup[] = [];
	for (const lesson of doc.lessons) {
		const cards: CardName[] = [];
		for (const binding of lesson.blocks) {
			const card = names.get(binding.block_id);
			if (card === undefined || seen.has(card.id)) continue;
			seen.add(card.id);
			if (!skip(card.id)) cards.push(card);
		}
		if (cards.length > 0) groups.push({ title: lessonLabel(doc, lesson), cards });
	}
	const loose = doc.blocks
		.filter((b) => !seen.has(b.block_id) && !skip(b.block_id))
		.map((b) => names.get(b.block_id)!);
	if (loose.length > 0) groups.push({ title: 'Karty mimo lekce', cards: loose });
	return groups;
}
