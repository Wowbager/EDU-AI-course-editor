import { describe, expect, it } from 'vitest';
import { branchLabels, blocksOfCard, reachedSteps } from './branch-labels';
import { storeFor } from '$lib/screen/__tests__/fixtures';

/** zlomky-5-trida has cards of several questions: one card on screen, several blocks exported. */
describe('what the preview column tells the player about the cards around it', () => {
	const store = storeFor('corpus/zlomky-5-trida.json');
	const split = [...store.source.blocks].find(
		(b) => (b as { group?: string }).group !== undefined
	)!;
	const key = (split as { group?: string }).group!;
	const members = store.source.blocks.filter((b) => (b as { group?: string }).group === key);

	it('gives a card the exported blocks it is made of, in order', () => {
		expect(blocksOfCard(store.source, key).map((b) => b.block_id)).toEqual(
			members.map((b) => b.block_id)
		);
		const plain = store.source.blocks.find((b) => (b as { group?: string }).group === undefined)!;
		expect(blocksOfCard(store.source, plain.block_id)).toEqual([plain]);
		expect(blocksOfCard(store.source, 'nothing')).toEqual([]);
	});

	it('names a branch by its card, and a later question by the card and its part', () => {
		const labels = branchLabels(store.source, store.doc, false);
		expect(Object.keys(labels)).toHaveLength(store.source.blocks.length);
		expect(labels[members[0].block_id]).not.toBe('');
		expect(labels[members[1].block_id]).toBe(
			`${labels[members[0].block_id]}, část 2/${members.length}`
		);
		// A teacher is never shown an id.
		for (const label of Object.values(labels)) expect(label).not.toContain(members[0].block_id);
	});

	it('names a branch by its id in Pokročilý, which shows ids', () => {
		const labels = branchLabels(store.source, store.source, true);
		expect(labels[members[1].block_id]).toBe(members[1].block_id);
	});

	it('counts the steps of the earlier blocks of a card as already met', () => {
		const second = members[1];
		const earlier = members[0].steps.map((s) => s.id);
		expect(reachedSteps(store.source, second.block_id, ['x'], true)).toEqual([...earlier, 'x']);
		// Pokročilý shows the blocks themselves, so there is nothing before them.
		expect(reachedSteps(store.source, second.block_id, ['x'], false)).toEqual(['x']);
		expect(reachedSteps(store.source, second.block_id, undefined, true)).toBeUndefined();
	});
});
