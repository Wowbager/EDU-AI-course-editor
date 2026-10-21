import { describe, expect, it } from 'vitest';
import { questionSettingApplies } from '../question-settings';
import { validate } from '../validate';
import { QUESTION_TYPES, type CourseV2, type QuestionConfig } from '../schema';

describe('which question settings the app uses (block_model.dart, block_step_engine.dart)', () => {
	it('photo and AI settings only on an open answer', () => {
		for (const type of QUESTION_TYPES) {
			const q = { type, ai_evaluation: true, ai_guided: true } as QuestionConfig;
			for (const path of ['allow_photo', 'ai_evaluation', 'ai_criteria', 'ai_criteria_list'])
				expect(questionSettingApplies(q, path), `${type} ${path}`).toBe(type === 'open');
		}
	});
	it('guiding only with AI feedback, its attempts only when guiding', () => {
		const open = (q: Partial<QuestionConfig>) => ({ type: 'open', ...q }) as QuestionConfig;
		expect(questionSettingApplies(open({}), 'ai_guided')).toBe(false);
		expect(questionSettingApplies(open({ ai_evaluation: true }), 'ai_guided')).toBe(true);
		expect(questionSettingApplies(open({ ai_evaluation: true }), 'ai_guided_attempts')).toBe(false);
		expect(
			questionSettingApplies(open({ ai_evaluation: true, ai_guided: true }), 'ai_guided_attempts')
		).toBe(true);
	});
	it('shuffling only for a choice question; Ano/Ne never shuffles', () => {
		for (const type of QUESTION_TYPES)
			expect(questionSettingApplies({ type } as QuestionConfig, 'shuffle_options'), type).toBe(
				type === 'multiple_choice'
			);
	});
});

describe('AI settings the app would correct', () => {
	const doc = (question: Partial<QuestionConfig>): CourseV2 =>
		({
			export_type: 'course_v2',
			course_id: 'c',
			name: 'Kurz',
			lessons: [{ lesson_id: 'l', name: 'Lekce', blocks: [{ block_id: 'b' }] }],
			blocks: [
				{
					block_id: 'b',
					type: 'question',
					steps: [
						{
							id: 's1',
							type: 'question',
							content: 'Proč?',
							question: { type: 'open', correct_answer: 'Protože.', ...question }
						}
					]
				}
			]
		}) as CourseV2;
	const codes = (q: Partial<QuestionConfig>) => validate(doc(q)).warnings.map((i) => i.code);

	it('says when the attempts are outside 1–10', () => {
		expect(codes({ ai_guided: true, ai_guided_attempts: 12 })).toContain('W_GUIDED_ATTEMPTS_RANGE');
		expect(codes({ ai_guided: true, ai_guided_attempts: 5 })).not.toContain(
			'W_GUIDED_ATTEMPTS_RANGE'
		);
	});
	it('says when a criterion has no name or there are more than four', () => {
		const c = (name: string, i: number) => ({ id: `k${i}`, name });
		expect(codes({ ai_criteria_list: [c('', 1)] })).toContain('W_AI_CRITERION_NO_NAME');
		expect(codes({ ai_criteria_list: ['a', 'b', 'c', 'd', 'e'].map(c) })).toContain(
			'W_AI_CRITERIA_TOO_MANY'
		);
		expect(codes({ ai_criteria_list: ['a', 'b'].map(c) })).toEqual([]);
	});
});
