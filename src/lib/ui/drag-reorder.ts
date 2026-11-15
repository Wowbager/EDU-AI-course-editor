/**
 * A pointer drag that reorders the rows of one list, for lists too small for a library:
 * the proposal in the AI panel. The same idea as the answer table's drag: the carried
 * row follows the pointer, the others slide aside, and a release commits. Every other
 * way a press ends (Escape, the window losing focus, a cancelled pointer) puts the row
 * back, so a drag is never left half done.
 */

/**
 * Where a carried row would land: the number of the other rows whose middle is above
 * the carried row's middle. `middles` are the rows' middles at the press.
 */
export function dropIndex(middles: readonly number[], from: number, carriedMiddle: number): number {
	return middles.filter((m, i) => i !== from && m < carriedMiddle).length;
}

export interface DragState {
	from: number;
	to: number;
	/** How far the pointer has moved the carried row from where it started, in px. */
	offset: number;
	/** The carried row's height plus the gap, which is how far the others slide. */
	step: number;
	/** The press has moved far enough to be a drag rather than a click. */
	moved: boolean;
}

const THRESHOLD = 4;

/**
 * Follow a press on a handle. `rows` are the list's rows in order, measured now.
 * `update` is told every change of the state (and `null` when the drag is over);
 * `drop` is called with the place the row ends at, only for a release after a real drag
 * that changes the order.
 */
export function startReorder(
	event: PointerEvent,
	rows: readonly HTMLElement[],
	from: number,
	update: (state: DragState | null) => void,
	drop: (from: number, to: number) => void
): void {
	if (event.button !== 0 || rows[from] === undefined) return;
	event.preventDefault();
	const rects = rows.map((r) => r.getBoundingClientRect());
	const middles = rects.map((r) => r.top + r.height / 2);
	const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
	const step = rects[from].height + gap;
	const startY = event.clientY;
	let state: DragState = { from, to: from, offset: 0, step, moved: false };

	const move = (e: PointerEvent) => {
		if (e.pointerId !== event.pointerId) return;
		if (e.buttons === 0) return end(false);
		const offset = e.clientY - startY;
		state = {
			...state,
			offset,
			to: dropIndex(middles, from, middles[from] + offset),
			moved: state.moved || Math.abs(offset) > THRESHOLD
		};
		update(state);
	};
	const release = (e: PointerEvent) => e.pointerId === event.pointerId && end(true);
	const cancel = (e?: Event) =>
		(e === undefined || !(e instanceof PointerEvent) || e.pointerId === event.pointerId) &&
		end(false);
	const escape = (e: KeyboardEvent) => {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		end(false);
	};
	const left = () => setTimeout(() => !document.hasFocus() && end(false));
	function end(commit: boolean) {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', release);
		window.removeEventListener('pointercancel', cancel);
		window.removeEventListener('blur', left);
		window.removeEventListener('keydown', escape, true);
		const done = state;
		update(null);
		if (commit && done.moved && done.to !== done.from) drop(done.from, done.to);
	}
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', release);
	window.addEventListener('pointercancel', cancel);
	window.addEventListener('blur', left);
	window.addEventListener('keydown', escape, true);
	update(state);
}

/**
 * How far row `index` is moved aside while `drag` is on: the others make room by the
 * carried row's step, the carried one follows the pointer.
 */
export function shiftOf(drag: DragState | null, index: number): number {
	if (drag === null || !drag.moved) return 0;
	if (index === drag.from) return drag.offset;
	if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.step;
	if (drag.from > drag.to && index >= drag.to && index < drag.from) return drag.step;
	return 0;
}
