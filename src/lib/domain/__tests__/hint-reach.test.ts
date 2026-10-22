import { describe, expect, it } from 'vitest';
import { hintOfferedSteps } from '../hint-reach';
import type { BlockStep, BlockV2 } from '../schema';

const text = (id: string): BlockStep => ({ id, order: 1, type: 'text', content: 'T' });
const question = (id: string, type = 'multiple_choice'): BlockStep =>
	({ id, order: 1, type: 'question', question: { type, options: [] } }) as unknown as BlockStep;
const ids = (type: BlockV2['type'], steps: BlockStep[]) =>
	hintOfferedSteps({ type, steps }).map((s) => s.id);

describe('the steps the "?" opens (BR-E4H835)', () => {
	it('offers every step of a display card', () => {
		expect(ids('display', [text('s1'), text('s2')])).toEqual(['s1', 's2']);
	});

	it('offers only the questions of a question or exercise card', () => {
		for (const type of ['question', 'exercise'] as const) {
			expect(ids(type, [text('t'), question('q1')])).toEqual(['q1']);
		}
	});

	it('offers only the first and last question when several share one grading tap', () => {
		for (const type of ['question', 'exercise'] as const) {
			expect(
				ids(type, [question('q1'), text('t'), question('q2'), question('q3'), question('q4')])
			).toEqual(['q1', 'q4']);
			expect(ids(type, [question('q1'), question('q2')])).toEqual(['q1', 'q2']);
		}
	});

	it('offers every question when one is open, as the engine then stops on each', () => {
		expect(ids('question', [question('q1'), question('q2', 'open'), question('q3')])).toEqual([
			'q1',
			'q2',
			'q3'
		]);
	});
});
