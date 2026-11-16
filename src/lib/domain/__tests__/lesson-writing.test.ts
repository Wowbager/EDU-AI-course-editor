import { describe, expect, it } from 'vitest';
import { addBlock, addLesson } from '../commands';
import { emptyCourse } from '../document';
import { BRIEF_KEY, SOURCE_REFS_KEY, buildGenRequest, completeness } from '../authoring';
import {
	MAX_TURN_CHARS,
	buildLessonRequest,
	cardRequestOf,
	lessonEventSchema,
	lessonRequestSchema,
	planEventSchema,
	type AssistantTurnData
} from '../lesson-writing';
import { buildPlanRequest } from '../plan';
import type { BlockV2, CourseV2 } from '../schema';

interface Fixture {
	doc: CourseV2;
	lesson: string;
	other: string;
	cards: string[];
}

function patch(doc: CourseV2, id: string, more: Record<string, unknown>): CourseV2 {
	return {
		...doc,
		blocks: doc.blocks.map((b) => (b.block_id === id ? ({ ...b, ...more } as BlockV2) : b))
	};
}

function fixture(): Fixture {
	let doc: CourseV2 = { ...emptyCourse('KURZ', 'Zlomky'), language: 'cs' };
	doc = addLesson(doc, 'Polovina').doc;
	doc = addLesson(doc, 'Třetina').doc;
	const [lesson, other] = doc.lessons.map((l) => l.lesson_id);
	const cards: string[] = [];
	for (const [l, type, name] of [
		[lesson, 'display', 'Co je půlka'],
		[lesson, 'exercise', 'Příklady'],
		[lesson, 'question', 'Kvíz'],
		[other, 'display', 'Jiná lekce']
	] as const) {
		const added = addBlock(doc, l, type);
		doc = patch(added.doc, added.ref!.blockId!, { name });
		cards.push(added.ref!.blockId!);
	}
	return { doc, lesson, other, cards };
}

/** A display card with its text written, so there is nothing left to write. */
const finished = (doc: CourseV2, id: string): CourseV2 => {
	const block = doc.blocks.find((b) => b.block_id === id)!;
	return patch(doc, id, {
		steps: block.steps.map((s) => ({ ...s, content: 'Hotový text karty.' }))
	});
};

const turn: AssistantTurnData = { role: 'assistant', content: 'Plán hotov', reasoning: 'úvaha' };

function planFor(f: Fixture, materials = '') {
	const refs = f.cards.slice(0, 3).map((blockId) => ({ blockId, lessonId: f.lesson }));
	const built = buildPlanRequest(f.doc, refs, 'dossier', materials)!;
	return { request: built.request, turn, targets: built.targets };
}

describe('buildLessonRequest', () => {
	it('keeps the order it was given and returns the ids it carries', () => {
		const f = fixture();
		const order = [f.cards[2], f.cards[0], f.cards[1]];
		const built = buildLessonRequest(f.doc, f.lesson, order, { context: 'ctx' })!;
		expect(built.ids).toEqual(order);
		expect(built.request.cards.map((c) => c.title)).toEqual(['Kvíz', 'Co je půlka', 'Příklady']);
		expect(built.request.cards.map((c) => c.kind)).toEqual(['question', 'display', 'exercise']);
		expect(built.request.course).toMatchObject({ title: 'Zlomky', language: 'cs' });
		expect(built.request.lesson).toMatchObject({ name: 'Polovina' });
		expect(built.request.context).toBe('ctx');
		expect('plan' in built.request).toBe(false);
		expect('materials' in built.request).toBe(false);
		expect(lessonRequestSchema.safeParse(built.request).success).toBe(true);
	});

	it('skips cards that are gone or have nothing left to write, and is undefined when none is left', () => {
		const f = fixture();
		const doc = finished(patch(f.doc, f.cards[0], {}), f.cards[0]);
		expect(completeness(doc.blocks.find((b) => b.block_id === f.cards[0])!)).toBe('ready');
		const built = buildLessonRequest(doc, f.lesson, [f.cards[0], 'GONE', f.cards[1]], {
			context: ''
		})!;
		expect(built.ids).toEqual([f.cards[1]]);
		expect(built.request.cards).toHaveLength(1);
		expect(buildLessonRequest(doc, f.lesson, [f.cards[0], 'GONE'], { context: '' })).toBe(
			undefined
		);
		expect(buildLessonRequest(doc, f.lesson, [], { context: '' })).toBe(undefined);
	});

	it('adds plan_card, the 1-based number in the plan targets, only for planned cards', () => {
		const f = fixture();
		const plan = planFor(f);
		const ids = [f.cards[1], f.cards[0], f.cards[3]];
		const { request } = buildLessonRequest(f.doc, f.lesson, ids, { context: '', plan })!;
		expect(request.cards.map((c) => c.plan_card)).toEqual([2, 1, undefined]);
		expect('plan_card' in request.cards[2]).toBe(false);
		expect(request.plan).toEqual({ request: plan.request, turn: plan.turn });
		expect('targets' in request.plan!).toBe(false);
		expect(lessonRequestSchema.safeParse(request).success).toBe(true);
	});

	it('adds no plan_card without a plan', () => {
		const f = fixture();
		const { request } = buildLessonRequest(f.doc, f.lesson, f.cards.slice(0, 3), { context: '' })!;
		expect(request.cards.some((c) => 'plan_card' in c)).toBe(false);
	});

	describe('draws_on', () => {
		const sourced = (f: Fixture) =>
			patch(f.doc, f.cards[0], { [SOURCE_REFS_KEY]: ['abcdef01.1', 'abcdef01.2'] });

		it('is the lesson card source_refs when materials are sent', () => {
			const f = fixture();
			const { request } = buildLessonRequest(sourced(f), f.lesson, f.cards.slice(0, 2), {
				context: '',
				materials: 'The materials in full: …'
			})!;
			expect(request.materials).toBe('The materials in full: …');
			expect(request.cards[0].draws_on).toEqual(['abcdef01.1', 'abcdef01.2']);
			expect('draws_on' in request.cards[1]).toBe(false);
		});

		it('is also sent when only the plan has materials', () => {
			const f = fixture();
			const doc = sourced(f);
			const plan = planFor({ ...f, doc }, 'materials');
			const { request } = buildLessonRequest(doc, f.lesson, f.cards.slice(0, 2), {
				context: '',
				plan
			})!;
			expect('materials' in request).toBe(false);
			expect(request.cards[0].draws_on).toEqual(['abcdef01.1', 'abcdef01.2']);
		});

		it('is left out when no materials are sent and the plan has none', () => {
			const f = fixture();
			const doc = sourced(f);
			const none = buildLessonRequest(doc, f.lesson, f.cards.slice(0, 2), { context: '' })!;
			expect('draws_on' in none.request.cards[0]).toBe(false);
			const plan = planFor({ ...f, doc });
			const planned = buildLessonRequest(doc, f.lesson, f.cards.slice(0, 2), {
				context: '',
				plan
			})!;
			expect('draws_on' in planned.request.cards[0]).toBe(false);
			// An empty materials string is not materials.
			const empty = buildLessonRequest(doc, f.lesson, f.cards.slice(0, 2), {
				context: '',
				materials: ''
			})!;
			expect('draws_on' in empty.request.cards[0]).toBe(false);
			expect('materials' in empty.request).toBe(false);
		});
	});

	it('never shows a block id or a lesson id in the cards, course or lesson', () => {
		const f = fixture();
		const doc = patch(f.doc, f.cards[0], {
			[SOURCE_REFS_KEY]: ['abcdef01.1'],
			[BRIEF_KEY]: 'Půlka na koláči'
		});
		const plan = planFor({ ...f, doc });
		const { request } = buildLessonRequest(doc, f.lesson, f.cards.slice(0, 3), {
			context: '',
			materials: 'm',
			plan
		})!;
		const shown = JSON.stringify({
			cards: request.cards,
			course: request.course,
			lesson: request.lesson
		});
		for (const id of [...f.cards, f.lesson, f.other, 'KURZ']) expect(shown).not.toContain(id);
		// The brief does reach the model.
		expect(request.cards[0].brief).toBe('Půlka na koláči');
		// Nor does the plan the conversation starts with.
		expect(JSON.stringify(request.plan!.request)).not.toContain(f.lesson);
		for (const id of f.cards) expect(JSON.stringify(request.plan!.request)).not.toContain(id);
	});

	it('makes cards that match what buildGenRequest makes of them', () => {
		const f = fixture();
		const { request } = buildLessonRequest(f.doc, f.lesson, [f.cards[1]], { context: 'x' })!;
		expect(request.cards[0]).toEqual(buildGenRequest(f.doc, f.cards[1], f.lesson)!.card);
	});
});

describe('cardRequestOf', () => {
	it('makes the single-card request of one card, without plan_card and draws_on, with no context', () => {
		const f = fixture();
		const doc = patch(f.doc, f.cards[0], { [SOURCE_REFS_KEY]: ['abcdef01.1'] });
		const plan = planFor({ ...f, doc });
		const { request } = buildLessonRequest(doc, f.lesson, f.cards.slice(0, 2), {
			context: 'big dossier',
			materials: 'm',
			plan
		})!;
		expect(request.cards[0].plan_card).toBe(1);
		const one = cardRequestOf(request, 0);
		expect(one.schema).toBe('eduai.gen-request/2');
		// A stub with an empty step is 'generate', as buildGenRequest says.
		expect(buildGenRequest(doc, f.cards[0])!.mode).toBe('generate');
		expect(one.mode).toBe('generate');
		expect(one.context).toBe('');
		expect('plan_card' in one.card).toBe(false);
		expect('draws_on' in one.card).toBe(false);
		expect(one.lesson).toEqual(request.lesson);
		expect(one.card.title).toBe('Co je půlka');
		expect(cardRequestOf(request, 1).card.title).toBe('Příklady');
	});

	it('is in mode complete when the card has some steps written', () => {
		const f = fixture();
		const doc = patch(f.doc, f.cards[0], {
			steps: [
				{ id: 's1', type: 'text', order: 1, content: 'Začátek' },
				{ id: 's2', type: 'text', order: 2, content: '' }
			]
		});
		const built = buildLessonRequest(doc, f.lesson, [f.cards[0]], { context: '' });
		if (built === undefined) throw new Error('expected a request');
		expect(cardRequestOf(built.request, 0).mode).toBe(buildGenRequest(doc, f.cards[0])!.mode);
	});
});

describe('lessonRequestSchema', () => {
	const make = (extra: Partial<AssistantTurnData> = {}) => {
		const f = fixture();
		const plan = planFor(f);
		const { request } = buildLessonRequest(f.doc, f.lesson, f.cards.slice(0, 3), {
			context: '',
			plan: { ...plan, turn: { ...turn, ...extra } }
		})!;
		return request;
	};

	it('accepts what buildLessonRequest makes', () => {
		expect(lessonRequestSchema.safeParse(make()).success).toBe(true);
	});

	it('refuses a plan turn longer than MAX_TURN_CHARS as JSON, and takes one just under', () => {
		const pad = (n: number) => ({ reasoning: 'x'.repeat(n) });
		const base = JSON.stringify({ ...turn, reasoning: '' }).length;
		expect(lessonRequestSchema.safeParse(make(pad(MAX_TURN_CHARS - base))).success).toBe(true);
		expect(lessonRequestSchema.safeParse(make(pad(MAX_TURN_CHARS - base + 1))).success).toBe(false);
	});

	it('refuses no cards, and a wrong schema tag', () => {
		const ok = make();
		expect(lessonRequestSchema.safeParse({ ...ok, cards: [] }).success).toBe(false);
		expect(lessonRequestSchema.safeParse({ ...ok, schema: 'eduai.gen-request/2' }).success).toBe(
			false
		);
	});
});

describe('lessonEventSchema', () => {
	it('accepts every event of the stream', () => {
		for (const event of [
			{ type: 'writing', card: 0 },
			{ type: 'card-failed', card: 2 },
			{ type: 'stopped', reason: 'rate', retryAfter: 30 },
			{ type: 'stopped', reason: 'budget', retryAfter: 0 },
			{ type: 'done' },
			{ type: 'failed', problem: 'busy' },
			{ type: 'failed', problem: 'failed' }
		])
			expect(lessonEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
	});

	it('refuses an unknown type, a negative card and an unknown problem', () => {
		expect(lessonEventSchema.safeParse({ type: 'nope' }).success).toBe(false);
		expect(lessonEventSchema.safeParse({ type: 'writing', card: -1 }).success).toBe(false);
		expect(lessonEventSchema.safeParse({ type: 'failed', problem: 'x' }).success).toBe(false);
		expect(
			lessonEventSchema.safeParse({ type: 'stopped', reason: 'rate', retryAfter: -1 }).success
		).toBe(false);
	});

	it('refuses a card event whose answer is not a card', () => {
		expect(lessonEventSchema.safeParse({ type: 'card', card: 0, answer: {} }).success).toBe(false);
	});
});

describe('planEventSchema', () => {
	const plan = {
		conventions: 'Tykání',
		lessons: [{ lesson: 1, note: 'x' }],
		cards: [{ card: 1, brief: 'y' }]
	};

	it('accepts a plan with its turn, a failure and a stop', () => {
		expect(planEventSchema.safeParse({ type: 'plan', plan, turn }).success).toBe(true);
		expect(planEventSchema.safeParse({ type: 'failed', problem: 'busy' }).success).toBe(true);
		expect(
			planEventSchema.safeParse({ type: 'stopped', reason: 'budget', retryAfter: 5 }).success
		).toBe(true);
	});

	it('refuses a plan without conventions or without its turn', () => {
		expect(
			planEventSchema.safeParse({ type: 'plan', plan: { ...plan, conventions: ' ' }, turn }).success
		).toBe(false);
		expect(planEventSchema.safeParse({ type: 'plan', plan }).success).toBe(false);
		expect(planEventSchema.safeParse({ type: 'done' }).success).toBe(false);
	});
});
