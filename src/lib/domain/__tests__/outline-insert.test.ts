import { describe, expect, it } from 'vitest';
import { addBlock, addLesson } from '../commands';
import { emptyCourse } from '../document';
import { BRIEF_KEY, canGenerate, completeness } from '../authoring';
import { insertOutline } from '../outline-insert';
import { OUTLINE_KINDS, type Outline } from '../outline';
import { DocStore } from '$lib/state/doc-store.svelte';
import type { CourseV2 } from '../schema';

const card = (name: string, kind: (typeof OUTLINE_KINDS)[number] = 'display') => ({
	kind,
	name,
	brief: `O: ${name}`
});

function course(): { doc: CourseV2; l1: string; l2: string; a1: string; a2: string } {
	let doc = addLesson(emptyCourse('K', 'Zlomky'), 'Jedna').doc;
	doc = addLesson(doc, 'Dvě').doc;
	const [l1, l2] = doc.lessons.map((l) => l.lesson_id);
	const first = addBlock(doc, l1, 'display');
	const second = addBlock(first.doc, l1, 'display');
	return { doc: second.doc, l1, l2, a1: first.ref!.blockId!, a2: second.ref!.blockId! };
}

const lessonNames = (doc: CourseV2) => doc.lessons.map((l) => l.name);
const cardNames = (doc: CourseV2, lessonId: string) =>
	doc.lessons
		.find((l) => l.lesson_id === lessonId)!
		.blocks.map((b) => doc.blocks.find((x) => x.block_id === b.block_id)!.name);

const structure: Outline = {
	scope: 'lessons',
	lessons: [
		{
			name: 'Polovina',
			takeaway: 'Poznám půlku',
			cards: [card('Co je půlka'), card('Příklady', 'exercise')]
		},
		{ name: 'Třetina', cards: [card('Kvíz', 'question')] }
	]
};

describe('inserting a proposal of lessons', () => {
	it('puts the lessons after the selected lesson, in order', () => {
		const { doc, l1 } = course();
		const result = insertOutline(doc, structure, { lessonId: l1 });
		expect(lessonNames(result.doc)).toEqual(['Jedna', 'Polovina', 'Třetina', 'Dvě']);
		expect(result.doc.lessons.map((l) => l.order)).toEqual([1, 2, 3, 4]);
	});

	it('goes after the lesson of the selected card, and at the end with no selection', () => {
		const { doc, l1, a1 } = course();
		expect(lessonNames(insertOutline(doc, structure, { blockId: a1 }).doc)).toEqual([
			'Jedna',
			'Polovina',
			'Třetina',
			'Dvě'
		]);
		expect(lessonNames(insertOutline(doc, structure).doc)).toEqual([
			'Jedna',
			'Dvě',
			'Polovina',
			'Třetina'
		]);
		expect(l1).toBeDefined();
	});

	it('keeps name, brief and takeaway, and maps every kind to its block type', () => {
		const { doc } = course();
		const result = insertOutline(doc, structure);
		const lesson = result.doc.lessons.find((l) => l.name === 'Polovina')!;
		expect(lesson.description).toBe('Poznám půlku');
		expect(result.doc.lessons.find((l) => l.name === 'Třetina')!.description).toBeUndefined();
		const blocks = result.added.map((a) =>
			result.doc.blocks.find((b) => b.block_id === a.blockId)!
		);
		expect(blocks.map((b) => b.type)).toEqual(['display', 'exercise', 'question']);
		expect(blocks.map((b) => b.name)).toEqual(['Co je půlka', 'Příklady', 'Kvíz']);
		expect(blocks.map((b) => (b as Record<string, unknown>)[BRIEF_KEY])).toEqual([
			'O: Co je půlka',
			'O: Příklady',
			'O: Kvíz'
		]);
		// Empty except for the name and brief, and ready for AI to write.
		for (const b of blocks) {
			expect(completeness(b)).toBe('stub');
			expect(canGenerate(b)).toBe(true);
		}
	});

	it('returns the new cards in course order, each with its lesson', () => {
		const { doc } = course();
		const result = insertOutline(doc, structure);
		expect(result.added).toHaveLength(3);
		const order = result.doc.lessons.flatMap((l) => l.blocks.map((b) => b.block_id));
		expect(order.filter((id) => result.added.some((a) => a.blockId === id))).toEqual(
			result.added.map((a) => a.blockId)
		);
		for (const { blockId, lessonId } of result.added)
			expect(
				result.doc.lessons.find((l) => l.lesson_id === lessonId)!.blocks.map((b) => b.block_id)
			).toContain(blockId);
	});

	it('keeps every id unique, also with an old document that has L1 and L1_B1', () => {
		const { doc } = course();
		const result = insertOutline(insertOutline(doc, structure).doc, structure);
		const lessonIds = result.doc.lessons.map((l) => l.lesson_id);
		const blockIds = result.doc.blocks.map((b) => b.block_id);
		expect(new Set(lessonIds).size).toBe(lessonIds.length);
		expect(new Set(blockIds).size).toBe(blockIds.length);
		// Every card is in exactly one lesson.
		const bound = result.doc.lessons.flatMap((l) => l.blocks.map((b) => b.block_id));
		expect([...bound].sort()).toEqual([...blockIds].sort());
	});

	it('does not touch what was there', () => {
		const { doc } = course();
		const result = insertOutline(doc, structure);
		for (const b of doc.blocks) expect(result.doc.blocks).toContainEqual(b);
	});
});

describe('inserting a proposal of cards', () => {
	const cards: Outline = { scope: 'cards', cards: [card('Nová A'), card('Nová B', 'exercise')] };

	it('puts them after the selected card in its lesson', () => {
		const { doc, l1, a1 } = course();
		const result = insertOutline(doc, cards, { lessonId: l1, blockId: a1 });
		expect(cardNames(result.doc, l1)).toEqual([undefined, 'Nová A', 'Nová B', undefined]);
		expect(result.doc.lessons[0].blocks.map((b) => b.order)).toEqual([1, 2, 3, 4]);
		expect(result.added.every((a) => a.lessonId === l1)).toBe(true);
	});

	it('goes to the end of the selected lesson when no card is selected, and to the last lesson with nothing selected', () => {
		const { doc, l1, l2 } = course();
		expect(cardNames(insertOutline(doc, cards, { lessonId: l1 }).doc, l1)).toEqual([
			undefined,
			undefined,
			'Nová A',
			'Nová B'
		]);
		expect(cardNames(insertOutline(doc, cards).doc, l2)).toEqual(['Nová A', 'Nová B']);
	});

	it('makes a lesson when the course has none', () => {
		const result = insertOutline(emptyCourse('K', 'Prázdný'), cards);
		expect(result.doc.lessons).toHaveLength(1);
		expect(result.doc.blocks.map((b) => b.name)).toEqual(['Nová A', 'Nová B']);
	});

	it('refuses a lesson that is not in the course', () => {
		const { doc } = course();
		expect(() => insertOutline(doc, cards, { lessonId: 'nope' })).toThrow();
	});
});

describe('through the store', () => {
	it('is one undo step, and undo takes everything back', () => {
		const { doc, l1 } = course();
		const store = new DocStore();
		store.load(doc);
		const before = store.undoStack.length;
		store.endEdit();
		store.apply((d, r) => insertOutline(d, structure, { lessonId: l1 }, r));
		expect(store.undoStack.length).toBe(before + 1);
		expect(store.doc.lessons).toHaveLength(4);
		store.undo();
		expect(store.doc.lessons).toHaveLength(2);
		expect(store.doc.blocks).toHaveLength(2);
	});
});
