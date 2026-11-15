import { describe, expect, it } from 'vitest';
import {
	anyTicked,
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

const card = (name: string, kind = 'display') => ({ kind, name, brief: `O: ${name}` });
const lessons = {
	scope: 'lessons',
	lessons: [
		{
			name: 'Polovina',
			takeaway: 'Poznám půlku',
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
		['an unknown kind', { scope: 'cards', cards: [{ kind: 'video', name: 'A', brief: 'b' }] }],
		[
			'a card without a name',
			{ scope: 'cards', cards: [{ kind: 'display', name: ' ', brief: 'b' }] }
		],
		['a card without a brief', { scope: 'cards', cards: [{ kind: 'display', name: 'A' }] }],
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
				{ name: 'Polovina', takeaway: 'Poznám půlku', cards: lessons.lessons[0].cards },
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
			lessons: [
				{ name: 'Polovina', takeaway: 'Poznám půlku', cards: [lessons.lessons[0].cards[1]] }
			]
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
