import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCourse, parseCourse } from '../document';
import { splitQuestionCards } from '../groups';
import type { BlockStep, CourseV2 } from '../schema';
import {
	advance,
	answer,
	explore,
	numericMatches,
	parseNumericAnswer,
	position,
	startLesson,
	view,
	type SimInput,
	type SimState
} from '../simulate';

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url));
const corpusDir = `${fixtures}/corpus`;
const files = [
	...readdirSync(corpusDir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => `${corpusDir}/${f}`),
	`${fixtures}/spec-16-course.json`,
	`${fixtures}/spec-16-course-broken.json`
];
/** The course as the editor exports and the player plays it: imported, each question its own card. */
const load = (path: string): CourseV2 =>
	splitQuestionCards(importCourse(JSON.parse(readFileSync(path, 'utf8'))).doc).doc;

/**
 * The input of a pupil who is getting on: the right answer, as the document marks it —
 * unless it sends them back (`AGAIN`), when any answer that moves on will do. Several
 * corpus questions (the converted V1 course) put `AGAIN` on their right answers, which in
 * the player is a loop with no way out through that option.
 */
function correctInput(step: BlockStep): SimInput {
	const q = step.question!;
	const options = q.options ?? [];
	if (q.allow_multiple === true) {
		return { optionIds: options.filter((o) => o.is_correct === true).map((o) => o.id) };
	}
	if (q.type === 'numeric') return { number: q.correct_number ?? 0 };
	if (q.type === 'open') {
		return { text: q.correct_answer ?? options.find((o) => o.is_correct === true)?.text ?? 'x' };
	}
	const moves = options.filter((o) => o.go_to !== 'AGAIN');
	const pick =
		moves.find((o) => o.is_correct === true) ??
		moves[0] ??
		options.find((o) => o.is_correct === true) ??
		options[0];
	return { optionId: pick.id };
}

/** Walk with the right answers until the run ends or `limit` actions pass. */
function walk(doc: CourseV2, start: SimState, limit = 500) {
	let state = start;
	const seen: string[] = [];
	for (let i = 0; i < limit && state.phase !== 'ended'; i++) {
		const here = position(doc, state);
		if (here) seen.push(`${here.blockId}/${here.stepId}`);
		if (state.phase === 'await') {
			const block = doc.blocks.find((b) => b.block_id === state.blockId)!;
			state = answer(doc, state, correctInput(block.steps[state.stepIndex])).state;
		} else {
			state = advance(doc, state).state;
		}
	}
	return { state, seen };
}

describe('over the corpus', () => {
	for (const file of files) {
		const name = file.split('/').pop()!;
		describe(name, () => {
			const doc = load(file);
			for (const lesson of doc.lessons) {
				it(`plays ${lesson.lesson_id} with the right answers and explores it within bounds`, () => {
					const start = startLesson(doc, lesson.lesson_id);
					expect(JSON.parse(JSON.stringify(start))).toEqual(start);
					const { state } = walk(doc, start);
					const report = explore(doc, lesson.lesson_id, { maxPaths: 60, maxSteps: 80 });
					expect(report.paths.length).toBeLessThanOrEqual(60);
					for (const path of report.paths) expect(path.length).toBeLessThanOrEqual(81);

					// Either the first way on reaches an end (an explicit state, never an
					// exception), or the lesson really does trap the pupil and `explore` says so:
					// a jump back to an answered question shows its solution and sends the pupil
					// round again, and a lesson of those has no end on that route.
					if (state.phase === 'ended') {
						expect(view(doc, state).status).toBe('ended');
					} else {
						const traps = report.loops.length + report.deadEnds.length + report.errors.length;
						expect(traps + (report.truncated ? 1 : 0)).toBeGreaterThan(0);
					}
				});
			}
		});
	}
});

// ───────────────────── targeted rules, one document each ─────────────────────

type Opt = {
	id: string;
	text?: string;
	ok?: boolean;
	go?: string;
	fb?: string;
};

const text = (id: string, extra: Record<string, unknown> = {}): BlockStep => ({
	id,
	type: 'text',
	content: `Text ${id}`,
	...extra
});

const choice = (id: string, options: Opt[], extra: Record<string, unknown> = {}): BlockStep => ({
	id,
	type: 'question',
	content: `Otázka ${id}`,
	question: {
		type: 'multiple_choice',
		options: options.map((o) => ({
			id: o.id,
			text: o.text ?? `Možnost ${o.id}`,
			is_correct: o.ok === true,
			...(o.go === undefined ? {} : { go_to: o.go }),
			...(o.fb === undefined ? {} : { feedback: o.fb })
		})),
		...extra
	}
});

const question = (id: string, q: Record<string, unknown>): BlockStep => ({
	id,
	type: 'question',
	content: `Otázka ${id}`,
	question: q as never
});

/** A course of one lesson whose cards are given in order. */
function course(
	blocks: { id: string; type?: 'display' | 'question' | 'exercise'; steps: BlockStep[] }[],
	extra: Record<string, unknown> = {}
): CourseV2 {
	return parseCourse({
		export_type: 'course_v2',
		course_id: 'c',
		lessons: [
			{ lesson_id: 'L1', name: 'Lekce', blocks: blocks.map((b) => ({ block_id: b.id })) },
			...((extra.lessons as unknown[]) ?? [])
		],
		blocks: [
			...blocks.map((b) => ({ block_id: b.id, type: b.type ?? 'display', steps: b.steps })),
			...((extra.blocks as unknown[]) ?? [])
		]
	});
}

const show = (doc: CourseV2, state: SimState) => position(doc, state)?.stepId;

describe('go_to, as GoToResolver.resolve decides it', () => {
	const steps = [
		choice('s1', [
			{ id: 'next', ok: true, go: 'NEXT_STEP' },
			{ id: 'plain' },
			{ id: 'jump', go: 's3' },
			{ id: 'end', go: 'END' },
			{ id: 'chat', go: 'CHAT' },
			{ id: 'lecture', go: 'LECTURE' },
			{ id: 'card', go: 'B2' },
			{ id: 'nowhere', go: 'B404' }
		]),
		text('s2'),
		text('s3')
	];
	const doc = course([
		{ id: 'B1', steps },
		{ id: 'B2', steps: [text('t1')] }
	]);
	const play = (optionId: string) => {
		const start = startLesson(doc, 'L1');
		return answer(doc, start, { optionId });
	};

	it('null and NEXT_STEP go to the next step', () => {
		for (const id of ['next', 'plain']) {
			const { state, outcome } = play(id);
			expect(show(doc, state)).toBe('s2');
			expect(outcome.target).toEqual({ kind: 'next_step', stepId: 's2' });
		}
	});

	it('a step id jumps there, and the steps it skips are not on screen', () => {
		const { state } = play('jump');
		expect(show(doc, state)).toBe('s3');
		expect(position(doc, state)!.shownStepIds).toEqual(['s1', 's3']);
		expect(view(doc, state).shown.map((s) => s.id)).toEqual(['s1', 's3']);
	});

	it('END completes the card and moves to the next one', () => {
		const { state, outcome } = play('end');
		expect(state.blockId).toBe('B2');
		expect(outcome.blockResult?.blockId).toBe('B1');
	});

	it('CHAT and LECTURE stop the run with a label, the tutor is not simulated', () => {
		for (const [id, keyword] of [
			['chat', 'CHAT'],
			['lecture', 'LECTURE']
		] as const) {
			const { state } = play(id);
			expect(state.phase).toBe('ended');
			expect(state.end).toMatchObject({ kind: 'chat', keyword });
			expect(view(doc, state).label).toContain('AI tutora');
		}
	});

	it('another card of the lesson is entered afresh', () => {
		const { state } = play('card');
		expect(state).toMatchObject({ blockId: 'B2', stepIndex: 0, phase: 'show' });
	});

	it('a go_to that is neither a step nor a card is an explicit error, not an exception', () => {
		const { state } = play('nowhere');
		expect(state.phase).toBe('ended');
		expect(state.end).toMatchObject({ kind: 'error', code: 'dangling_go_to', target: 'B404' });
		expect(view(doc, state).status).toBe('ended');
	});

	it('an exercise card ignores go_to, a display card honours it (the player, not stepSuccessors)', () => {
		for (const [type, expected] of [
			['exercise', 's2'],
			['display', 's3']
		] as const) {
			const d = course([
				{
					id: 'B1',
					type,
					steps: [
						text('s0'),
						choice('s1', [{ id: 'a', ok: true, go: 's3' }]),
						choice('s2', [{ id: 'a' }]),
						choice('s3', [{ id: 'a' }])
					]
				}
			]);
			let state = startLesson(d, 'L1');
			if (type === 'display') state = advance(d, state).state;
			state = answer(d, state, { optionId: 'a' }).state;
			// `ok: true` has feedback-free options, so the player moves on at once.
			expect(show(d, state)).toBe(type === 'exercise' ? 's2' : expected);
		}
	});

	it('a go_to into another lesson continues there', () => {
		const d = course([{ id: 'B1', steps: [choice('s1', [{ id: 'a', go: 'X1' }])] }], {
			lessons: [{ lesson_id: 'L2', name: 'Druhá', blocks: [{ block_id: 'X1' }] }],
			blocks: [{ block_id: 'X1', type: 'display', steps: [text('x')] }]
		});
		const { state } = answer(d, startLesson(d, 'L1'), { optionId: 'a' });
		expect(state).toMatchObject({ lessonId: 'L2', blockId: 'X1', phase: 'show' });
	});
});

describe('feedback, hints and what the pupil is shown', () => {
	it('a wrong answer with feedback pauses on it; "Pokračovat" moves on', () => {
		const d = course([
			{
				id: 'B1',
				steps: [
					choice(
						's1',
						[
							{ id: 'a', ok: true },
							{ id: 'b', fb: 'Zkus to znovu pomalu.' }
						],
						{
							solution: 'Řešení je a.'
						}
					),
					text('s2')
				]
			}
		]);
		const { state, outcome } = answer(d, startLesson(d, 'L1'), { optionId: 'b' });
		expect(outcome).toMatchObject({ correct: false, paused: true });
		expect(outcome.feedback).toEqual({
			correct: false,
			optionFeedback: ['Zkus to znovu pomalu.'],
			solution: 'Řešení je a.',
			revealedCorrectOptionIds: ['a']
		});
		expect(state.phase).toBe('solution');
		expect(view(d, state)).toMatchObject({ action: 'continue', actionLabel: 'Pokračovat' });
		expect(show(d, advance(d, state).state)).toBe('s2');
	});

	it('with nothing to show, or show_answers off, the player moves on without pausing', () => {
		const bare = course([
			{ id: 'B1', steps: [choice('s1', [{ id: 'a', ok: true }, { id: 'b' }]), text('s2')] }
		]);
		const quiet = answer(bare, startLesson(bare, 'L1'), { optionId: 'b' });
		expect(quiet.outcome).toMatchObject({ paused: false, feedback: null });
		expect(show(bare, quiet.state)).toBe('s2');

		const hidden = course([
			{
				id: 'B1',
				steps: [
					choice(
						's1',
						[
							{ id: 'a', ok: true },
							{ id: 'b', fb: 'Chyba.' }
						],
						{ show_answers: false }
					),
					text('s2')
				]
			}
		]);
		const out = answer(hidden, startLesson(hidden, 'L1'), { optionId: 'b' });
		expect(out.outcome.paused).toBe(false);
		expect(view(hidden, startLesson(hidden, 'L1')).actionLabel).toBe('Další');
	});

	it('the hint is the step’s own, else the card’s, and a blank one is absent', () => {
		const d = course([
			{
				id: 'B1',
				steps: [text('s1', { hint: 'Nápověda kroku' }), text('s2', { hint: '  ' }), text('s3')]
			}
		]);
		(d.blocks[0] as Record<string, unknown>).hint = 'Nápověda karty';
		let state = startLesson(d, 'L1');
		expect(view(d, state).step?.hint).toBe('Nápověda kroku');
		state = advance(d, state).state;
		expect(view(d, state).step?.hint).toBe('Nápověda karty');
	});

	it('the question the pupil sees carries no correctness, feedback or targets', () => {
		const d = course([
			{
				id: 'B1',
				steps: [choice('s1', [{ id: 'a', ok: true, go: 's1', fb: 'tajné' }], { solution: 'tajné' })]
			}
		]);
		const v = view(d, startLesson(d, 'L1'));
		const json = JSON.stringify(v);
		expect(json).not.toMatch(/is_correct|go_to|tajné|"ok"/);
		expect(v.question?.options).toEqual([{ id: 'a', text: 'Možnost a' }]);
		expect(v).toMatchObject({ action: 'answer', actionLabel: 'Zkontrolovat' });
	});

	it('a bad input is rejected and leaves the state alone', () => {
		const d = course([{ id: 'B1', steps: [choice('s1', [{ id: 'a' }])] }]);
		const start = startLesson(d, 'L1');
		const result = answer(d, start, { optionId: 'zzz' });
		expect(result.outcome.accepted).toBe(false);
		expect(result.state).toBe(start);
	});
});

describe('AGAIN', () => {
	const d = course([
		{
			id: 'B1',
			steps: [
				choice('s1', [
					{ id: 'a', ok: true },
					{ id: 'b', go: 'AGAIN', fb: 'Ještě jednou.' }
				]),
				text('s2')
			]
		}
	]);

	it('a wrong answer shows its feedback and "Zkusit znovu", and the same question comes back', () => {
		const wrong = answer(d, startLesson(d, 'L1'), { optionId: 'b' });
		expect(wrong.state.phase).toBe('retry');
		expect(wrong.outcome).toMatchObject({ paused: true, target: { kind: 'again' } });
		// The right answer is not revealed on a retry.
		expect(wrong.outcome.feedback).toMatchObject({
			optionFeedback: ['Ještě jednou.'],
			revealedCorrectOptionIds: null
		});
		expect(view(d, wrong.state)).toMatchObject({ action: 'retry', actionLabel: 'Zkusit znovu' });

		const again = advance(d, wrong.state).state;
		expect(again).toMatchObject({ phase: 'await', stepIndex: 0 });
		expect(again.answers).toEqual({});
		expect(show(d, answer(d, again, { optionId: 'a' }).state)).toBe('s2');
	});

	it('a RIGHT answer on AGAIN is a retry too, and says so', () => {
		const loopy = course([
			{ id: 'B1', steps: [choice('s1', [{ id: 'a', ok: true, go: 'AGAIN' }]), text('s2')] }
		]);
		const out = answer(loopy, startLesson(loopy, 'L1'), { optionId: 'a' });
		expect(out.state.phase).toBe('retry');
		expect(out.outcome.notes.join(' ')).toContain('AGAIN');
	});

	it('explore bounds an AGAIN cycle and reports it', () => {
		const loopy = course([
			{ id: 'B1', steps: [choice('s1', [{ id: 'a', ok: true, go: 'AGAIN' }]), text('s2')] }
		]);
		const report = explore(loopy, 'L1');
		expect(report.loops).toHaveLength(1);
		expect(report.paths.every((p) => p.end.kind === 'loop')).toBe(true);
		expect(report.unreachable?.map((u) => u.stepId)).toContain('s2');
	});
});

describe('grading', () => {
	it('numeric tolerance is |answer - correct| <= tolerance, with a decimal comma', () => {
		expect(parseNumericAnswer(' 3,5 ')).toBe(3.5);
		expect(parseNumericAnswer('tři')).toBeNull();
		expect(numericMatches(3.04, 3, 0.05)).toBe(true);
		expect(numericMatches(3.06, 3, 0.05)).toBe(false);
		expect(numericMatches(3, 3)).toBe(true);
	});

	it('the player at the pinned commit grades no V2 numeric answer right, and the outcome says so', () => {
		const d = course([
			{
				id: 'B1',
				steps: [question('s1', { type: 'numeric', correct_number: 3, tolerance: 0.1 }), text('s2')]
			}
		]);
		const { outcome } = answer(d, startLesson(d, 'L1'), { number: 3.05 });
		expect(outcome.correct).toBe(false);
		expect(outcome.notes[0]).toContain('by podle kurzu byla správně');
	});

	it('an open answer is compared here, trimmed and case-insensitive, or with a right option', () => {
		const d = course([
			{
				id: 'B1',
				steps: [
					question('s1', { type: 'open', correct_answer: 'Praha' }),
					question('s2', { type: 'open', options: [{ id: 'o', text: 'Brno', is_correct: true }] })
				]
			}
		]);
		const first = answer(d, startLesson(d, 'L1'), { text: '  praha ' });
		expect(first.outcome.correct).toBe(true);
		const second = answer(d, first.state, { text: 'BRNO' });
		expect(second.outcome.correct).toBe(true);
		expect(answer(d, startLesson(d, 'L1'), { text: 'Plzeň' }).outcome.correct).toBe(false);
	});

	it('a multi-select needs exactly the right set and ignores the options’ own go_to', () => {
		const d = course([
			{
				id: 'B1',
				steps: [
					choice('s1', [{ id: 'a', ok: true, go: 'END' }, { id: 'b', ok: true }, { id: 'c' }], {
						allow_multiple: true
					}),
					text('s2')
				]
			}
		]);
		const start = startLesson(d, 'L1');
		expect(answer(d, start, { optionIds: ['a'] }).outcome.correct).toBe(false);
		expect(answer(d, start, { optionIds: ['a', 'b', 'c'] }).outcome.correct).toBe(false);
		const right = answer(d, start, { optionIds: ['b', 'a'] });
		expect(right.outcome.correct).toBe(true);
		// `END` on option a is not read for a multi-select (optionOutcomesApply).
		expect(show(d, right.state)).toBe('s2');
	});

	it('score koef and the card’s XP follow _completeBlock', () => {
		const d = course([
			{
				id: 'B1',
				steps: [
					text('s0'),
					choice('s1', [{ id: 'a', ok: true }, { id: 'b' }]),
					choice('s2', [{ id: 'a', ok: true }, { id: 'b' }])
				]
			},
			{ id: 'B2', steps: [text('t')] }
		]);
		let state = advance(d, startLesson(d, 'L1')).state;
		const first = answer(d, state, { optionId: 'a' });
		expect(first.outcome.scoreKoef).toBe(1);
		const second = answer(d, first.state, { optionId: 'b' });
		// Question steps are 8 when right with koef 1, 5 otherwise; the text step is 1.
		expect(second.outcome.blockResult).toMatchObject({
			blockId: 'B1',
			earnedXp: 1 + 8 + 5,
			scoreKoef: 1
		});
		state = second.state;
		expect(state.blockId).toBe('B2');
	});
});

describe('cards and the end of the lesson', () => {
	it('a display card walks its steps with "Další" and ends the lesson on the last', () => {
		const d = course([{ id: 'B1', type: 'display', steps: [text('s1'), text('s2')] }]);
		let state = startLesson(d, 'L1');
		expect(view(d, state)).toMatchObject({ action: 'advance', actionLabel: 'Pokračovat' });
		state = advance(d, state).state;
		expect(show(d, state)).toBe('s2');
		state = advance(d, state).state;
		expect(state.end).toMatchObject({ kind: 'lesson_end', complete: true });
		expect(advance(d, state).state).toBe(state);
	});

	it('an exercise card opens on its first question, with the text before it as context', () => {
		const d = course([
			{ id: 'B1', type: 'exercise', steps: [text('s1'), choice('s2', [{ id: 'a', ok: true }])] }
		]);
		const state = startLesson(d, 'L1');
		expect(show(d, state)).toBe('s2');
		expect(position(d, state)!.shownStepIds).toEqual(['s1', 's2']);
	});

	it('a forward jump over a card ends the lesson, but not as completed', () => {
		const d = course([
			{ id: 'B1', steps: [choice('s1', [{ id: 'a', go: 'B3' }])] },
			{ id: 'B2', steps: [text('t')] },
			{ id: 'B3', type: 'display', steps: [text('u')] }
		]);
		let state = answer(d, startLesson(d, 'L1'), { optionId: 'a' }).state;
		state = advance(d, state).state;
		expect(state.end).toMatchObject({
			kind: 'lesson_end',
			complete: false,
			skippedBlockIds: ['B1', 'B2']
		});
	});

	it('cards run in binding order, and fromBlockId starts mid-lesson', () => {
		const d = parseCourse({
			export_type: 'course_v2',
			course_id: 'c',
			lessons: [
				{
					lesson_id: 'L1',
					blocks: [
						{ block_id: 'B1', order: 2 },
						{ block_id: 'B2', order: 1 }
					]
				}
			],
			blocks: [
				{ block_id: 'B1', type: 'display', steps: [text('a')] },
				{ block_id: 'B2', type: 'display', steps: [text('b')] }
			]
		});
		expect(startLesson(d, 'L1').blockId).toBe('B2');
		expect(startLesson(d, 'L1', { fromBlockId: 'B1' }).blockId).toBe('B1');
		expect(startLesson(d, 'L1', { fromBlockId: 'nope' }).blockId).toBe('B2');
	});

	it('an unknown or empty lesson is an error state', () => {
		const d = course([{ id: 'B1', steps: [text('a')] }]);
		expect(startLesson(d, 'nope').end).toMatchObject({ kind: 'error', code: 'unknown_lesson' });
		const empty = parseCourse({
			export_type: 'course_v2',
			course_id: 'c',
			lessons: [{ lesson_id: 'L1', blocks: [] }],
			blocks: []
		});
		expect(startLesson(empty, 'L1').end).toMatchObject({ kind: 'error', code: 'empty_lesson' });
	});

	it('a question without options is a dead end the pupil cannot leave', () => {
		const d = course([{ id: 'B1', steps: [choice('s1', [])] }]);
		expect(startLesson(d, 'L1').end).toMatchObject({ kind: 'error', code: 'no_options' });
		expect(explore(d, 'L1').deadEnds).toHaveLength(1);
	});
});

describe('explore', () => {
	const d = course([
		{
			id: 'B1',
			steps: [
				choice('s1', [
					{ id: 'a', ok: true },
					{ id: 'b', go: 's3' },
					{ id: 'c', go: 'B404' }
				]),
				text('s2'),
				text('s3', { go_to: 'END' }),
				text('orphan')
			]
		}
	]);

	it('finds each distinct path, the error one, the lengths and the unreachable step', () => {
		const report = explore(d, 'L1');
		expect(report.truncated).toBe(false);
		const ends = report.paths.map((p) => p.end.kind).sort();
		expect(ends).toEqual(['error', 'lesson_end', 'lesson_end']);
		expect(report.errors).toHaveLength(1);
		expect(report.errors[0].end).toMatchObject({ code: 'dangling_go_to', target: 'B404' });
		expect(report.minLength).toBe(2);
		expect(report.maxLength).toBe(3);
		expect(report.unreachable).toEqual([
			expect.objectContaining({ blockId: 'B1', stepId: 'orphan' })
		]);
		expect(report.summary).toContain('Cest: 3');
	});

	it('merges answers that lead the same way into one path', () => {
		const same = course([
			{
				id: 'B1',
				steps: [
					choice('s1', [{ id: 'a', ok: true }, { id: 'b' }, { id: 'c' }, { id: 'd' }]),
					text('s2')
				]
			}
		]);
		const report = explore(same, 'L1');
		// Right and wrong lead to the same steps: one path, two ways of walking it.
		expect(report.paths).toHaveLength(1);
		expect(report.paths[0].variants).toBe(2);
	});

	it('stays bounded on a lesson with many questions', () => {
		const steps = Array.from({ length: 14 }, (_, i) =>
			choice(`s${i}`, [
				{ id: 'a', ok: true },
				{ id: 'b', fb: 'špatně' },
				{ id: 'c', fb: 'jinak' }
			])
		);
		const report = explore(course([{ id: 'B1', steps }]), 'L1', { maxPaths: 25 });
		expect(report.paths.length).toBeLessThanOrEqual(25);
		expect(report.truncated).toBe(true);
		expect(report.unreachable).toBeNull();
	});
});
