import type { Ref } from '$lib/domain/ref';
import type { UndoEntry } from './doc-store.svelte';

/** How long a notice stays before it goes by itself. */
export const NOTICE_MS = 6000;

export interface Notice {
	/** A new one for every `show`, so a repeat of the same text restarts the timer and the animation. */
	id: number;
	text: string;
	/**
	 * The undo entry the action recorded. "Vrátit zpět" is offered only while it is
	 * still the top of the store's stack, so a notice can never undo a later edit.
	 */
	entry?: UndoEntry;
	/** Selected after the undo, so the teacher lands where the action took place. */
	ref?: Ref;
}

/**
 * The one message the editor says about what it has just done: "Karta smazána",
 * "Karta odebrána z lekce …". One at a time, bottom-left of the editor column, and
 * it goes by itself. A notice that has to be read carefully belongs in a dialog.
 */
export class Notices {
	current = $state<Notice | null>(null);
	#count = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;

	show(input: { text: string; entry?: UndoEntry; ref?: Ref }): void {
		this.current = { id: ++this.#count, ...input };
		this.resume();
	}

	dismiss(): void {
		this.pause();
		this.current = null;
	}

	/** While the pointer or focus is on the notice it is being read, so it stays. */
	pause(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	resume(): void {
		this.pause();
		if (this.current === null) return;
		this.#timer = setTimeout(() => this.dismiss(), NOTICE_MS);
	}
}

export const notices = new Notices();
