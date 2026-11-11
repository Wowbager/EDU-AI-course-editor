import { describe, expect, it } from 'vitest';
import { parseCourse } from '../document';
import { setField } from '../commands';
import { fromView, splitQuestionCards, toView } from '../groups';
import { validate } from '../validate';
import type { BlockStep, BlockV2, CourseV2 } from '../schema';

/**
 * The editor validates the teacher's view of the course (each question card as one
 * card), and exports the source (each question as its own block). This file pins
 * where the two are judged differently today.
 *
 * Every `KNOWN GAP` test asserts the behaviour as it is, not as it should be: the
 * source is what the pupil gets, so an error only the source has is a course that
 * exports broken, and a warning only the view has is advice about a problem the
 * pupil never meets. A change that closes a gap flips that test's expectation, in
 * the same commit.
 */

const text = (id: string, content = id): BlockStep => ({ id, type: 'text', content });
const question = (id: string): BlockStep => ({
	id,
	type: 'question',
	content: `Otázka ${id}`,
	question: {
		type: 'multiple_choice',
		options: [0, 1].map((i) => ({
			id: `${id}o${i}`,
			text: `${id} ${i}`,
			is_correct: i === 0,
			feedback: 'Proto.'
		}))
	}
});

const course = (blocks: BlockV2[]): CourseV2 =>
	parseCourse({
		export_type: 'course_v2',
		course_id: 'C',
		lessons: [
			{ lesson_id: 'L1', blocks: blocks.map((b, i) => ({ block_id: b.block_id, order: i + 1 })) }
		],
		blocks
	});

/** A card as an import leaves it: every question in its own block. */
const split = (doc: CourseV2): CourseV2 => splitQuestionCards(doc).doc;

/** Edit the teacher's view with a command and write it back, as the store does. */
const edit = (doc: CourseV2, command: (view: CourseV2) => CourseV2): CourseV2 => {
	const view = toView(doc);
	return fromView(doc, view, command(view));
};

/** The first answer of `from` in card K leads to step `to`. */
const jump = (from: string, to: string) => (view: CourseV2) =>
	setField(view, { blockId: 'K', stepId: from, optionId: `${from}o0`, field: 'go_to' }, to).doc;

const shape = (doc: CourseV2) =>
	doc.blocks.map((b) => [b.block_id, b.type, b.steps.map((s) => s.id).join(' ')]);
const errors = (doc: CourseV2) => validate(doc).errors.map((i) => i.code);
const warnings = (doc: CourseV2) => validate(doc).warnings.map((i) => i.code);

describe('a card with nothing unusual is judged the same either way', () => {
	const source = split(
		course([
			{ block_id: 'K', type: 'question', steps: [question('q1'), question('q2'), text('t')] }
		])
	);

	it('is two blocks in the source and one card in the view', () => {
		expect(shape(source)).toEqual([
			['K', 'question', 'q1'],
			['K_2', 'question', 'q2 t']
		]);
		expect(toView(source).blocks).toHaveLength(1);
	});

	it('has no issue in either', () => {
		expect(validate(source)).toMatchObject({ errors: [], warnings: [] });
		expect(validate(toView(source))).toMatchObject({ errors: [], warnings: [] });
	});
});

describe('KNOWN GAP: an error only the exported course has', () => {
	it('a jump onto an empty closing text makes it a text card with no text', () => {
		const before = split(
			course([
				{ block_id: 'K', type: 'question', steps: [question('q1'), question('q2'), text('t', '')] }
			])
		);
		const source = edit(before, jump('q1', 't'));

		// The jump's target has to start a block, so the empty text becomes one of its own.
		expect(shape(source)).toEqual([
			['K', 'question', 'q1'],
			['K_2', 'question', 'q2'],
			['K_3', 'display', 't']
		]);
		expect(errors(source)).toEqual(['E_DISPLAY_NO_TEXT']);
		expect(errors(toView(source))).toEqual([]);
	});

	it('a prerequisite loop through the second question of a card', () => {
		const needs = (block_id: string) => ({ prerequisites: [{ block_id, min_level: 1 }] });
		const cards = split(
			course([
				{
					block_id: 'K',
					type: 'question',
					learning: needs('P'),
					steps: [question('q1'), question('q2')]
				},
				{ block_id: 'P', type: 'display', steps: [text('p')] }
			])
		);
		// As the advanced mode can write it: P waits for the card's second block.
		const source: CourseV2 = {
			...cards,
			blocks: cards.blocks.map((b) => (b.block_id === 'P' ? { ...b, learning: needs('K_2') } : b))
		};

		expect(errors(source)).toEqual(['E_PREREQ_CYCLE']);
		expect(errors(toView(source))).toEqual([]);
	});
});

describe('KNOWN GAP: a warning only the exported course has', () => {
	it('a question of a card that no lesson holds any more', () => {
		const cards = split(
			course([{ block_id: 'K', type: 'question', steps: [question('q1'), question('q2')] }])
		);
		// As the advanced mode can leave it: the second block taken out of the lesson.
		const source: CourseV2 = {
			...cards,
			lessons: cards.lessons.map((l) => ({ ...l, blocks: l.blocks.slice(0, 1) }))
		};

		expect(warnings(source)).toEqual(['W_ORPHAN_BLOCK']);
		expect(warnings(toView(source))).toEqual([]);
	});
});

describe('KNOWN GAP: a warning only the view has', () => {
	it('a jump between the questions of a card is said never to be taken', () => {
		const before = split(
			course([
				{ block_id: 'K', type: 'question', steps: [question('q1'), question('q2'), question('q3')] }
			])
		);
		const source = edit(before, jump('q1', 'q3'));

		// Three blocks, each checked on its own: the app does take the jump.
		expect(shape(source)).toEqual([
			['K', 'question', 'q1'],
			['K_2', 'question', 'q2'],
			['K_3', 'question', 'q3']
		]);
		expect(warnings(source)).toEqual([]);
		expect(warnings(toView(source))).toEqual(['W_GOTO_IN_ONE_TAP']);
	});
});
