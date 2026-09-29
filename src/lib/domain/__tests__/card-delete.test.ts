import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCourse } from '../document';
import { bindBlock, deleteBlock } from '../commands';
import { quickDelete } from '../card-delete';

const base = () =>
	parseCourse(JSON.parse(readFileSync(new URL('./fixtures/spec-16-course.json', import.meta.url), 'utf8')));

describe('deleting a card without the repair dialog', () => {
	it('a card that only its own lesson holds is deleted with its binding, and the next card is chosen', () => {
		const doc = base();
		const lesson = doc.lessons[0];
		// The first card: nothing branches to it and nothing needs it.
		const first = lesson.blocks[0].block_id;
		const plan = quickDelete(doc, lesson.lesson_id, first)!;
		expect(plan).not.toBeNull();
		expect(plan.neighbour).toBe(lesson.blocks[1].block_id);
		const next = deleteBlock(doc, first, plan.repairs).doc;
		expect(next.blocks.some((b) => b.block_id === first)).toBe(false);
		expect(next.lessons[0].blocks.map((b) => b.block_id)).not.toContain(first);
	});

	it('the last card falls back to the one before it', () => {
		const doc = base();
		const lesson = doc.lessons[0];
		const last = lesson.blocks.at(-1)!.block_id;
		const plan = quickDelete(doc, lesson.lesson_id, last);
		expect(plan?.neighbour).toBe(lesson.blocks.at(-2)!.block_id);
	});

	it('the only card has no neighbour', () => {
		const doc = base();
		const lesson = doc.lessons[0];
		const only = { ...doc, lessons: [{ ...lesson, blocks: [lesson.blocks[0]] }] };
		expect(quickDelete(only, lesson.lesson_id, lesson.blocks[0].block_id)?.neighbour).toBeUndefined();
	});

	it('a card another card branches to or needs first is left to the repair dialog', () => {
		const doc = base();
		// L1_B2_casti has a lesson binding, a cross-block `go_to` and a prerequisite.
		expect(quickDelete(doc, doc.lessons[0].lesson_id, 'L1_B2_casti')).toBeNull();
	});

	it('a card that a second lesson also holds is left to the repair dialog', () => {
		const doc = base();
		const first = doc.lessons[0].blocks[0].block_id;
		const withSecond = {
			...doc,
			lessons: [...doc.lessons, { lesson_id: 'OTHER', version: 1, name: 'Další', blocks: [] }]
		};
		const shared = bindBlock(withSecond, 'OTHER', first).doc;
		expect(quickDelete(shared, doc.lessons[0].lesson_id, first)).toBeNull();
	});

	it('a card in no lesson is deleted at once', () => {
		const doc = base();
		const first = doc.lessons[0].blocks[0].block_id;
		const orphan = {
			...doc,
			lessons: doc.lessons.map((l) => ({ ...l, blocks: l.blocks.filter((b) => b.block_id !== first) }))
		};
		const plan = quickDelete(orphan, undefined, first)!;
		expect(plan.repairs).toEqual([]);
		expect(plan.neighbour).toBeUndefined();
	});
});
