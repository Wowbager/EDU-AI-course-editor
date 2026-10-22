import { describe, expect, it } from 'vitest';
import { goToIgnored } from '../navigation';
import { validate } from '../validate';
import { BLOCK_TYPES, EXPORT_TYPES, type BlockV2, type CourseV2 } from '../schema';

const block = (type: BlockV2['type']): BlockV2 =>
	({
		block_id: 'b',
		type,
		steps: [
			{
				id: 's1',
				type: 'question',
				content: 'Kolik?',
				question: {
					type: 'multiple_choice',
					options: [
						{ id: 'a', text: '1', is_correct: true },
						{ id: 'b', text: '2', is_correct: false, go_to: 's2' }
					]
				}
			},
			{ id: 's2', type: 'text', content: 'Náprava' }
		]
	}) as BlockV2;

const course = (export_type: CourseV2['export_type'], b: BlockV2): CourseV2 =>
	({
		export_type,
		course_id: 'c',
		name: 'Kurz',
		lessons: [{ lesson_id: 'l', name: 'Lekce', blocks: [{ block_id: 'b' }] }],
		blocks: [b]
	}) as CourseV2;

describe('goToIgnored (step_navigation.dart GoToResolver.resolve)', () => {
	for (const type of BLOCK_TYPES) {
		for (const exportType of EXPORT_TYPES) {
			it(`${type} block in a ${exportType} course`, () => {
				const b = block(type);
				expect(goToIgnored(b)).toBe(type === 'exercise');
				const doc = course(exportType, b);
				const warned = validate(doc).warnings.some((i) => i.code === 'W_GOTO_IN_EXERCISE');
				expect(warned).toBe(type === 'exercise');
			});
		}
	}
});
