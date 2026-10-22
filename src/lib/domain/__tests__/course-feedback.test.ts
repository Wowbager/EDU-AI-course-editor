import { describe, expect, it } from 'vitest';
import { appReadsField, appShowsFeedback, EVALUATION_ONLY_FIELDS } from '../course-feedback';
import { parseCourse } from '../document';
import { validate } from '../validate';
import { allows, fieldsFor, FIELDS } from '$lib/ui/fields';
import { DocStore } from '$lib/state/doc-store.svelte';

const TYPES = ['course_v2', 'exercise_v2', 'quiz_v2'] as const;
const BLOCKS = ['display', 'question', 'exercise'] as const;

const course = (
	export_type: (typeof TYPES)[number],
	blockType: (typeof BLOCKS)[number],
	quiz_evaluate?: boolean
) =>
	parseCourse({
		export_type,
		course_id: 'K',
		version: 1,
		name: 'K',
		...(quiz_evaluate === undefined ? {} : { quiz_evaluate }),
		lessons: [{ lesson_id: 'L1', name: 'L', order: 1, blocks: [{ block_id: 'B1', order: 1 }] }],
		blocks: [
			{
				block_id: 'B1',
				type: blockType,
				name: 'Karta',
				steps: [
					{ id: 's1', type: 'text', content: 'Úvod' },
					{
						id: 's2',
						type: 'question',
						question: {
							type: 'multiple_choice',
							solution: 'Řešení',
							solution_image: { url: 'http://x/y.png' },
							options: [
								{ id: 'a', text: 'A', is_correct: true },
								{ id: 'b', text: 'B' }
							]
						}
					}
				]
			}
		]
	});

describe('what the app shows of a course', () => {
	it('hides the evaluation only in a test without quiz_evaluate', () => {
		for (const type of TYPES) {
			expect(appShowsFeedback({ export_type: type })).toBe(type !== 'quiz_v2');
			expect(appShowsFeedback({ export_type: type, quiz_evaluate: false })).toBe(
				type !== 'quiz_v2'
			);
			expect(appShowsFeedback({ export_type: type, quiz_evaluate: true })).toBe(true);
		}
	});

	it('lists only fields the registry has', () => {
		for (const key of EVALUATION_ONLY_FIELDS) {
			expect(
				FIELDS.some((f) => `${f.level}.${f.path}` === key),
				key
			).toBe(true);
		}
		const doc = { export_type: 'quiz_v2' as const };
		expect(appReadsField(doc, 'question', 'solution')).toBe(false);
		expect(appReadsField(doc, 'step', 'hint')).toBe(true);
		expect(appReadsField({ ...doc, quiz_evaluate: true }, 'question', 'solution')).toBe(true);
	});
});

describe('the field registry in a test without evaluation', () => {
	it('asks no solution and no feedback, but keeps the hint', () => {
		for (const mode of ['teacher', 'metodik', 'advanced'] as const) {
			const paths = fieldsFor('question', mode, true, false).map((f) => f.path);
			for (const gone of ['solution', 'solution_image', 'show_solution', 'show_answers']) {
				expect(paths, `${mode} ${gone}`).not.toContain(gone);
			}
			expect(allows('option', 'feedback', mode, true, false)).toBe(false);
			expect(allows('option', 'feedback', 'advanced', true, true)).toBe(true);
			expect(allows('step', 'hint', mode, true, false)).toBe(allows('step', 'hint', mode));
		}
		expect(fieldsFor('question', 'advanced', true, true).map((f) => f.path)).toContain(
			'show_solution'
		);
	});
});

describe('validation of feedback in every card type and course type', () => {
	for (const type of TYPES) {
		for (const block of BLOCKS) {
			for (const evaluate of [undefined, true]) {
				it(`${type} / ${block} / quiz_evaluate ${evaluate}`, () => {
					const result = validate(course(type, block, evaluate));
					const codes = [...result.errors, ...result.warnings].map((i) => i.code);
					const silent = !appShowsFeedback({ export_type: type, quiz_evaluate: evaluate });
					expect(codes.includes('W_NO_WRONG_OPTION_FEEDBACK')).toBe(!silent);
				});
			}
		}
	}

	it('does not check the solution image the app never loads', () => {
		const warn = (doc: ReturnType<typeof course>) =>
			validate(doc).errors.some((w) => w.ref.field === 'question.solution_image.url');
		expect(warn(course('course_v2', 'question'))).toBe(true);
		expect(warn(course('quiz_v2', 'question'))).toBe(false);
	});
});

describe('jumping to a field the app does not read', () => {
	it('lands on the step, and leaves the Zpětná vazba toggle alone', () => {
		const store = new DocStore();
		store.load(course('quiz_v2', 'question'));
		store.showFeedback = false;
		store.revealAt({ blockId: 'B1', stepId: 's2', optionId: 'b', field: 'feedback' });
		expect(store.showFeedback).toBe(false);
		expect(store.selection).toEqual({ blockId: 'B1', stepId: 's2' });
	});
});
