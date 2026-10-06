import type { BlockType } from '$lib/domain/schema';

/**
 * The names of the three card types. Plain data, so the screen model can say them
 * without importing the icons that `card-types.ts` draws them with.
 */
export const CARD_TYPE_LABELS: Record<BlockType, string> = {
	display: 'Výklad',
	question: 'Otázka',
	exercise: 'Cvičení'
};
