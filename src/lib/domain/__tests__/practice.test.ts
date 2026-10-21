import { describe, expect, it } from 'vitest';
import { skipConditionSupported } from '../practice';

describe('skip_condition (skip_condition_evaluator.dart)', () => {
	it('accepts GPF_mastery compared with a number', () => {
		for (const c of ['GPF_mastery > 0.8', 'gpf_mastery>=.5', ' GPF_mastery != 1 ', 'GPF_mastery<0'])
			expect(skipConditionSupported(c), c).toBe(true);
	});
	it('rejects anything else, which the app ignores', () => {
		for (const c of [
			'GPF_mastery > 0,8',
			'mastery > 0.8',
			'GPF_mastery > 0.8 && x',
			'GPF_mastery = 1'
		])
			expect(skipConditionSupported(c), c).toBe(false);
	});
});
