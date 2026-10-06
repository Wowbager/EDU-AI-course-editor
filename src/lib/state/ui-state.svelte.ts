/**
 * Which panels are open, and the little state that goes with them. It is here, and not
 * in the page or a component, so that the screen model can say it (`store.screen.ui`)
 * and an AI agent is told the same panel the teacher has open.
 *
 * Nothing here is about the course; no command reads it.
 */

/** Where this browser remembers that the Pokročilý parts note was read. */
export const PARTS_NOTE_KEY = 'edu-editor:parts-note-seen';

export class UiState {
	/** The Kontrola kurzu panel behind the top bar's chip. */
	#validationOpen = $state(false);
	/** The export review, opened by Stáhnout. */
	reviewOpen = $state(false);
	/** The tree folded to its rail. */
	sidebarCollapsed = $state(false);
	/** The issues hidden by hand in the open panel (`screen/issues.ts` `panelKey`). */
	dismissedIssues = $state.raw<ReadonlySet<string>>(new Set());
	/** Whether this browser has been shown the parts note: null until it has been read. */
	partsNoteSeen = $state<boolean | null>(null);

	get validationOpen(): boolean {
		return this.#validationOpen;
	}
	set validationOpen(open: boolean) {
		// A hidden warning comes back with the next opening of the panel.
		if (!open) this.dismissedIssues = new Set();
		this.#validationOpen = open;
	}

	dismissIssue(key: string) {
		this.dismissedIssues = new Set([...this.dismissedIssues, key]);
	}

	/** The note shows until it has been dismissed once in this browser. */
	readPartsNote() {
		if (this.partsNoteSeen !== null) return;
		try {
			this.partsNoteSeen = localStorage.getItem(PARTS_NOTE_KEY) !== null;
		} catch {
			// No storage: the note shows each time the mode is switched, which is harmless.
			this.partsNoteSeen = false;
		}
	}

	/** Not eligible any more: read the browser again the next time it is. */
	forgetPartsNote() {
		this.partsNoteSeen = null;
	}

	dismissPartsNote() {
		this.partsNoteSeen = true;
		try {
			localStorage.setItem(PARTS_NOTE_KEY, '1');
		} catch {
			// Nothing to remember it in.
		}
	}
}
