import { describe, expect, it } from 'vitest';
import { addBlock, addLesson, addOption, renameLesson, setField, setPractice } from '../commands';
import { emptyCourse } from '../document';
import { isUntouchedCard, isUntouchedLesson, STARTER_LESSON_NAME, withStarter } from '../starter';
import { toView } from '../groups';
import type { CourseV2 } from '../schema';

const KINDS = ['display', 'question', 'exercise'] as const;

const fresh = (): { doc: CourseV2; lessonId: string; blockId: string } => {
	const result = withStarter(emptyCourse('K', 'Nový kurz'));
	return { doc: result.doc, lessonId: result.ref!.lessonId!, blockId: result.ref!.blockId! };
};

const named = (doc: CourseV2, lessonId: string, name: string): CourseV2 => ({
	...doc,
	lessons: doc.lessons.map((l) => (l.lesson_id === lessonId ? { ...l, name } : l))
});

describe('a new course', () => {
	it('starts with „První lekce“ and one empty Výklad card, the card selected', () => {
		const { doc, lessonId, blockId } = fresh();
		expect(doc.lessons.map((l) => l.name)).toEqual([STARTER_LESSON_NAME]);
		expect(doc.blocks).toHaveLength(1);
		expect(doc.blocks[0]).toMatchObject({ block_id: blockId, type: 'display' });
		expect(doc.lessons[0].lesson_id).toBe(lessonId);
		expect(isUntouchedLesson(doc, lessonId)).toBe(true);
	});
});

describe('an untouched card', () => {
	for (const kind of KINDS) {
		it(`is a ${kind} card as „Přidat kartu“ makes it, also in the teacher's view, and stops being one once anything is set`, () => {
			let doc = addLesson(emptyCourse('K', 'K')).doc;
			const lessonId = doc.lessons[0].lesson_id;
			const added = addBlock(doc, lessonId, kind);
			doc = added.doc;
			const blockId = added.ref!.blockId!;
			expect(isUntouchedCard(doc, blockId)).toBe(true);
			expect(isUntouchedCard(toView(doc), blockId)).toBe(true);

			const step = { blockId, stepId: 's1' };
			const typed =
				kind === 'display'
					? setField(doc, { ...step, field: 'content' }, 'Ahoj').doc
					: setField(doc, { ...step, optionId: 'a', field: 'text' }, '1/2').doc;
			expect(isUntouchedCard(typed, blockId)).toBe(false);
			expect(isUntouchedCard(setField(doc, { blockId, field: 'name' }, 'Moje').doc, blockId)).toBe(
				false
			);
			expect(isUntouchedCard(setPractice(doc, blockId, true).doc, blockId)).toBe(false);
			if (kind !== 'display')
				expect(isUntouchedCard(addOption(doc, blockId, 's1').doc, blockId)).toBe(false);
		});
	}

	it('is not a card that is not there', () => {
		expect(isUntouchedCard(fresh().doc, 'nope')).toBe(false);
	});
});

describe('an untouched lesson', () => {
	it('has the name the editor gave it, and no card or one untouched card', () => {
		let doc = emptyCourse('K', 'K');
		doc = addLesson(doc).doc;
		doc = addLesson(doc).doc;
		const [first, second] = doc.lessons.map((l) => l.lesson_id);
		expect(doc.lessons.map((l) => l.name)).toEqual(['Nová lekce', 'Nová lekce 2']);
		expect(isUntouchedLesson(doc, first)).toBe(true);
		expect(isUntouchedLesson(doc, second)).toBe(true);
		doc = addBlock(doc, first, 'question').doc;
		expect(isUntouchedLesson(doc, first)).toBe(true);
		doc = addBlock(doc, first, 'question').doc;
		expect(isUntouchedLesson(doc, first)).toBe(false);
	});

	it('is no longer one once it is renamed, set, or its card is touched', () => {
		const { doc, lessonId, blockId } = fresh();
		expect(isUntouchedLesson(named(doc, lessonId, 'Zlomky'), lessonId)).toBe(false);
		expect(isUntouchedLesson(addLesson(emptyCourse('K', 'K'), 'Nová lekce x').doc, 'L1')).toBe(
			false
		);
		const set = {
			...doc,
			lessons: doc.lessons.map((l) => ({ ...l, description: 'Úvod do zlomků' }))
		};
		expect(isUntouchedLesson(set, lessonId)).toBe(false);
		const typed = setField(doc, { blockId, stepId: 's1', field: 'content' }, 'Text').doc;
		expect(isUntouchedLesson(typed, lessonId)).toBe(false);
	});

	it('is not one whose card is in another lesson too', () => {
		const { doc, blockId } = fresh();
		let next = addLesson(doc).doc;
		const other = next.lessons[1].lesson_id;
		next = {
			...next,
			lessons: next.lessons.map((l) =>
				l.lesson_id === other ? { ...l, blocks: [{ block_id: blockId, order: 1 }] } : l
			)
		};
		expect(isUntouchedLesson(next, doc.lessons[0].lesson_id)).toBe(false);
	});
});
