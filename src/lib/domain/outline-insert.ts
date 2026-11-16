/**
 * Putting the ticked part of a proposal into the course: lessons or cards, empty except
 * for a name and a type (`outline.ts`); the AI writes them from the name, the outline around
 * them and the teacher's request, which a course structure saves on the course. One command,
 * so one undo step takes all of it back.
 *
 * Where it goes follows what the teacher has selected: lessons after the selected lesson
 * (or after the lesson of the selected card), else at the end; cards into the selected
 * lesson after the selected card, else at its end. Ids come from the ordinary commands
 * (`addLesson`, `addBlock`) on the document as it grows, so they stay unique.
 *
 * The outline stands in for a placeholder still as the editor made it (`starter.ts`):
 * lessons replace the selected lesson when it is untouched (a new course's „První lekce“
 * with its empty card, or a „Nová lekce“ just added), and cards put into an untouched
 * lesson replace its one untouched card. Then the selection moves to the first new card,
 * and an undo puts it back where it was.
 */
import type { BlockV2, CourseV2 } from './schema';
import {
	addBlock,
	addLesson,
	CommandError,
	deleteBlock,
	deleteLesson,
	reorderLessons,
	unbindBlock,
	type CommandResult
} from './commands';
import { isUntouchedLesson } from './starter';
import { REQUEST_KEY, SOURCE_REFS_KEY } from './authoring';
import type { Outline, OutlineCard } from './outline';
import type { Reservations } from './ids';

export interface InsertAt {
	lessonId?: string;
	blockId?: string;
}

/**
 * The cards the command added, in course order, for the queue that writes them. `ref` is
 * set only when a placeholder was replaced: the selection was on it.
 */
export interface InsertResult extends CommandResult {
	added: { blockId: string; lessonId: string }[];
}

/** The lesson's cards and the lesson itself out of the course. */
function withoutLesson(doc: CourseV2, lessonId: string): CourseV2 {
	const lesson = doc.lessons.find((l) => l.lesson_id === lessonId)!;
	let next = deleteLesson(doc, lessonId).doc;
	for (const { block_id } of lesson.blocks) next = deleteBlock(next, block_id).doc;
	return next;
}

/** After a placeholder was replaced: the first new card, and back to the placeholder on undo. */
function moved(
	back: { lessonId: string; blockId?: string },
	added: InsertResult['added'],
	/** The first new lesson, for an outline whose lessons have no cards yet. */
	lessonId?: string
): Pick<CommandResult, 'ref' | 'undoRef'> {
	const first = added[0];
	const ref =
		first !== undefined
			? { lessonId: first.lessonId, blockId: first.blockId }
			: lessonId !== undefined
				? { lessonId }
				: undefined;
	return {
		...(ref !== undefined ? { ref } : {}),
		undoRef: back.blockId === undefined ? { lessonId: back.lessonId } : back
	};
}

const ownerOf = (doc: CourseV2, blockId: string | undefined): string | undefined =>
	blockId === undefined
		? undefined
		: doc.lessons.find((l) => l.blocks.some((b) => b.block_id === blockId))?.lesson_id;

function named(doc: CourseV2, blockId: string, card: OutlineCard): CourseV2 {
	return {
		...doc,
		blocks: doc.blocks.map((b): BlockV2 =>
			b.block_id === blockId
				? {
						...b,
						name: card.name,
						// Only the keys of the materials; the text stays with the course's materials.
						...(card.sources !== undefined && card.sources.length > 0
							? { [SOURCE_REFS_KEY]: [...card.sources] }
							: {})
					}
				: b
		)
	};
}

/** Add the cards to a lesson from `at` on; returns the new document and the ids. */
function addCards(
	doc: CourseV2,
	lessonId: string,
	cards: readonly OutlineCard[],
	at: number | undefined,
	reserved: Reservations | undefined
): { doc: CourseV2; added: InsertResult['added'] } {
	let next = doc;
	const added: InsertResult['added'] = [];
	cards.forEach((card, i) => {
		const result = addBlock(
			next,
			lessonId,
			card.kind,
			at === undefined ? undefined : at + i,
			reserved
		);
		const blockId = result.ref!.blockId!;
		next = named(result.doc, blockId, card);
		added.push({ blockId, lessonId });
	});
	return { doc: next, added };
}

export function insertOutline(
	doc: CourseV2,
	outline: Outline,
	at: InsertAt = {},
	reserved?: Reservations,
	/** What the teacher asked for; kept on the course with a structure, for the cards' dossier. */
	request?: string
): InsertResult {
	let next = doc;
	const added: InsertResult['added'] = [];

	if (outline.scope === 'cards') {
		let lessonId = at.lessonId ?? ownerOf(doc, at.blockId) ?? doc.lessons.at(-1)?.lesson_id;
		if (lessonId !== undefined && !doc.lessons.some((l) => l.lesson_id === lessonId))
			throw new CommandError('Lekce, do které karty patří, v kurzu není.');
		if (lessonId === undefined) {
			const created = addLesson(next, undefined, reserved);
			next = created.doc;
			lessonId = created.ref!.lessonId!;
		}
		const lesson = next.lessons.find((l) => l.lesson_id === lessonId)!;
		// An untouched lesson's one untouched card is what the new cards stand in for.
		const placeholder = isUntouchedLesson(next, lessonId) ? lesson.blocks[0]?.block_id : undefined;
		const after = lesson.blocks.findIndex((b) => b.block_id === at.blockId);
		const result = addCards(
			next,
			lessonId,
			outline.cards,
			after < 0 ? undefined : after + 1,
			reserved
		);
		next = result.doc;
		added.push(...result.added);
		if (placeholder !== undefined)
			next = deleteBlock(unbindBlock(next, lessonId, placeholder).doc, placeholder).doc;
		return {
			doc: next,
			added,
			...(placeholder !== undefined ? moved({ lessonId, blockId: placeholder }, added) : {}),
			description: `Přidány karty z návrhu AI (${outline.cards.length})`
		};
	}

	// Each new lesson goes after the one before it, the first after the selected lesson.
	let previous = at.lessonId ?? ownerOf(doc, at.blockId);
	if (previous !== undefined && !doc.lessons.some((l) => l.lesson_id === previous))
		throw new CommandError('Vybraná lekce v kurzu není.');
	// The selected lesson, or a course's only lesson, when it is still as the editor made it.
	const candidate = previous ?? (doc.lessons.length === 1 ? doc.lessons[0].lesson_id : undefined);
	const placeholder =
		candidate !== undefined && isUntouchedLesson(doc, candidate) ? candidate : undefined;
	let firstLesson: string | undefined;
	for (const lesson of outline.lessons) {
		const created = addLesson(next, lesson.name, reserved);
		const lessonId = created.ref!.lessonId!;
		firstLesson ??= lessonId;
		next = created.doc;
		const result = addCards(next, lessonId, lesson.cards, undefined, reserved);
		next = result.doc;
		added.push(...result.added);
		const ids = next.lessons.map((l) => l.lesson_id).filter((id) => id !== lessonId);
		ids.splice(previous === undefined ? ids.length : ids.indexOf(previous) + 1, 0, lessonId);
		next = reorderLessons(next, ids).doc;
		previous = lessonId;
	}
	const back =
		placeholder === undefined
			? undefined
			: {
					lessonId: placeholder,
					blockId: doc.lessons.find((l) => l.lesson_id === placeholder)!.blocks[0]?.block_id
				};
	if (placeholder !== undefined) next = withoutLesson(next, placeholder);
	const asked = request?.trim() ?? '';
	if (asked !== '') next = { ...next, [REQUEST_KEY]: asked };
	return {
		doc: next,
		added,
		...(back !== undefined ? moved(back, added, firstLesson) : {}),
		description: `Přidány lekce z návrhu AI (${outline.lessons.length})`
	};
}
