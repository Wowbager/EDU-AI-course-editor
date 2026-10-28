import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCourse } from '../document';
import type { CourseV2, QuestionConfig } from '../schema';
import {
	addOption,
	deleteOption,
	markCorrect,
	reorderOptions,
	setAllowMultiple,
	setField,
	setQuestionType
} from '../commands';
import { optionOutcomesApply } from '../derive';
import { MIN_CHOICE_OPTIONS, validate } from '../validate';
import { UNKNOWN_SKILL_CONFIG } from '../skill-config';

/**
 * Whatever the author clicks on a question, in whatever order, the question stays one
 * the pupil can answer, and no issue points at an answer's field the editor hides.
 * Each command here is what a control in the step editor sends (`StepEditor`,
 * `AnswerTable`), with the same guards the controls have.
 */

const BLOCK = 'L1_B3_poznej';
const STEP = 's2';

const base = (): CourseV2 =>
	parseCourse(
		JSON.parse(
			readFileSync(
				fileURLToPath(new URL('./fixtures/spec-16-course.json', import.meta.url)),
				'utf8'
			)
		)
	);

const questionOf = (doc: CourseV2): QuestionConfig =>
	doc.blocks.find((b) => b.block_id === BLOCK)!.steps.find((s) => s.id === STEP)!.question!;

type Action =
	| { kind: 'type'; type: QuestionConfig['type'] }
	| { kind: 'multiple'; on: boolean }
	| { kind: 'mark'; at: number }
	| { kind: 'add' }
	| { kind: 'delete'; at: number }
	| { kind: 'reorder'; seed: number }
	| { kind: 'goTo'; at: number; to: string };

const action: fc.Arbitrary<Action> = fc.oneof(
	fc.record({
		kind: fc.constant('type' as const),
		type: fc.constantFrom('multiple_choice', 'true_false', 'open', 'numeric')
	}),
	fc.record({ kind: fc.constant('multiple' as const), on: fc.boolean() }),
	fc.record({ kind: fc.constant('mark' as const), at: fc.nat(9) }),
	fc.record({ kind: fc.constant('add' as const) }),
	fc.record({ kind: fc.constant('delete' as const), at: fc.nat(9) }),
	fc.record({ kind: fc.constant('reorder' as const), seed: fc.nat() }),
	fc.record({
		kind: fc.constant('goTo' as const),
		at: fc.nat(9),
		to: fc.constantFrom('s3', 'END', 'nikam', '')
	})
);

/** The action as the editor sends it, or the same document where no control offers it. */
function run(doc: CourseV2, a: Action): CourseV2 {
	const question = questionOf(doc);
	const options = question.options ?? [];
	const choice = question.type === 'multiple_choice';
	const pick = (at: number) => options[at % Math.max(options.length, 1)];
	switch (a.kind) {
		case 'type':
			return setQuestionType(doc, BLOCK, STEP, a.type).doc;
		case 'multiple':
			return choice ? setAllowMultiple(doc, BLOCK, STEP, a.on).doc : doc;
		case 'mark':
			return options.length > 0 ? markCorrect(doc, BLOCK, STEP, pick(a.at).id).doc : doc;
		case 'add':
			return choice ? addOption(doc, BLOCK, STEP).doc : doc;
		case 'delete':
			// The trash is disabled on the last answers a choice question needs.
			return choice && options.length > MIN_CHOICE_OPTIONS
				? deleteOption(doc, BLOCK, STEP, pick(a.at).id).doc
				: doc;
		case 'reorder': {
			if (!choice || options.length < 2) return doc;
			const ids = options.map((o) => o.id);
			const [moved] = ids.splice(a.seed % ids.length, 1);
			ids.splice((a.seed >> 3) % (ids.length + 1), 0, moved);
			return reorderOptions(doc, BLOCK, STEP, ids).doc;
		}
		case 'goTo':
			// "Kam dál" is offered only where the app reads it.
			if (options.length === 0 || !optionOutcomesApply(question)) return doc;
			return setField(
				doc,
				{ blockId: BLOCK, stepId: STEP, optionId: pick(a.at).id, field: 'go_to' },
				a.to || undefined
			).doc;
	}
}

const rightCount = (doc: CourseV2) =>
	(questionOf(doc).options ?? []).filter((o) => o.is_correct === true).length;

/**
 * What an answer's mark, count and hidden fields must look like after any click.
 * `none`: the author deleted the only right answer. Which other one is right is
 * theirs to say, so the question has none until they mark one, and the list says so.
 */
function check(doc: CourseV2, none: boolean) {
	const question = questionOf(doc);
	const right = rightCount(doc);
	if (none) expect(right).toBe(0);
	else if (question.type === 'true_false' || question.type === 'multiple_choice') {
		if (question.allow_multiple === true) expect(right).toBeGreaterThan(0);
		else expect(right).toBe(1);
	}

	const issues = (() => {
		const { errors, warnings } = validate(doc, UNKNOWN_SKILL_CONFIG);
		return [...errors, ...warnings].filter((i) => i.ref.blockId === BLOCK && i.ref.stepId === STEP);
	})();
	const shape = issues.filter(
		(i) => /^E_(MC|TF)_/.test(i.code) && i.code !== 'E_MC_EMPTY_OPTION_TEXT'
	);
	expect(shape.map((i) => i.code)).toEqual(none ? ['E_MC_NO_CORRECT'] : []);
	if (!optionOutcomesApply(question)) {
		const hidden = issues.filter((i) => i.ref.field === 'go_to' || i.ref.field === 'mark');
		expect(hidden.map((i) => i.code)).toEqual([]);
	}
}

describe('any sequence of edits to a question', () => {
	it('leaves it answerable, with no issue on a hidden field', () => {
		fc.assert(
			fc.property(fc.array(action, { maxLength: 25 }), (actions) => {
				let doc = base();
				let none = false;
				check(doc, none);
				for (const a of actions) {
					const before = rightCount(doc);
					doc = run(doc, a);
					const after = rightCount(doc);
					if (after > 0 || questionOf(doc).type !== 'multiple_choice') none = false;
					else if (a.kind === 'delete' && before > 0) none = true;
					check(doc, none);
				}
			}),
			{ numRuns: 200 }
		);
	});
});
