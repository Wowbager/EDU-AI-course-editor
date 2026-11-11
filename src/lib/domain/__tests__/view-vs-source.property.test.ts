import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseCourse } from '../document';
import { CommandError, addStep, deleteStep, reorderSteps, setField } from '../commands';
import { MEMBERS_KEY, fromView, splitQuestionCards, toView } from '../groups';
import { validate } from '../validate';
import type { CourseV2 } from '../schema';

/**
 * Whatever the teacher does to the steps of a question card, in whatever order, the
 * card they see and the blocks that are exported stay two readings of one course:
 * the same steps in the same order, nothing of the view written into the file, and
 * a file the view can be rebuilt from without changing it.
 *
 * It also holds the line on what the exported course may have wrong that the view
 * does not show (`view-vs-source.test.ts`): today exactly one error, and no other may
 * join it unnoticed.
 */

const CARD = 'K';

const question = (id: string) => ({
	id,
	type: 'question',
	content: `Otázka ${id}`,
	question: {
		type: 'multiple_choice',
		options: [0, 1].map((i) => ({ id: `${id}o${i}`, text: `${id} ${i}`, is_correct: i === 0 }))
	}
});

/** A card already in two blocks, so every run starts where the two readings differ. */
const base = (): CourseV2 =>
	splitQuestionCards(
		parseCourse({
			export_type: 'course_v2',
			course_id: 'C',
			lessons: [{ lesson_id: 'L1', blocks: [{ block_id: CARD, order: 1 }] }],
			blocks: [
				{
					block_id: CARD,
					type: 'question',
					name: 'Karta',
					steps: [question('q1'), question('q2'), { id: 't', type: 'text', content: 'Závěr' }]
				}
			]
		})
	).doc;

type Action =
	| { kind: 'add'; type: 'text' | 'question'; at: number }
	| { kind: 'delete'; at: number }
	| { kind: 'move'; from: number; to: number }
	| { kind: 'write'; at: number; content: string }
	| { kind: 'jump'; from: number; option: number; to: number | 'END' | null };

const action: fc.Arbitrary<Action> = fc.oneof(
	fc.record({
		kind: fc.constant('add' as const),
		type: fc.constantFrom('text' as const, 'question' as const),
		at: fc.nat(8)
	}),
	fc.record({ kind: fc.constant('delete' as const), at: fc.nat(8) }),
	fc.record({ kind: fc.constant('move' as const), from: fc.nat(8), to: fc.nat(8) }),
	fc.record({
		kind: fc.constant('write' as const),
		at: fc.nat(8),
		content: fc.constantFrom('', 'Text')
	}),
	fc.record({
		kind: fc.constant('jump' as const),
		from: fc.nat(8),
		option: fc.nat(3),
		to: fc.oneof(fc.nat(8), fc.constant('END' as const), fc.constant(null))
	})
);

const cardOf = (view: CourseV2) => view.blocks.find((b) => b.block_id === CARD)!;

/** The action on the view, as the editor sends it; the same view where it cannot. */
function run(view: CourseV2, a: Action): CourseV2 {
	const steps = cardOf(view).steps;
	const pick = (at: number) => steps[at % steps.length];
	switch (a.kind) {
		case 'add':
			return addStep(view, CARD, a.type, a.at % (steps.length + 1)).doc;
		case 'delete':
			if (steps.length < 2) return view;
			try {
				return deleteStep(view, CARD, pick(a.at).id).doc;
			} catch (e) {
				// A step answers still lead to is not deleted without saying where they go.
				if (e instanceof CommandError) return view;
				throw e;
			}
		case 'move': {
			const ids = steps.map((s) => s.id);
			const [moved] = ids.splice(a.from % ids.length, 1);
			ids.splice(a.to % (ids.length + 1), 0, moved);
			return reorderSteps(view, CARD, ids).doc;
		}
		case 'write':
			return setField(view, { blockId: CARD, stepId: pick(a.at).id, field: 'content' }, a.content)
				.doc;
		case 'jump': {
			const from = pick(a.from);
			const options = from.question?.options ?? [];
			if (options.length === 0) return view;
			const to = a.to === null ? undefined : a.to === 'END' ? 'END' : pick(a.to).id;
			if (to === from.id) return view;
			return setField(
				view,
				{
					blockId: CARD,
					stepId: from.id,
					optionId: options[a.option % options.length].id,
					field: 'go_to'
				},
				to
			).doc;
		}
	}
}

/** Errors the exported course has and the teacher's view does not, by code. */
const KNOWN_SOURCE_ONLY = new Set(['E_DISPLAY_NO_TEXT']);

function check(source: CourseV2) {
	const view = toView(source);

	// One course: the card's steps are the blocks' steps, in order.
	const exported = source.blocks.flatMap((b) => b.steps.map((s) => s.id));
	expect(exported).toEqual(cardOf(view).steps.map((s) => s.id));

	// Nothing of the view is in the file.
	for (const block of source.blocks) expect(block).not.toHaveProperty(MEMBERS_KEY);

	// Writing the view back untouched, or with the card merely copied, changes nothing.
	expect(fromView(source, view, view)).toBe(source);
	const copied = { ...view, blocks: view.blocks.map((b) => ({ ...b })) };
	expect(fromView(source, view, copied)).toEqual(source);

	const inView = new Set(validate(view).errors.map((i) => i.code));
	const sourceOnly = validate(source)
		.errors.map((i) => i.code)
		.filter((code) => !inView.has(code));
	expect(sourceOnly.filter((code) => !KNOWN_SOURCE_ONLY.has(code))).toEqual([]);
}

describe('any sequence of edits to the steps of a question card', () => {
	it('keeps the card and its exported blocks one course', () => {
		fc.assert(
			fc.property(fc.array(action, { maxLength: 20 }), (actions) => {
				let source = base();
				check(source);
				for (const a of actions) {
					const view = toView(source);
					source = fromView(source, view, run(view, a));
					check(source);
				}
			}),
			{ numRuns: 300 }
		);
	});
});
