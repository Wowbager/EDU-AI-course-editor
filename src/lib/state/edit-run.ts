/**
 * One run of typing in a field: what the store groups into one undo entry, and what
 * Escape takes back. Shared by every editing surface of a field (the visual editor
 * and the source view), so switching between them, undoing, or another field taking
 * over cannot leave the field believing a run is open that the store has closed.
 */
export interface RunStore {
	beginEdit(): void;
	endEdit(): void;
	/** The store's open session; it can be closed, or replaced, from elsewhere. */
	readonly session: object | undefined;
}

export class EditRun {
	#session: object | undefined;
	#baseline: string | undefined;
	#store: RunStore;

	constructor(store: RunStore) {
		this.#store = store;
	}

	/** Whether this field's run is open — and still the store's. */
	get open(): boolean {
		return this.#session !== undefined && this.#session === this.#store.session;
	}

	/** The first change of a run. `current` is the value before it, for Escape. */
	begin(current: string | undefined): void {
		if (this.open) return;
		this.#baseline = current;
		this.#store.beginEdit();
		this.#session = this.#store.session;
	}

	/** The run is over: the field was left, the view switched, or undo was pressed. */
	end(): void {
		// Only this field's own session: one another field has opened since is theirs.
		if (this.open) this.#store.endEdit();
		this.#session = undefined;
	}

	/**
	 * Escape: put back the value the run started from — inside the run, so the store
	 * sees a session that changed nothing and keeps no undo entry — and end it. False
	 * when no run is open, so Escape belongs to whatever surrounds the field.
	 */
	revert(apply: (value: string | undefined) => void): boolean {
		if (!this.open) return false;
		apply(this.#baseline);
		this.end();
		return true;
	}
}
