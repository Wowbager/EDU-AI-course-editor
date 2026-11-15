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
 */
import type { BlockV2, CourseV2 } from './schema';
import { addBlock, addLesson, CommandError, reorderLessons, type CommandResult } from './commands';
import { REQUEST_KEY } from './authoring';
import type { Outline, OutlineCard } from './outline';
import type { Reservations } from './ids';

export interface InsertAt {
	lessonId?: string;
	blockId?: string;
}

/** The cards the command added, in course order, for the queue that writes them. */
export interface InsertResult extends CommandResult {
	added: { blockId: string; lessonId: string }[];
}

const ownerOf = (doc: CourseV2, blockId: string | undefined): string | undefined =>
	blockId === undefined
		? undefined
		: doc.lessons.find((l) => l.blocks.some((b) => b.block_id === blockId))?.lesson_id;

function named(doc: CourseV2, blockId: string, card: OutlineCard): CourseV2 {
	return {
		...doc,
		blocks: doc.blocks.map((b): BlockV2 => (b.block_id === blockId ? { ...b, name: card.name } : b))
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
		return {
			doc: next,
			added,
			description: `Přidány karty z návrhu AI (${outline.cards.length})`
		};
	}

	// Each new lesson goes after the one before it, the first after the selected lesson.
	let previous = at.lessonId ?? ownerOf(doc, at.blockId);
	if (previous !== undefined && !doc.lessons.some((l) => l.lesson_id === previous))
		throw new CommandError('Vybraná lekce v kurzu není.');
	for (const lesson of outline.lessons) {
		const created = addLesson(next, lesson.name, reserved);
		const lessonId = created.ref!.lessonId!;
		next = created.doc;
		const result = addCards(next, lessonId, lesson.cards, undefined, reserved);
		next = result.doc;
		added.push(...result.added);
		const ids = next.lessons.map((l) => l.lesson_id).filter((id) => id !== lessonId);
		ids.splice(previous === undefined ? ids.length : ids.indexOf(previous) + 1, 0, lessonId);
		next = reorderLessons(next, ids).doc;
		previous = lessonId;
	}
	const asked = request?.trim() ?? '';
	if (asked !== '') next = { ...next, [REQUEST_KEY]: asked };
	return {
		doc: next,
		added,
		description: `Přidány lekce z návrhu AI (${outline.lessons.length})`
	};
}
