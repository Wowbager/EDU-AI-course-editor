import { describe, expect, it, vi } from 'vitest';
import type { LessonEvent, LessonRequest } from '$lib/domain/lesson-writing';
import type { PlanRequest } from '$lib/domain/plan';
import { FAKE_REASONING, fakeChat } from '../fake';
import {
	AUTHOR_SYSTEM_PROMPT,
	lessonEvents,
	LESSON_MATERIALS_LABEL,
	LESSON_SPEC_VERSION,
	makePlan,
	type Gate
} from '../lesson';
import {
	PLAN_TIMEOUT_MS,
	ProviderError,
	type AssistantTurn,
	type Chat,
	type ChatMessage,
	type ChatOptions,
	type ToolCall
} from '../provider';
import { parseJson } from '../json';

type Card = LessonRequest['cards'][number];

const card = (over: Partial<Card> = {}): Card => ({
	kind: 'exercise',
	title: 'Kolik je polovina',
	steps: [
		{
			id: 's1',
			kind: 'question',
			content_md: 'Kolik je polovina z osmi?',
			hint_md: 'Děl dvěma.',
			missing: ['help']
		}
	],
	...over
});

const request = (over: Partial<LessonRequest> = {}): LessonRequest => ({
	schema: 'eduai.lesson-request/1',
	course: { title: 'Zlomky', language: 'cs', audience: { grade: 4 } },
	lesson: { name: 'Polovina' },
	cards: [card()],
	context: '',
	...over
});

const call = (name: 'write_card' | 'save_plan', args: unknown, id = 'c1'): ToolCall => ({
	id,
	type: 'function',
	function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
});
const turn = (calls: ToolCall[], extra: Partial<AssistantTurn> = {}): AssistantTurn => ({
	role: 'assistant',
	content: '',
	tool_calls: calls,
	...extra
});
/** The model saying `args` through write_card. */
const says = (args: unknown, id = 'c1', extra: Partial<AssistantTurn> = {}) =>
	turn([call('write_card', args, id)], extra);

type Scripted = Chat & { calls: number; seen: ChatMessage[][]; options: ChatOptions[] };
/** A model that gives the queued turns, one per call; the last repeats; an Error is thrown. */
const scripted = (...answers: (AssistantTurn | Error)[]): Scripted => {
	const fn = (async (messages: readonly ChatMessage[], options: ChatOptions) => {
		fn.seen.push([...messages]);
		fn.options.push(options);
		const answer = answers[Math.min(fn.calls, answers.length - 1)];
		fn.calls++;
		if (answer instanceof Error) throw answer;
		return { turn: answer, tokens: 10 };
	}) as Scripted;
	fn.calls = 0;
	fn.seen = [];
	fn.options = [];
	return fn;
};

const collect = async (events: AsyncGenerator<LessonEvent>) => {
	const out: LessonEvent[] = [];
	for await (const e of events) out.push(e);
	return out;
};
const lastOf = (messages: ChatMessage[]) => messages.at(-1)!;
const textOf = (m: ChatMessage) => (typeof m.content === 'string' ? m.content : '');

const GOOD = { steps: [{ keep: 's1', fill: { help_md: 'Polovina je jedna ze dvou částí.' } }] };
const MORE = {
	kind: 'question',
	content_md: 'Kolik je polovina z deseti?',
	question: { type: 'number', answer: 5 },
	hint_md: 'Děl dvěma.',
	help_md: 'Polovina je jedna ze dvou částí.',
	solution_md: 'Deset děleno dvěma je pět.'
};

describe('lessonEvents: one card', () => {
	it('writes, then returns the card: the kept step with its fill, and the steps added', async () => {
		const model = scripted(says({ steps: [GOOD.steps[0], MORE] }));
		const spent = vi.fn();
		const events = await collect(lessonEvents(request(), model, { spent }));
		expect(events).toMatchObject([
			{ type: 'writing', card: 0 },
			{ type: 'card', card: 0, answer: { steps: [{ keep: 's1' }, { kind: 'question' }] } },
			{ type: 'done' }
		]);
		expect(spent).toHaveBeenCalledWith(10);
		expect(model.options[0].tool).toBe('write_card');
	});

	it('sends the system prompt, the materials, the dossier, the lesson, then the card turn', async () => {
		const model = scripted(says(GOOD));
		await collect(
			lessonEvents(
				request({ context: 'KURZ: Zlomky\nLEKCE 1', materials: '### [aaaaaaaa.0] x' }),
				model
			)
		);
		const messages = model.seen[0];
		expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user', 'user']);
		expect(messages[0]).toEqual({ role: 'system', content: AUTHOR_SYSTEM_PROMPT });
		expect(textOf(messages[1]).startsWith(LESSON_MATERIALS_LABEL)).toBe(true);
		expect(textOf(messages[1])).toContain('[aaaaaaaa.0]');
		expect(textOf(messages[2])).toContain('KURZ: Zlomky');
		expect(JSON.parse(textOf(messages[3]))).toMatchObject({ task: 'lesson', course: {} });
		const cardTurn = JSON.parse(textOf(messages[4]));
		expect(cardTurn).toMatchObject({ write: 1, card: { kind: 'exercise' } });
		// The lesson's turn says nothing of the materials or the dossier.
		for (const m of messages.slice(3)) {
			expect(textOf(m)).not.toContain('aaaaaaaa');
			expect(textOf(m)).not.toContain('LEKCE 1');
		}
	});

	it('sends no message for materials or a dossier when there are none', async () => {
		const model = scripted(says(GOOD));
		await collect(lessonEvents(request(), model));
		expect(model.seen[0].map((m) => m.role)).toEqual(['system', 'user', 'user']);
	});

	it('the messages before the dossier are the same for every lesson of a course (cached prefix)', async () => {
		const materials = '### [aaaaaaaa.0] x';
		const a = scripted(says(GOOD));
		const b = scripted(says(GOOD));
		await collect(lessonEvents(request({ context: 'Kurz: A', materials }), a));
		await collect(
			lessonEvents(request({ context: 'Kurz: B', materials, cards: [card({ title: 'Jiná' })] }), b)
		);
		expect(b.seen[0].slice(0, 2)).toEqual(a.seen[0].slice(0, 2));
		expect(b.seen[0][2]).not.toEqual(a.seen[0][2]);
	});

	it('draws_on and plan_card are part of the card turn, not of the checked card', async () => {
		const model = scripted(says(GOOD));
		await collect(
			lessonEvents(request({ cards: [card({ plan_card: 3, draws_on: ['aaaaaaaa.0'] })] }), model)
		);
		const turnJson = JSON.parse(textOf(lastOf(model.seen[0])));
		expect(turnJson.plan_card).toBe(3);
		expect(turnJson.draws_on).toEqual(['aaaaaaaa.0']);
		expect(turnJson.card.plan_card).toBeUndefined();
		expect(turnJson.card.draws_on).toBeUndefined();
	});
});

describe('lessonEvents: a refusal is the tool result', () => {
	it('names the missing step the teacher wrote, and the card is then accepted', async () => {
		const model = scripted(says({ steps: [MORE] }, 'a1'), says(GOOD, 'a2'));
		const spent = vi.fn();
		const events = await collect(lessonEvents(request(), model, { spent }));
		expect(events.map((e) => e.type)).toEqual(['writing', 'card', 'done']);
		expect(model.calls).toBe(2);
		expect(spent).toHaveBeenCalledTimes(2);
		const refusal = lastOf(model.seen[1]);
		expect(refusal).toMatchObject({ role: 'tool', tool_call_id: 'a1' });
		expect(textOf(refusal)).toMatch(/^Refused:/);
		expect(textOf(refusal)).toContain('"s1"');
	});

	it('names the part the model overwrote', async () => {
		const bad = { steps: [{ keep: 's1', fill: { help_md: 'Pomoc.', hint_md: 'Přepsaná' } }] };
		const model = scripted(says(bad), says(GOOD));
		await collect(lessonEvents(request(), model));
		expect(model.calls).toBe(2);
		expect(textOf(lastOf(model.seen[1]))).toContain('hint_md');
	});

	it('does not take a question with the wrong number of right answers', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const options = ['a', 'b', 'c'].map((text) => ({ text, correct: true, feedback: 'x' }));
			const bad = says({
				steps: [GOOD.steps[0], { ...MORE, question: { type: 'mcq_1', options } }]
			});
			const model = scripted(bad);
			const events = await collect(lessonEvents(request(), model));
			expect(events.map((e) => e.type)).toEqual(['writing', 'card-failed', 'done']);
			expect(textOf(lastOf(model.seen[1]))).toContain('number of correct options');
		} finally {
			vi.restoreAllMocks();
		}
	});

	it('holds the model to the question type the teacher chose', async () => {
		const steps: Card['steps'] = [
			{ id: 's1', kind: 'question', question_type: 'number', missing: ['question'] }
		];
		const model = scripted(
			says({ steps: [{ keep: 's1', fill: { question: { type: 'open', answer: 'čtyři' } } }] }),
			says({ steps: [{ keep: 's1', fill: { question: { type: 'number', answer: 4 } } }] })
		);
		const events = await collect(lessonEvents(request({ cards: [card({ steps })] }), model));
		expect(events[1]).toEqual({
			type: 'card',
			card: 0,
			answer: { steps: [{ keep: 's1', fill: { question: { type: 'number', answer: 4 } } }] }
		});
		expect(textOf(lastOf(model.seen[1]))).toContain('"number"');
	});

	const open = (answer: string) =>
		says({
			steps: [
				GOOD.steps[0],
				{
					kind: 'question',
					content_md: 'Sečti zlomky.',
					question: { type: 'open', answer },
					hint_md: 'h',
					help_md: 'p',
					solution_md: 's'
				}
			]
		});

	it.each(['$\\frac{21}{30}$ a $\\frac{4}{30}$', '\\frac{1}{2}', '**3/4**', '- 3/4\n- 0,75'])(
		'sends an open answer such as %j back with the reason',
		async (bad) => {
			const model = scripted(open(bad), open('21/30 a 4/30'));
			const events = await collect(lessonEvents(request(), model));
			expect(events[1].type).toBe('card');
			expect(model.calls).toBe(2);
			expect(textOf(lastOf(model.seen[1]))).toMatch(/plain text/);
		}
	);

	it('takes typed fractions and equations', async () => {
		const model = scripted(open('21/30\nx = 5'));
		expect((await collect(lessonEvents(request(), model)))[1].type).toBe('card');
	});

	it('refuses arguments that are not JSON or not a card', async () => {
		const model = scripted(
			turn([call('write_card', 'not json')]),
			says({ nothing: true }, 'c2'),
			says(GOOD, 'c3')
		);
		const events = await collect(lessonEvents(request(), model));
		expect(events[1].type).toBe('card');
		expect(textOf(model.seen[1].at(-1)!)).toContain('not valid JSON');
		expect(textOf(model.seen[2].at(-1)!)).toContain('expected shape');
	});
});

describe('lessonEvents: giving up and going on', () => {
	it('gives up after three attempts, logs why without the course text, and writes the next card in the same conversation', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const first = card({ title: 'Kolik je polovina' });
			const second = card({
				title: 'Druhá karta',
				steps: [{ id: 't1', kind: 'question', missing: ['help'] }]
			});
			const model = scripted(
				says('{"nope"', 'a1'),
				says('{"nope"', 'a2'),
				says('{"nope"', 'a3'),
				says({ steps: [{ keep: 't1', fill: { help_md: 'Pomoc.' } }] }, 'b1')
			);
			const events = await collect(
				lessonEvents(request({ context: 'TAJNÝ TEXT KURZU', cards: [first, second] }), model)
			);
			expect(events.map((e) => e.type)).toEqual([
				'writing',
				'card-failed',
				'writing',
				'card',
				'done'
			]);
			expect(model.calls).toBe(4);
			expect(log).toHaveBeenCalledTimes(1);
			const logged = JSON.stringify(log.mock.calls[0]);
			expect(logged).toContain('[ai]');
			expect(logged).toContain('not valid JSON');
			expect(logged).toContain('exercise');
			expect(logged).not.toContain('TAJNÝ');
			expect(logged).not.toContain('Kolik je polovina');
			// The fourth call is the same conversation: the failed card's turns are still in it.
			const fourth = model.seen[3];
			expect(fourth.filter((m) => m.role === 'assistant')).toHaveLength(3);
			expect(fourth.filter((m) => m.role === 'tool')).toHaveLength(3);
			expect(JSON.parse(textOf(lastOf(fourth)))).toMatchObject({ write: 2 });
		} finally {
			log.mockRestore();
		}
	});

	it('reports what each call used to `spent`, even when a later call throws', async () => {
		const model = scripted(says('x'), new ProviderError('busy', '429'));
		let used = 0;
		await expect(
			collect(lessonEvents(request(), model, { spent: (n) => (used += n) }))
		).rejects.toBeInstanceOf(ProviderError);
		expect(used).toBe(10);
	});

	it('keeps the cards written before a provider failure', async () => {
		const model = scripted(says(GOOD), new ProviderError('network', 'down'));
		const seen: LessonEvent[] = [];
		await expect(
			(async () => {
				for await (const e of lessonEvents(request({ cards: [card(), card()] }), model))
					seen.push(e);
			})()
		).rejects.toBeInstanceOf(ProviderError);
		expect(seen.map((e) => e.type)).toEqual(['writing', 'card', 'writing']);
	});
});

describe('lessonEvents: the shape of the answer', () => {
	it('reads JSON in `content` when the model called no tool, and asks for the tool in reply', async () => {
		const model = scripted({ role: 'assistant', content: JSON.stringify(GOOD) });
		const events = await collect(lessonEvents(request(), model));
		expect(events[1].type).toBe('card');
		const bad = scripted(
			{ role: 'assistant', content: 'nothing' },
			{ role: 'assistant', content: JSON.stringify(GOOD) }
		);
		await collect(lessonEvents(request(), bad));
		expect(lastOf(bad.seen[1])).toMatchObject({ role: 'user' });
		expect(textOf(lastOf(bad.seen[1]))).toContain('write_card');
	});

	it('answers a second tool call in one turn with "Ignored"', async () => {
		const both = turn([call('write_card', GOOD, 'x1'), call('write_card', MORE, 'x2')]);
		const model = scripted(both, says(GOOD, 'y1'));
		// The first call is fine, so the card is written and the extra call is answered.
		const events = await collect(lessonEvents(request({ cards: [card(), card()] }), model));
		expect(events.map((e) => e.type)).toEqual(['writing', 'card', 'writing', 'card', 'done']);
		const second = model.seen[1];
		const tools = second.filter((m) => m.role === 'tool');
		expect(tools).toMatchObject([
			{ tool_call_id: 'x1', content: 'ok' },
			{ tool_call_id: 'x2', content: expect.stringMatching(/^Ignored/) }
		]);
	});

	it('sends earlier turns back unchanged, reasoning included, and card i+1 sees card i', async () => {
		const reasoning = [{ type: 'reasoning.text', text: 'Úvaha.', index: 0 }];
		const first = says(GOOD, 'k1', { reasoning_details: reasoning });
		const model = scripted(first, says(GOOD, 'k2'));
		await collect(lessonEvents(request({ cards: [card(), card({ title: 'Druhá' })] }), model));
		const second = model.seen[1];
		const at = second.findIndex((m) => m.role === 'assistant');
		expect(second[at]).toBe(first);
		expect((second[at] as AssistantTurn).reasoning_details).toEqual(reasoning);
		expect(second[at + 1]).toMatchObject({ role: 'tool', tool_call_id: 'k1', content: 'ok' });
		expect(JSON.parse(textOf(lastOf(second)))).toMatchObject({ write: 2 });
		// The first call did not have the later card.
		expect(model.seen[0].some((m) => textOf(m).startsWith('{"write":2'))).toBe(false);
	});
});

describe('lessonEvents: the gate', () => {
	it('stops with reason and retryAfter when the gate refuses, and makes no further call', async () => {
		const model = scripted(says(GOOD));
		let n = 0;
		const gate: Gate = () =>
			n++ === 0 ? { ok: true } : { ok: false, reason: 'rate', retryAfterSeconds: 42 };
		const events = await collect(
			lessonEvents(request({ cards: [card(), card()] }), model, { gate })
		);
		expect(events).toEqual([
			{ type: 'writing', card: 0 },
			{ type: 'card', card: 0, answer: expect.anything() },
			{ type: 'writing', card: 1 },
			{ type: 'stopped', reason: 'rate', retryAfter: 42 }
		]);
		expect(model.calls).toBe(1);
	});

	it('stops before any call when the gate refuses at once', async () => {
		const model = scripted(says(GOOD));
		const gate: Gate = () => ({ ok: false, reason: 'budget', retryAfterSeconds: 7 });
		const events = await collect(lessonEvents(request(), model, { gate }));
		expect(events.at(-1)).toEqual({ type: 'stopped', reason: 'budget', retryAfter: 7 });
		expect(model.calls).toBe(0);
	});
});

// ───────────────────────────────── with a plan ─────────────────────────────────

const planRequest = (over: Partial<PlanRequest> = {}): PlanRequest => ({
	schema: 'eduai.plan-request/1',
	course: { title: 'Zlomky', language: 'cs', audience: {} },
	lessons: [
		{
			lesson: 1,
			name: 'Polovina',
			cards: [
				{ card: 1, kind: 'display', title: 'Co je polovina' },
				{ card: 2, kind: 'exercise', title: 'Počítáme půlky', brief: 'Procvičit.' }
			]
		},
		{ lesson: 2, name: 'Čtvrtina', cards: [{ card: 3, kind: 'display', title: 'Čtvrtina' }] }
	],
	context: 'KURZ: Zlomky',
	materials: '### [aaaaaaaa.0] x',
	...over
});
const PLAN = {
	conventions: 'Tykáme.',
	lessons: [{ lesson: 1, note: 'Půlky.' }],
	cards: [
		{ card: 1, brief: 'Co je půlka.' },
		{ card: 2, brief: 'Procvičit.' },
		{ card: 3, brief: 'Čtvrtina.' }
	]
};

describe('lessonEvents with a plan', () => {
	const planTurn: AssistantTurn = turn([call('save_plan', PLAN, 'p1')], {
		reasoning_details: [{ type: 'reasoning.text', text: 'Plán.', index: 0 }]
	});
	const withPlan = (over: Partial<LessonRequest>): LessonRequest =>
		request({ plan: { request: planRequest(), turn: planTurn }, ...over });

	it('opens with the plan, its answer with the reasoning and "ok", the same for every lesson', async () => {
		const a = scripted(says(GOOD));
		const b = scripted(says(GOOD));
		await collect(
			lessonEvents(withPlan({ context: 'Lekce A', cards: [card({ plan_card: 1 })] }), a)
		);
		await collect(
			lessonEvents(
				withPlan({
					lesson: { name: 'Čtvrtina' },
					context: 'Lekce B jiná',
					materials: 'Jiné materiály',
					cards: [card({ plan_card: 3, title: 'Jiná' })]
				}),
				b
			)
		);
		const upto = (messages: ChatMessage[]) => {
			const at = messages.findIndex((m) => m.role === 'tool');
			return messages.slice(0, at + 1);
		};
		const opening = upto(a.seen[0]);
		expect(opening).toEqual(upto(b.seen[0]));
		expect(opening.map((m) => m.role)).toEqual([
			'system',
			'user',
			'user',
			'user',
			'assistant',
			'tool'
		]);
		expect(JSON.parse(textOf(opening[3]))).toMatchObject({ task: 'plan' });
		expect(opening[4]).toMatchObject({ reasoning_details: [{ text: 'Plán.' }] });
		expect(opening[5]).toMatchObject({ tool_call_id: 'p1', content: 'ok' });
		// After it comes what is specific to the lesson.
		expect(textOf(a.seen[0][opening.length])).toContain('Lekce A');
		expect(textOf(b.seen[0][opening.length])).toContain('Jiné materiály');
		expect(JSON.parse(textOf(lastOf(a.seen[0])))).toMatchObject({ write: 1, plan_card: 1 });
	});
});

describe('makePlan', () => {
	const planned = (args: unknown, id = 'p1') => turn([call('save_plan', args, id)]);

	it('accepts a plan covering every card, thinking hard, through save_plan', async () => {
		const model = scripted(planned(PLAN));
		const spent = vi.fn();
		const event = await makePlan(planRequest(), model, { spent });
		expect(event).toMatchObject({ type: 'plan', plan: PLAN, turn: { role: 'assistant' } });
		expect(model.calls).toBe(1);
		expect(model.options[0]).toMatchObject({
			tool: 'save_plan',
			effort: 'high',
			timeoutMs: PLAN_TIMEOUT_MS
		});
		expect(spent).toHaveBeenCalledWith(10);
		const messages = model.seen[0];
		expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user']);
		expect(textOf(messages[1]).startsWith(LESSON_MATERIALS_LABEL)).toBe(true);
	});

	it('refuses a plan missing a card, names it, and asks again', async () => {
		const missing = { ...PLAN, cards: PLAN.cards.slice(0, 2) };
		const model = scripted(planned(missing, 'p1'), planned(PLAN, 'p2'));
		const event = await makePlan(planRequest(), model);
		expect(event).toMatchObject({ type: 'plan', plan: PLAN });
		expect(model.calls).toBe(2);
		const refusal = lastOf(model.seen[1]);
		expect(refusal).toMatchObject({ role: 'tool', tool_call_id: 'p1' });
		expect(textOf(refusal)).toMatch(/^Refused:.*card 3/);
		// The accepted turn is the one handed back, not the refused one.
		expect((event as { turn: AssistantTurn }).turn.tool_calls?.[0].id).toBe('p2');
	});

	it('fails after three attempts', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const model = scripted(planned({ conventions: '', lessons: [], cards: [] }));
			expect(await makePlan(planRequest(), model)).toEqual({ type: 'failed', problem: 'failed' });
			expect(model.calls).toBe(3);
			expect(log).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(log.mock.calls[0])).not.toContain('KURZ');
		} finally {
			log.mockRestore();
		}
	});

	it('stops when the gate refuses', async () => {
		const model = scripted(planned(PLAN));
		const gate: Gate = () => ({ ok: false, reason: 'budget', retryAfterSeconds: 9 });
		expect(await makePlan(planRequest(), model, { gate })).toEqual({
			type: 'stopped',
			reason: 'budget',
			retryAfter: 9
		});
		expect(model.calls).toBe(0);
	});
});

describe('the fake provider', () => {
	it('plans in a shape makePlan accepts, with its reasoning', async () => {
		const event = await makePlan(planRequest(), fakeChat);
		expect(event.type).toBe('plan');
		if (event.type !== 'plan') return;
		expect(event.plan.cards.map((c) => c.card)).toEqual([1, 2, 3]);
		// A brief the teacher gave is kept.
		expect(event.plan.cards[1].brief).toBe('Procvičit.');
		expect(event.turn.reasoning_details).toEqual(FAKE_REASONING);
	});

	it('answers every kind of card in a shape lessonEvents accepts, keeping given steps', async () => {
		for (const kind of ['display', 'exercise', 'question'] as const) {
			for (const type of ['yes_no', 'number', 'mcq_1', 'mcq_n', 'open', undefined] as const) {
				const asked = card({
					kind,
					steps: [
						{ id: 's0', kind: 'text', content_md: 'Úvod od učitele', missing: [] },
						{
							id: 's1',
							kind: 'question',
							missing: ['content', 'question', 'hint', 'help', 'solution'],
							...(type === undefined ? {} : { question_type: type })
						}
					]
				});
				const events = await collect(lessonEvents(request({ cards: [asked] }), fakeChat));
				const label = `${kind} ${String(type)}`;
				expect(
					events.map((e) => e.type),
					label
				).toEqual(['writing', 'card', 'done']);
				const written = events[1];
				if (written.type !== 'card') continue;
				expect(
					written.answer.steps.slice(0, 2).map((s) => ('keep' in s ? s.keep : '?')),
					label
				).toEqual(['s0', 's1']);
				expect(written.answer.steps.length, label).toBeGreaterThan(2);
			}
		}
	});

	it('writes several cards of a lesson', async () => {
		const events = await collect(lessonEvents(request({ cards: [card(), card()] }), fakeChat));
		expect(events.map((e) => e.type)).toEqual(['writing', 'card', 'writing', 'card', 'done']);
	});
});

describe('the prompt', () => {
	it('states what the card kinds hold and that a stated count wins', () => {
		expect(LESSON_SPEC_VERSION).toBe('1');
		expect(AUTHOR_SYSTEM_PROMPT).toContain('"display"');
		expect(AUTHOR_SYSTEM_PROMPT).toContain('2 to 8 question steps');
		expect(AUTHOR_SYSTEM_PROMPT).toContain('it wins');
		expect(AUTHOR_SYSTEM_PROMPT).toContain('$x$');
	});

	it('puts the field rules and the length limits in the prompt', () => {
		expect(AUTHOR_SYSTEM_PROMPT).toMatch(/- open answer[^\n]*plain text/);
		expect(AUTHOR_SYSTEM_PROMPT).toMatch(/a hint is one sentence/);
		expect(AUTHOR_SYSTEM_PROMPT).toMatch(
			/Use "number" only when the pupil types a whole or decimal number/
		);
		expect(AUTHOR_SYSTEM_PROMPT).toContain('never put a key in a card');
	});

	it('names both tools and both tasks', () => {
		expect(AUTHOR_SYSTEM_PROMPT).toContain('save_plan');
		expect(AUTHOR_SYSTEM_PROMPT).toContain('write_card');
		expect(AUTHOR_SYSTEM_PROMPT).toContain('"task":"plan"');
		expect(AUTHOR_SYSTEM_PROMPT).toContain('"task":"lesson"');
	});
});

describe('parseJson', () => {
	it('reads JSON wrapped in a code fence, and nothing else as undefined', () => {
		expect(parseJson('```json\n' + JSON.stringify(GOOD) + '\n```')).toEqual(GOOD);
		expect(parseJson('nothing here')).toBeUndefined();
	});
});
