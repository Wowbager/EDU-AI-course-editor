import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DocStore } from './doc-store.svelte';
import { importCourse } from '$lib/domain/document';
import { addBlock, addStep, setField } from '$lib/domain/commands';
import { emptyCourse } from '$lib/domain/document';
import { groupOf, questionCount } from '$lib/domain/groups';

/**
 * The store holds the course as exported (`source`) and shows the editor a view of it
 * (`doc`): in Učitel and Metodik each question card as one card, in Pokročilý the
 * source itself. These are the promises the rest of the editor relies on.
 */
const fixture = () =>
	importCourse(
		JSON.parse(
			readFileSync(
				new URL('../domain/__tests__/fixtures/corpus/zlomky-5-trida.json', import.meta.url),
				'utf8'
			)
		)
	).doc;

function loaded() {
	const store = new DocStore();
	store.load(fixture());
	store.splitQuestions();
	return store;
}

describe('the store and question cards', () => {
	it('splits an imported course as one undoable edit', () => {
		const store = new DocStore();
		store.load(fixture());
		const before = store.source;
		const { split } = store.splitQuestions();
		expect(split.length).toBe(5);
		expect(store.source.blocks.length).toBe(before.blocks.length + 5);
		store.undo();
		expect(store.source).toBe(before);
	});

	it('shows the teacher one card where the export has two', () => {
		const store = loaded();
		expect(store.doc.blocks.some((b) => b.block_id === 'L1_B4_cviceni_2')).toBe(false);
		expect(store.source.blocks.some((b) => b.block_id === 'L1_B4_cviceni_2')).toBe(true);
		store.mode = 'advanced';
		expect(store.doc).toBe(store.source);
	});

	it('writes a teacher’s new question into its own block, and undoes it whole', () => {
		const store = loaded();
		const before = store.source;
		store.apply((d, r) => addStep(d, 'L1_B3_poznej', 'question', undefined, r));
		const card = store.source.blocks.filter((b) => groupOf(b) === 'L1_B3_poznej');
		expect(card.length).toBeGreaterThan(1);
		for (const block of card) expect(questionCount(block)).toBeLessThanOrEqual(1);
		store.undo();
		expect(store.source).toBe(before);
	});

	it('moves the selection between a card and its block when the mode changes', () => {
		const store = loaded();
		store.selection = { lessonId: 'L1_INTRO', blockId: 'L1_B4_cviceni', stepId: 's4' };
		store.mode = 'advanced';
		expect(store.selection).toMatchObject({ blockId: 'L1_B4_cviceni_2', stepId: 's4' });
		store.mode = 'teacher';
		expect(store.selection).toMatchObject({ blockId: 'L1_B4_cviceni', stepId: 's4' });
	});

	it('carries a jump’s target into the mode it switches to', () => {
		const store = loaded();
		const ref = store.switchMode('advanced', { blockId: 'L1_B4_cviceni', stepId: 's3' });
		expect(ref).toMatchObject({ blockId: 'L1_B4_cviceni_2', stepId: 's3' });
	});

	it('maps what the player reports back to the teacher’s card', () => {
		const store = loaded();
		expect(store.toView({ blockId: 'L1_B4_cviceni_2', stepId: 's4' })).toMatchObject({ blockId: 'L1_B4_cviceni' });
	});

	it('exports the source, not the view', () => {
		const store = loaded();
		store.apply((d) => setField(d, { field: 'name' }, 'Zlomky'));
		const out = store.export() as { name: string; blocks: { block_id: string }[] };
		expect(out.name).toBe('Zlomky');
		expect(out.blocks.map((b) => b.block_id)).toContain('L1_B4_cviceni_2');
		expect(JSON.stringify(out)).not.toContain('_members');
	});

	it('counts leaving a card as leaving its blocks too', () => {
		const store = loaded();
		store.selection = { blockId: 'L1_B4_cviceni' };
		store.selection = { blockId: 'L1_B1_uvod' };
		expect(store.touchedCards.has('L1_B4_cviceni')).toBe(true);
		expect(store.touchedCards.has('L1_B4_cviceni_2')).toBe(true);
	});
});

describe('the Zpětná vazba flag', () => {
	it('starts on and flips', () => {
		const store = new DocStore();
		expect(store.showFeedback).toBe(true);
		store.showFeedback = false;
		expect(store.showFeedback).toBe(false);
		store.showFeedback = true;
		expect(store.showFeedback).toBe(true);
	});

	it('is a view preference: loading another course keeps it', () => {
		const store = new DocStore();
		store.showFeedback = false;
		store.load(fixture());
		expect(store.showFeedback).toBe(false);
	});
});

describe('warnings about hidden feedback fields', () => {
	/** A question card whose only step has a detailed help but no hint to open it from. */
	function withUnreachableHelp() {
		const store = new DocStore();
		store.load({
			...emptyCourse('KURZ', 'Kurz'),
			lessons: [{ lesson_id: 'L1', version: 1, name: 'Lekce', order: 1, blocks: [] }]
		});
		const added = store.apply((d) => addBlock(d, 'L1', 'question'));
		const blockId = added.ref!.blockId!;
		const step = store.apply((d) => addStep(d, blockId, 'question'));
		const stepRef = { blockId, stepId: step.ref!.stepId, field: 'help' };
		store.apply((d) => setField(d, stepRef, 'Nejdřív si to nakresli.'));
		return { store, stepRef };
	}

	it('are in the full validation but not in what is listed, while feedback is hidden', () => {
		const { store } = withUnreachableHelp();
		const unreachable = (issues: readonly { code: string }[]) =>
			issues.filter((i) => i.code === 'W_HINT_UNREACHABLE').length;
		expect(unreachable(store.validation.warnings)).toBe(1);
		expect(unreachable(store.listed.warnings)).toBe(1);

		store.showFeedback = false;
		expect(unreachable(store.validation.warnings)).toBe(1);
		expect(unreachable(store.listed.warnings)).toBe(0);

		store.showFeedback = true;
		expect(unreachable(store.listed.warnings)).toBe(1);
	});

	it('are not marked inline while hidden', () => {
		const { store, stepRef } = withUnreachableHelp();
		expect(store.issuesAt(stepRef).warnings.map((i) => i.code)).toEqual(['W_HINT_UNREACHABLE']);
		store.showFeedback = false;
		expect(store.shown.warnings.map((i) => i.code)).not.toContain('W_HINT_UNREACHABLE');
		expect(store.issuesAt(stepRef).warnings).toEqual([]);
	});

	it('never hold back an error', () => {
		const { store } = withUnreachableHelp();
		const before = store.listed.errors.map((i) => i.code);
		expect(before.length).toBeGreaterThan(0);
		store.showFeedback = false;
		expect(store.listed.errors.map((i) => i.code)).toEqual(before);
		expect(store.listed.errors).toEqual(store.validation.errors);
	});
});
