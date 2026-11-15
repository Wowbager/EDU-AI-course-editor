/**
 * An undo history of whole values, for state small enough to keep a copy of each step:
 * the AI panel's outline. Pure: every call returns a new history.
 *
 * `past` holds the values before each step, oldest first; `future` the values undone,
 * the next one to redo last. A new step forgets the future, and the oldest steps go once
 * there are more than the limit.
 */
export interface History<T> {
	readonly past: readonly T[];
	readonly future: readonly T[];
}

export const HISTORY_LIMIT = 100;

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/** A step was taken from `before`. */
export function record<T>(history: History<T>, before: T, limit = HISTORY_LIMIT): History<T> {
	return { past: [...history.past, before].slice(-limit), future: [] };
}

/** The value to go back to from `now`, or `undefined` with nothing to undo. */
export function undo<T>(
	history: History<T>,
	now: T
): { history: History<T>; value: T } | undefined {
	if (history.past.length === 0) return undefined;
	return {
		history: { past: history.past.slice(0, -1), future: [...history.future, now] },
		value: history.past[history.past.length - 1]
	};
}

/** The value to go forward to from `now`, or `undefined` with nothing to redo. */
export function redo<T>(
	history: History<T>,
	now: T
): { history: History<T>; value: T } | undefined {
	if (history.future.length === 0) return undefined;
	return {
		history: { past: [...history.past, now], future: history.future.slice(0, -1) },
		value: history.future[history.future.length - 1]
	};
}

/**
 * Take back the last step as if it had never been: its value comes back and nothing is
 * left to redo it. For a step that turned out to do nothing (a row added and left
 * empty); the caller makes sure no other step came after it.
 */
export function retract<T>(history: History<T>): { history: History<T>; value: T } | undefined {
	if (history.past.length === 0) return undefined;
	return {
		history: { past: history.past.slice(0, -1), future: history.future },
		value: history.past[history.past.length - 1]
	};
}
