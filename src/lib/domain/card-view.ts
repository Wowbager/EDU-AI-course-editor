/**
 * The view type of the teacher's card (`groups.ts`): a merged card carries the ids of the
 * blocks it stands for. Imports types only, so every domain file can use it.
 */
import type { BlockV2 } from './schema';

/**
 * View only (`groups.ts`): the blocks a merged question card stands for. The index
 * resolves each of them to the card, so a branch from another card into the card's
 * second question still resolves, and deleting the card finds it.
 */
export const MEMBERS_KEY = '_members';

/** A card as the view holds it: one block that stands for several of the source's. */
export type ViewBlock = BlockV2 & { readonly [MEMBERS_KEY]: readonly string[] };

/** Whether this block is a merged card of the view, not a block of the source. */
export const isMerged = (block: BlockV2): block is ViewBlock =>
	Array.isArray((block as { [MEMBERS_KEY]?: unknown })[MEMBERS_KEY]);

/** The ids of the blocks a merged card stands for; undefined for any other block. */
export const membersOf = (block: BlockV2): readonly string[] | undefined =>
	isMerged(block) ? block[MEMBERS_KEY] : undefined;
