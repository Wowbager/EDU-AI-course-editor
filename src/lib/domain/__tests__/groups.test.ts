import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importCourse, parseCourse, serialise } from '../document';
import { addStep, deleteStep, reorderSteps, setField, addBlock, CommandError } from '../commands';
import {
	GROUP_KEY,
	MEMBERS_KEY,
	TOGETHER_KEY,
	blockOfStep,
	cardIdOf,
	fromView,
	groupOf,
	groupsOf,
	mergeQuestionCard,
	questionCount,
	segmentSteps,
	splitQuestionCard,
	splitQuestionCards,
	toView
} from '../groups';
import { buildIndex } from '../index-doc';
import { validate } from '../validate';
import type { BlockStep, BlockV2, CourseV2 } from '../schema';

const fixture = (path: string): CourseV2 =>
	importCourse(JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8'))).doc;

const text = (id: string, content = id): BlockStep => ({ id, type: 'text', content });
const question = (id: string, goTo: (string | undefined)[] = [undefined, undefined]): BlockStep => ({
	id,
	type: 'question',
	question: {
		type: 'multiple_choice',
		options: goTo.map((go_to, i) => ({
			id: `${id}o${i}`,
			text: `${id} ${i}`,
			is_correct: i === 0,
			...(go_to !== undefined ? { go_to } : {})
		}))
	}
});

const course = (blocks: BlockV2[], lessons = [{ lesson_id: 'L1', blocks: blocks.map((b, i) => ({ block_id: b.block_id, order: i + 1 })) }]): CourseV2 =>
	parseCourse({ export_type: 'course_v2', course_id: 'C', lessons, blocks });

/** Edit the teacher's view with a command and write it back, as the store does. */
function edit(doc: CourseV2, command: (view: CourseV2) => CourseV2): CourseV2 {
	const view = toView(doc);
	return fromView(doc, view, command(view));
}

const stepIds = (block: BlockV2) => block.steps.map((s) => s.id);
const lesson = (doc: CourseV2, id = 'L1') => doc.lessons.find((l) => l.lesson_id === id)!.blocks.map((b) => b.block_id);

describe('a card with one question is a block like any other', () => {
	it('shows the document itself when nothing is grouped', () => {
		const doc = course([{ block_id: 'B1', type: 'question', steps: [text('s1'), question('s2')] }]);
		expect(toView(doc)).toBe(doc);
	});

	it('writes an edit straight through when nothing needs splitting', () => {
		const doc = course([{ block_id: 'B1', type: 'question', steps: [text('s1'), question('s2')] }]);
		const after = edit(doc, (v) => setField(v, { blockId: 'B1', stepId: 's1', field: 'content' }, 'Nový text').doc);
		expect(after.blocks[0].steps[0].content).toBe('Nový text');
		expect(groupOf(after.blocks[0])).toBeUndefined();
	});
});

describe('a second question makes the card two blocks, and the teacher still sees one card', () => {
	const doc = course([
		{ block_id: 'B1', type: 'exercise', name: 'Sčítání', hint: 'Sečti čitatele.', duration: '3 min', steps: [text('s1'), question('s2')] },
		{ block_id: 'B2', type: 'display', steps: [text('s1')] }
	]);
	const after = edit(doc, (v) => {
		const withText = addStep(v, 'B1', 'text').doc;
		return addStep(withText, 'B1', 'question').doc;
	});

	it('writes one block per question, in the card order', () => {
		expect(after.blocks.map((b) => b.block_id)).toEqual(['B1', 'B1_2', 'B2']);
		expect(after.blocks.slice(0, 2).map(questionCount)).toEqual([1, 1]);
		expect(stepIds(after.blocks[0])).toEqual(['s1', 's2']);
		expect(stepIds(after.blocks[1])).toEqual(['s3', 's4']);
	});

	it('marks both as one card, and gives each the card’s settings', () => {
		expect(after.blocks.slice(0, 2).map(groupOf)).toEqual(['B1', 'B1']);
		for (const block of after.blocks.slice(0, 2)) {
			expect(block.type).toBe('exercise');
			expect(block.name).toBe('Sčítání');
			expect(block.hint).toBe('Sečti čitatele.');
		}
		// A lesson's length is the sum of its blocks, so the card's time is not copied.
		expect(after.blocks[0].duration).toBe('3 min');
		expect(after.blocks[1].duration).toBeUndefined();
	});

	it('binds both blocks where the card was bound', () => {
		expect(lesson(after)).toEqual(['B1', 'B1_2', 'B2']);
		expect(after.lessons[0].blocks.map((b) => b.order)).toEqual([1, 2, 3]);
	});

	it('shows the teacher the one card they edited', () => {
		const view = toView(after);
		expect(view.blocks.map((b) => b.block_id)).toEqual(['B1', 'B2']);
		expect(stepIds(view.blocks[0])).toEqual(['s1', 's2', 's3', 's4']);
		expect(lesson(view)).toEqual(['B1', 'B2']);
		expect(membersOfView(view, 'B1')).toEqual(['B1', 'B1_2']);
	});

	it('exports no view-only keys', () => {
		expect(JSON.stringify(serialise(after))).not.toContain(MEMBERS_KEY);
	});
});

const membersOfView = (view: CourseV2, id: string) =>
	(view.blocks.find((b) => b.block_id === id) as Record<string, unknown>)[MEMBERS_KEY];

describe('the lens changes nothing it was not asked to', () => {
	const doc = splitQuestionCards(fixture('corpus/zlomky-5-trida.json')).doc;

	it('writes back an edit that changed nothing as the same document', () => {
		const view = toView(doc);
		expect(fromView(doc, view, view)).toBe(doc);
	});

	it('keeps every block of an untouched card, object for object', () => {
		const after = edit(doc, (v) => setField(v, { field: 'name' }, 'Jiný název').doc);
		expect(after.name).toBe('Jiný název');
		expect(after.blocks).toBe(doc.blocks);
		expect(after.lessons).toBe(doc.lessons);
	});

	it('rewrites only the card that was edited', () => {
		const card = toView(doc).blocks.find((b) => b.block_id === 'L1_B4_cviceni')!;
		const after = edit(doc, (v) =>
			setField(v, { blockId: card.block_id, stepId: card.steps[0].id, field: 'content' }, 'Nové zadání').doc
		);
		const changed = after.blocks.filter((b, i) => b !== doc.blocks[i]).map((b) => b.block_id);
		expect(changed).toEqual(['L1_B4_cviceni']);
		expect(after.lessons).toStrictEqual(doc.lessons);
	});
});

describe('where a card breaks into blocks', () => {
	it('keeps text after the last question with it', () => {
		const card: BlockV2 = { block_id: 'B', type: 'exercise', steps: [text('a'), question('q1'), text('b'), question('q2'), text('c')] };
		expect(segmentSteps(card).map((s) => s.map((x) => x.id))).toEqual([['a', 'q1'], ['b', 'q2', 'c']]);
	});

	it('starts a block where a question card jumps to, because a jump lands on a block’s first step', () => {
		const card: BlockV2 = { block_id: 'B', type: 'question', steps: [question('q1', ['c', 'b']), text('b'), question('q2'), text('c')] };
		expect(segmentSteps(card).map((s) => s.map((x) => x.id))).toEqual([['q1'], ['b', 'q2'], ['c']]);
	});

	it('ignores jumps in an exercise card, which the app ignores too', () => {
		const card: BlockV2 = { block_id: 'B', type: 'exercise', steps: [question('q1', ['c']), text('b'), question('q2'), text('c')] };
		expect(segmentSteps(card).map((s) => s.map((x) => x.id))).toEqual([['q1'], ['b', 'q2', 'c']]);
	});

	it('turns a jump inside the card into a jump to the block that holds the target', () => {
		const doc = course([{ block_id: 'B1', type: 'question', steps: [question('q1', ['q2', undefined]), text('t'), question('q2')] }]);
		const after = edit(doc, (v) => ({ ...v, blocks: v.blocks.map((b) => ({ ...b })) }));
		expect(after.blocks.map((b) => b.block_id)).toEqual(['B1', 'B1_2', 'B1_3']);
		expect(after.blocks[0].steps[0].question!.options![0].go_to).toBe('B1_3');
		// And the teacher still reads it as a jump to the question.
		expect(toView(after).blocks[0].steps[0].question!.options![0].go_to).toBe('q2');
		expect(after.blocks[2].type).toBe('question');
		expect(after.blocks[1].type).toBe('display');
	});
});

describe('a block keeps its id as long as its question does', () => {
	const two = edit(
		course([
			{ block_id: 'B1', type: 'exercise', steps: [text('s1'), question('s2'), text('s3'), question('s4')] },
			{ block_id: 'B2', type: 'question', steps: [question('p', ['B1', undefined])] }
		]),
		(v) => ({ ...v, blocks: v.blocks.map((b) => ({ ...b })) })
	);

	it('moves a block with its question when the questions are reordered', () => {
		const after = edit(two, (v) => reorderSteps(v, 'B1', ['s3', 's4', 's1', 's2']).doc);
		expect(after.blocks.slice(0, 2).map((b) => [b.block_id, stepIds(b)])).toEqual([
			['B1_2', ['s3', 's4']],
			['B1', ['s1', 's2']]
		]);
	});

	it('keeps the card and what points at it when its first question is deleted', () => {
		let after = edit(two, (v) => deleteStep(v, 'B1', 's2').doc);
		after = edit(after, (v) => deleteStep(v, 'B1', 's1').doc);
		expect(after.blocks.map((b) => b.block_id)).toEqual(['B1_2', 'B2']);
		expect(groupOf(after.blocks[0])).toBe('B1');
		expect(after.blocks[1].steps[0].question!.options![0].go_to).toBe('B1_2');
		expect(lesson(after)).toEqual(['B1_2', 'B2']);
		// The teacher's card is still the card they had.
		expect(toView(after).blocks.map((b) => b.block_id)).toEqual(['B1', 'B2']);
		expect(toView(after).blocks[1].steps[0].question!.options![0].go_to).toBe('B1');
	});
});

describe('importing a course that has several questions in one block', () => {
	const original = fixture('corpus/zlomky-5-trida.json');
	const { doc, split, keptTogether } = splitQuestionCards(original);

	it('splits the drills, and keeps whole the cards that branch inside themselves', () => {
		expect(split).toEqual(['L1_B4_cviceni', 'L2_B5_cviceni', 'L3_B5_cviceni', 'L4_B4_cviceni', 'L5_B4_cviceni']);
		expect(keptTogether).toEqual(['L3_B3_mc', 'L5_B3_pizza']);
		for (const block of doc.blocks) {
			if (block[TOGETHER_KEY as keyof BlockV2] === true) continue;
			expect(questionCount(block), block.block_id).toBeLessThanOrEqual(1);
		}
	});

	it('shows the teacher every card as it was authored', () => {
		const view = toView(doc);
		expect(view.blocks.map((b) => b.block_id)).toEqual(original.blocks.map((b) => b.block_id));
		for (const card of view.blocks) {
			const before = original.blocks.find((b) => b.block_id === card.block_id)!;
			expect(card.steps.map((s) => s.id), card.block_id).toEqual(before.steps.map((s) => s.id));
		}
		expect(view.lessons.map((l) => l.blocks.map((b) => b.block_id))).toEqual(
			original.lessons.map((l) => l.blocks.map((b) => b.block_id))
		);
	});

	it('binds each question’s block in the lesson, next to each other', () => {
		expect(lesson(doc, 'L1_INTRO')).toEqual(['L1_B1_uvod', 'L1_B2_casti', 'L1_B3_poznej', 'L1_B4_cviceni', 'L1_B4_cviceni_2', 'L1_B5_shrn']);
	});

	it('is done once: splitting the result again changes nothing', () => {
		expect(splitQuestionCards(doc).doc).toBe(doc);
	});

	it('validates the same in the teacher’s view as in the document', () => {
		const codes = (d: CourseV2) => validate(d).errors.map((i) => i.code).sort();
		expect(codes(toView(doc))).toEqual(codes(doc));
	});

	it('resolves a branch into any of a card’s blocks through the card', () => {
		const view = toView(doc);
		const index = buildIndex(view);
		expect(index.blocksById.get('L1_B4_cviceni_2')?.block_id).toBe('L1_B4_cviceni');
	});
});

describe('the advanced toggle', () => {
	const { doc } = splitQuestionCards(fixture('corpus/zlomky-5-trida.json'));

	it('merges a card into one block that keeps its questions together, and splits it back', () => {
		const merged = mergeQuestionCard(doc, 'L1_B4_cviceni');
		const block = merged.blocks.find((b) => b.block_id === 'L1_B4_cviceni')!;
		expect(questionCount(block)).toBe(2);
		expect((block as Record<string, unknown>)[TOGETHER_KEY]).toBe(true);
		expect((block as Record<string, unknown>)[GROUP_KEY]).toBeUndefined();
		expect(merged.blocks.some((b) => b.block_id === 'L1_B4_cviceni_2')).toBe(false);
		expect(lesson(merged, 'L1_INTRO')).toContain('L1_B4_cviceni');
		expect(lesson(merged, 'L1_INTRO')).not.toContain('L1_B4_cviceni_2');

		const again = splitQuestionCard(merged, 'L1_B4_cviceni');
		expect(groupsOf(again).get('L1_B4_cviceni')?.map((b) => b.block_id)).toEqual(['L1_B4_cviceni', 'L1_B4_cviceni_2']);
	});

	it('leaves a kept-together card whole when the teacher adds a question to it', () => {
		const after = edit(doc, (v) => addStep(v, 'L3_B3_mc', 'question').doc);
		const block = after.blocks.find((b) => b.block_id === 'L3_B3_mc')!;
		expect(questionCount(block)).toBe(3);
		expect(after.blocks.some((b) => groupOf(b) === 'L3_B3_mc')).toBe(false);
	});
});

describe('refs between the view and the document', () => {
	const { doc } = splitQuestionCards(fixture('corpus/zlomky-5-trida.json'));

	it('finds the block that holds a step of a card, and the card of a block', () => {
		expect(blockOfStep(doc, 'L1_B4_cviceni', 's4')).toBe('L1_B4_cviceni_2');
		expect(blockOfStep(doc, 'L1_B4_cviceni', 's1')).toBe('L1_B4_cviceni');
		expect(cardIdOf(doc, 'L1_B4_cviceni_2')).toBe('L1_B4_cviceni');
		expect(cardIdOf(doc, 'L1_B1_uvod')).toBe('L1_B1_uvod');
	});
});

describe('random edits keep the document well-formed', () => {
	// A small, seeded generator: the same run every time, so a failure repeats.
	function rng(seed: number) {
		return () => {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			return seed / 2 ** 31;
		};
	}

	it('never leaves two questions in a block, a card split across a lesson, or a step lost', () => {
		const random = rng(7);
		let doc = course([
			{ block_id: 'B1', type: 'exercise', steps: [text('s1'), question('s2')] },
			{ block_id: 'B2', type: 'question', steps: [text('s1'), question('s2')] }
		]);
		for (let round = 0; round < 300; round++) {
			const view = toView(doc);
			const card = view.blocks[Math.floor(random() * view.blocks.length)];
			const pick = random();
			let edited: CourseV2;
			try {
				if (pick < 0.35) edited = addStep(view, card.block_id, random() < 0.5 ? 'question' : 'text', Math.floor(random() * (card.steps.length + 1))).doc;
				else if (pick < 0.6 && card.steps.length > 1) edited = deleteStep(view, card.block_id, card.steps[Math.floor(random() * card.steps.length)].id).doc;
				else if (pick < 0.85) {
					const ids = card.steps.map((s) => s.id).sort(() => random() - 0.5);
					edited = reorderSteps(view, card.block_id, ids).doc;
				} else if (view.blocks.length < 5) {
					const added = addBlock(view, 'L1', random() < 0.5 ? 'exercise' : 'question');
					edited = added.doc;
				} else continue;
			} catch (error) {
				// Commands refuse some edits on purpose (a step something still jumps to);
				// anything else is a bug in the test or the command.
				if (!(error instanceof CommandError)) throw error;
				continue;
			}
			const expected = toView(edited === view ? view : edited);
			doc = fromView(doc, view, edited);

			const after = toView(doc);
			// The teacher sees exactly the steps they edited, in their order.
			for (const want of expected.blocks) {
				const got = after.blocks.find((b) => b.block_id === want.block_id);
				expect(got?.steps.map((s) => s.id), `round ${round}, card ${want.block_id}`).toEqual(want.steps.map((s) => s.id));
			}
			for (const block of doc.blocks) expect(questionCount(block), `round ${round}`).toBeLessThanOrEqual(1);
			for (const [key, members] of groupsOf(doc)) {
				const bound = lesson(doc).filter((id) => members.some((m) => m.block_id === id));
				if (bound.length === 0) continue;
				const at = lesson(doc).indexOf(bound[0]);
				expect(lesson(doc).slice(at, at + bound.length), `round ${round}, card ${key}`).toEqual(members.map((m) => m.block_id));
			}
			const ids = doc.blocks.map((b) => b.block_id);
			expect(new Set(ids).size, `round ${round}`).toBe(ids.length);
		}
		// The run did exercise the interesting cases.
		expect(toView(doc).blocks.length).toBeGreaterThan(2);
		expect(groupsOf(doc).size).toBeGreaterThan(0);
	});
});
