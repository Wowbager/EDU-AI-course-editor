/**
 * Versions in this browser, in IndexedDB — `localStorage` holds the draft already
 * and is a few megabytes in all, and a course's history is many copies of it.
 *
 * Every call can fail: a private window, blocked site data, a quota. The store
 * treats a failure as "not kept here" and says so; nothing in the editor may break
 * because the history could not be written.
 */
import type { CourseVersion, Publication, VersionIndex } from '$lib/domain/versions';
import { VersionConflict, type VersionBackend } from './backend';

const DB = 'edu-editor-versions';
const VERSIONS = 'versions';
const PUBLISHED = 'published';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB není k dispozici.'));
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(VERSIONS)) {
				const store = db.createObjectStore(VERSIONS, { keyPath: ['courseId', 'version'] });
				store.createIndex('course', 'courseId');
			}
			if (!db.objectStoreNames.contains(PUBLISHED)) db.createObjectStore(PUBLISHED, { keyPath: 'courseId' });
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

export class BrowserBackend implements VersionBackend {
	readonly name = 'browser' as const;
	#db: Promise<IDBDatabase> | null = null;

	#open() {
		this.#db ??= open().catch((error) => {
			this.#db = null;
			throw error;
		});
		return this.#db;
	}

	async index(courseId: string): Promise<VersionIndex> {
		const db = await this.#open();
		const tx = db.transaction([VERSIONS, PUBLISHED], 'readonly');
		const all = await done(tx.objectStore(VERSIONS).index('course').getAll(IDBKeyRange.only(courseId)));
		const published = await done(tx.objectStore(PUBLISHED).get(courseId));
		const versions = (all as CourseVersion[])
			.map(({ doc: _doc, ...meta }) => meta)
			.sort((a, b) => a.version - b.version);
		return {
			courseId,
			versions,
			...(published ? { published: (published as { publication: Publication }).publication } : {})
		};
	}

	async get(courseId: string, version: number): Promise<CourseVersion | null> {
		const db = await this.#open();
		const found = await done(db.transaction(VERSIONS, 'readonly').objectStore(VERSIONS).get([courseId, version]));
		return (found as CourseVersion | undefined) ?? null;
	}

	async put(version: CourseVersion): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(VERSIONS, 'readwrite');
		const store = tx.objectStore(VERSIONS);
		const existing = (await done(store.get([version.courseId, version.version]))) as CourseVersion | undefined;
		if (existing !== undefined && existing.hash !== version.hash) {
			throw new VersionConflict(version.courseId, version.version);
		}
		await done(store.put(version));
	}

	async setPublished(courseId: string, publication: Publication): Promise<void> {
		const db = await this.#open();
		await done(
			db.transaction(PUBLISHED, 'readwrite').objectStore(PUBLISHED).put({ courseId, publication: { ...publication } })
		);
	}
}
