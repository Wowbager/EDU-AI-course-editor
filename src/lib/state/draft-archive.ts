/**
 * Durable copies of the drafts, in IndexedDB — one record per course, the same
 * envelope `localStorage` holds (`state/draft.ts`).
 *
 * The active draft stays in `localStorage` because its write must be synchronous:
 * the last keystroke before the tab closes is flushed in `beforeunload`, and a
 * promise there is not a save. IndexedDB is the copy that survives the quota
 * eviction `DraftSession.flush` performs when `localStorage` is full: the evicted
 * course keeps its meta key and opens from here.
 *
 * Every call can fail (a private window, blocked site data, a quota); the caller
 * treats a failure as "not kept here" and nothing in the editor breaks over it.
 */
import type { CourseMeta } from './courses';

const DB = 'edu-editor-drafts';
const STORE = 'drafts';

export interface ArchivedDraft extends CourseMeta {
	/** The exact `Draft` JSON, as `localStorage` holds it. */
	text: string;
}

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB není k dispozici.'));
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE))
				db.createObjectStore(STORE, { keyPath: 'courseId' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB se nepodařilo otevřít.'));
		request.onblocked = () => reject(new Error('IndexedDB je blokovaná jinou kartou.'));
	});
}

const done = <T>(request: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

let db: Promise<IDBDatabase> | null = null;
function openOnce(): Promise<IDBDatabase> {
	db ??= open().catch((error) => {
		db = null;
		throw error;
	});
	return db;
}

export async function archiveDraft(record: ArchivedDraft): Promise<void> {
	const handle = await openOnce();
	await done(
		handle
			.transaction(STORE, 'readwrite')
			.objectStore(STORE)
			.put({ ...record })
	);
}

export async function readArchivedDraft(courseId: string): Promise<ArchivedDraft | null> {
	const handle = await openOnce();
	const found = await done(handle.transaction(STORE, 'readonly').objectStore(STORE).get(courseId));
	return (found as ArchivedDraft | undefined) ?? null;
}

/** Names and timestamps only — the texts stay in the store. */
export async function listArchivedDrafts(): Promise<CourseMeta[]> {
	const handle = await openOnce();
	const all = (await done(
		handle.transaction(STORE, 'readonly').objectStore(STORE).getAll()
	)) as ArchivedDraft[];
	return all.map(({ courseId, name, savedAt }) => ({ courseId, name, savedAt }));
}
