import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyCourse, importCourse, parseCourse } from '../document';
import { addLesson, pasteBlock, pasteStep } from '../commands';
import { fromClipboard, toClipboard } from '../clipboard';
import { fromView, groupOf, groupsOf, splitQuestionCards, toView } from '../groups';
import type { CourseV2 } from '../schema';

const fixture = (path: string): unknown =>
	JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8'));
const base = () => parseCourse(fixture('spec-16-course.json'));
const block = (doc: CourseV2, id: string) => doc.blocks.find((b) => b.block_id === id)!;

/** What a copy of `blockId` (and maybe one of its steps) reads back as. */
const copied = (doc: CourseV2, blockId: string, stepId?: string) =>
	fromClipboard(toClipboard(doc.course_id, block(doc, blockId), stepId)!)!;
const copiedCard = (doc: CourseV2, blockId: string) => {
	const c = copied(doc, blockId);
	if (c.kind !== 'card') throw new Error('expected a card');
	return c;
};
const copiedStep = (doc: CourseV2, blockId: string, stepId: string) => {
	const c = copied(doc, blockId, stepId);
	if (c.kind !== 'step') throw new Error('expected a step');
	return c;
};
/** The same course under another id, as a second course with matching card ids. */
const elsewhere = (): CourseV2 => ({ ...base(), course_id: 'JINY' });

describe('the clipboard text', () => {
	it('reads back the card it was made from', () => {
		const doc = base();
		expect(copied(doc, 'L1_B3_poznej')).toEqual({
			from: { courseId: doc.course_id, blockId: 'L1_B3_poznej' },
			kind: 'card',
			block: block(doc, 'L1_B3_poznej')
		});
	});

	it('reads back one step', () => {
		const doc = base();
		expect(copied(doc, 'L1_B3_poznej', 's2')).toEqual({
			from: { courseId: doc.course_id, blockId: 'L1_B3_poznej' },
			kind: 'step',
			step: block(doc, 'L1_B3_poznej').steps[1]
		});
	});

	it('is not a copied card when it is any other text', () => {
		expect(fromClipboard('3/4 pizzy')).toBeNull();
		expect(fromClipboard('{"a": 1}')).toBeNull();
		expect(fromClipboard('{"edu_ai_editor": 1, "kind": "card"}')).toBeNull();
		expect(fromClipboard('edu_ai_editor {')).toBeNull();
	});
});

describe('pasting a card', () => {
	it('in the same course: a new card right after the selected one, refs kept', () => {
		const doc = base();
		const { block: card, from } = copiedCard(doc, 'L1_B3_poznej');
		const result = pasteBlock(doc, card, 'L1_INTRO', 'L1_B1_uvod', undefined, from);
		const id = result.ref!.blockId!;

		expect(id).not.toBe('L1_B3_poznej');
		expect(result.doc.lessons[0].blocks.map((b) => b.block_id)).toEqual([
			'L1_B1_uvod',
			id,
			'L1_B2_casti',
			'L1_B3_poznej'
		]);
		const copy = block(result.doc, id);
		const options = copy.steps[1].question!.options!;
		expect(options.map((o) => o.go_to)).toEqual(['s4', 's3', 'L1_B2_casti', 'CHAT']);
		expect(copy.learning?.prerequisites).toEqual([{ block_id: 'L1_B2_casti', min_level: 0.5 }]);
	});

	it('into another course: jumps and prerequisites to cards it lacks are dropped', () => {
		const { block: card, from } = copiedCard(base(), 'L1_B3_poznej');
		let other = emptyCourse('JINY', 'Jiný kurz');
		other = addLesson(other).doc;
		const lessonId = other.lessons[0].lesson_id;
		const result = pasteBlock(other, card, lessonId, undefined, undefined, from);
		const copy = block(result.doc, result.ref!.blockId!);

		expect(result.doc.lessons[0].blocks.map((b) => b.block_id)).toEqual([copy.block_id]);
		expect(copy.steps[1].question!.options!.map((o) => o.go_to)).toEqual([
			's4',
			's3',
			undefined,
			'CHAT'
		]);
		expect(copy.learning?.prerequisites).toEqual([]);
	});

	it('into another course with a card of the same id: that card is not the one meant', () => {
		const { block: card, from } = copiedCard(base(), 'L1_B3_poznej');
		const result = pasteBlock(elsewhere(), card, 'L1_INTRO', undefined, undefined, from);
		const copy = block(result.doc, result.ref!.blockId!);
		expect(copy.steps[1].question!.options!.map((o) => o.go_to)).toEqual([
			's4',
			's3',
			undefined,
			'CHAT'
		]);
		expect(copy.learning?.prerequisites).toEqual([]);
	});

	it('of several questions gets blocks of its own, never the original group', () => {
		const { doc } = splitQuestionCards(importCourse(fixture('corpus/zlomky-5-trida.json')).doc);
		const [key, members] = [...groupsOf(doc)].find(([, m]) => m.length > 1)!;
		const view = toView(doc);
		const card = copiedCard(view, key);
		const lessonId = view.lessons.find((l) => l.blocks.some((b) => b.block_id === key))!.lesson_id;

		const pasted = pasteBlock(view, card.block, lessonId, key, undefined, card.from);
		const after = fromView(doc, view, pasted.doc);

		const newKey = pasted.ref!.blockId!;
		const copies = groupsOf(after).get(newKey)!;
		expect(copies).toHaveLength(members.length);
		expect(groupsOf(after).get(key)).toEqual(members);
		const before = new Set(doc.blocks.map((b) => b.block_id));
		for (const copy of copies) {
			expect(before.has(copy.block_id)).toBe(false);
			expect(groupOf(copy)).toBe(newKey);
		}
	});
});

describe('pasting a step', () => {
	it('gets a fresh id, lands after the selected step and keeps jumps it can', () => {
		const doc = base();
		const { step, from } = copiedStep(doc, 'L1_B3_poznej', 's2');
		const result = pasteStep(doc, 'L1_B3_poznej', step, 's1', undefined, from);
		const steps = block(result.doc, 'L1_B3_poznej').steps;

		expect(steps.map((s) => s.id)).toEqual(['s1', result.ref!.stepId, 's2', 's3', 's4']);
		expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
		expect(steps[1].question!.options!.map((o) => o.go_to)).toEqual([
			's4',
			's3',
			'L1_B2_casti',
			'CHAT'
		]);
	});

	it('into another card drops jumps to steps that card does not have', () => {
		const doc = base();
		const { step, from } = copiedStep(doc, 'L1_B3_poznej', 's2');
		const result = pasteStep(doc, 'L1_B2_casti', step, undefined, undefined, from);
		const pasted = block(result.doc, 'L1_B2_casti').steps.at(-1)!;

		expect(pasted.id).not.toBe('s2');
		expect(pasted.question!.options!.map((o) => o.go_to)).toEqual([
			undefined,
			undefined,
			'L1_B2_casti',
			'CHAT'
		]);
	});

	it('into another card whose steps have the same ids: those are other steps', () => {
		const doc = base();
		const { step, from } = copiedStep(doc, 'L1_B3_poznej', 's2');
		// The target card happens to have an s3 and s4 of its own.
		const target = block(doc, 'L1_B1_uvod');
		target.steps = [
			{ ...target.steps[0], id: 's3' },
			{ ...target.steps[1], id: 's4' }
		];
		const result = pasteStep(doc, 'L1_B1_uvod', step, undefined, undefined, from);
		const pasted = block(result.doc, 'L1_B1_uvod').steps.at(-1)!;
		expect(pasted.question!.options!.map((o) => o.go_to)).toEqual([
			undefined,
			undefined,
			'L1_B2_casti',
			'CHAT'
		]);
	});

	it('into another course keeps only keyword jumps', () => {
		const { step, from } = copiedStep(base(), 'L1_B3_poznej', 's2');
		const result = pasteStep(elsewhere(), 'L1_B3_poznej', step, undefined, undefined, from);
		const pasted = block(result.doc, 'L1_B3_poznej').steps.at(-1)!;
		expect(pasted.question!.options!.map((o) => o.go_to)).toEqual([
			undefined,
			undefined,
			undefined,
			'CHAT'
		]);
	});
});
