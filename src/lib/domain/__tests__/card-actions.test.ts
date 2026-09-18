import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCourse } from '../document';
import { bindBlock, unbindBlock } from '../commands';

const base = () => parseCourse(JSON.parse(readFileSync(
	new URL('./fixtures/spec-16-course.json', import.meta.url), 'utf8'
)));

it('binding an existing card twice is an identity no-op and preserves presentation', () => {
	const doc = base();
	const lesson = doc.lessons[0];
	const binding = lesson.blocks[1]; // includes a custom background
	const result = bindBlock(doc, lesson.lesson_id, binding.block_id, 0);
	expect(result.doc).toBe(doc);
	expect(result.doc.lessons[0].blocks[1]).toBe(binding);
	expect(result.ref).toEqual({ lessonId: lesson.lesson_id, blockId: binding.block_id });
});

it('an orphan can be rebound once, and sharing with another lesson still works', () => {
	const doc = base();
	const lessonId = doc.lessons[0].lesson_id;
	const blockId = doc.blocks[0].block_id;
	const orphan = unbindBlock(doc, lessonId, blockId).doc;
	const rebound = bindBlock(orphan, lessonId, blockId).doc;
	expect(rebound.blocks).toBe(doc.blocks);
	expect(rebound.lessons[0].blocks.filter((b) => b.block_id === blockId)).toHaveLength(1);
	expect(bindBlock(rebound, lessonId, blockId).doc).toBe(rebound);
	const withLesson = { ...rebound, lessons: [...rebound.lessons, {
		lesson_id: 'OTHER', version: 1, name: 'Další lekce', blocks: []
	}] };
	const shared = bindBlock(withLesson, 'OTHER', blockId).doc;
	expect(shared.lessons[1].blocks).toEqual([{ block_id: blockId, order: 1 }]);
	expect(shared.lessons[0]).toBe(rebound.lessons[0]);
});
