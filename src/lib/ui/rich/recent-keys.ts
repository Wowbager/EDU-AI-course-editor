/**
 * The keypad's recently-used row (§5.4): the 8–10 keys the teacher used last, persisted
 * per teacher in `localStorage`, shown at the top of every tab. Ids only — the keys
 * themselves live in `keypad-data.ts`, so an id that no longer exists is simply dropped.
 */

const KEY = 'edu-editor:math-keypad:recent';
export const RECENT_MAX = 10;

export type RecentStore = string[];

/** Read the stored ids; anything unreadable or not an id list is an empty row. */
export function readRecent(): RecentStore {
	try {
		const raw = globalThis.localStorage?.getItem(KEY);
		if (!raw) return [];
		const list = JSON.parse(raw);
		return Array.isArray(list)
			? list.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
			: [];
	} catch {
		return [];
	}
}

/** A key was used: it goes first, duplicates collapse, the row keeps at most `RECENT_MAX`. */
export function writeRecent(id: string, current: RecentStore = readRecent()): RecentStore {
	const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENT_MAX);
	try {
		globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
	} catch {
		// Private mode: the row just lives for this edit.
	}
	return next;
}
