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
	saveCard,
	serializeBackpack,
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

	/** Keep a copy of `block`. Returns false when the browser had no room for it. */
	save(block: BlockV2, from: CopiedFrom, courseName?: string): boolean {
		const next = saveCard(this.cards, block, {
			id: newId(),
			savedAt: new Date().toISOString(),
			from,
			courseName: courseName || undefined
		});
		if (!write(serializeBackpack(next))) {
			notices.show({ text: 'Kartu se nepodařilo uložit do batohu: prohlížeč nemá místo.' });
			return false;
		}
		this.cards = next;
		return true;
	}

	drop(id: string): void {
		const next = dropCard(this.cards, id);
		if (write(serializeBackpack(next))) this.cards = next;
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
