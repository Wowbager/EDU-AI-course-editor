/**
 * What a played run (Vyzkoušet) is made of, and what it earned.
 *
 * The player is given the course, a lesson and the card to start on. It lists the
 * lesson's blocks sorted by `order` (a missing one is 0), skips a binding whose block
 * does not exist, and plays from the start card onward, one block after the next
 * (`preview_lesson_player.dart`, `_advance`; `block_model.dart`,
 * `getBlockBindingsForLesson` / `loadBlocksWithBindings`). A start card that is not in
 * the lesson means the first block. A branch can skip blocks or go back, so the maximum
 * is what the run offers, not what every path earns.
 *
 * The player finds a card by its first place in the list (`_indexOf`), so a card bound
 * twice in a lesson is, to it, always the first of the two: `_advance` goes on from
 * there, and a card whose first place is not the last never ends the run.
 */
import type { BlockV2, CourseV2 } from './schema';
import { derivedBlockXp } from './derive';

/** The blocks the player lists for a lesson, in play order. */
export function lessonBlocks(doc: CourseV2, lessonId: string | undefined): BlockV2[] {
	const lesson = doc.lessons.find((l) => l.lesson_id === lessonId);
	if (lesson === undefined) return [];
	const byId = new Map<string, BlockV2>();
	for (const block of doc.blocks) if (!byId.has(block.block_id)) byId.set(block.block_id, block);
	return lesson.blocks
		.map((binding, position) => ({ binding, position }))
		.sort((a, b) => (a.binding.order ?? 0) - (b.binding.order ?? 0) || a.position - b.position)
		.flatMap(({ binding }) => byId.get(binding.block_id) ?? []);
}

/** The blocks a run started on `startBlockId` plays. */
export function runBlocks(
	doc: CourseV2,
	lessonId: string | undefined,
	startBlockId: string | undefined
): BlockV2[] {
	const blocks = lessonBlocks(doc, lessonId);
	const from = blocks.findIndex((b) => b.block_id === startBlockId);
	return blocks.slice(Math.max(from, 0));
}

/**
 * The most XP a run can award: the sum over `runBlocks`, each card once. A card bound
 * twice earns once, like `runTally` counts it.
 */
export function runMaxXp(
	doc: CourseV2,
	lessonId: string | undefined,
	startBlockId: string | undefined
): number {
	const once = new Map(runBlocks(doc, lessonId, startBlockId).map((b) => [b.block_id, b]));
	return [...once.values()].reduce((sum, b) => sum + derivedBlockXp(b), 0);
}

/** Whether completing `blockId` ends the run: its first place is the lesson's last. */
export function endsRun(doc: CourseV2, lessonId: string | undefined, blockId: string): boolean {
	const blocks = lessonBlocks(doc, lessonId);
	return blocks.length > 0 && blocks.findIndex((b) => b.block_id === blockId) === blocks.length - 1;
}

export interface BlockResult {
	xp: number;
	scoreKoef: number;
	mark?: string;
}

/**
 * What a run earned so far. One result per block, the latest winning: a block played
 * again after Zpět replaces its earlier result instead of adding to it.
 */
export function runTally(results: ReadonlyMap<string, BlockResult>): {
	xp: number;
	/** Mean `scoreKoef` of the finished blocks, 0–1. */
	share: number;
} {
	let xp = 0;
	let koef = 0;
	for (const r of results.values()) {
		xp += r.xp;
		koef += r.scoreKoef;
	}
	return { xp, share: results.size === 0 ? 0 : koef / results.size };
}

/**
 * Which block a `completed` belongs to. The message carries no block id, so it is
 * worked out from what the player reported before it.
 *
 * The player sends `stepChanged` for every card it shows, but a block with no steps
 * has none, so "the last block reported" would credit its `completed` to the card
 * before. The player moves on by one block after a completion (`_advance`) and by
 * `stepChanged` for any jump, so:
 *  - a position reported since the last completion is where the pupil is (`seen`);
 *  - with none, the pupil is on the block after the one last completed
 *    (`previous`), or on the run's first block when nothing was completed yet.
 *
 * Undefined when the run has no such block: the run is over, the lesson is empty, or
 * `previous` is no longer in the lesson (an edit took it out), where `_advance` does
 * not move and the editor cannot tell which card is on screen.
 */
export function completedBlock(
	doc: CourseV2,
	lessonId: string | undefined,
	startBlockId: string | undefined,
	seen: string | undefined,
	previous: string | undefined
): string | undefined {
	if (seen !== undefined) return seen;
	if (previous === undefined) return runBlocks(doc, lessonId, startBlockId)[0]?.block_id;
	const blocks = lessonBlocks(doc, lessonId);
	const at = blocks.findIndex((b) => b.block_id === previous);
	return at < 0 ? undefined : blocks[at + 1]?.block_id;
}
