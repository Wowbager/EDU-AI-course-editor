/**
 * What the preview column hands the player about the course around the card on screen.
 * Pure: the column only passes its inputs in.
 */
import type { BlockV2, CourseV2 } from '$lib/domain/schema';
import { cardIdOf, groupOf, groupsOf } from '$lib/domain/groups';
import { cardLabel, partLabel } from '$lib/domain/naming';

/**
 * What to call the other cards a branch leads to. The player holds one card and cannot
 * look another one up; left to itself it would print the `block_id`, which a teacher
 * must never be shown (plan §8). So the naming is decided here, by the same rule the
 * rest of the editor uses. `showIds` is Pokročilý, which names a branch by its id.
 */
export function branchLabels(
	source: CourseV2,
	view: CourseV2,
	showIds: boolean
): Record<string, string> {
	const groups = groupsOf(source);
	const labels: Record<string, string> = {};
	for (const candidate of source.blocks) {
		if (showIds) {
			labels[candidate.block_id] = candidate.block_id;
			continue;
		}
		// A branch into a card's later question names the card and the question.
		const key = groupOf(candidate);
		const members = key !== undefined ? (groups.get(key) ?? []) : [];
		const position = members.indexOf(candidate);
		const card = members[0] ?? candidate;
		const name = cardLabel(view, cardIdOf(source, card.block_id), { max: 30 });
		labels[candidate.block_id] =
			position > 0 ? `${name}, ${partLabel(position, members.length)}` : name;
	}
	return labels;
}

/**
 * The steps of a played card the pupil has met: those of the card's blocks before the
 * one on screen, and the ones on screen. The step list folds the rest. `splitCards` is
 * whether the editor shows a card as one (everything but Pokročilý).
 */
export function reachedSteps(
	source: CourseV2,
	blockId: string,
	shown: string[] | undefined,
	splitCards: boolean
): string[] | undefined {
	if (shown === undefined) return undefined;
	const key = groupOf(source.blocks.find((b) => b.block_id === blockId) ?? ({} as BlockV2));
	if (key === undefined || !splitCards) return shown;
	const members = groupsOf(source).get(key) ?? [];
	const at = members.findIndex((m) => m.block_id === blockId);
	return [...members.slice(0, Math.max(at, 0)).flatMap((m) => m.steps.map((s) => s.id)), ...shown];
}

/** The blocks the card on screen is made of, as exported, in order. */
export function blocksOfCard(source: CourseV2, cardId: string): BlockV2[] {
	const members = groupsOf(source).get(cardId);
	if (members !== undefined) return members;
	const own = source.blocks.find((b) => b.block_id === cardId);
	return own !== undefined ? [own] : [];
}
