/**
 * Which steps and cards a pupil can reach, by the player's rule and not the editor's
 * older one: `GoToResolver.resolve` (`lib/models/step_navigation.dart:208-211`) ignores a
 * `go_to` in an `exercise` card and nowhere else, and the answers' own targets are read
 * only for a single pick (`optionOutcomesApply`).
 */
import { describe, expect, it } from 'vitest';
import { parseCourse } from '../document';
import { reachableSteps } from '../index-doc';
import { validate } from '../validate';

type Question = { type?: string; allow_multiple?: boolean };

/** A card of `type` with a question on s1 whose answer "a" jumps to s3 (and "b" goes on). */
function course(type: string, question: Question = {}, own = true) {
	return parseCourse({
		export_type: 'course_v2',
		course_id: 'K',
		version: 1,
		name: 'K',
		lessons: [
			{
				lesson_id: 'L1',
				name: 'L',
				order: 1,
				blocks: own ? [{ block_id: 'B1', order: 1 }] : []
			}
		],
		blocks: [
			{
				block_id: 'B1',
				type,
				steps: [
					{
						id: 's1',
						type: 'question',
						content: 'Otázka',
						question: {
							type: 'multiple_choice',
							...question,
							options: [
								{ id: 'a', text: 'A', is_correct: true, go_to: 's3' },
								{ id: 'b', text: 'B', go_to: 'NEXT_STEP' }
							]
						}
					},
					{ id: 's2', type: 'text', content: 'Dál' },
					{ id: 's3', type: 'text', content: 'Skok' }
				]
			},
			{
				block_id: 'B2',
				type: 'display',
				steps: [{ id: 's1', type: 'text', content: 'Jinde' }]
			}
		]
	});
}

const codes = (doc: ReturnType<typeof course>, code: string) =>
	validate(doc, undefined)
		.warnings.filter((w) => w.code === code)
		.map((w) => `${w.ref.blockId}/${w.ref.stepId ?? ''}`);

describe('the steps a pupil reaches', () => {
	it('follows an answer in a question card', () => {
		expect([...reachableSteps(course('question').blocks[0])].sort()).toEqual(['s1', 's2', 's3']);
	});

	it('follows an answer in a display card too: the player only ignores exercise cards', () => {
		const b = course('display').blocks[0];
		// With "a" jumping to s3 and "b" going on, s2 is reached through "b" and s3 through "a".
		expect([...reachableSteps(b)].sort()).toEqual(['s1', 's2', 's3']);
		b.steps[0].question!.options![1].go_to = 'END';
		expect([...reachableSteps(b)].sort()).toEqual(['s1', 's3']);
		expect(codes(course('display'), 'W_UNREACHABLE_STEP')).toEqual([]);
	});

	it('walks an exercise card straight through, whatever the answers say', () => {
		const b = course('exercise').blocks[0];
		b.steps[0].question!.options![1].go_to = 'END';
		expect([...reachableSteps(b)].sort()).toEqual(['s1', 's2', 's3']);
	});

	it('does not read the targets of a multi-select, or of a typed answer', () => {
		for (const question of [
			{ allow_multiple: true },
			{ type: 'open' },
			{ type: 'numeric' }
		] as Question[]) {
			const b = course('question', question).blocks[0];
			b.steps[0].question!.options![0].go_to = 'END';
			// Nothing is read from the answers, so the pupil goes on to s2, then s3.
			expect([...reachableSteps(b)].sort(), JSON.stringify(question)).toEqual(['s1', 's2', 's3']);
		}
	});
});

describe('a card that a branch leads to', () => {
	const jump = (doc: ReturnType<typeof course>) => {
		doc.blocks[0].steps[0].question!.options![0].go_to = 'B2';
		return doc;
	};

	it('is reached by an answer the player follows', () => {
		expect(codes(jump(course('question')), 'W_ORPHAN_BLOCK')).toEqual([]);
		expect(codes(jump(course('display')), 'W_ORPHAN_BLOCK')).toEqual([]);
	});

	it('is an orphan when the only branch to it is one the player ignores', () => {
		expect(codes(jump(course('exercise')), 'W_ORPHAN_BLOCK')).toEqual(['B2/']);
		expect(codes(jump(course('question', { allow_multiple: true })), 'W_ORPHAN_BLOCK')).toEqual([
			'B2/'
		]);
	});
});
