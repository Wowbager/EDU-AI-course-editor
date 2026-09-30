import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	fieldKey,
	heldBack,
	HELD_WITH_FEEDBACK,
	isVisible,
	issueKey,
	TIMING,
	timingOf,
	type Touched
} from '$lib/ui/issue-visibility';
import type { Issue } from '../validate';

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
