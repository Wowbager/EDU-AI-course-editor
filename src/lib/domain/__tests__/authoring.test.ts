import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addBlock, addLesson, markCorrect, setField, setQuestionType } from '../commands';
import { emptyCourse, importCourseJson, serialiseToJson } from '../document';
import type { BlockV2, CourseV2 } from '../schema';
import { fromView, toView } from '../groups';
import { validate } from '../validate';
import { UNKNOWN_SKILL_CONFIG } from '../skill-config';
import {
	BRIEF_KEY,
	ORIGIN_KEY,
	buildGenRequest,
	canGenerate,
	completeness,
	fillBlock,
	missingSlots,
	restrictGenerated,
	settleOrigins,
	type Generated
} from '../authoring';

/** A course with one lesson and one new card of each type, as the buttons make them. */
function fresh(): { doc: CourseV2; display: string; exercise: string; question: string } {
	let doc = addLesson(emptyCourse('KURZ_TEST', 'Zlomky'), 'Polovina').doc;
	const lessonId = doc.lessons[0].lesson_id;
	const ids = (['display', 'exercise', 'question'] as const).map((type) => {
		const result = addBlock(doc, lessonId, type);
		doc = result.doc;
		return result.ref!.blockId!;
	});
	return { doc, display: ids[0], exercise: ids[1], question: ids[2] };
}

const blockOf = (doc: CourseV2, id: string): BlockV2 => doc.blocks.find((b) => b.block_id === id)!;
const stepOf = (doc: CourseV2, id: string) => blockOf(doc, id).steps[0];

const FULL: Generated = {
	content_md: 'Kolik je polovina z osmi?',
	question: {
		type: 'mcq_1',
		options: [
			{ text: '4', correct: true, feedback: 'Správně!' },
			{ text: '2', correct: false, feedback: 'To je čtvrtina.' },
			{ text: '16', correct: false, feedback: 'To je dvojnásobek.' }
		]
	},
	option_feedback: ['r1', 'r2', 'r3', 'r4'],
	hint_md: 'Rozděl osm na dvě stejné části.',
	help_md: 'Polovina je jedna ze dvou stejných částí.',
	solution_md: 'Osm děleno dvěma jsou čtyři.'
};

describe('what is empty', () => {
	it('calls a new card of every type a stub', () => {
		const { doc, display, exercise, question } = fresh();
		expect(completeness(blockOf(doc, display))).toBe('stub');
		expect(completeness(blockOf(doc, exercise))).toBe('stub');
		expect(completeness(blockOf(doc, question))).toBe('stub');
		expect(missingSlots(blockOf(doc, display))).toEqual(['content']);
		expect(missingSlots(blockOf(doc, exercise))).toEqual([
			'content',
			'question',
			'hint',
			'help',
			'solution'
		]);
	});

	it('needs a name or a line before AI can write a stub', () => {
		const { doc, display } = fresh();
		expect(canGenerate(blockOf(doc, display))).toBe(false);
		const named = setField(doc, { blockId: display, field: 'name' }, 'Co je polovina').doc;
		expect(canGenerate(blockOf(named, display))).toBe(true);
		const briefed = setField(doc, { blockId: display, field: BRIEF_KEY }, 'Zavede polovinu').doc;
		expect(canGenerate(blockOf(briefed, display))).toBe(true);
	});

	it('calls a card partial once the teacher wrote some of it, and ready once all of it', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		let d = setField(doc, { blockId: exercise, stepId: step, field: 'content' }, 'Kolik?').doc;
		expect(completeness(blockOf(d, exercise))).toBe('partial');
		expect(canGenerate(blockOf(d, exercise))).toBe(true);
		d = fillBlock(d, exercise, FULL).doc;
		expect(completeness(blockOf(d, exercise))).toBe('ready');
		expect(canGenerate(blockOf(d, exercise))).toBe(false);
	});

	it('leaves a card with several questions to the teacher', () => {
		const { doc, exercise } = fresh();
		const block = blockOf(doc, exercise);
		const two = { ...block, steps: [...block.steps, { ...block.steps[0], id: 's2' }] };
		expect(missingSlots(two)).toEqual([]);
		expect(completeness(two)).toBe('ready');
	});

	it('asks for reactions only when the teacher wrote the answers without them', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		let d = doc;
		for (const [option, value] of [
			['a', 'čtyři'],
			['b', 'dvě']
		])
			d = setField(
				d,
				{ blockId: exercise, stepId: step, optionId: option, field: 'text' },
				value
			).doc;
		expect(missingSlots(blockOf(d, exercise))).toContain('feedback');
		expect(missingSlots(blockOf(d, exercise))).not.toContain('question');
	});
});

describe('the request', () => {
	it('sends what is given, names what is missing, and fixes a chosen question type', () => {
		const { doc, exercise, display } = fresh();
		const step = stepOf(doc, exercise).id;
		let d = setField(doc, { field: 'audience' }, { grade: 4, purpose: 'intro' }).doc;
		d = setField(d, { blockId: display, field: 'name' }, 'Rozdělíme pizzu').doc;
		d = setField(d, { blockId: exercise, field: 'name' }, 'Kolik je polovina').doc;
		d = setQuestionType(d, exercise, step, 'numeric').doc;
		d = setField(d, { blockId: exercise, stepId: step, field: 'hint' }, 'Děl dvěma.').doc;
		const request = buildGenRequest(d, exercise)!;
		expect(request.mode).toBe('complete');
		expect(request.course.audience).toEqual({ grade: 4, purpose: 'intro' });
		expect(request.lesson.name).toBe('Polovina');
		expect(request.lesson.neighbors).toEqual([{ kind: 'display', title: 'Rozdělíme pizzu' }]);
		expect(request.block.question_type).toBe('number');
		expect(request.block.given).toEqual({ hint_md: 'Děl dvěma.' });
		expect(request.block.missing).toEqual(['content', 'question', 'help', 'solution']);
	});

	it('lets the model choose the type of an untouched question', () => {
		const { doc, exercise } = fresh();
		const d = setField(doc, { blockId: exercise, field: 'name' }, 'Kolik je polovina').doc;
		const request = buildGenRequest(d, exercise)!;
		expect(request.mode).toBe('generate');
		expect(request.block.question_type).toBeUndefined();
	});

	it('has nothing to ask for a finished card', () => {
		const { doc, exercise } = fresh();
		expect(buildGenRequest(fillBlock(doc, exercise, FULL).doc, exercise)).toBeUndefined();
	});

	it('cuts an answer down to what was asked', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		const d = setField(doc, { blockId: exercise, stepId: step, field: 'hint' }, 'Děl.').doc;
		const request = buildGenRequest(d, exercise)!;
		const cut = restrictGenerated(request, FULL);
		expect(cut.hint_md).toBeUndefined();
		expect(cut.option_feedback).toBeUndefined();
		expect(cut.content_md).toBe(FULL.content_md);
	});
});

describe('writing the answer', () => {
	it('writes a whole exercise the app can play, in one step', () => {
		const { doc, exercise } = fresh();
		const result = fillBlock(doc, exercise, FULL);
		const step = stepOf(result.doc, exercise);
		expect(result.origin).toBe('ai');
		expect(step.content).toBe(FULL.content_md);
		expect(step.hint).toBe(FULL.hint_md);
		expect(step.help).toBe(FULL.help_md);
		expect(step.question).toMatchObject({
			type: 'multiple_choice',
			solution: FULL.solution_md,
			options: [
				{ id: 'a', text: '4', is_correct: true, feedback: 'Správně!' },
				{ id: 'b', text: '2', is_correct: false },
				{ id: 'c', text: '16', is_correct: false }
			]
		});
		expect(step.question?.allow_multiple).toBeUndefined();
		const errors = validate(result.doc, UNKNOWN_SKILL_CONFIG).errors.filter(
			(issue) => issue.ref.blockId === exercise
		);
		expect(errors).toEqual([]);
	});

	it.each([
		[{ type: 'yes_no', answer: false, feedback_true: 'Ne.', feedback_false: 'Ano.' }, 'true_false'],
		[{ type: 'number', answer: 4, tolerance: 0 }, 'numeric'],
		[{ type: 'open', answer: 'Čtyři.' }, 'open'],
		[
			{
				type: 'mcq_n',
				options: ['a', 'b', 'c', 'd'].map((text, i) => ({ text, correct: i < 2, feedback: 'x' }))
			},
			'multiple_choice'
		]
	] as const)('writes a %o question in the shape the editor keeps', (question, type) => {
		const { doc, exercise } = fresh();
		const result = fillBlock(doc, exercise, { ...FULL, question: question as never });
		const q = stepOf(result.doc, exercise).question!;
		expect(q.type).toBe(type);
		if (question.type === 'yes_no')
			expect(q.options).toEqual([
				{ id: 'true', text: 'Ano', is_correct: false, feedback: 'Ne.' },
				{ id: 'false', text: 'Ne', is_correct: true, feedback: 'Ano.' }
			]);
		if (question.type === 'number') expect(q).toMatchObject({ correct_number: 4 });
		if (question.type === 'open') expect(q).toMatchObject({ correct_answer: 'Čtyři.' });
		if (question.type === 'mcq_n') expect(q.allow_multiple).toBe(true);
		expect(
			validate(result.doc, UNKNOWN_SKILL_CONFIG).errors.filter((i) => i.ref.blockId === exercise)
		).toEqual([]);
	});

	it('refuses a question with the wrong number of right answers', () => {
		const { doc, exercise } = fresh();
		const bad: Generated = {
			question: {
				type: 'mcq_1',
				options: ['a', 'b', 'c'].map((text) => ({ text, correct: true, feedback: 'x' }))
			}
		};
		expect(fillBlock(doc, exercise, bad).doc).toBe(doc);
	});

	it('keeps the question type the teacher chose', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		const d = setQuestionType(doc, exercise, step, 'open').doc;
		const result = fillBlock(d, exercise, FULL);
		expect(stepOf(result.doc, exercise).question?.type).toBe('open');
		expect(stepOf(result.doc, exercise).question?.correct_answer).toBeUndefined();
	});

	it('gives a Výklad card its text, and nothing an exercise has', () => {
		const { doc, display } = fresh();
		const result = fillBlock(doc, display, FULL);
		const block = blockOf(result.doc, display);
		expect(block.steps).toHaveLength(1);
		expect(block.steps[0]).toMatchObject({ type: 'text', content: FULL.content_md });
		expect(block.steps[0].hint).toBeUndefined();
	});

	it('fills only the reactions the teacher left out', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		const at = (optionId: string, field: string) => ({
			blockId: exercise,
			stepId: step,
			optionId,
			field
		});
		let d = setField(doc, at('a', 'text'), 'čtyři').doc;
		d = setField(d, at('b', 'text'), 'dvě').doc;
		d = setField(d, at('a', 'feedback'), 'Moje reakce').doc;
		const answer = { ...FULL, option_feedback: ['r1', 'r2'] };
		const options = stepOf(fillBlock(d, exercise, answer).doc, exercise).question!.options!;
		expect(options.map((o) => [o.text, o.feedback])).toEqual([
			['čtyři', 'Moje reakce'],
			['dvě', 'r2']
		]);
	});

	it('writes no reactions when the answers are no longer the ones they were written for', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		let d = doc;
		for (const id of ['a', 'b'])
			d = setField(d, { blockId: exercise, stepId: step, optionId: id, field: 'text' }, id).doc;
		const result = fillBlock(d, exercise, { option_feedback: ['r1', 'r2', 'r3'] });
		expect(result.doc).toBe(d);
	});

	it('does nothing to a card that has nothing empty', () => {
		const { doc, exercise } = fresh();
		const done = fillBlock(doc, exercise, FULL).doc;
		expect(fillBlock(done, exercise, { ...FULL, content_md: 'Jiný text' }).doc).toBe(done);
	});

	/**
	 * The rule the whole feature stands on: whatever the teacher wrote before the
	 * answer arrived, in whatever combination, is in the card afterwards unchanged.
	 */
	it('never changes a part the teacher filled, whatever was filled', () => {
		const edits = fc.record(
			{
				content: fc.constant('Moje zadání'),
				hint: fc.constant('Moje nápověda'),
				help: fc.constant('Moje pomoc'),
				solution: fc.constant('Moje řešení'),
				type: fc.constantFrom('true_false', 'open', 'numeric', 'multiple_choice' as const),
				answers: fc.boolean()
			},
			{ requiredKeys: [] }
		);
		fc.assert(
			fc.property(edits, (edit) => {
				const { doc, exercise } = fresh();
				const step = stepOf(doc, exercise).id;
				const at = (field: string) => ({ blockId: exercise, stepId: step, field });
				let d = doc;
				if (edit.type !== undefined) d = setQuestionType(d, exercise, step, edit.type).doc;
				if (edit.content !== undefined) d = setField(d, at('content'), edit.content).doc;
				if (edit.hint !== undefined) d = setField(d, at('hint'), edit.hint).doc;
				if (edit.help !== undefined) d = setField(d, at('help'), edit.help).doc;
				if (edit.solution !== undefined)
					d = setField(d, at('question.solution'), edit.solution).doc;
				const q = stepOf(d, exercise).question!;
				if (edit.answers === true && q.type === 'multiple_choice') {
					for (const o of q.options ?? [])
						d = setField(d, { ...at('text'), optionId: o.id }, `moje ${o.id}`).doc;
					d = markCorrect(d, exercise, step, 'b').doc;
				}
				if (edit.answers === true && q.type === 'open')
					d = setField(d, at('question.correct_answer'), 'Moje odpověď').doc;
				if (edit.answers === true && q.type === 'numeric')
					d = setField(d, at('question.correct_number'), 7).doc;

				const before = stepOf(d, exercise);
				const missing = new Set(missingSlots(blockOf(d, exercise)));
				const after = stepOf(fillBlock(d, exercise, FULL).doc, exercise);

				if (!missing.has('content')) expect(after.content).toBe(before.content);
				if (!missing.has('hint')) expect(after.hint).toBe(before.hint);
				if (!missing.has('help')) expect(after.help).toBe(before.help);
				if (!missing.has('solution'))
					expect(after.question?.solution).toBe(before.question?.solution);
				if (!missing.has('question')) {
					expect(after.question?.type).toBe(before.question?.type);
					expect(after.question?.correct_answer).toBe(before.question?.correct_answer);
					expect(after.question?.correct_number).toBe(before.question?.correct_number);
					expect((after.question?.options ?? []).map((o) => [o.id, o.text, o.is_correct])).toEqual(
						(before.question?.options ?? []).map((o) => [o.id, o.text, o.is_correct])
					);
				}
				for (const o of before.question?.options ?? []) {
					if ((o.feedback ?? '') === '') continue;
					expect(after.question?.options?.find((x) => x.id === o.id)?.feedback).toBe(o.feedback);
				}
			})
		);
	});
});

describe('who wrote what', () => {
	const origins = (doc: CourseV2, id: string) =>
		(blockOf(doc, id) as Record<string, unknown>)[ORIGIN_KEY];

	it('records the parts AI wrote', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		const d = setField(doc, { blockId: exercise, stepId: step, field: 'hint' }, 'Děl.').doc;
		expect(origins(fillBlock(d, exercise, FULL).doc, exercise)).toEqual({
			content_md: 'ai',
			question: 'ai',
			help_md: 'ai',
			solution_md: 'ai'
		});
	});

	it('hands a part to the teacher when they change it, and only that part', () => {
		const { doc, exercise } = fresh();
		const filled = fillBlock(doc, exercise, FULL).doc;
		const step = stepOf(filled, exercise).id;
		const edited = setField(
			filled,
			{ blockId: exercise, stepId: step, field: 'hint' },
			'Jinak.'
		).doc;
		const settled = settleOrigins(filled, edited);
		expect(origins(settled, exercise)).toMatchObject({ hint_md: 'teacher', content_md: 'ai' });

		const marked = markCorrect(filled, exercise, step, 'b').doc;
		expect(origins(settleOrigins(filled, marked), exercise)).toMatchObject({
			question: 'teacher',
			solution_md: 'ai'
		});
	});

	it('changes nothing when the edit touched no AI part', () => {
		const { doc, exercise } = fresh();
		const filled = fillBlock(doc, exercise, FULL).doc;
		const renamed = setField(filled, { blockId: exercise, field: 'name' }, 'Polovina z osmi').doc;
		expect(settleOrigins(filled, renamed)).toBe(renamed);
	});
});

describe('in the document', () => {
	it('keeps the brief, the origins and the audience through export and import', () => {
		const { doc, exercise } = fresh();
		let d = setField(doc, { field: 'audience' }, { grade: 4, register: 'tykání' }).doc;
		d = setField(d, { blockId: exercise, field: BRIEF_KEY }, 'Ověří polovinu').doc;
		d = fillBlock(d, exercise, FULL).doc;
		const back = importCourseJson(serialiseToJson(d)).doc;
		expect(serialiseToJson(back)).toBe(serialiseToJson(d));
		expect((back as Record<string, unknown>).audience).toEqual({ grade: 4, register: 'tykání' });
		expect(blockOf(back, exercise)).toMatchObject({
			[BRIEF_KEY]: 'Ověří polovinu',
			[ORIGIN_KEY]: { content_md: 'ai' }
		});
	});

	it('keeps them on the first block when a card becomes several blocks', () => {
		const { doc, exercise } = fresh();
		const filled = fillBlock(
			setField(doc, { blockId: exercise, field: BRIEF_KEY }, 'Ověří polovinu').doc,
			exercise,
			FULL
		).doc;
		// The teacher adds a second question: the card is written back as two blocks.
		const view = toView(filled);
		const card = blockOf(view, exercise);
		const second = { ...card.steps[0], id: 's2', order: 2 };
		const edited: CourseV2 = {
			...view,
			blocks: view.blocks.map((b) => (b === card ? { ...card, steps: [...card.steps, second] } : b))
		};
		const source = fromView(filled, view, edited, {
			blocks: new Set(),
			lessons: new Set(),
			steps: new Set()
		});
		const members = source.blocks.filter((b) => b.group === exercise || b.block_id === exercise);
		expect(members.length).toBe(2);
		expect(members.filter((b) => BRIEF_KEY in b)).toHaveLength(1);
		expect(members.filter((b) => ORIGIN_KEY in b)).toHaveLength(1);
	});
});
