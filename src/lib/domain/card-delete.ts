/**
 * Deleting a card from the rail or the tree, without the repair dialog.
 *
 * The dialog exists because a card can be the target of a branch or a prerequisite,
 * and deleting it would leave a pupil stuck on a place that is gone
 * (`deleteBlock` refuses to). But most cards are pointed at by nothing except the
 * lesson that holds them, and asking a teacher to confirm a dialog with nothing in
 * it for each of those is what the two-click button replaces. So the rule is one
 * function, here: when the only pointer at the card is its own lesson's binding,
 * removing that binding with the card is the whole repair.
 */
import type { CourseV2 } from './schema';
import { planDeleteBlock, type Repair } from './commands';

export interface QuickDelete {
	/** The repairs to pass to `deleteBlock`: the card's own binding, cleared. */
	repairs: Repair[];
	/** The card to select afterwards: the next in the lesson, else the previous. */
	neighbour: string | undefined;
}

/**
 * `null` when something else points at the card (another lesson holds it, another
 * card branches to it, or needs it first), so the caller opens the repair dialog.
 * A card in no lesson (`lessonId` undefined) has no pointers, so it is deleted at once.
 */
export function quickDelete(doc: CourseV2, lessonId: string | undefined, blockId: string): QuickDelete | null {
	const references = planDeleteBlock(doc, blockId);
	const ownOnly = references.every((r) => r.kind === 'binding' && r.from.lessonId === lessonId);
	if (!ownOnly) return null;
	const blocks = doc.lessons.find((l) => l.lesson_id === lessonId)?.blocks ?? [];
	const at = blocks.findIndex((b) => b.block_id === blockId);
	const neighbour = at < 0 ? undefined : (blocks[at + 1] ?? blocks[at - 1])?.block_id;
	return {
		repairs: references.map((reference) => ({ reference, action: 'clear' as const })),
		neighbour
	};
}
