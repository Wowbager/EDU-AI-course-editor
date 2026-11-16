/**
 * The unfinished batch of a course in IndexedDB (`domain/write-snapshot.ts`), one record
 * per course. Every call can fail (a private window, blocked site data); a failure means
 * "not kept" and never reaches the editor.
 */
import type { WriteSnapshot } from '$lib/domain/write-snapshot';

const DB = 'edu-editor-ai-queue';
const STORE = 'batches';

export interface SnapshotBackend {
	get(courseId: string): Promise<unknown>;
	put(snapshot: WriteSnapshot): Promise<void>;
	delete(courseId: string): Promise<void>;
}

const done = <T>(request: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

let db: Promise<IDBDatabase> | null = null;
function openOnce(): Promise<IDBDatabase> {
	db ??= new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB není k dispozici.'));
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE))
				request.result.createObjectStore(STORE, { keyPath: 'courseId' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB se nepodařilo otevřít.'));
		request.onblocked = () => reject(new Error('IndexedDB je blokovaná jinou kartou.'));
	}).catch((error) => {
		db = null;
		throw error;
	});
	return db;
}

const idb: SnapshotBackend = {
	async get(courseId) {
		const handle = await openOnce();
		return done(handle.transaction(STORE, 'readonly').objectStore(STORE).get(courseId));
	},
	async put(snapshot) {
		const handle = await openOnce();
		await done(handle.transaction(STORE, 'readwrite').objectStore(STORE).put(snapshot));
	},
	async delete(courseId) {
		const handle = await openOnce();
		await done(handle.transaction(STORE, 'readwrite').objectStore(STORE).delete(courseId));
	}
};

let backend: SnapshotBackend = idb;
/** For tests: another place to keep the records; no argument puts IndexedDB back. */
export function useSnapshotBackend(next?: SnapshotBackend) {
	backend = next ?? idb;
}

/** Writes and deletes go one after another, so the last call is what stays. */
let chain: Promise<unknown> = Promise.resolve();
const queued = (job: () => Promise<unknown>): Promise<void> => {
	const next = chain.then(job).then(
		() => undefined,
		() => undefined
	);
	chain = next;
	return next;
};

export const saveSnapshot = (snapshot: WriteSnapshot): Promise<void> =>
	queued(() => backend.put(snapshot));

export const dropSnapshot = (courseId: string): Promise<void> =>
	queued(() => backend.delete(courseId));

export async function loadSnapshot(courseId: string): Promise<unknown> {
	try {
		await chain;
		return (await backend.get(courseId)) ?? undefined;
	} catch {
		return undefined;
	}
}
