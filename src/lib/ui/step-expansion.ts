/**
 * Whether a step is drawn open or folded to its one-line summary.
 *
 * Three things decide it, and they used to live in three places or nowhere. The
 * author's own choice (the chevron) was `$state` inside each `StepEditor`, so any
 * remount forgot it — and a drag remounts the dragged step twice, because
 * `svelte-dnd-action` swaps it for a placeholder with a different id. That is how a
 * collapsed step left an expanded-height hole while it was carried and came back
 * open after the drop. Focus did not open a step at all, so a jump from the preview
 * or the validation panel scrolled to the header of a step whose field was not
 * rendered.
 *
 * The rule, in one place:
 * - while any step is being dragged, every step is folded — the list is for
 *   reordering then, and every row has to be the same short height the library
 *   measured when the drag began;
 * - otherwise a step is open unless the author folded it,
 * - and a folded step opens while it is focused (the selection points at it), then
 *   folds again when the selection moves on,
 * - unless the author folded it *while* it was focused: that is an explicit "not
 *   now", and it holds until the selection is set again;
 * - while Vyzkoušet plays a card, a step of it the pupil has not reached is folded
 *   too. The list shows the card as the pupil has it on screen, and opens the next
 *   step when the pupil gets to it. The author can still open one: focusing it, or
 *   its chevron, works as on any folded step.
 */
export interface StepExpansionInput {
	/** The author folded this step with its chevron. */
	userCollapsed: boolean;
	/** The editor's selection points at this step. */
	focused: boolean;
	/** Folded while focused, and the selection has not been set since. */
	suppressed: boolean;
	/** Some step in the list is being dragged. */
	dragging: boolean;
	/** A played run is on this card and has not shown the pupil this step yet. */
	unreached?: boolean;
}

export function stepExpanded({
	userCollapsed,
	focused,
	suppressed,
	dragging,
	unreached = false
}: StepExpansionInput): boolean {
	if (dragging) return false;
	if (!userCollapsed && !unreached) return true;
	return focused && !suppressed;
}

/** The key a step's view state is stored under — step ids are unique per card only. */
export const stepViewKey = (blockId: string, stepKey: string) => `${blockId}/${stepKey}`;

/** What the step list remembers: the author's folds and the run being played. */
export interface StepViewState {
	/** `stepViewKey`s the author folded with the chevron. */
	collapsed: ReadonlySet<string>;
	/** The step folded while it was focused, and the selection it was folded under. */
	suppressed: { key: string; selection: unknown } | null;
	dragging: boolean;
	/** The card a played run is on and the steps of it the pupil has been shown. */
	run: { blockId: string; shown: ReadonlySet<string> } | null;
	/** Unreached steps the author opened with the chevron during this run. */
	opened: ReadonlySet<string>;
}

/**
 * Whether the step is drawn open: `stepExpanded` over what the step list remembers.
 * `StepView.expanded` and the screen model's `card.steps[].expanded` are this.
 * `stepKey` is where the folding is kept; `stepId` is what the selection names.
 */
export function stepIsExpanded(
	state: StepViewState,
	blockId: string,
	stepKey: string,
	stepId: string,
	selection: { blockId?: string; stepId?: string } | null
): boolean {
	const key = stepViewKey(blockId, stepKey);
	const unreached =
		state.run !== null &&
		state.run.blockId === blockId &&
		!state.run.shown.has(stepId) &&
		!state.opened.has(key);
	return stepExpanded({
		userCollapsed: state.collapsed.has(key),
		focused: selection?.blockId === blockId && selection?.stepId === stepId,
		suppressed: state.suppressed?.key === key && state.suppressed.selection === selection,
		dragging: state.dragging,
		unreached
	});
}
