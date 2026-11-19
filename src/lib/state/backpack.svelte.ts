/**
 * The backpack at the bottom of the lesson panel: whether it is open, and „Moje karty“,
 * the copies the teacher keeps across courses (`domain/backpack.ts`).
 *
 * „Moje karty“ lives in this browser's `localStorage`, beside the courses' drafts, so it
 * reaches every course on this computer and no other. A second tab sees a change through
 * the `storage` event.
 */
import type { BlockV2 } from '$lib/domain/schema';
import type { CopiedFrom } from '$lib/domain/commands';
import {
	dropCard,
	parseBackpack,
	rewriteBackpack,
	saveCard,
	type SavedCard
} from '$lib/domain/backpack';
import { notices } from './notice.svelte';

export const BACKPACK_KEY = 'edu-editor:backpack:v1';

export class Backpack {
	cards = $state<SavedCard[]>([]);
	/** Whether the backpack is open over the lesson list. */
	open = $state(false);
	#loaded = false;

	/** Read the stored list once, in the browser; later changes come through `storage`. */
	load(): void {
		if (this.#loaded || typeof window === 'undefined') return;
		this.#loaded = true;
		this.cards = parseBackpack(read());
		window.addEventListener('storage', (event) => {
			if (event.key === BACKPACK_KEY) this.cards = parseBackpack(event.newValue);
		});
	}

	/**
	 * Change the stored list. It is re-read first, so a card another tab saved a moment
	 * ago is not written over; a newer build's backpack is not written at all
	 * (`rewriteBackpack`). `failed` is what the teacher is told when the write fails.
	 */
	#change(change: (cards: SavedCard[]) => SavedCard[], failed: string): boolean {
		const next = rewriteBackpack(read(), change);
		if (next === null) {
			notices.show({
				text: 'Batoh uložila novější verze editoru. Obnov stránku, ať se nic neztratí.'
			});
			return false;
		}
		if (!write(next)) {
			notices.show({ text: failed });
			return false;
		}
		this.cards = parseBackpack(next);
		return true;
	}

	/** Keep a copy of `block`. Returns false when it could not be stored. */
	save(block: BlockV2, from: CopiedFrom, courseName?: string): boolean {
		const where = {
			id: newId(),
			savedAt: new Date().toISOString(),
			from,
			courseName: courseName || undefined
		};
		return this.#change(
			(cards) => saveCard(cards, block, where),
			'Kartu se nepodařilo uložit do batohu: prohlížeč nemá místo.'
		);
	}

	drop(id: string): void {
		this.#change((cards) => dropCard(cards, id), 'Kartu se nepodařilo vyndat z batohu.');
	}

	find(id: string): SavedCard | undefined {
		return this.cards.find((card) => card.id === id);
	}
}

function read(): string | null {
	try {
		return localStorage.getItem(BACKPACK_KEY);
	} catch {
		return null;
	}
}

function write(text: string): boolean {
	try {
		localStorage.setItem(BACKPACK_KEY, text);
		return true;
	} catch {
		return false;
	}
}

function newId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const backpack = new Backpack();
