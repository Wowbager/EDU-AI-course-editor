import { describe, expect, it } from 'vitest';
import { emptyCourse } from '../document';
import { DEFAULT_PLACE } from '../placement';
import {
	anyTicked,
	unnamedTicked,
	firstUnnamedTicked,
	buildOutlineRequest,
	addDraftCard,
	addDraftLesson,
	canAddCard,
	canAddLesson,
	currentOutlineSchema,
	emptyDraft,
	MAX_CARDS_PER_LESSON,
	MAX_LESSONS,
	moveCardTo,
	setDraftKind,
	stepCard,
	type Draft,
	addToDraft,
	applyEvent,
	limitProblem,
	lineSplitter,
	readLine,
	type OutlineEvent,
	type OutlineKind,
	cardCount,
	draftOf,
	keyMaker,
	lessonStartsOpen,
	settleOpen,
	lessonTick,
	moveCard,
	moveLesson,
	outlineProblem,
	outlineRequestSchema,
	outlineSchema,
	removeCard,
	removeLesson,
	renameDraftCard,
	renameDraftLesson,
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
	it('sends an outline made by hand without a first prompt', () => {
		const doc = emptyCourse('K', 'Zlomky');
		const current = { scope: 'lessons', lessons: [{ name: 'A', cards: [] }] } as Outline;
		const made = buildOutlineRequest(doc, DEFAULT_PLACE, 'doplň karty', { current, original: '' });
		expect(made.original).toBeUndefined();
		expect(made.current).toEqual(current);
		expect(outlineRequestSchema.safeParse(made).success).toBe(true);
		const asked = buildOutlineRequest(doc, DEFAULT_PLACE, 'doplň', { current, original: 'Kurz' });
		expect(asked.original).toBe('Kurz');
	});

	const request = (over: Partial<OutlineRequest> = {}): OutlineRequest => ({
		schema: 'eduai.outline-request/1',
		prompt: 'Kurz o zlomcích',
		course: { title: 'Zlomky', language: 'cs', audience: {} },
		place: { scope: 'lessons' },
		context: '',
		...over
	});

	it('needs a prompt', () => {
		expect(outlineRequestSchema.safeParse(request()).success).toBe(true);
		expect(outlineRequestSchema.safeParse(request({ prompt: '  ' })).success).toBe(false);
	});

	it("refuses a scope that is not the place's", () => {
		const cards = { scope: 'cards', cards: [card('A')] } as Outline;
		expect(outlineProblem(request(), cards)).toMatch(/"scope":"lessons"/);
		const inLesson = request({ place: { scope: 'cards', lesson: 'X' } });
		expect(outlineProblem(inLesson, cards)).toBeUndefined();
		expect(outlineProblem(inLesson, lessons)).toMatch(/"scope":"cards"/);
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
		// The last card goes; its lesson stays, empty, to be filled or removed by hand.
		draft = removeCard(draft, draft.lessons[1].cards[0].key);
		expect(draft.lessons.map((l) => l.name)).toEqual(['Třetina', 'Polovina']);
		expect(draft.lessons[1].cards).toEqual([]);
		draft = removeLesson(draft, draft.lessons[1].key);
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

describe('an outline made by hand', () => {
	const make = () => draftOf(lessons, keyMaker());
	const names = (draft: Draft) => draft.lessons.map((l) => l.cards.map((c) => c.name));

	it('adds a lesson with no name, ticked, at the end or in place', () => {
		let draft = addDraftLesson(emptyDraft('lessons', keyMaker()), 'n1');
		expect(draft.lessons).toEqual([{ key: 'n1', name: '', cards: [], on: true }]);
		draft = addDraftLesson(draft, 'n2', 0);
		expect(draft.lessons.map((l) => l.key)).toEqual(['n2', 'n1']);
		// A nameless lesson is not part of the outline yet.
		expect(toOutline(draft)).toBeUndefined();
	});

	it('knows when a ticked row still has no name', () => {
		let draft = make();
		expect(unnamedTicked(draft)).toBe(false);
		draft = addDraftCard(draft, draft.lessons[0].key, 'n1');
		expect(unnamedTicked(draft)).toBe(true);
		// The first one from the top, with the lesson it is in.
		draft = addDraftCard(draft, draft.lessons[1].key, 'n0');
		expect(firstUnnamedTicked(draft)).toEqual({ key: 'n1', lesson: draft.lessons[0].key });
		draft = removeCard(draft, 'n0');
		draft = setCardTick(draft, 'n1', false);
		expect(unnamedTicked(draft)).toBe(false);
		// A lesson without a name counts once it would be created: ticked, or with ticked cards.
		draft = addDraftLesson(draft, 'l');
		expect(unnamedTicked(draft)).toBe(true);
		draft = setLessonTick(draft, 'l', false);
		expect(unnamedTicked(draft)).toBe(false);
		draft = renameDraftLesson(setLessonTick(draft, 'l', true), 'l', 'Opakování');
		expect(unnamedTicked(draft)).toBe(false);
		// The group of a cards proposal has no name and needs none.
		const cards = draftOf({ scope: 'cards', cards: [card('A')] } as Outline, keyMaker());
		expect(unnamedTicked(cards)).toBe(false);
	});

	it('adds a card of the kind above it, or the first kind; never with sources', () => {
		let draft = make();
		const second = draft.lessons[1].key;
		draft = addDraftCard(draft, second, 'n1', 2);
		expect(draft.lessons[1].cards[2]).toEqual({ key: 'n1', kind: 'question', name: '', on: true });
		draft = addDraftCard(draft, second, 'n2', 0);
		expect(draft.lessons[1].cards[0].kind).toBe('display');
		draft = addDraftCard(draft, draft.lessons[0].key, 'n3');
		expect(draft.lessons[0].cards.at(-1)).toMatchObject({ key: 'n3', kind: 'exercise' });
		draft = addDraftLesson(draft, 'l');
		draft = addDraftCard(draft, 'l', 'n4');
		expect(draft.lessons[2].cards[0].kind).toBe('display');
		// Unnamed cards are left out of what is created or sent.
		expect(cardCount(toOutline(draft)!)).toBe(5);
	});

	it('changes a kind and keeps the name, tick and sources', () => {
		let draft = draftOf(
			{
				scope: 'cards',
				cards: [{ kind: 'display', name: 'A', sources: ['k.0'] }]
			} as Outline,
			keyMaker()
		);
		const key = draft.lessons[0].cards[0].key;
		draft = setCardTick(draft, key, false);
		draft = setDraftKind(draft, key, 'exercise');
		expect(draft.lessons[0].cards[0]).toEqual({
			key,
			kind: 'exercise',
			name: 'A',
			sources: ['k.0'],
			on: false
		});
		draft = renameDraftCard(draft, key, 'B');
		expect(draft.lessons[0].cards[0].sources).toEqual(['k.0']);
	});

	it('creates a ticked lesson without cards, and leaves it out unticked', () => {
		let draft = addDraftLesson(make(), 'n');
		draft = renameDraftLesson(draft, 'n', 'Prázdná');
		expect(lessonTick(draft.lessons[2])).toBe('all');
		expect(toOutline(draft, 'ticked')).toMatchObject({
			lessons: [{}, {}, { name: 'Prázdná', cards: [] }]
		});
		draft = setLessonTick(draft, 'n', false);
		expect(lessonTick(draft.lessons[2])).toBe('none');
		expect((toOutline(draft, 'ticked') as { lessons: unknown[] }).lessons).toHaveLength(2);
		// It is still sent with „Co změnit?“, for the model to fill.
		expect((toOutline(draft, 'all') as { lessons: unknown[] }).lessons).toHaveLength(3);
		// A lesson with cards, all unticked, is left out as before.
		draft = setLessonTick(draft, draft.lessons[0].key, false);
		expect((toOutline(draft, 'ticked') as { lessons: unknown[] }).lessons).toHaveLength(1);
	});

	it('is a valid "current" for „Co změnit?“ with an empty lesson, which the model may not answer with', () => {
		const draft = renameDraftLesson(addDraftLesson(make(), 'n'), 'n', 'Prázdná');
		const current = toOutline(draft)!;
		expect(currentOutlineSchema.safeParse(current).success).toBe(true);
		expect(outlineSchema.safeParse(current).success).toBe(false);
	});

	it('moves a card into another lesson, at a place or at its end', () => {
		let draft = make();
		const [a, b] = draft.lessons.map((l) => l.key);
		const pulka = draft.lessons[0].cards[0].key;
		draft = moveCardTo(draft, pulka, b, 1);
		expect(names(draft)).toEqual([
			['Příklady'],
			['Co je třetina', 'Co je půlka', 'Kvíz', 'Shrnutí']
		]);
		draft = moveCardTo(draft, pulka, a, 'end');
		expect(names(draft)[0]).toEqual(['Příklady', 'Co je půlka']);
		draft = moveCardTo(draft, pulka, a, 0);
		expect(names(draft)[0]).toEqual(['Co je půlka', 'Příklady']);
		expect(moveCardTo(draft, 'nic', a, 0)).toBe(draft);
	});

	it('steps a card past the end of its lesson into the next, and stops at the ends', () => {
		let draft = make();
		const priklady = draft.lessons[0].cards[1].key;
		draft = stepCard(draft, priklady, 1);
		expect(names(draft)).toEqual([
			['Co je půlka'],
			['Příklady', 'Co je třetina', 'Kvíz', 'Shrnutí']
		]);
		draft = stepCard(draft, priklady, -1);
		expect(names(draft)[0]).toEqual(['Co je půlka', 'Příklady']);
		const first = draft.lessons[0].cards[0].key;
		expect(stepCard(draft, first, -1)).toEqual(draft);
		const last = draft.lessons[1].cards[2].key;
		expect(stepCard(draft, last, 1)).toEqual(draft);
		// Into a lesson with no cards.
		draft = addDraftLesson(draft, 'n');
		draft = stepCard(draft, last, 1);
		expect(draft.lessons[2].cards.map((c) => c.name)).toEqual(['Shrnutí']);
	});

	it('keeps to the limits the model works to', () => {
		let draft = emptyDraft('lessons', keyMaker());
		for (let i = 0; i < MAX_LESSONS + 2; i++) draft = addDraftLesson(draft, `l${i}`);
		expect(draft.lessons).toHaveLength(MAX_LESSONS);
		expect(canAddLesson(draft)).toBe(false);
		for (let i = 0; i < MAX_CARDS_PER_LESSON + 2; i++) draft = addDraftCard(draft, 'l0', `c${i}`);
		expect(draft.lessons[0].cards).toHaveLength(MAX_CARDS_PER_LESSON);
		expect(canAddCard(draft, 'l0')).toBe(false);
		draft = addDraftCard(draft, 'l1', 'x');
		// A full lesson takes no card from another.
		expect(moveCardTo(draft, 'x', 'l0', 0)).toBe(draft);
		expect(canAddLesson(emptyDraft('cards', keyMaker()))).toBe(false);
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

	it('reads the limits of the scope line, and leaves out what is unusable', () => {
		expect(readLine({ scope: 'cards', only: ['question', 'exercise'], count: 10 })).toEqual({
			event: { type: 'scope', scope: 'cards', only: ['question', 'exercise'], count: 10 }
		});
		// Unknown kinds, an empty list, zero and fractions are dropped; the line stays good.
		expect(readLine({ scope: 'cards', only: ['quiz'], count: 0 })).toEqual({
			event: { type: 'scope', scope: 'cards' }
		});
		expect(
			readLine({ scope: 'lessons', only: ['display', 'quiz', 'display'], count: 2.5 })
		).toEqual({
			event: { type: 'scope', scope: 'lessons', only: ['display'] }
		});
		expect(readLine({ scope: 'lessons', only: 'display', count: '3' })).toEqual({
			event: { type: 'scope', scope: 'lessons' }
		});
	});

	it('says what breaks the limits, and whether asking again could help', () => {
		const lesson = (...kinds: OutlineKind[]): OutlineEvent => ({
			type: 'lesson',
			lesson: { name: 'L', cards: kinds.map((kind, i) => ({ kind, name: `C${i}` })) }
		});
		const one = (kind: OutlineKind): OutlineEvent => ({ type: 'card', card: { kind, name: 'X' } });
		expect(limitProblem({}, 50, lesson('display', 'exercise'))).toBeUndefined();
		const only = { only: ['question' as const, 'exercise' as const] };
		expect(limitProblem(only, 0, one('exercise'))).toBeUndefined();
		expect(limitProblem(only, 0, one('display'))).toMatchObject({
			problem: expect.stringMatching(/"display".*"question" and "exercise"/),
			drop: false
		});
		expect(limitProblem(only, 0, lesson('question', 'display'))).toMatchObject({ drop: false });
		expect(limitProblem({ count: 3 }, 2, one('display'))).toBeUndefined();
		expect(limitProblem({ count: 3 }, 3, one('display'))).toMatchObject({ drop: true });
		// A lesson that is too long for what is left can be asked for shorter; a full proposal cannot.
		expect(limitProblem({ count: 3 }, 1, lesson('display', 'display', 'display'))).toMatchObject({
			problem: expect.stringMatching(/2 more fit/),
			drop: false
		});
		expect(limitProblem({ count: 3 }, 3, lesson('display'))).toMatchObject({ drop: true });
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

	it('puts a line that was asked for again back at its place, in the proposal and in the draft', () => {
		let so = applyEvent(null, { type: 'scope', scope: 'lessons' });
		for (const name of ['A', 'C'])
			so = applyEvent(so, { type: 'lesson', lesson: { name, cards: [card('x')] } as never });
		so = applyEvent(so, {
			type: 'lesson',
			lesson: { name: 'B', cards: [card('x')] } as never,
			at: 1
		});
		expect(so?.scope === 'lessons' && so.lessons.map((l) => l.name)).toEqual(['A', 'B', 'C']);

		const next = keyMaker();
		let draft = emptyDraft('lessons', next);
		for (const name of ['A', 'C'])
			draft = addToDraft(
				draft,
				{ type: 'lesson', lesson: { name, cards: [card('x')] } as never },
				next
			);
		draft = addToDraft(
			draft,
			{ type: 'lesson', lesson: { name: 'B', cards: [card('x')] } as never, at: 1 },
			next
		);
		expect(draft.lessons.map((l) => l.name)).toEqual(['A', 'B', 'C']);
		// Beyond the end is the end.
		draft = addToDraft(
			draft,
			{ type: 'lesson', lesson: { name: 'Z', cards: [card('x')] } as never, at: 99 },
			next
		);
		expect(draft.lessons.at(-1)!.name).toBe('Z');
	});

	it('opens every lesson of a short proposal and only the first of a long one', () => {
		const next = keyMaker();
		const small = draftOf(lessons, next);
		expect([0, 1].map((i) => lessonStartsOpen(small, i))).toEqual([true, true]);
		const many = (n: number) =>
			draftOf(
				{
					scope: 'lessons',
					lessons: Array.from({ length: n }, (_, i) => ({
						name: `L${i}`,
						cards: [card('x'), card('y')]
					}))
				} as Outline,
				next
			);
		// 10 lessons of 2 cards is 20: still short; 11 is 22.
		expect(lessonStartsOpen(many(10), 9)).toBe(true);
		expect([0, 1, 10].map((i) => lessonStartsOpen(many(11), i))).toEqual([true, false, false]);
	});

	it("settles a lesson's default once: growing past 20 cards or removing back to it changes nothing", () => {
		const next = keyMaker();
		let draft = emptyDraft('lessons', next);
		let opened: Record<string, boolean> = {};
		const add = (name: string, n: number) => {
			draft = addToDraft(
				draft,
				{
					type: 'lesson',
					lesson: { name, cards: Array.from({ length: n }, (_, i) => card(`c${i}`)) } as never
				},
				next
			);
			opened = settleOpen(opened, draft);
		};
		add('A', 10);
		add('B', 10);
		// The 21st card arrives: A and B stay open, C (which arrives over the line) starts folded.
		add('C', 5);
		expect(draft.lessons.map((l) => opened[l.key])).toEqual([true, true, false]);
		// Removing cards back under 20 does not open C by itself, nor fold the others.
		draft = {
			...draft,
			lessons: draft.lessons.map((l, i) => (i === 0 ? { ...l, cards: l.cards.slice(0, 1) } : l))
		};
		expect(draft.lessons.map((l) => settleOpen(opened, draft)[l.key])).toEqual([true, true, false]);
		// A choice made by hand is kept.
		opened = { ...opened, [draft.lessons[1].key]: false };
		expect(settleOpen(opened, draft)[draft.lessons[1].key]).toBe(false);
	});
});
