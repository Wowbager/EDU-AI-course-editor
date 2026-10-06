import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	fieldKey,
	heldBack,
	HELD_WITH_FEEDBACK,
	isVisible,
	issueKey,
	madeUnreachable,
	validationDelta,
	TIMING,
	timingOf,
	type Touched
} from '$lib/ui/issue-visibility';
import type { Issue } from '../validate';
import { parseCourse } from '../document';
import { setField } from '../commands';

const nothing: Touched = { cards: new Set(), fields: new Set() };

const issue = (code: string, ref: Issue['ref'], severity: Issue['severity'] = 'error'): Issue => ({
	code,
	severity,
	ref,
	message: code
});

describe('the timing table', () => {
	// Read off the validator's source, so a new code cannot ship without someone
	// deciding when a teacher should see it.
	const source = readFileSync(fileURLToPath(new URL('../validate.ts', import.meta.url)), 'utf8');
	const codes = [...new Set([...source.matchAll(/'([EW]_[A-Z0-9_]+)'/g)].map((m) => m[1]))];

	it('classifies every code the validator can emit', () => {
		expect(codes.length).toBeGreaterThan(30);
		expect(codes.filter((code) => !(code in TIMING))).toEqual([]);
	});

	it('names no code the validator does not have', () => {
		expect(Object.keys(TIMING).filter((code) => !codes.includes(code))).toEqual([]);
	});

	it('never waits for a review before showing an error', () => {
		// Advice may stay quiet until export; something that blocks the file may not.
		const reviewOnlyErrors = Object.entries(TIMING).filter(
			([code, timing]) => code.startsWith('E_') && timing === 'review'
		);
		expect(reviewOnlyErrors).toEqual([]);
	});

	it('falls back by severity for a code nobody classified', () => {
		expect(timingOf({ code: 'E_NEW', severity: 'error' })).toBe('onLeave');
		expect(timingOf({ code: 'W_NEW', severity: 'warning' })).toBe('review');
	});
});

describe('warnings held back with the feedback fields', () => {
	const source = readFileSync(fileURLToPath(new URL('../validate.ts', import.meta.url)), 'utf8');
	const emitted = [...new Set([...source.matchAll(/'([EW]_[A-Z0-9_]+)'/g)].map((m) => m[1]))];
	const help = { blockId: 'B1', stepId: 's1', field: 'help' };
	const noFeedbackOnWrong = issue(
		'W_NO_WRONG_OPTION_FEEDBACK',
		{ blockId: 'B1', stepId: 's1', field: 'question.options' },
		'warning'
	);
	const unreachable = issue('W_HINT_UNREACHABLE', help, 'warning');

	it('names only warnings the validator emits', () => {
		expect(
			[...HELD_WITH_FEEDBACK].filter((code) => !emitted.includes(code) || !code.startsWith('W_'))
		).toEqual([]);
	});

	it('holds a warning about a hidden field, and one that only feedback fixes', () => {
		expect(heldBack(unreachable, false)).toBe(true);
		expect(heldBack(noFeedbackOnWrong, false)).toBe(true);
		// Held by where it points, whatever its code.
		expect(
			heldBack(
				issue(
					'W_NEW',
					{ blockId: 'B1', stepId: 's1', optionId: 'a', field: 'feedback' },
					'warning'
				),
				false
			)
		).toBe(true);
	});

	it('holds nothing while feedback is shown', () => {
		expect(heldBack(unreachable, true)).toBe(false);
		expect(heldBack(noFeedbackOnWrong, true)).toBe(false);
	});

	it('leaves other warnings alone', () => {
		expect(
			heldBack(
				issue('W_IMAGE_NO_ALT', { blockId: 'B1', stepId: 's3', field: 'image.alt' }, 'warning'),
				false
			)
		).toBe(false);
		expect(heldBack(issue('W_EMPTY_LESSON', { lessonId: 'L1' }, 'warning'), false)).toBe(false);
	});

	it('never holds an error, even one on a feedback field or with a held code', () => {
		expect(
			heldBack(
				issue('E_MC_NO_CORRECT', { blockId: 'B1', stepId: 's1', field: 'question.options' }),
				false
			)
		).toBe(false);
		expect(heldBack(issue('E_ANY', help), false)).toBe(false);
		expect(heldBack(issue('W_HINT_UNREACHABLE', help, 'error'), false)).toBe(false);
		expect([...HELD_WITH_FEEDBACK].filter((code) => code.startsWith('E_'))).toEqual([]);
	});
});

describe('isVisible', () => {
	const noText = issue('E_DISPLAY_NO_TEXT', { blockId: 'B1' });
	const emptyAnswer = issue('E_MC_EMPTY_OPTION_TEXT', {
		blockId: 'B1',
		stepId: 's1',
		optionId: 'a',
		field: 'text'
	});
	const youtube = issue('E_MEDIA_NOT_DIRECT', { blockId: 'B1', stepId: 's2', field: 'video.url' });
	const noAlt = issue(
		'W_IMAGE_NO_ALT',
		{ blockId: 'B1', stepId: 's3', field: 'image.alt' },
		'warning'
	);

	it('keeps a card that is still being written quiet', () => {
		for (const each of [noText, emptyAnswer, noAlt])
			expect(isVisible(each, nothing, null)).toBe(false);
	});

	it('shows a real contradiction at once', () => {
		expect(isVisible(youtube, nothing, null)).toBe(true);
	});

	it('shows unfinished content once its card has been left', () => {
		const left: Touched = { cards: new Set(['B1']), fields: new Set() };
		expect(isVisible(noText, left, null)).toBe(true);
		expect(isVisible(emptyAnswer, left, null)).toBe(true);
		// Another card being left says nothing about this one.
		expect(isVisible(noText, { cards: new Set(['B2']), fields: new Set() }, null)).toBe(false);
	});

	it('shows an unfinished field once that field has been left', () => {
		const blurred: Touched = { cards: new Set(), fields: new Set([fieldKey(emptyAnswer.ref)]) };
		expect(isVisible(emptyAnswer, blurred, null)).toBe(true);
		// …and only that field: the card-level problem waits for the card.
		expect(isVisible(noText, blurred, null)).toBe(false);
	});

	it('keeps advice for the review, even on a card that was left', () => {
		expect(isVisible(noAlt, { cards: new Set(['B1']), fields: new Set() }, null)).toBe(false);
	});

	describe('after the export review has been opened', () => {
		const all = [noText, emptyAnswer, youtube, noAlt];
		const reviewed = new Set(all.map(issueKey));

		it('shows what the review listed', () => {
			for (const each of all) expect(isVisible(each, nothing, reviewed)).toBe(true);
		});

		it('keeps an issue that arose afterwards to its own timing', () => {
			const newCard = issue('E_DISPLAY_NO_TEXT', { blockId: 'B9' });
			const newAlt = issue(
				'W_IMAGE_NO_ALT',
				{ blockId: 'B9', stepId: 's1', field: 'image.alt' },
				'warning'
			);
			const newLink = issue('E_MEDIA_NOT_DIRECT', {
				blockId: 'B9',
				stepId: 's2',
				field: 'video.url'
			});
			expect(isVisible(newCard, nothing, reviewed)).toBe(false);
			expect(isVisible(newAlt, nothing, reviewed)).toBe(false);
			expect(isVisible(newCard, { cards: new Set(['B9']), fields: new Set() }, reviewed)).toBe(
				true
			);
			expect(isVisible(newLink, nothing, reviewed)).toBe(true);
		});

		it('recognises the same problem in the same place, whatever its message says', () => {
			const reworded = { ...noText, message: 'jiný text' };
			expect(isVisible(reworded, nothing, reviewed)).toBe(true);
			// The same code somewhere else, or another code in the same place, is another issue.
			expect(issueKey(issue('E_DISPLAY_NO_TEXT', { blockId: 'B2' }))).not.toBe(issueKey(noText));
			expect(issueKey(issue('E_IMAGE_NO_URL', { blockId: 'B1' }))).not.toBe(issueKey(noText));
		});

		it('shows nothing early for an empty review', () => {
			for (const each of [noText, emptyAnswer, noAlt])
				expect(isVisible(each, nothing, new Set())).toBe(false);
		});
	});
});

/**
 * A new card is, by definition, unfinished. Nothing about it may be shown as wrong
 * before the teacher has left it — the class of bug where a card is born with a
 * warning chip the teacher cannot clear. Every card type, and every step type added
 * to it, from the empty course a teacher starts with.
 */
describe('a card is born quiet', () => {
	const STEP_TYPES = ['text', 'image', 'video', 'audio', 'question'] as const;

	for (const type of ['display', 'question', 'exercise'] as const) {
		it(`shows nothing on a new ${type} card, with every kind of step added`, async () => {
			const { emptyCourse } = await import('../document');
			const { addBlock, addStep } = await import('../commands');
			const { validate } = await import('../validate');
			let doc = emptyCourse('KURZ', 'Kurz');
			doc = {
				...doc,
				lessons: [{ lesson_id: 'L1', version: 1, name: 'Lekce', order: 1, blocks: [] }]
			};
			const added = addBlock(doc, 'L1', type);
			doc = added.doc;
			const blockId = added.ref!.blockId!;
			for (const step of STEP_TYPES) doc = addStep(doc, blockId, step).doc;

			const block = doc.blocks.find((b) => b.block_id === blockId)!;
			expect(block.status, 'a new card carries no status').toBeUndefined();

			const result = validate(doc, null);
			const shown = [...result.errors, ...result.warnings].filter((i) =>
				isVisible(i, nothing, null)
			);
			expect(shown.map((i) => i.code)).toEqual([]);
		});
	}
});

describe('what a change just made unreachable', () => {
	const course = () =>
		parseCourse(
			JSON.parse(
				readFileSync(
					fileURLToPath(new URL('./fixtures/spec-16-course.json', import.meta.url)),
					'utf8'
				)
			)
		);
	const change = (doc: ReturnType<typeof course>, optionId: string, value: string) =>
		setField(doc, { blockId: 'L1_B3_poznej', stepId: 's2', optionId, field: 'go_to' }, value).doc;

	it('names the step that only that answer led to', () => {
		const before = course();
		const after = change(before, 'b', 'END');
		const lost = madeUnreachable(before, after);
		expect(lost.map((i) => [i.code, i.ref.stepId])).toEqual([['W_UNREACHABLE_STEP', 's3']]);
	});

	it('says nothing for a change that loses nothing, or that wins a step back', () => {
		const before = course();
		expect(madeUnreachable(before, change(before, 'b', 's4'))).toHaveLength(1);
		const broken = change(before, 'b', 'END');
		expect(madeUnreachable(broken, change(broken, 'b', 's3'))).toEqual([]);
		// Already unreachable before: not this change's doing.
		expect(madeUnreachable(broken, change(broken, 'd', 'END'))).toEqual([]);
	});

	it('names a card nothing links to any more', () => {
		// The card is in no lesson and no one lists it as a prerequisite, so answer c is
		// the only thing that leads to it.
		const base = JSON.parse(JSON.stringify(course()));
		for (const block of base.blocks) {
			delete block.default_practice;
			delete block.learning?.prerequisites;
			for (const step of block.steps) delete step.default_practice;
		}
		for (const lesson of base.lessons) {
			lesson.blocks = lesson.blocks.filter(
				(b: { block_id: string }) => b.block_id !== 'L1_B2_casti'
			);
		}
		const before = parseCourse(base);
		const after = change(before, 'c', 'END');
		expect(madeUnreachable(before, after).map((i) => i.code)).toContain('W_ORPHAN_BLOCK');
	});
});

describe('validationDelta', () => {
	const e = (code: string, blockId: string, message = code): Issue => ({
		code,
		severity: 'error',
		ref: { blockId },
		message
	});
	const w = (code: string, blockId: string): Issue => ({
		code,
		severity: 'warning',
		ref: { blockId },
		message: code
	});

	it('lists what is new and what is gone, errors and warnings apart', () => {
		const delta = validationDelta(
			{ errors: [e('E_A', 'b1'), e('E_B', 'b2')], warnings: [w('W_A', 'b1')] },
			{ errors: [e('E_B', 'b2'), e('E_C', 'b3')], warnings: [w('W_B', 'b1')] }
		);
		expect(delta.newErrors.map((i) => i.code)).toEqual(['E_C']);
		expect(delta.resolvedErrors.map((i) => i.code)).toEqual(['E_A']);
		expect(delta.newWarnings.map((i) => i.code)).toEqual(['W_B']);
		expect(delta.resolvedWarnings.map((i) => i.code)).toEqual(['W_A']);
	});

	it('does not call a changed message a new problem, but counts an extra occurrence', () => {
		const delta = validationDelta(
			{ errors: [e('E_A', 'b1', '2 chyby')], warnings: [] },
			{ errors: [e('E_A', 'b1', '3 chyby'), e('E_A', 'b1', '3 chyby')], warnings: [] }
		);
		expect(delta.newErrors.length).toBe(1);
		expect(delta.resolvedErrors).toEqual([]);
	});

	it('is empty when nothing changed', () => {
		const same = { errors: [e('E_A', 'b1')], warnings: [w('W_A', 'b1')] };
		expect(validationDelta(same, same)).toEqual({
			newErrors: [],
			resolvedErrors: [],
			newWarnings: [],
			resolvedWarnings: []
		});
	});
});
