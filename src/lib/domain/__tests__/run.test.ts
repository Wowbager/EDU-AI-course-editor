import { describe, expect, it } from 'vitest';
import type { BlockV2, CourseV2 } from '../schema';
import { endsRun, lessonBlocks, runBlocks, runMaxXp, runTally } from '../run';

const text = { id: 's', type: 'text' as const, content: 'a' };
const ask = { id: 'q', type: 'question' as const, content: 'b' };
const block = (id: string, steps: BlockV2['steps']) =>
	({ block_id: id, type: 'display', steps }) as unknown as BlockV2;

const doc = {
	export_type: 'course_v2',
	lessons: [
		{
			lesson_id: 'L',
			blocks: [
				{ block_id: 'C', order: 3 },
				{ block_id: 'gone', order: 2 },
				{ block_id: 'A', order: 1 },
				{ block_id: 'B', order: 2 }
			]
		}
	],
	// A: 1, B: 9 (one text, one question), C: 1
	blocks: [block('A', [text]), block('B', [text, ask]), block('C', [text])]
} as unknown as CourseV2;

describe('what a played run is made of (preview_lesson_player.dart)', () => {
	it('lists the lesson by order and skips a block that does not exist', () => {
		expect(lessonBlocks(doc, 'L').map((b) => b.block_id)).toEqual(['A', 'B', 'C']);
		expect(lessonBlocks(doc, 'nope')).toEqual([]);
	});
	it('plays from the start card onward, or from the first when it is not in the lesson', () => {
		expect(runBlocks(doc, 'L', 'B').map((b) => b.block_id)).toEqual(['B', 'C']);
		expect(runBlocks(doc, 'L', 'elsewhere').map((b) => b.block_id)).toEqual(['A', 'B', 'C']);
		expect(runBlocks(doc, 'L', undefined)).toHaveLength(3);
	});
	it('offers the XP of exactly those blocks', () => {
		expect(runMaxXp(doc, 'L', 'A')).toBe(11);
		expect(runMaxXp(doc, 'L', 'B')).toBe(10);
		expect(runMaxXp(doc, 'L', 'C')).toBe(1);
		expect(runMaxXp(doc, 'nope', undefined)).toBe(0);
	});
	it('ends on the lesson’s last block, wherever the run started', () => {
		expect(endsRun(doc, 'L', 'C')).toBe(true);
		expect(endsRun(doc, 'L', 'B')).toBe(false);
	});
});

describe('what a run earned', () => {
	it('counts a block once, the latest result winning, and averages the scores', () => {
		const results = new Map([
			['A', { xp: 1, scoreKoef: 1 }],
			['B', { xp: 5, scoreKoef: 0.5 }]
		]);
		expect(runTally(results)).toEqual({ xp: 6, share: 0.75 });
		results.set('B', { xp: 9, scoreKoef: 1 });
		expect(runTally(results)).toEqual({ xp: 10, share: 1 });
		expect(runTally(new Map())).toEqual({ xp: 0, share: 0 });
	});
});
