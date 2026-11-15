import { describe, expect, it } from 'vitest';
import {
	anyTicked,
	addToDraft,
	applyEvent,
	emptyDraft,
	lineSplitter,
	readLine,
	cardCount,
	draftOf,
	keyMaker,
	lessonTick,
	moveCard,
	moveLesson,
	outlineProblem,
	outlineRequestSchema,
	outlineSchema,
	removeCard,
	removeLesson,
	renameDraftCard,
	setCardTick,
	setLessonTick,
	toOutline,
	type Outline,
	type OutlineRequest
} from '../outline';

const card = (name: string, kind = 'display') => ({ kind, name });
const lessons = {
	scope: 'lessons',
	lessons: [
		{
			name: 'Polovina',
			cards: [card('Co je půlka'), card('Příklady', 'exercise')]
		},
		{ name: 'Třetina', cards: [card('Co je třetina'), card('Kvíz', 'question'), card('Shrnutí')] }
	]
} as Extract<Outline, { scope: 'lessons' }>;

describe('the outline schema', () => {
	it('takes both scopes', () => {
		expect(outlineSchema.safeParse(lessons).success).toBe(true);
		expect(
			outlineSchema.safeParse({ scope: 'cards', cards: [card('Jedna'), card('Dvě', 'exercise')] })
				.success
		).toBe(true);
	});

	it.each([
		['an unknown scope', { scope: 'steps', cards: [card('A')] }],
		['no lessons', { scope: 'lessons', lessons: [] }],
		['a lesson without cards', { scope: 'lessons', lessons: [{ name: 'A', cards: [] }] }],
		['no cards', { scope: 'cards', cards: [] }],
		['an unknown kind', { scope: 'cards', cards: [{ kind: 'video', name: 'A' }] }],
		['a card without a name', { scope: 'cards', cards: [{ kind: 'display', name: ' ' }] }],
		['a lesson without a name', { scope: 'lessons', lessons: [{ cards: [card('A')] }] }]
	])('refuses %s', (_, value) => {
		expect(outlineSchema.safeParse(value).success).toBe(false);
	});

	it('refuses more cards than a course proposal may hold', () => {
		const big = {
			scope: 'lessons',
			lessons: Array.from({ length: 5 }, (_, i) => ({
				name: `L${i}`,
				cards: Array.from({ length: 14 }, (_, j) => card(`K${j}`))
			}))
		};
		expect(outlineSchema.safeParse(big).success).toBe(false);
	});

	it('counts cards of either scope', () => {
		expect(cardCount(lessons)).toBe(5);
		expect(cardCount({ scope: 'cards', cards: [card('A')] } as Outline)).toBe(1);
	});
});

describe('the request', () => {
	const request = (over: Partial<OutlineRequest> = {}): OutlineRequest => ({
		schema: 'eduai.outline-request/1',
		prompt: 'Kurz o zlomcích',
		course: { title: 'Zlomky', language: 'cs', audience: {} },
		target: { lessons: 0 },
		context: '',
		...over
	});

	it('needs a prompt', () => {
		expect(outlineRequestSchema.safeParse(request()).success).toBe(true);
		expect(outlineRequestSchema.safeParse(request({ prompt: '  ' })).success).toBe(false);
	});

	it('refuses cards for a course that has no lesson', () => {
		const cards = { scope: 'cards', cards: [card('A')] } as Outline;
		expect(outlineProblem(request(), cards)).toMatch(/no lesson/);
		expect(outlineProblem(request({ target: { lessons: 2, lesson: 'X' } }), cards)).toBeUndefined();
		expect(outlineProblem(request(), lessons)).toBeUndefined();
	});
});

describe('the draft', () => {
	const make = () => draftOf(lessons, keyMaker());

	it('starts all ticked, with unique keys', () => {
		const draft = make();
		expect(draft.lessons.every((l) => lessonTick(l) === 'all')).toBe(true);
		const keys = draft.lessons.flatMap((l) => [l.key, ...l.cards.map((c) => c.key)]);
		expect(new Set(keys).size).toBe(keys.length);
		expect(toOutline(draft)).toEqual({
			scope: 'lessons',
			lessons: [
				{ name: 'Polovina', cards: lessons.lessons[0].cards },
				{ name: 'Třetina', cards: lessons.lessons[1].cards }
			]
		});
	});

	it('ticking a lesson ticks its cards, and one card makes the lesson partial', () => {
		let draft = setLessonTick(make(), make().lessons[0].key, false);
		draft = make();
		const l0 = draft.lessons[0];
		draft = setLessonTick(draft, l0.key, false);
		expect(lessonTick(draft.lessons[0])).toBe('none');
		draft = setCardTick(draft, draft.lessons[0].cards[1].key, true);
		expect(lessonTick(draft.lessons[0])).toBe('some');
		draft = setLessonTick(draft, draft.lessons[0].key, true);
		expect(lessonTick(draft.lessons[0])).toBe('all');
	});

	it('hands over only what is ticked, and drops a lesson with nothing ticked', () => {
		let draft = make();
		draft = setLessonTick(draft, draft.lessons[1].key, false);
		draft = setCardTick(draft, draft.lessons[0].cards[0].key, false);
		const out = toOutline(draft, 'ticked');
		expect(out).toEqual({
			scope: 'lessons',
			lessons: [{ name: 'Polovina', cards: [lessons.lessons[0].cards[1]] }]
		});
		expect(anyTicked(setLessonTick(draft, draft.lessons[0].key, false))).toBe(false);
		expect(toOutline(setLessonTick(draft, draft.lessons[0].key, false), 'ticked')).toBeUndefined();
	});

	it('renames, removes and reorders', () => {
		let draft = make();
		draft = renameDraftCard(draft, draft.lessons[0].cards[0].key, '  Půlka  ');
		expect(toOutline(draft)).toMatchObject({ lessons: [{ cards: [{ name: 'Půlka' }, {}] }, {}] });

		draft = moveCard(draft, draft.lessons[1].key, 2, 0);
		expect(draft.lessons[1].cards.map((c) => c.name)).toEqual(['Shrnutí', 'Co je třetina', 'Kvíz']);
		draft = moveLesson(draft, 1, 0);
		expect(draft.lessons.map((l) => l.name)).toEqual(['Třetina', 'Polovina']);

		draft = removeCard(draft, draft.lessons[1].cards[0].key);
		expect(draft.lessons[1].cards).toHaveLength(1);
		draft = removeCard(draft, draft.lessons[1].cards[0].key);
		expect(draft.lessons.map((l) => l.name)).toEqual(['Třetina']);
		expect(removeLesson(draft, draft.lessons[0].key).lessons).toEqual([]);
	});

	it('keeps the ticks of the items the model kept when it reworks the proposal', () => {
		let draft = make();
		draft = setCardTick(draft, draft.lessons[0].cards[1].key, false);
		const reworked: Outline = {
			scope: 'lessons',
			lessons: [
				{
					name: 'Polovina',
					cards: [card('Co je půlka'), card('Příklady', 'exercise'), card('Nová')]
				}
			]
		} as Outline;
		const next = draftOf(reworked, keyMaker(), draft);
		expect(next.lessons[0].cards.map((c) => c.on)).toEqual([true, false, true]);
	});

	it('shows a cards proposal as one group without a name, which never reaches the outline as a lesson', () => {
		const draft = draftOf({ scope: 'cards', cards: [card('A'), card('B')] } as Outline, keyMaker());
		expect(draft.lessons).toHaveLength(1);
		expect(removeCard(draft, draft.lessons[0].cards[0].key).lessons).toHaveLength(1);
		expect(toOutline(draft)).toEqual({ scope: 'cards', cards: [card('A'), card('B')] });
	});
});

describe('the stream of lines', () => {
	const lines = (...pieces: string[]) => {
		const got: unknown[] = [];
		const damaged: string[] = [];
		const splitter = lineSplitter(
			(json) => got.push(json),
			(raw) => damaged.push(raw)
		);
		for (const piece of pieces) splitter.feed(piece);
		splitter.end();
		return { got, damaged };
	};

	it('hands over a line when its newline arrives, however the text is cut', () => {
		const { got } = lines(
			'{"scope":"les',
			'sons"}\n{"name":"A","cards":[{"kind":"display",',
			'"name":"B"}]}\n'
		);
		expect(got).toEqual([
			{ scope: 'lessons' },
			{ name: 'A', cards: [{ kind: 'display', name: 'B' }] }
		]);
	});

	it('takes the last line without a newline, and skips fences and empty lines', () => {
		const { got } = lines('```json\n{"scope":"cards"}\n\n{"kind":"exercise","name":"X"}');
		expect(got).toEqual([{ scope: 'cards' }, { kind: 'exercise', name: 'X' }]);
	});

	it('reports a damaged line and goes on', () => {
		const { got, damaged } = lines(
			'{"scope":"cards"}\n{"kind":"exercise","na\n{"kind":"display","name":"Y"}\n'
		);
		expect(damaged).toEqual(['{"kind":"exercise","na']);
		expect(got).toHaveLength(2);
	});

	it('reads a line as the scope, a lesson or a card, or says what is wrong', () => {
		expect(readLine({ scope: 'cards' })).toEqual({ event: { type: 'scope', scope: 'cards' } });
		expect(readLine({ name: 'A', cards: [card('B')] })).toMatchObject({
			event: { type: 'lesson' }
		});
		expect(readLine(card('B', 'exercise'))).toMatchObject({ event: { type: 'card' } });
		expect(readLine({ name: 'A', cards: [] })).toHaveProperty('problem');
		expect(readLine({ kind: 'video', name: 'A' })).toHaveProperty('problem');
		expect(readLine({ name: 'A', cards: [card('Součet $\\frac{1}{2}$')] })).toMatchObject({
			problem: expect.stringMatching(/plain text/)
		});
		expect(readLine(card('**Tučně**'))).toMatchObject({
			problem: expect.stringMatching(/plain text/)
		});
	});

	it('builds the proposal and the draft event by event', () => {
		let so = applyEvent(null, { type: 'scope', scope: 'lessons' });
		so = applyEvent(so, { type: 'lesson', lesson: { name: 'A', cards: [card('B')] } as never });
		expect(so).toEqual({ scope: 'lessons', lessons: [{ name: 'A', cards: [card('B')] }] });
		// A card event does nothing to a lessons proposal.
		expect(applyEvent(so, { type: 'card', card: card('C') as never })).toBe(so);

		let draft = emptyDraft('lessons', keyMaker());
		const next = keyMaker();
		draft = addToDraft(
			draft,
			{ type: 'lesson', lesson: { name: 'A', cards: [card('B')] } as never },
			next
		);
		draft = addToDraft(
			draft,
			{ type: 'lesson', lesson: { name: 'C', cards: [card('D')] } as never },
			next
		);
		expect(draft.lessons.map((l) => l.name)).toEqual(['A', 'C']);
		const keys = draft.lessons.flatMap((l) => [l.key, ...l.cards.map((c) => c.key)]);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
