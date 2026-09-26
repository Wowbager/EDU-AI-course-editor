import { describe, expect, it } from 'vitest';
import { stepExpanded } from '$lib/ui/step-expansion';
import { StepView } from '$lib/state/step-view.svelte';
import type { Ref } from '$lib/domain/ref';

describe('whether a step is open', () => {
	// Every combination, so a change to the rule has to change this table on purpose.
	const table: [userCollapsed: boolean, focused: boolean, suppressed: boolean, dragging: boolean, unreached: boolean, open: boolean][] = [
		[false, false, false, false, false, true],
		[false, true, false, false, false, true],
		[false, false, true, false, false, true],
		[false, true, true, false, false, true],
		[true, false, false, false, false, false],
		[true, true, false, false, false, true], // focus opens a folded step…
		[true, false, true, false, false, false],
		[true, true, true, false, false, false], // …unless it was folded while focused
		// A step the played run has not reached is folded like one the author folded.
		[false, false, false, false, true, false],
		[false, true, false, false, true, true],
		[false, false, true, false, true, false],
		[false, true, true, false, true, false],
		[true, false, false, false, true, false],
		[true, true, false, false, true, true],
		[true, false, true, false, true, false],
		[true, true, true, false, true, false],
		// Dragging folds everything, whatever else is true.
		[false, false, false, true, false, false],
		[false, true, false, true, false, false],
		[false, false, true, true, false, false],
		[false, true, true, true, false, false],
		[true, false, false, true, false, false],
		[true, true, false, true, false, false],
		[true, false, true, true, false, false],
		[true, true, true, true, false, false],
		[false, false, false, true, true, false],
		[false, true, false, true, true, false],
		[false, false, true, true, true, false],
		[false, true, true, true, true, false],
		[true, false, false, true, true, false],
		[true, true, false, true, true, false],
		[true, false, true, true, true, false],
		[true, true, true, true, true, false]
	];
	it.each(table)(
		'collapsed=%s focused=%s suppressed=%s dragging=%s unreached=%s → open=%s',
		(userCollapsed, focused, suppressed, dragging, unreached, open) => {
			expect(stepExpanded({ userCollapsed, focused, suppressed, dragging, unreached })).toBe(open);
		}
	);
});

describe('the step list during a played run', () => {
	const open = (view: StepView, blockId: string, stepId: string, selection: Ref | null = null) =>
		view.expanded(blockId, stepId, stepId, selection);

	it('shows the played card as the pupil has it: reached steps open, the rest folded', () => {
		const view = new StepView();
		view.followRun('B1', ['s1']);
		expect([open(view, 'B1', 's1'), open(view, 'B1', 's2'), open(view, 'B1', 's3')]).toEqual([true, false, false]);

		view.followRun('B1', ['s1', 's2']);
		expect(open(view, 'B1', 's2')).toBe(true);
		expect(open(view, 'B2', 's3'), 'another card is not the one being played').toBe(true);
	});

	it('opens a folded step the author focuses or unfolds', () => {
		const view = new StepView();
		view.followRun('B1', ['s1']);
		expect(open(view, 'B1', 's2', { blockId: 'B1', stepId: 's2' })).toBe(true);
		view.toggle('B1', 's3', 's3', null);
		expect(open(view, 'B1', 's3')).toBe(true);
	});

	it('gives the author their own folding back when the run ends', () => {
		const view = new StepView();
		view.toggle('B1', 's1', 's1', null); // the author folds s1
		view.followRun('B1', ['s1']);
		view.endRun();
		expect([open(view, 'B1', 's1'), open(view, 'B1', 's2')]).toEqual([false, true]);
	});

	it('folds nothing for a player that does not say what is on screen', () => {
		const view = new StepView();
		view.followRun('B1', ['s1']);
		view.followRun('B1', undefined);
		expect(open(view, 'B1', 's2')).toBe(true);
	});
});
