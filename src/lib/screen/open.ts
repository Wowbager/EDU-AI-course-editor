/**
 * What is open in the editor column and the preview: the one place the selection is
 * resolved (`DocStore.open`). A ref does not always carry a `lessonId` (`setField`
 * answers with one addressed at the block; a click in the preview reports what it can
 * see), so the lesson comes from the selected card when the ref is silent, and only
 * then from the first lesson.
 */
import type { CourseV2 } from '$lib/domain/schema';
import type { DocIndex } from '$lib/domain/index-doc';
import type { Ref } from '$lib/domain/ref';
import { cardPlace } from '$lib/domain/naming';
import type { OpenState } from './types';

export function resolveOpen(doc: CourseV2, index: DocIndex, selection: Ref | null): OpenState {
	let lesson: OpenState['lesson'];
	const owner =
		selection?.blockId !== undefined
			? (index.lessonsByBlock.get(selection.blockId) ?? [])[0]
			: undefined;
	if (selection?.lessonId !== undefined) {
		lesson = doc.lessons.find((l) => l.lesson_id === selection.lessonId);
	} else if (owner !== undefined) {
		lesson = doc.lessons.find((l) => l.lesson_id === owner);
	} else if (
		selection?.blockId !== undefined &&
		doc.blocks.some((b) => b.block_id === selection.blockId)
	) {
		// A card in no lesson at all. Belonging to the first lesson would be a lie.
		lesson = undefined;
	} else {
		lesson = doc.lessons[0];
	}
	const selected =
		selection?.blockId !== undefined
			? doc.blocks.find((b) => b.block_id === selection.blockId)
			: undefined;
	const card =
		selected ??
		(lesson !== undefined
			? doc.blocks.find((b) => b.block_id === lesson.blocks[0]?.block_id)
			: undefined);
	const binding =
		card === undefined ? undefined : lesson?.blocks.find((b) => b.block_id === card.block_id);
	const orphaned =
		card !== undefined && (index.lessonsByBlock.get(card.block_id) ?? []).length === 0;
	// The position is the card's place in the open lesson, by the one naming rule.
	const position =
		card === undefined || binding === undefined || lesson === undefined
			? undefined
			: cardPlace(doc, card, { lessonId: lesson.lesson_id }).position;
	return { lesson, card, binding, orphaned, position };
}
