/**
 * A pointer drag that reorders the rows of one list, for lists too small for a library:
 * the proposal in the AI panel. The same idea as the answer table's drag: the carried
 * row follows the pointer, the others slide aside, and a release commits. Every other
 * way a press ends (Escape, the window losing focus, a cancelled pointer) puts the row
 * back, so a drag is never left half done.
 *
 * A card carried between lessons is the same drag over one flat list of rows, the
 * lessons' heads among the cards (`cardPlace` says which lesson a place is in).
 */

/**
 * Where a carried row would land. A row above gives way once the carried row's top
 * edge is over its middle, a row below once the bottom edge is: the carried row covers
 * at most half of a neighbour before that one slides aside, so two rows are never drawn
 * on top of each other. `middles` are the rows' middles at the press; `top` and
 * `bottom` are the carried row's edges now.
 */
export function dropIndex(
	middles: readonly number[],
	from: number,
	top: number,
	bottom: number
): number {
	return middles.filter((m, i) => i !== from && m < (i < from ? top : bottom)).length;
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

/** The space between rows that sit closest: what a row moving aside makes room by, with its height. */
export function rowGap(rects: readonly { top: number; bottom: number }[]): number {
	const gaps = rects.slice(1).map((r, i) => r.top - rects[i].bottom);
	return gaps.length === 0 ? 0 : Math.max(0, Math.min(...gaps));
}

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
	drop: (from: number, to: number) => void,
	/** The first place the row may go: 1 keeps it below a list's first row (a lesson's head). */
	min = 0
): void {
	if (event.button !== 0 || rows[from] === undefined) return;
	event.preventDefault();
	const rects = rows.map((r) => r.getBoundingClientRect());
	const middles = rects.map((r) => r.top + r.height / 2);
	const gap = rowGap(rects);
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
			to: Math.max(
				min,
				dropIndex(middles, from, rects[from].top + offset, rects[from].bottom + offset)
			),
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

/** A row of the flat list a card is carried over: a lesson's head (no `card`) or a card. */
export interface FlatRow {
	lesson: number;
	card?: number;
	/** A folded lesson's head: a card dropped after it goes to the end of that lesson. */
	folded?: boolean;
}

/**
 * Where a card carried from flat row `from` lands when the drag says `to` (its place
 * among the other rows): the lesson, and the index it ends at there once it has left
 * its own place (`end` for the end of a folded lesson). Right after a head is the start
 * of that lesson; right after a card is just below it.
 */
export function cardPlace(
	rows: readonly FlatRow[],
	from: number,
	to: number
): { lesson: number; index: number | 'end' } {
	const carried = rows[from];
	const before = rows.filter((_, i) => i !== from)[to - 1];
	if (before === undefined) return { lesson: rows[0]?.lesson ?? 0, index: 0 };
	if (before.card === undefined)
		return { lesson: before.lesson, index: before.folded === true ? 'end' : 0 };
	const sameLesson = before.lesson === carried?.lesson && carried.card !== undefined;
	return {
		lesson: before.lesson,
		index: sameLesson && before.card > carried.card! ? before.card : before.card + 1
	};
}
