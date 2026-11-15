import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addBlock, addLesson, markCorrect, setField, setQuestionType } from '../commands';
import { emptyCourse, importCourseJson, serialiseToJson } from '../document';
import type { BlockV2, CourseV2 } from '../schema';
import { fromView, toView } from '../groups';
import { nextStepId } from '../ids';
import { validate } from '../validate';
import { UNKNOWN_SKILL_CONFIG } from '../skill-config';
import {
	BRIEF_KEY,
	ORIGIN_KEY,
	buildGenRequest,
	canGenerate,
	completeness,
	cardProblem,
	describeWritten,
	fillCard,
	SLOT_KEY,
	type Fill,
	type GenQuestion,
	type Slot,
	generatedCardSchema,
	missingParts,
	settleOrigins,
	type GeneratedCard,
	type GenRequest
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
const RESERVED = {
	blocks: new Set<string>(),
	lessons: new Set<string>(),
	steps: new Set<string>()
};

const MCQ: GenQuestion = {
	type: 'mcq_1',
	options: [
		{ text: '4', correct: true, feedback: 'Správně!' },
		{ text: '2', correct: false, feedback: 'To je čtvrtina.' },
		{ text: '16', correct: false, feedback: 'To je dvojnásobek.' }
	]
};

/** Everything a question step can be missing. */
const FULL_FILL: Fill = {
	content_md: 'Kolik je polovina z osmi?',
	question: MCQ,
	hint_md: 'Rozděl osm na dvě stejné části.',
	help_md: 'Polovina je jedna ze dvou stejných částí.',
	solution_md: 'Osm děleno dvěma jsou čtyři.'
};

const newQuestion = (n = 2) =>
	({
		kind: 'question',
		content_md: `Úloha ${n}`,
		question: { type: 'open', answer: 'odpověď' },
		hint_md: `nápověda ${n}`,
		help_md: `pomoc ${n}`,
		solution_md: `řešení ${n}`
	}) as const;
const newText = (n = 1) => ({ kind: 'text', content_md: `Text ${n}` }) as const;

/** The card's first step filled in whole, with one more question after it. */
const card = (doc: CourseV2, id: string, ...more: GeneratedCard['steps']): GeneratedCard => ({
	steps: [{ keep: stepOf(doc, id).id, fill: FULL_FILL }, ...more]
});

const fill = (doc: CourseV2, id: string, answer: GeneratedCard) =>
	fillCard(doc, id, answer, RESERVED);

const request = (doc: CourseV2, id: string, name = 'Kolik je polovina'): GenRequest => {
	const named = setField(doc, { blockId: id, field: 'name' }, name).doc;
	return buildGenRequest(named, id, undefined, 'dossier')!;
};

describe('what is empty', () => {
	it('calls a new card of every type a stub', () => {
		const { doc, display, exercise, question } = fresh();
		for (const id of [display, exercise, question])
			expect(completeness(blockOf(doc, id))).toBe('stub');
		expect(missingParts(blockOf(doc, display))).toEqual([
			{ stepId: 's1', kind: 'text', missing: ['content'] }
		]);
		expect(missingParts(blockOf(doc, exercise))).toEqual([
			{
				stepId: 's1',
				kind: 'question',
				missing: ['content', 'question', 'hint', 'help', 'solution']
			}
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
		d = fill(d, exercise, card(d, exercise)).doc;
		expect(completeness(blockOf(d, exercise))).toBe('ready');
		expect(canGenerate(blockOf(d, exercise))).toBe(false);
	});

	it('handles a card with several questions, each step on its own', () => {
		const { doc, exercise } = fresh();
		const block = blockOf(doc, exercise);
		const second = { ...block.steps[0], id: 's2', content: 'Druhé zadání' };
		const two = { ...block, steps: [block.steps[0], second] };
		expect(missingParts(two).map((g) => g.stepId)).toEqual(['s1', 's2']);
		expect(missingParts(two)[1].missing).not.toContain('content');
		expect(completeness(two)).toBe('partial');
	});

	it('counts a written text step above a question as its task', () => {
		const { doc, exercise } = fresh();
		const block = blockOf(doc, exercise);
		const text = { id: 's2', type: 'text' as const, content: 'Kolik je 2 + 2?' };
		const gaps = missingParts({ ...block, steps: [text, block.steps[0]] });
		expect(gaps).toHaveLength(1);
		expect(gaps[0].missing).not.toContain('content');
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
		const missing = missingParts(blockOf(d, exercise))[0].missing;
		expect(missing).toContain('feedback');
		expect(missing).not.toContain('question');
	});
});

describe('the request', () => {
	it('lists the steps by id with what is given and what is missing, and fixes a chosen type', () => {
		const { doc, exercise, display } = fresh();
		const step = stepOf(doc, exercise).id;
		let d = setField(doc, { field: 'audience' }, { grade: 4, purpose: 'intro' }).doc;
		d = setField(d, { blockId: display, field: 'name' }, 'Rozdělíme pizzu').doc;
		d = setField(d, { blockId: exercise, field: 'name' }, 'Kolik je polovina').doc;
		d = setQuestionType(d, exercise, step, 'numeric').doc;
		d = setField(d, { blockId: exercise, stepId: step, field: 'hint' }, 'Děl dvěma.').doc;
		const r = buildGenRequest(d, exercise, undefined, 'KONTEXT')!;
		expect(r.schema).toBe('eduai.gen-request/2');
		expect(r.mode).toBe('complete');
		expect(r.context).toBe('KONTEXT');
		expect(r.course.audience).toEqual({ grade: 4, purpose: 'intro' });
		expect(r.lesson.name).toBe('Polovina');
		expect(r.card).toMatchObject({ kind: 'exercise', title: 'Kolik je polovina' });
		expect(r.card.steps).toEqual([
			{
				id: step,
				kind: 'question',
				question_type: 'number',
				hint_md: 'Děl dvěma.',
				missing: ['content', 'question', 'help', 'solution']
			}
		]);
		expect(buildGenRequest(d, display)!.card.kind).toBe('display');
	});

	it('lets the model choose the type of an untouched question', () => {
		const { doc, exercise } = fresh();
		const r = request(doc, exercise);
		expect(r.mode).toBe('generate');
		expect(r.card.steps[0].question_type).toBeUndefined();
	});

	it('lists a step the teacher wrote, with its text, and a step with nothing missing', () => {
		const { doc, exercise } = fresh();
		const block = blockOf(doc, exercise);
		const text = { id: 's9', type: 'text' as const, content: 'Úvod' };
		const d: CourseV2 = {
			...doc,
			blocks: doc.blocks.map((b) => (b === block ? { ...block, steps: [text, ...block.steps] } : b))
		};
		const r = buildGenRequest(d, exercise)!;
		expect(r.card.steps.map((s) => [s.id, s.kind, s.missing.length > 0])).toEqual([
			['s9', 'text', false],
			['s1', 'question', true]
		]);
		expect(r.card.steps[0].content_md).toBe('Úvod');
	});

	it('has nothing to ask for a finished card', () => {
		const { doc, exercise } = fresh();
		expect(buildGenRequest(fill(doc, exercise, card(doc, exercise)).doc, exercise)).toBeUndefined();
	});
});

describe('checking the answer', () => {
	const exercise = () => {
		const { doc, exercise } = fresh();
		return { doc, id: exercise, r: request(doc, exercise) };
	};

	it('takes the card with new steps around the kept one', () => {
		const { doc, id, r } = exercise();
		const answer = card(doc, id, newQuestion());
		expect(cardProblem(r, generatedCardSchema.parse(answer))).toBeUndefined();
		const before = { steps: [newText(), ...answer.steps] };
		expect(cardProblem(r, generatedCardSchema.parse(before))).toBeUndefined();
	});

	it('names an existing step that is missing', () => {
		const { r } = exercise();
		const problem = cardProblem(r, { steps: [newQuestion(), newQuestion(3)] });
		expect(problem).toContain('"s1"');
		expect(problem).toContain('missing');
	});

	it('names steps that were reordered, repeated or invented', () => {
		const { doc, id, r } = exercise();
		const block = blockOf(doc, id);
		const two = { ...block, steps: [...block.steps, { ...block.steps[0], id: 's2' }] };
		const d: CourseV2 = { ...doc, blocks: doc.blocks.map((b) => (b === block ? two : b)) };
		const r2 = buildGenRequest(setField(d, { blockId: id, field: 'name' }, 'x').doc, id)!;
		const keep = (k: string) => ({ keep: k, fill: FULL_FILL });
		expect(cardProblem(r2, { steps: [keep('s2'), keep('s1')] })).toContain('order');
		expect(cardProblem(r2, { steps: [keep('s1'), keep('s1'), keep('s2')] })).toContain(
			'more than once'
		);
		expect(cardProblem(r, { steps: [keep('s7')] })).toContain('not a step');
	});

	it('refuses a part the teacher already wrote', () => {
		const { doc, id } = exercise();
		const step = stepOf(doc, id).id;
		const d = setField(doc, { blockId: id, stepId: step, field: 'hint' }, 'Moje nápověda').doc;
		const r = request(d, id);
		const problem = cardProblem(r, generatedCardSchema.parse(card(d, id)));
		expect(problem).toContain('hint_md');
		expect(problem).toContain('already written');
	});

	it('wants every empty part filled', () => {
		const { doc, id, r } = exercise();
		const answer = { steps: [{ keep: stepOf(doc, id).id, fill: { content_md: 'jen text' } }] };
		expect(cardProblem(r, answer)).toContain('missing');
	});

	it('holds the model to the question type the teacher chose, and to sound questions', () => {
		const { doc, id } = exercise();
		const step = stepOf(doc, id).id;
		const d = setQuestionType(doc, id, step, 'open').doc;
		const r = request(d, id);
		expect(cardProblem(r, generatedCardSchema.parse(card(d, id)))).toContain('"open"');

		const bad = {
			type: 'mcq_1',
			options: ['a', 'b', 'c'].map((t) => ({ text: t, correct: true, feedback: 'x' }))
		} as const;
		const plain = exercise();
		expect(
			cardProblem(plain.r, { steps: [{ keep: step, fill: { ...FULL_FILL, question: bad } }] })
		).toContain('correct options');
		expect(
			cardProblem(plain.r, card(plain.doc, plain.id, { ...newQuestion(), question: bad }))
		).toContain('correct options');
	});

	it('wants one reaction per given answer', () => {
		const { doc, id } = exercise();
		const step = stepOf(doc, id).id;
		let d = doc;
		for (const o of ['a', 'b'])
			d = setField(d, { blockId: id, stepId: step, optionId: o, field: 'text' }, o).doc;
		const r = request(d, id);
		expect(r.card.steps[0].missing).toContain('feedback');
		const at = (option_feedback: string[]) => ({
			steps: [
				{ keep: step, fill: { ...pick(FULL_FILL, r.card.steps[0].missing), option_feedback } }
			]
		});
		expect(cardProblem(r, at(['1']))).toContain('one text per given option');
		expect(cardProblem(r, at(['1', '2']))).toBeUndefined();
	});

	it('keeps the size of a card to what its kind allows', () => {
		const display = fresh();
		const rd = request(display.doc, display.display);
		const keep = { keep: 's1', fill: { content_md: 'x' } };
		const texts = (n: number) => ({
			steps: [keep, ...Array.from({ length: n - 1 }, (_, i) => newText(i))]
		});
		expect(cardProblem(rd, texts(6))).toBeUndefined();
		// A count the teacher asked for is allowed, up to the hard limit.
		expect(cardProblem(rd, texts(10))).toBeUndefined();
		expect(cardProblem(rd, texts(11))).toContain('1–10 text steps');
		expect(cardProblem(rd, { steps: [keep, newQuestion()] })).toContain('text steps only');

		const ex = exercise();
		const questions = (n: number) =>
			card(ex.doc, ex.id, ...Array.from({ length: n - 1 }, (_, i) => newQuestion(i)));
		expect(cardProblem(ex.r, questions(8))).toBeUndefined();
		expect(cardProblem(ex.r, questions(12))).toBeUndefined();
		expect(cardProblem(ex.r, questions(13))).toContain('1–12 question steps');

		const q = fresh();
		const rq = request(q.doc, q.question);
		const many = card(q.doc, q.question, ...Array.from({ length: 6 }, (_, i) => newQuestion(i)));
		expect(cardProblem(rq, many)).toContain('1–6 question steps');
	});

	it('rejects an answer without steps', () => {
		expect(generatedCardSchema.safeParse({ steps: [] }).success).toBe(false);
		expect(generatedCardSchema.safeParse({ steps: [{ kind: 'text' }] }).success).toBe(false);
	});
});

/** The parts of `FULL_FILL` for the given slots. */
function pick(fill: Fill, slots: readonly Slot[]): Fill {
	return Object.fromEntries(slots.map((slot) => [SLOT_KEY[slot], fill[SLOT_KEY[slot]]]));
}

describe('writing the answer', () => {
	it('writes a whole exercise the app can play: the kept step filled, a new one after it', () => {
		const { doc, exercise } = fresh();
		const result = fill(doc, exercise, card(doc, exercise, newQuestion()));
		const [first, second] = blockOf(result.doc, exercise).steps;
		expect(result.origin).toBe('ai');
		expect(result.written).toEqual({ steps: 2, questions: 2 });
		expect(first.id).toBe('s1');
		expect(first.content).toBe(FULL_FILL.content_md);
		expect(first.hint).toBe(FULL_FILL.hint_md);
		expect(first.help).toBe(FULL_FILL.help_md);
		expect(first.question).toMatchObject({
			type: 'multiple_choice',
			solution: FULL_FILL.solution_md,
			options: [
				{ id: 'a', text: '4', is_correct: true, feedback: 'Správně!' },
				{ id: 'b', text: '2', is_correct: false },
				{ id: 'c', text: '16', is_correct: false }
			]
		});
		expect(first.question?.allow_multiple).toBeUndefined();
		expect(second).toMatchObject({
			type: 'question',
			content: 'Úloha 2',
			hint: 'nápověda 2',
			help: 'pomoc 2',
			question: { type: 'open', correct_answer: 'odpověď', solution: 'řešení 2' }
		});
		expect(second.id).not.toBe(first.id);
		expect(blockOf(result.doc, exercise).steps.map((s) => s.order)).toEqual([1, 2]);
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
		const answer = card(doc, exercise, { ...newQuestion(), question: question as never });
		const result = fill(doc, exercise, {
			steps: [{ keep: 's1', fill: { ...FULL_FILL, question: question as never } }, answer.steps[1]]
		});
		const q = blockOf(result.doc, exercise).steps[1].question!;
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

	it('writes no question with the wrong number of right answers', () => {
		const { doc, exercise } = fresh();
		const bad = {
			type: 'mcq_1',
			options: ['a', 'b', 'c'].map((text) => ({ text, correct: true, feedback: 'x' }))
		} as const;
		const result = fill(doc, exercise, {
			steps: [
				{ keep: 's1', fill: { question: bad } },
				{ ...newQuestion(), question: bad }
			]
		});
		expect(result.doc).toBe(doc);
		expect(result.written).toEqual({ steps: 0, questions: 0 });
	});

	it('keeps the question type the teacher chose', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		const d = setQuestionType(doc, exercise, step, 'open').doc;
		const result = fill(d, exercise, card(d, exercise));
		expect(stepOf(result.doc, exercise).question?.type).toBe('open');
		expect(stepOf(result.doc, exercise).question?.correct_answer).toBeUndefined();
	});

	it('gives a Výklad card as many text steps as the model wrote, and nothing an exercise has', () => {
		const { doc, display } = fresh();
		const answer: GeneratedCard = {
			steps: [{ keep: 's1', fill: { content_md: 'Myšlenka' } }, newText(2), newText(3)]
		};
		const result = fill(doc, display, answer);
		const block = blockOf(result.doc, display);
		expect(block.steps.map((s) => [s.type, s.content])).toEqual([
			['text', 'Myšlenka'],
			['text', 'Text 2'],
			['text', 'Text 3']
		]);
		expect(block.steps[0].hint).toBeUndefined();
		expect(result.written).toEqual({ steps: 3, questions: 0 });
		expect(new Set(block.steps.map((s) => s.id)).size).toBe(3);
	});

	it('puts new steps before, between and after kept ones', () => {
		const { doc, display } = fresh();
		const block = blockOf(doc, display);
		const steps = ['s1', 's2'].map((id) => ({ id, type: 'text' as const, content: `T${id}` }));
		const d: CourseV2 = {
			...doc,
			blocks: doc.blocks.map((b) => (b === block ? { ...block, steps } : b))
		};
		const answer: GeneratedCard = {
			steps: [newText(1), { keep: 's1' }, newText(2), { keep: 's2' }, newText(3)]
		};
		const result = fill(d, display, answer);
		expect(blockOf(result.doc, display).steps.map((s) => s.content)).toEqual([
			'Text 1',
			'Ts1',
			'Text 2',
			'Ts2',
			'Text 3'
		]);
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
		const answer = {
			steps: [
				{
					keep: step,
					fill: {
						...pick(FULL_FILL, request(d, exercise).card.steps[0].missing),
						option_feedback: ['r1', 'r2']
					}
				}
			]
		};
		const options = stepOf(fill(d, exercise, answer).doc, exercise).question!.options!;
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
		const result = fill(d, exercise, {
			steps: [{ keep: step, fill: { option_feedback: ['r1', 'r2', 'r3'] } }]
		});
		expect(result.doc).toBe(d);
	});

	it('does nothing to a card that has nothing empty and gets only keeps', () => {
		const { doc, exercise } = fresh();
		const done = fill(doc, exercise, card(doc, exercise)).doc;
		const again = fill(done, exercise, {
			steps: [{ keep: 's1', fill: { content_md: 'Jiný text' } }]
		});
		expect(again.doc).toBe(done);
	});

	it('skips a part the teacher filled while the model was working', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		const r = request(doc, exercise);
		expect(r.card.steps[0].missing).toContain('hint');
		const meanwhile = setField(doc, { blockId: exercise, stepId: step, field: 'hint' }, 'Moje').doc;
		const after = stepOf(fill(meanwhile, exercise, card(doc, exercise)).doc, exercise);
		expect(after.hint).toBe('Moje');
		expect(after.help).toBe(FULL_FILL.help_md);
	});

	it('drops what was meant for a step the teacher deleted, and puts new steps beside a survivor', () => {
		const { doc, display } = fresh();
		const block = blockOf(doc, display);
		const steps = ['s1', 's2'].map((id) => ({ id, type: 'text' as const, content: '' }));
		const d: CourseV2 = {
			...doc,
			blocks: doc.blocks.map((b) => (b === block ? { ...block, steps } : b))
		};
		const answer: GeneratedCard = {
			steps: [
				{ keep: 's1', fill: { content_md: 'Pro s1' } },
				newText(1),
				{ keep: 's2', fill: { content_md: 'Pro s2' } },
				newText(2)
			]
		};
		// The teacher deletes s1 meanwhile.
		const meanwhile: CourseV2 = {
			...d,
			blocks: d.blocks.map((b) => (b === blockOf(d, display) ? { ...b, steps: [steps[1]] } : b))
		};
		const result = fill(meanwhile, display, answer);
		expect(blockOf(result.doc, display).steps.map((s) => s.content)).toEqual([
			'Text 1',
			'Pro s2',
			'Text 2'
		]);
		expect(result.written.steps).toBe(3);
	});

	it('mints ids that are unique and not reserved', () => {
		const { doc, display } = fresh();
		const reserved = { ...RESERVED, steps: new Set<string>() };
		const answer: GeneratedCard = {
			steps: [{ keep: 's1', fill: { content_md: 'x' } }, newText(1), newText(2), newText(3)]
		};
		const ids = blockOf(fillCard(doc, display, answer, reserved).doc, display).steps.map(
			(s) => s.id
		);
		expect(new Set(ids).size).toBe(4);
		expect(nextStepId([], display, reserved)).toMatch(/^s\d+$/);
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
				const missing = new Set(missingParts(blockOf(d, exercise))[0]?.missing ?? []);
				const after = stepOf(fill(d, exercise, card(d, exercise, newQuestion())).doc, exercise);

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

describe('a card of several questions', () => {
	/** The card written as the editor writes it: the view edited, then split back. */
	function written() {
		const { doc, exercise } = fresh();
		const view = toView(doc);
		const result = fill(
			view,
			exercise,
			card(view, exercise, newQuestion(2), newText(3), newQuestion(4))
		);
		const source = fromView(doc, view, result.doc, RESERVED);
		return { doc, exercise, view: result.doc, source };
	}

	it('becomes one block per question in the document and reads back as the same card', () => {
		const { exercise, view, source } = written();
		const members = source.blocks.filter((b) => b.group === exercise || b.block_id === exercise);
		expect(members.filter((b) => b.steps.some((s) => s.type === 'question'))).toHaveLength(3);
		expect(members.every((b) => b.steps.filter((s) => s.type === 'question').length <= 1)).toBe(
			true
		);
		const back = toView(source);
		expect(blockOf(back, exercise).steps.map((s) => [s.id, s.type, s.content])).toEqual(
			blockOf(view, exercise).steps.map((s) => [s.id, s.type, s.content])
		);
		expect(
			validate(source, UNKNOWN_SKILL_CONFIG).errors.filter((i) =>
				members.some((m) => m.block_id === i.ref.blockId)
			)
		).toEqual([]);
	});

	it('can be filled again: every step of the merged card is asked for', () => {
		const { exercise, source } = written();
		const view = toView(source);
		// The teacher empties the second question's hint.
		const second = blockOf(view, exercise).steps[1];
		const cleared = setField(view, { blockId: exercise, stepId: second.id, field: 'hint' }, '').doc;
		const r = buildGenRequest(cleared, exercise)!;
		expect(r.card.steps).toHaveLength(4);
		expect(r.card.steps.filter((s) => s.missing.length > 0).map((s) => [s.id, s.missing])).toEqual([
			[second.id, ['hint']]
		]);
	});
});

describe('who wrote what', () => {
	const origins = (doc: CourseV2, id: string) =>
		(blockOf(doc, id) as Record<string, unknown>)[ORIGIN_KEY];

	it('records the parts AI wrote, per step', () => {
		const { doc, exercise } = fresh();
		const step = stepOf(doc, exercise).id;
		const d = setField(doc, { blockId: exercise, stepId: step, field: 'hint' }, 'Děl.').doc;
		const result = fill(d, exercise, {
			steps: [
				{ keep: step, fill: pick(FULL_FILL, request(d, exercise).card.steps[0].missing) },
				newText(1)
			]
		});
		const newId = blockOf(result.doc, exercise).steps[1].id;
		expect(origins(result.doc, exercise)).toEqual({
			[`${step}.content_md`]: 'ai',
			[`${step}.question`]: 'ai',
			[`${step}.help_md`]: 'ai',
			[`${step}.solution_md`]: 'ai',
			[`${newId}.content_md`]: 'ai'
		});
	});

	it('hands a part to the teacher when they change it, and only that part', () => {
		const { doc, exercise } = fresh();
		const filled = fill(doc, exercise, card(doc, exercise)).doc;
		const step = stepOf(filled, exercise).id;
		const edited = setField(
			filled,
			{ blockId: exercise, stepId: step, field: 'hint' },
			'Jinak.'
		).doc;
		const settled = settleOrigins(filled, edited);
		expect(origins(settled, exercise)).toMatchObject({
			[`${step}.hint_md`]: 'teacher',
			[`${step}.content_md`]: 'ai'
		});

		const marked = markCorrect(filled, exercise, step, 'b').doc;
		expect(origins(settleOrigins(filled, marked), exercise)).toMatchObject({
			[`${step}.question`]: 'teacher',
			[`${step}.solution_md`]: 'ai'
		});
	});

	it('changes nothing when the edit touched no AI part', () => {
		const { doc, exercise } = fresh();
		const filled = fill(doc, exercise, card(doc, exercise)).doc;
		const renamed = setField(filled, { blockId: exercise, field: 'name' }, 'Polovina z osmi').doc;
		expect(settleOrigins(filled, renamed)).toBe(renamed);
	});

	it('drops the mark of a step that is gone', () => {
		const { doc, display } = fresh();
		const filled = fill(doc, display, {
			steps: [{ keep: 's1', fill: { content_md: 'a' } }, newText(1)]
		}).doc;
		const [first, second] = blockOf(filled, display).steps;
		const gone: CourseV2 = {
			...filled,
			blocks: filled.blocks.map((b) => (b.block_id === display ? { ...b, steps: [first] } : b))
		};
		const marks = origins(settleOrigins(filled, gone), display) as Record<string, string>;
		expect(Object.keys(marks)).toEqual([`${first.id}.content_md`]);
		expect(second.id).not.toBe(first.id);
	});

	it('follows a step into the second block of a split card', () => {
		const { doc, exercise } = fresh();
		const view = toView(doc);
		const filled = fill(view, exercise, card(view, exercise, newQuestion(2)));
		const source = fromView(doc, view, filled.doc, RESERVED);
		const second = blockOf(filled.doc, exercise).steps[1];
		// The marks sit on the first block; the second question is in another one.
		expect(source.blocks.filter((b) => ORIGIN_KEY in b)).toHaveLength(1);
		const view2 = toView(source);
		const edit = setField(
			view2,
			{ blockId: exercise, stepId: second.id, field: 'hint' },
			'Jinak'
		).doc;
		const after = fromView(source, view2, edit, RESERVED);
		const settled = settleOrigins(source, after);
		const marks = settled.blocks.find((b) => ORIGIN_KEY in b) as Record<string, unknown>;
		expect(marks[ORIGIN_KEY]).toMatchObject({
			[`${second.id}.hint_md`]: 'teacher',
			[`${second.id}.help_md`]: 'ai'
		});
	});
});

describe('what the teacher is told', () => {
	it('counts steps and questions in Czech', () => {
		expect(describeWritten({ steps: 3, questions: 2 })).toBe('Dopsáno: 3 kroky, 2 otázky.');
		expect(describeWritten({ steps: 1, questions: 1 })).toBe('Dopsáno: 1 krok, 1 otázka.');
		expect(describeWritten({ steps: 5, questions: 0 })).toBe('Dopsáno: 5 kroků.');
		expect(describeWritten({ steps: 8, questions: 5 })).toBe('Dopsáno: 8 kroků, 5 otázek.');
		expect(describeWritten({ steps: 4, questions: 4 })).toBe('Dopsáno: 4 kroky, 4 otázky.');
	});
});

describe('in the document', () => {
	it('keeps the brief, the origins and the audience through export and import', () => {
		const { doc, exercise } = fresh();
		let d = setField(doc, { field: 'audience' }, { grade: 4, register: 'tykání' }).doc;
		d = setField(d, { blockId: exercise, field: BRIEF_KEY }, 'Ověří polovinu').doc;
		d = fill(d, exercise, card(d, exercise)).doc;
		const back = importCourseJson(serialiseToJson(d)).doc;
		expect(serialiseToJson(back)).toBe(serialiseToJson(d));
		expect((back as Record<string, unknown>).audience).toEqual({ grade: 4, register: 'tykání' });
		expect(blockOf(back, exercise)).toMatchObject({
			[BRIEF_KEY]: 'Ověří polovinu',
			[ORIGIN_KEY]: { 's1.content_md': 'ai' }
		});
	});

	it('keeps the brief and the marks on the first block when a card becomes several blocks', () => {
		const { doc, exercise } = fresh();
		const view0 = toView(doc);
		const briefed = setField(view0, { blockId: exercise, field: BRIEF_KEY }, 'Ověří polovinu').doc;
		const filled = fill(briefed, exercise, card(briefed, exercise, newQuestion(2)));
		const source = fromView(doc, view0, filled.doc, RESERVED);
		const members = source.blocks.filter((b) => b.group === exercise || b.block_id === exercise);
		expect(members.length).toBe(2);
		expect(members.filter((b) => BRIEF_KEY in b)).toHaveLength(1);
		expect(members.filter((b) => ORIGIN_KEY in b)).toHaveLength(1);
	});
});
