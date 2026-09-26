/**
 * The editor half of the preview contract (plan §4).
 *
 *   editor → player: setBlock, setLesson, highlight, back, restart, reset
 *   player → editor: ready, stepChanged, clicked, completed, navState
 *
 * Two rules matter more than the message shapes. Updates are debounced, and the
 * iframe is **never reloaded to refresh content** — a reload costs seconds of Flutter
 * boot and destroys the live feel. The engine is re-mounted only when the step graph
 * changes (ids added or removed), and then restored to the nearest surviving step.
 *
 * Content updates are debounced; **navigation is not**. The queue keeps only the
 * last pending message, so a debounced `back` would be swallowed by the next
 * keystroke — and a button that sometimes does nothing is worse than no button.
 *
 * When each player message arrives is part of the contract, and it is written down
 * on the player's side (`lib/preview/README.md` → "The contract"). The one the editor
 * leans on: while a lesson is played, `stepChanged {blockId, stepId}` arrives every
 * time the step on screen changes — the first card, the next one, a branch, back,
 * restart — and never from Náhled. `PreviewColumn` follows the run with it.
 */
import type { BlockV2, CourseV2, ExportType } from '$lib/domain/schema';
import type { Ref } from '$lib/domain/ref';

/**
 * Which of the editor's two modes the player is showing.
 *
 *  - `expanded` one card, every step at once, nothing interactive: a click reports
 *    the field behind it so the editor can focus it.
 *  - `play` the lesson as a pupil takes it, from the selected card onward.
 */
export type PreviewView = 'expanded' | 'play';

export type EditorMessage =
	| {
			type: 'setBlock';
			block: unknown;
			exportMode: ExportType;
			view: PreviewView;
			stepId?: string;
			remount?: boolean;
			/** How to name the other cards a branch leads to — see `showBlock`. */
			blockLabels?: Record<string, string>;
	  }
	| {
			type: 'setLesson';
			course: unknown;
			lessonId: string;
			exportMode: ExportType;
			view: PreviewView;
			startBlockId?: string;
	  }
	| { type: 'highlight'; ref: Ref }
	| { type: 'back' }
	| { type: 'restart' }
	| { type: 'reset' };

export type PlayerMessage =
	| { type: 'ready' }
	| { type: 'stepChanged'; stepId: string; blockId: string }
	| { type: 'clicked'; ref: Ref }
	| { type: 'completed'; xp: number; scoreKoef: number; mark?: string }
	| { type: 'navState'; canGoBack: boolean };

export interface BridgeHandlers {
	onready?: () => void;
	onstepChanged?: (stepId: string, blockId: string) => void;
	onclicked?: (ref: Ref) => void;
	oncompleted?: (result: { xp: number; scoreKoef: number; mark?: string }) => void;
	onnavState?: (canGoBack: boolean) => void;
}

const DEBOUNCE_MS = 250;

export class PreviewBridge {
	#frame: HTMLIFrameElement | null = null;
	#handlers: BridgeHandlers;
	#ready = false;
	#pending: EditorMessage | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	/** The step graph last sent, to decide between a content update and a re-mount. */
	#lastStepIds: string[] = [];
	/**
	 * Where the **expanded** view was last told to sit. Written by `showBlock`,
	 * cleared by `showLesson` and `reset`, and read only to survive a re-mount.
	 *
	 * It used to be written from the player's `stepChanged`, which only *Vyzkoušet*
	 * emits and only *Náhled* reads — a one-way channel from one mode into the other.
	 * A run left the field pointing at the step it ended on, and because step ids are
	 * unique per block rather than per course, going back to Náhled would "restore"
	 * the same-numbered step of a completely different card. Nothing the player
	 * reports from a played run may decide what the expanded view shows.
	 */
	#lastStepId: string | undefined;
	/** The view last sent; switching views re-mounts, switching content does not. */
	#lastView: PreviewView | undefined;
	/**
	 * The last card or lesson sent, so a player that announces itself a second time —
	 * the frame reloaded, or crashed and came back — is given its content again
	 * instead of sitting on its placeholder until the next keystroke.
	 */
	#lastContent: EditorMessage | null = null;

	constructor(handlers: BridgeHandlers = {}) {
		this.#handlers = handlers;
	}

	attach(frame: HTMLIFrameElement) {
		this.#frame = frame;
		window.addEventListener('message', this.#onmessage);
	}

	detach() {
		window.removeEventListener('message', this.#onmessage);
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#frame = null;
		this.#ready = false;
	}

	get ready(): boolean {
		return this.#ready;
	}

	/**
	 * The message that would go out next. The channel carries opaque JSON into a
	 * canvas, so without this there is nothing to assert on and nothing to read in a
	 * console when it misbehaves.
	 */
	get pending(): EditorMessage | null {
		return this.#pending;
	}

	#onmessage = (event: MessageEvent) => {
		// The player is served from the editor's own origin (§6.4), so anything from
		// elsewhere is not ours.
		if (event.source !== this.#frame?.contentWindow) return;
		const message = decode(event.data);
		if (message === null) return;
		this.receive(message);
	};

	/**
	 * Dispatch a message already established to be the player's. Split out from
	 * `#onmessage`, which is the origin check and the decoding — the policy about who
	 * may speak is a separate thing from what is said, and only this half is worth
	 * testing.
	 */
	receive(message: PlayerMessage) {
		switch (message.type) {
			case 'ready': {
				this.#ready = true;
				this.#handlers.onready?.();
				const content = this.#pending ?? this.#lastContent;
				if (content !== null) {
					this.#post(content.type === 'setBlock' ? { ...content, remount: true } : content);
				}
				break;
			}
			case 'stepChanged':
				// Reported, never stored: this is a position in a run, not a position
				// in the card the expanded view is showing. See `#lastStepId`.
				if (typeof message.blockId === 'string' && typeof message.stepId === 'string') {
					this.#handlers.onstepChanged?.(message.stepId, message.blockId);
				}
				break;
			case 'navState':
				this.#handlers.onnavState?.(message.canGoBack === true);
				break;
			case 'clicked':
				this.#handlers.onclicked?.(message.ref);
				break;
			case 'completed':
				this.#handlers.oncompleted?.(message);
				break;
			default: {
				// Every player message has a case. A new one fails to compile here
				// until it is handled (AGENTS.md: update the union and every switch).
				const unhandled: never = message;
				void unhandled;
			}
		}
	}

	/**
	 * Send a block. A change to the step ids re-mounts the engine and restores to the
	 * nearest surviving step; a change to content alone does not.
	 */
	showBlock(
		block: BlockV2,
		exportMode: ExportType,
		serialise: (b: BlockV2) => unknown,
		view: PreviewView = 'expanded',
		stepId?: string,
		blockLabels?: Record<string, string>
	) {
		const stepIds = block.steps.map((s) => s.id);
		const remount = !sameIds(stepIds, this.#lastStepIds) || view !== this.#lastView;
		// A selection can name a step in another card — the author clicked one card in
		// the tree while the editor still pointed at a step of the last one. Step ids
		// repeat across blocks, so an unchecked id would land on whatever step of
		// *this* card happens to share the number.
		const wanted = stepId !== undefined && stepIds.includes(stepId) ? stepId : undefined;
		// In the expanded view `stepId` is only the outline, so it is the selection
		// or nothing: every step is on screen and there is no position to restore.
		// Falling back to the nearest surviving step there outlined step 1 of every
		// card nobody had focused. Only a played card has a place to be put back to.
		const restore =
			view === 'expanded'
				? wanted
				: (wanted ?? (remount ? nearestSurviving(this.#lastStepId, this.#lastStepIds, stepIds) : undefined));
		this.#lastStepIds = stepIds;
		this.#lastView = view;
		this.#lastStepId =
			restore ??
			(this.#lastStepId !== undefined && stepIds.includes(this.#lastStepId)
				? this.#lastStepId
				: undefined);

		this.#queue({
			type: 'setBlock',
			block: serialise(block),
			exportMode,
			view,
			stepId: restore,
			remount,
			blockLabels
		});
	}

	showLesson(
		doc: CourseV2,
		lessonId: string,
		exportMode: ExportType,
		serialise: (d: CourseV2) => unknown,
		startBlockId?: string
	) {
		this.#lastStepIds = [];
		this.#lastStepId = undefined;
		this.#lastView = 'play';
		this.#queue({
			type: 'setLesson',
			course: serialise(doc),
			lessonId,
			exportMode,
			view: 'play',
			startBlockId
		});
	}

	/** Outline a step in the expanded view. Never debounced — see the file header. */
	highlight(ref: Ref) {
		this.#post({ type: 'highlight', ref });
	}

	/** Retrace one move in the played lesson. */
	back() {
		this.#post({ type: 'back' });
	}

	/** Play the lesson again from the selected card. */
	restart() {
		this.#post({ type: 'restart' });
	}

	reset() {
		this.#lastStepIds = [];
		this.#lastStepId = undefined;
		this.#lastView = undefined;
		this.#lastContent = null;
		this.#post({ type: 'reset' });
	}

	#queue(message: EditorMessage) {
		this.#pending = message;
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			if (this.#pending !== null) this.#post(this.#pending);
		}, DEBOUNCE_MS);
	}

	#post(message: EditorMessage) {
		if (message.type === 'setBlock' || message.type === 'setLesson') this.#lastContent = message;
		if (!this.#ready || this.#frame?.contentWindow == null) {
			// Content waits for the player; navigation does not. Parking a `back` here
			// would overwrite the `setBlock` queued behind it and the player would
			// finish booting with nothing to show — and retracing a run that has not
			// started yet means nothing anyway.
			if (message.type === 'setBlock' || message.type === 'setLesson') this.#pending = message;
			return;
		}
		this.#pending = null;
		// Both directions carry JSON strings. Structured clone would work for the
		// editor → player leg, but Dart hands a cloned object back as an opaque JS
		// value, so one encoding for both sides is the thing that stays debuggable.
		this.#frame.contentWindow.postMessage(JSON.stringify(message), window.location.origin);
	}
}

/** Accept both encodings: a JSON string, or an already-structured object. */
function decode(data: unknown): PlayerMessage | null {
	if (typeof data === 'string') {
		try {
			const parsed: unknown = JSON.parse(data);
			return isPlayerMessage(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return isPlayerMessage(data) ? data : null;
}

const isPlayerMessage = (value: unknown): value is PlayerMessage =>
	typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * After a re-mount, land as close as possible to where the author was: the same step
 * if it survived, otherwise the nearest one that did, searching backwards first.
 */
export function nearestSurviving(
	current: string | undefined,
	previous: string[],
	next: string[]
): string | undefined {
	if (current === undefined) return next[0];
	if (next.includes(current)) return current;

	const at = previous.indexOf(current);
	if (at < 0) return next[0];
	for (let distance = 1; distance < previous.length; distance++) {
		const before = previous[at - distance];
		if (before !== undefined && next.includes(before)) return before;
		const after = previous[at + distance];
		if (after !== undefined && next.includes(after)) return after;
	}
	return next[0];
}
