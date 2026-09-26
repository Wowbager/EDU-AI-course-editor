/**
 * The step list's view state: which steps the author folded, and whether a step is
 * being dragged. It is not in `DocStore` because no command has an opinion about it
 * and it is not saved; it is not in `StepEditor` because a component forgets its
 * state whenever it remounts, and a drag remounts the dragged step (see
 * `ui/step-expansion.ts`, which holds the rule this class feeds).
 *
 * Everything is keyed by `blockId/stepKey`: step ids are unique per card only, and
 * the editor column reuses its components when another card is opened, so a key of
 * `s1` alone let a step folded in one card show folded in the next.
 */
import type { Ref } from '$lib/domain/ref';
import { stepExpanded, stepViewKey } from '$lib/ui/step-expansion';

export class StepView {
	#collapsed = $state<ReadonlySet<string>>(new Set());
	/**
	 * A step folded while it was focused, and the selection object it was folded
	 * under. It stops counting the moment the selection is set again — which is what
	 * a jump from the preview or the validation panel does, so those still open it.
	 */
	#suppressed = $state<{ key: string; selection: Ref | null } | null>(null);

	/** True from the press on a drag handle until the drop has settled. */
	dragging = $state(false);

	/**
	 * The last `store.reveal` a step has scrolled to. A reveal is a one-off request:
	 * whichever step answers it consumes it, so a step that remounts later — as the
	 * dragged one does, twice — does not scroll the page again.
	 */
	revealHandled = $state(0);

	/**
	 * The card a played run is on, and the steps of it on the pupil's screen, as the
	 * player last reported them. Null outside Vyzkoušet, and from a player that does
	 * not report them.
	 */
	#run = $state<{ blockId: string; shown: ReadonlySet<string> } | null>(null);
	/** Unreached steps the author opened with the chevron during this run. */
	#opened = $state<ReadonlySet<string>>(new Set());

	/** The run is on `blockId`, showing `shownStepIds`; undefined stops folding. */
	followRun(blockId: string, shownStepIds: readonly string[] | undefined) {
		if (shownStepIds === undefined) return this.endRun();
		if (this.#run?.blockId !== blockId) this.#opened = new Set();
		this.#run = { blockId, shown: new Set(shownStepIds) };
	}

	/** Back to the author's own folding: Vyzkoušet was left. */
	endRun() {
		this.#run = null;
		this.#opened = new Set();
	}

	#unreached(blockId: string, key: string, stepId: string): boolean {
		const run = this.#run;
		return run !== null && run.blockId === blockId && !run.shown.has(stepId) && !this.#opened.has(key);
	}

	/**
	 * `stepKey` is where the folding is remembered; `stepId` is what the selection
	 * names. They differ only for a duplicate id in a broken document.
	 */
	expanded(blockId: string, stepKey: string, stepId: string, selection: Ref | null): boolean {
		const key = stepViewKey(blockId, stepKey);
		const focused = selection?.blockId === blockId && selection?.stepId === stepId;
		const suppressed = this.#suppressed?.key === key && this.#suppressed.selection === selection;
		return stepExpanded({
			userCollapsed: this.#collapsed.has(key),
			focused,
			suppressed,
			dragging: this.dragging,
			unreached: this.#unreached(blockId, key, stepId)
		});
	}

	/** The chevron: fold an open step, open a folded one. */
	toggle(blockId: string, stepKey: string, stepId: string, selection: Ref | null) {
		const key = stepViewKey(blockId, stepKey);
		const next = new Set(this.#collapsed);
		if (this.expanded(blockId, stepKey, stepId, selection)) {
			next.add(key);
			this.#suppressed = { key, selection };
		} else {
			next.delete(key);
			if (this.#suppressed?.key === key) this.#suppressed = null;
			if (this.#unreached(blockId, key, stepId)) this.#opened = new Set(this.#opened).add(key);
		}
		this.#collapsed = next;
	}
}
