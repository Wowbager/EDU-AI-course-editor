import { describe, expect, it } from 'vitest';
import { addBlock, addLesson } from '../commands';
import { emptyCourse } from '../document';
import { BRIEF_KEY, SOURCE_REFS_KEY } from '../authoring';
import { applyPlan, buildPlanRequest, planProblem, planRequestSchema, type Plan } from '../plan';
import type { BlockV2, CourseV2 } from '../schema';

interface Fixture {
	doc: CourseV2;
	lessons: string[];
	/** Card ids: two in the first lesson, one in the second. */
	cards: string[];
}

function fixture(): Fixture {
	let doc: CourseV2 = { ...emptyCourse('KURZ', 'Zlomky'), language: 'cs' };
	doc = addLesson(doc, 'Polovina').doc;
	doc = addLesson(doc, 'Třetina').doc;
	const lessons = doc.lessons.map((l) => l.lesson_id);
	const cards: string[] = [];
	for (const [lesson, type, name] of [
		[lessons[0], 'display', 'Co je půlka'],
		[lessons[0], 'exercise', 'Příklady'],
		[lessons[1], 'question', 'Kvíz']
	] as const) {
		const added = addBlock(doc, lesson, type);
		doc = added.doc;
		cards.push(added.ref!.blockId!);
	}
	doc = withCard(doc, cards[0], { name: 'Co je půlka' });
	doc = withCard(doc, cards[1], { name: 'Příklady' });
	doc = withCard(doc, cards[2], { name: 'Kvíz' });
	return { doc, lessons, cards };
}

function withCard(doc: CourseV2, id: string, more: Record<string, unknown>): CourseV2 {
	return {
		...doc,
		blocks: doc.blocks.map((b) => (b.block_id === id ? ({ ...b, ...more } as BlockV2) : b))
	};
}

const refs = (f: Fixture, ids = f.cards) =>
	ids.map((blockId) => ({
		blockId,
		lessonId: f.doc.lessons.find((l) => l.blocks.some((b) => b.block_id === blockId))!.lesson_id
	}));

const briefOf = (doc: CourseV2, id: string) =>
	(doc.blocks.find((b) => b.block_id === id) as Record<string, unknown>)[BRIEF_KEY];
const noteOf = (doc: CourseV2, id: string) =>
	doc.lessons.find((l) => l.lesson_id === id)!.ai_context;

describe('buildPlanRequest', () => {
	it('numbers lessons and cards from 1 in course order and keeps the ids in targets', () => {
		const f = fixture();
		// Asked in another order than the course has.
		const built = buildPlanRequest(
			f.doc,
			refs(f, [f.cards[2], f.cards[0], f.cards[1]]),
			'dossier'
		)!;
		expect(built.targets).toEqual({ lessons: f.lessons, cards: f.cards });
		expect(built.request.lessons.map((l) => l.lesson)).toEqual([1, 2]);
		expect(built.request.lessons.map((l) => l.cards.map((c) => c.card))).toEqual([[1, 2], [3]]);
		expect(built.request.lessons[0]).toMatchObject({ name: 'Polovina' });
		expect(built.request.lessons[0].cards[1]).toMatchObject({
			kind: 'exercise',
			title: 'Příklady'
		});
		expect(built.request.course).toMatchObject({ title: 'Zlomky', language: 'cs' });
		expect(built.request.context).toBe('dossier');
		expect(planRequestSchema.safeParse(built.request).success).toBe(true);
	});

	it('leaves out lessons that hold none of the cards, and renumbers', () => {
		const f = fixture();
		const built = buildPlanRequest(f.doc, refs(f, [f.cards[2]]), '')!;
		expect(built.request.lessons).toHaveLength(1);
		expect(built.request.lessons[0]).toMatchObject({ lesson: 1, name: 'Třetina' });
		expect(built.request.lessons[0].cards[0].card).toBe(1);
		expect(built.targets).toEqual({ lessons: [f.lessons[1]], cards: [f.cards[2]] });
	});

	it('is undefined when none of the cards is in the course', () => {
		const f = fixture();
		expect(buildPlanRequest(f.doc, [{ blockId: 'GONE', lessonId: f.lessons[0] }], '')).toBe(
			undefined
		);
		expect(buildPlanRequest(f.doc, [], '')).toBe(undefined);
	});

	it("carries the teacher's brief and lesson note, trimmed, and nothing when there is none", () => {
		const f = fixture();
		let doc = withCard(f.doc, f.cards[0], { [BRIEF_KEY]: '  Půlka na koláči  ' });
		doc = withCard(doc, f.cards[1], { [BRIEF_KEY]: '   ' });
		doc = {
			...doc,
			lessons: doc.lessons.map((l, i) => (i === 0 ? { ...l, ai_context: ' Jen názorně ' } : l))
		};
		const { request } = buildPlanRequest(doc, refs(f), '')!;
		expect(request.lessons[0].note).toBe('Jen názorně');
		expect(request.lessons[0].cards[0].brief).toBe('Půlka na koláči');
		expect('brief' in request.lessons[0].cards[1]).toBe(false);
		expect('note' in request.lessons[1]).toBe(false);
	});

	it('sends sources only when materials are given', () => {
		const f = fixture();
		const doc = withCard(f.doc, f.cards[0], { [SOURCE_REFS_KEY]: ['abcdef01.2'] });
		const without = buildPlanRequest(doc, refs(f), '')!.request;
		expect(JSON.stringify(without)).not.toContain('abcdef01.2');
		expect('materials' in without).toBe(false);
		const withMaterials = buildPlanRequest(doc, refs(f), '', 'The materials in full: …')!.request;
		expect(withMaterials.materials).toBe('The materials in full: …');
		expect(withMaterials.lessons[0].cards[0].sources).toEqual(['abcdef01.2']);
		expect('sources' in withMaterials.lessons[0].cards[1]).toBe(false);
	});

	it('plans a card that stands in two lessons once, where it first stands', () => {
		const f = fixture();
		const doc: CourseV2 = {
			...f.doc,
			lessons: f.doc.lessons.map((l, i) =>
				i === 1 ? { ...l, blocks: [...l.blocks, { block_id: f.cards[0] }] } : l
			)
		};
		const built = buildPlanRequest(doc, refs(f), '')!;
		expect(built.targets.cards).toEqual(f.cards);
		expect(built.request.lessons[1].cards.map((c) => c.card)).toEqual([3]);
	});

	it('never shows a block id or a lesson id to the model', () => {
		const f = fixture();
		const doc = withCard(f.doc, f.cards[0], { [SOURCE_REFS_KEY]: ['abcdef01.2'] });
		const { request } = buildPlanRequest(doc, refs(f), 'ctx', 'materials')!;
		const json = JSON.stringify(request);
		for (const id of [...f.cards, ...f.lessons, 'KURZ']) expect(json).not.toContain(id);
	});
});

describe('planProblem', () => {
	const f = fixture();
	const { request } = buildPlanRequest(f.doc, refs(f), '')!;
	const good: Plan = {
		conventions: 'Desetinná čárka',
		lessons: [{ lesson: 1, note: 'Názorně' }],
		cards: [
			{ card: 1, brief: 'a' },
			{ card: 2, brief: 'b' },
			{ card: 3, brief: 'c' }
		]
	};

	it('accepts a plan with every card once', () => {
		expect(planProblem(request, good)).toBe(undefined);
	});

	it('names a missing card, a repeated one, an unknown one and an empty brief', () => {
		expect(planProblem(request, { ...good, cards: good.cards.slice(0, 2) })).toMatch(/card 3/);
		expect(
			planProblem(request, { ...good, cards: [...good.cards, { card: 2, brief: 'x' }] })
		).toMatch(/Card 2 appears more than once/);
		expect(
			planProblem(request, { ...good, cards: [...good.cards, { card: 9, brief: 'x' }] })
		).toMatch(/card 9, which is not in the request/);
		expect(
			planProblem(request, { ...good, cards: [{ card: 1, brief: '  ' }, ...good.cards.slice(1)] })
		).toMatch(/brief of card 1 is empty/);
	});

	it('names an unknown lesson', () => {
		expect(planProblem(request, { ...good, lessons: [{ lesson: 5, note: 'x' }] })).toMatch(
			/lesson 5/
		);
	});
});

describe('applyPlan', () => {
	const plan: Plan = {
		conventions: 'Desetinná čárka, tykání.',
		lessons: [
			{ lesson: 1, note: 'Jen názorně.' },
			{ lesson: 2, note: 'Pozor na jmenovatele.' }
		],
		cards: [
			{ card: 1, brief: 'Půlka na koláči' },
			{ card: 2, brief: 'Tři příklady' },
			{ card: 3, brief: 'Zaměř na záměnu čitatele' }
		]
	};

	function planned(f = fixture()) {
		const { targets } = buildPlanRequest(f.doc, refs(f), '')!;
		return { f, targets };
	}

	it('fills the course note, the lesson notes and the briefs where they are empty', () => {
		const { f, targets } = planned();
		const { doc } = applyPlan(f.doc, plan, targets);
		expect(doc.ai_context).toBe('Desetinná čárka, tykání.');
		expect(noteOf(doc, f.lessons[0])).toBe('Jen názorně.');
		expect(noteOf(doc, f.lessons[1])).toBe('Pozor na jmenovatele.');
		expect(briefOf(doc, f.cards[0])).toBe('Půlka na koláči');
		expect(briefOf(doc, f.cards[2])).toBe('Zaměř na záměnu čitatele');
	});

	it("never overwrites the teacher's text, and whitespace counts as empty", () => {
		const f = fixture();
		let doc: CourseV2 = { ...f.doc, ai_context: 'Moje pravidla' };
		doc = {
			...doc,
			lessons: doc.lessons.map((l, i) =>
				i === 0 ? { ...l, ai_context: 'Můj záměr' } : { ...l, ai_context: '  \n ' }
			)
		};
		doc = withCard(doc, f.cards[0], { [BRIEF_KEY]: 'Můj brief' });
		doc = withCard(doc, f.cards[1], { [BRIEF_KEY]: '   ' });
		const { targets } = planned(f);
		const out = applyPlan(doc, plan, targets).doc;
		expect(out.ai_context).toBe('Moje pravidla');
		expect(noteOf(out, f.lessons[0])).toBe('Můj záměr');
		expect(noteOf(out, f.lessons[1])).toBe('Pozor na jmenovatele.');
		expect(briefOf(out, f.cards[0])).toBe('Můj brief');
		expect(briefOf(out, f.cards[1])).toBe('Tři příklady');
	});

	it('is idempotent: a second application returns the same document', () => {
		const { f, targets } = planned();
		const once = applyPlan(f.doc, plan, targets).doc;
		const twice = applyPlan(once, plan, targets).doc;
		expect(twice).toBe(once);
	});

	it('returns the same document object when nothing changes', () => {
		const { f, targets } = planned();
		const empty: Plan = { conventions: '', lessons: [], cards: [] };
		expect(applyPlan(f.doc, empty, targets).doc).toBe(f.doc);
	});

	it('changes nothing when none of the planned cards is in the document', () => {
		const { f } = planned();
		const out = applyPlan(f.doc, plan, { lessons: ['X1'], cards: ['X2', 'X3', 'X4'] }).doc;
		expect(out).toBe(f.doc);
		expect(out.ai_context).toBe(undefined);
	});

	it('ignores numbers the targets do not know', () => {
		const { f, targets } = planned();
		const odd: Plan = {
			conventions: '',
			lessons: [{ lesson: 7, note: 'x' }],
			cards: [{ card: 8, brief: 'x' }]
		};
		expect(applyPlan(f.doc, odd, targets).doc).toBe(f.doc);
	});

	it('does not touch other fields of the cards', () => {
		const { f, targets } = planned();
		const out = applyPlan(f.doc, plan, targets).doc;
		for (const b of f.doc.blocks) {
			const after = out.blocks.find((x) => x.block_id === b.block_id)!;
			expect({ ...after, [BRIEF_KEY]: undefined }).toEqual({ ...b, [BRIEF_KEY]: undefined });
		}
	});
});
