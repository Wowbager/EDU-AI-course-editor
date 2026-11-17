/**
 * The placeholders the editor makes for the teacher to start from, and whether one is
 * still as it was made.
 *
 * A new course starts with one lesson, „První lekce“, holding one empty Výklad card
 * (`withStarter`). „Nová lekce“ in the tree adds a lesson named „Nová lekce“ (or
 * „Nová lekce 2“ …, `addLesson`), and „Přidat kartu“ an empty card (`addBlock`). When the
 * AI panel's outline goes in where one of these is still untouched, it stands in for it
 * (`insertOutline`), so the teacher is not left with an empty lesson or card to delete.
 *
 * Untouched means exactly what the editor made, ids and positions aside: a card equal to
 * what `addBlock` makes for its type, and a lesson with a name the editor gave it, nothing
 * set on it, and no card or one untouched card that is in no other lesson. Anything the
 * teacher typed, chose or set makes it theirs.
 */
import { addBlock, addLesson, DEFAULT_LESSON_NAME, type CommandResult } from './commands';
import { emptyCourse } from './document';
import type { Reservations } from './ids';
import type { CourseV2 } from './schema';

/** The name of a new course's first lesson. */
export const STARTER_LESSON_NAME = 'První lekce';

/** A new course's first lesson with its one empty Výklad card, the card selected. */
export function withStarter(doc: CourseV2, reserved?: Reservations): CommandResult {
	const lesson = addLesson(doc, STARTER_LESSON_NAME, reserved);
	return addBlock(lesson.doc, lesson.ref!.lessonId!, 'display', undefined, reserved);
}

/** The same value, whatever the order of its keys. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, i) => same(item, b[i]));
	}
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
	const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
	if (ka.length !== kb.length) return false;
	return ka.every((k) =>
		same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
	);
}

/** Whether the card is exactly what `addBlock` makes for its type, its id aside. */
export function isUntouchedCard(doc: CourseV2, blockId: string): boolean {
	const block = doc.blocks.find((b) => b.block_id === blockId);
	if (block === undefined) return false;
	const scratch = addLesson({ ...emptyCourse('X', ''), language: doc.language }).doc;
	const made = addBlock(scratch, scratch.lessons[0].lesson_id, block.type).doc.blocks[0];
	return same({ ...made, block_id: blockId }, block);
}

/** „Nová lekce“, „Nová lekce 2“ … (`nextDefaultLessonName`), or the new course's first lesson. */
const givenName = (name: string | undefined): boolean => {
	const text = name ?? '';
	if (text === STARTER_LESSON_NAME || text === DEFAULT_LESSON_NAME) return true;
	const rest = text.startsWith(`${DEFAULT_LESSON_NAME} `)
		? text.slice(DEFAULT_LESSON_NAME.length + 1)
		: '';
	return /^[1-9]\d*$/.test(rest);
};

/**
 * Whether the lesson is as the editor made it: a name it gave, nothing set, and no card
 * or one untouched card that no other lesson has.
 */
export function isUntouchedLesson(doc: CourseV2, lessonId: string): boolean {
	const lesson = doc.lessons.find((l) => l.lesson_id === lessonId);
	if (lesson === undefined || !givenName(lesson.name)) return false;
	const { lesson_id: _id, order: _order, blocks, name: _name, ...rest } = lesson;
	if (!same(rest, { version: 1 })) return false;
	if (blocks.length === 0) return true;
	if (blocks.length > 1) return false;
	const { block_id: blockId, order: _at, ...binding } = blocks[0];
	if (Object.values(binding).some((v) => v !== undefined)) return false;
	const elsewhere = doc.lessons.some(
		(l) => l.lesson_id !== lessonId && l.blocks.some((b) => b.block_id === blockId)
	);
	return !elsewhere && isUntouchedCard(doc, blockId);
}

/**
 * Whether the course has nothing of the teacher's yet: no lesson, or only lessons as the
 * editor made them. A course from the materials is proposed only then.
 */
export const hasNoContent = (doc: CourseV2): boolean =>
	doc.lessons.every((l) => isUntouchedLesson(doc, l.lesson_id));
