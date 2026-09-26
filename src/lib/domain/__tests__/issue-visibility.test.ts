import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fieldKey, isVisible, TIMING, timingOf, type Touched } from '$lib/ui/issue-visibility';
import type { Issue } from '../validate';

const nothing: Touched = { cards: new Set(), fields: new Set() };

const issue = (code: string, ref: Issue['ref'], severity: Issue['severity'] = 'error'): Issue =>
	({ code, severity, ref, message: code });

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
		const reviewOnlyErrors = Object.entries(TIMING)
			.filter(([code, timing]) => code.startsWith('E_') && timing === 'review');
		expect(reviewOnlyErrors).toEqual([]);
	});

	it('falls back by severity for a code nobody classified', () => {
		expect(timingOf({ code: 'E_NEW', severity: 'error' })).toBe('onLeave');
		expect(timingOf({ code: 'W_NEW', severity: 'warning' })).toBe('review');
	});
});

describe('isVisible', () => {
	const noText = issue('E_DISPLAY_NO_TEXT', { blockId: 'B1' });
	const emptyAnswer = issue('E_MC_EMPTY_OPTION_TEXT', { blockId: 'B1', stepId: 's1', optionId: 'a', field: 'text' });
	const youtube = issue('E_MEDIA_NOT_DIRECT', { blockId: 'B1', stepId: 's2', field: 'video.url' });
	const noAlt = issue('W_IMAGE_NO_ALT', { blockId: 'B1', stepId: 's3', field: 'image.alt' }, 'warning');

	it('keeps a card that is still being written quiet', () => {
		for (const each of [noText, emptyAnswer, noAlt]) expect(isVisible(each, nothing, false)).toBe(false);
	});

	it('shows a real contradiction at once', () => {
		expect(isVisible(youtube, nothing, false)).toBe(true);
	});

	it('shows unfinished content once its card has been left', () => {
		const left: Touched = { cards: new Set(['B1']), fields: new Set() };
		expect(isVisible(noText, left, false)).toBe(true);
		expect(isVisible(emptyAnswer, left, false)).toBe(true);
		// Another card being left says nothing about this one.
		expect(isVisible(noText, { cards: new Set(['B2']), fields: new Set() }, false)).toBe(false);
	});

	it('shows an unfinished field once that field has been left', () => {
		const blurred: Touched = { cards: new Set(), fields: new Set([fieldKey(emptyAnswer.ref)]) };
		expect(isVisible(emptyAnswer, blurred, false)).toBe(true);
		// …and only that field: the card-level problem waits for the card.
		expect(isVisible(noText, blurred, false)).toBe(false);
	});

	it('keeps advice for the review, even on a card that was left', () => {
		expect(isVisible(noAlt, { cards: new Set(['B1']), fields: new Set() }, false)).toBe(false);
	});

	it('shows everything once the author has seen the review', () => {
		for (const each of [noText, emptyAnswer, youtube, noAlt]) expect(isVisible(each, nothing, true)).toBe(true);
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
			doc = { ...doc, lessons: [{ lesson_id: 'L1', version: 1, name: 'Lekce', order: 1, blocks: [] }] };
			const added = addBlock(doc, 'L1', type);
			doc = added.doc;
			const blockId = added.ref!.blockId!;
			for (const step of STEP_TYPES) doc = addStep(doc, blockId, step).doc;

			const block = doc.blocks.find((b) => b.block_id === blockId)!;
			expect(block.status, 'a new card carries no status').toBeUndefined();

			const result = validate(doc, null);
			const shown = [...result.errors, ...result.warnings].filter((i) => isVisible(i, nothing, false));
			expect(shown.map((i) => i.code)).toEqual([]);
		});
	}
});
