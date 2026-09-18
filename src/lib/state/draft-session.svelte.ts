import type { DocStore } from './doc-store.svelte';
import { DRAFT_KEY, readDraft, type Draft } from './draft';

/** Browser-only lifecycle; constructed in onMount, never during SSR. */
export class DraftSession {
	status = $state<'saving' | 'saved' | 'error' | 'blocked'>('saving');
	message = $state('');
	#known: string | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#store: DocStore;

	constructor(store: DocStore) { this.#store = store; }

	restore(): boolean {
		try {
			this.#known = localStorage.getItem(DRAFT_KEY);
			if (this.#known === null) return false;
			const draft = readDraft(this.#known);
			this.#store.load(draft.doc);
			this.#store.restoreReservations(draft.reserved);
			this.#store.mode = draft.mode;
			this.#store.selection = draft.selection;
			this.#store.dirty = true;
			this.status = 'saved';
			this.message = 'Obnoven koncept uložený v tomto prohlížeči.';
			return true;
		} catch {
			this.status = 'blocked';
			this.message = 'Uložený koncept nelze načíst nebo úložiště není dostupné. Původní data nebyla přepsána.';
			return false;
		}
	}

	schedule() {
		if (this.status === 'blocked') return;
		this.status = 'saving';
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.flush(), 400);
	}

	flush() {
		clearTimeout(this.#timer);
		if (this.status === 'blocked' || this.status === 'saved') return;
		try {
			if (localStorage.getItem(DRAFT_KEY) !== this.#known) {
				this.conflict();
				return;
			}
			const store = this.#store;
			const draft: Draft = {
				format: 1, savedAt: new Date().toISOString(), doc: store.doc, mode: store.mode,
				selection: store.selection,
				reserved: { blocks: [...store.reservations.blocks], lessons: [...store.reservations.lessons], steps: [...store.reservations.steps] }
			};
			const text = JSON.stringify(draft);
			localStorage.setItem(DRAFT_KEY, text);
			this.#known = text;
			this.status = 'saved';
		} catch {
			this.status = 'error';
			this.message = 'Koncept se nepodařilo uložit. Nezavírej tuto kartu; úložiště může být plné nebo zakázané.';
		}
	}

	conflict() {
		clearTimeout(this.#timer);
		this.status = 'blocked';
		this.message = 'Koncept v úložišti se změnil v jiné kartě. Automatické ukládání je pozastaveno, aby se práce nepřepsala.';
	}

	/** Explicitly archive the old record before authorizing replacement. */
	replace() {
		try {
			const previous = localStorage.getItem(DRAFT_KEY);
			if (previous !== null) localStorage.setItem(`${DRAFT_KEY}:backup:${Date.now()}`, previous);
			this.#known = previous;
			this.status = 'saving';
			this.flush();
		} catch {
			this.status = 'blocked';
			this.message = 'Původní koncept nelze zálohovat. Nebyl přepsán.';
		}
	}

	dispose() { clearTimeout(this.#timer); }
}
