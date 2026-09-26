import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DocStore } from './doc-store.svelte';
import { importCourse } from '$lib/domain/document';
import { addStep, setField } from '$lib/domain/commands';
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
