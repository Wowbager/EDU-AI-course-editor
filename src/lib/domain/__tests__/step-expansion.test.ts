import { describe, expect, it } from 'vitest';
import { stepExpanded } from '$lib/ui/step-expansion';

describe('whether a step is open', () => {
	// Every combination, so a change to the rule has to change this table on purpose.
	const table: [userCollapsed: boolean, focused: boolean, suppressed: boolean, dragging: boolean, open: boolean][] = [
		[false, false, false, false, true],
		[false, true, false, false, true],
		[false, false, true, false, true],
		[false, true, true, false, true],
		[true, false, false, false, false],
		[true, true, false, false, true], // focus opens a folded step…
		[true, false, true, false, false],
		[true, true, true, false, false], // …unless it was folded while focused
		// Dragging folds everything, whatever else is true.
		[false, false, false, true, false],
		[false, true, false, true, false],
		[false, false, true, true, false],
		[false, true, true, true, false],
		[true, false, false, true, false],
		[true, true, false, true, false],
		[true, false, true, true, false],
		[true, true, true, true, false]
	];
	it.each(table)('collapsed=%s focused=%s suppressed=%s dragging=%s → open=%s', (userCollapsed, focused, suppressed, dragging, open) => {
		expect(stepExpanded({ userCollapsed, focused, suppressed, dragging })).toBe(open);
	});
});
