/**
 * Whether a pointer press is still going on, for the page as a whole.
 *
 * A rich field that loses focus to a press waits for the release before its toolbar goes
 * (`RichField.svelte`, `onfocusout`), so the release is not moved off what was pressed.
 * The release does not always reach the page: one over the preview's frame lands in the
 * frame. So a press also ends when the page sees a sign that it is over: a pointer
 * moving with no button held, a key that is not a modifier, or the window losing focus.
 * A press that is believed down forever would keep a field "being edited" after
 * the teacher has left it.
 */

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

export interface PressTracker {
	/** Whether a press has started and not yet ended. */
	readonly down: boolean;
	/**
	 * Run `run` once the current press ends, after the click that follows the release
	 * has been dispatched; at once (still after the current task) when no press is on.
	 */
	afterPress(run: () => void): void;
}

/** One tracker for every listener on `target` (the window, in the editor). */
export function createPressTracker(target: EventTarget): PressTracker {
	let down = false;
	let waiting: (() => void)[] = [];

	const end = () => {
		down = false;
		const runs = waiting;
		waiting = [];
		for (const run of runs) setTimeout(run, 0);
	};

	target.addEventListener('pointerdown', () => (down = true), true);
	target.addEventListener('pointerup', end, true);
	target.addEventListener('pointercancel', end, true);
	target.addEventListener('blur', () => down && end());
	target.addEventListener(
		'pointermove',
		(event) => down && (event as PointerEvent).buttons === 0 && end(),
		true
	);
	target.addEventListener(
		'keydown',
		(event) => down && !MODIFIERS.has((event as KeyboardEvent).key) && end(),
		true
	);

	return {
		get down() {
			return down;
		},
		afterPress(run) {
			if (down) waiting.push(run);
			else setTimeout(run, 0);
		}
	};
}

let shared: PressTracker | undefined;

/** The window's tracker, made on first use (never on the server). */
export function pagePress(): PressTracker {
	shared ??= createPressTracker(window);
	return shared;
}
