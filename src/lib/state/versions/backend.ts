/**
 * Where versions are kept. Two places, behind one interface:
 *
 *  - this browser (IndexedDB), always tried first — it works offline and without
 *    anything on the server;
 *  - the editor's own server, under a per-browser key (`server.ts`), so that
 *    clearing site data does not have to mean losing the history.
 *
 * The interface is shaped for the login that is coming: a backend answers for "the
 * current owner", whoever that turns out to be. Today the owner is a key this
 * browser made up; later it is a signed-in teacher, and sharing a course between
 * teachers is an access list on the course, not a change to this interface.
 */
import type { CourseVersion, Publication, VersionIndex } from '$lib/domain/versions';

export interface VersionBackend {
	/** A short name for messages: where the versions are. */
	readonly name: 'browser' | 'server';
	/** Everything known about a course. Resolves to an empty index, never throws for "none". */
	index(courseId: string): Promise<VersionIndex>;
	get(courseId: string, version: number): Promise<CourseVersion | null>;
	/** Store a version. Rejects with `VersionConflict` if the number is taken by other content. */
	put(version: CourseVersion): Promise<void>;
	setPublished(courseId: string, publication: Publication): Promise<void>;
}

/** The number is already used by a different version — another tab, most likely. */
export class VersionConflict extends Error {
	constructor(
		readonly courseId: string,
		readonly version: number
	) {
		super(`Verze ${version} už existuje s jiným obsahem.`);
	}
}

/** A backend that holds everything in memory — for tests, and as the last resort. */
export class MemoryBackend implements VersionBackend {
	readonly name: 'browser' | 'server';
	#versions = new Map<string, CourseVersion>();
	#published = new Map<string, Publication>();

	constructor(name: 'browser' | 'server' = 'browser') {
		this.name = name;
	}

	async index(courseId: string): Promise<VersionIndex> {
		const versions = [...this.#versions.values()]
			.filter((v) => v.courseId === courseId)
			.map(({ doc: _doc, ...meta }) => meta)
			.sort((a, b) => a.version - b.version);
		const published = this.#published.get(courseId);
		return { courseId, versions, ...(published ? { published } : {}) };
	}

	async get(courseId: string, version: number) {
		return structuredClone(this.#versions.get(`${courseId}#${version}`) ?? null);
	}

	async put(version: CourseVersion) {
		const key = `${version.courseId}#${version.version}`;
		const existing = this.#versions.get(key);
		if (existing !== undefined && existing.hash !== version.hash) {
			throw new VersionConflict(version.courseId, version.version);
		}
		this.#versions.set(key, structuredClone(version));
	}

	async setPublished(courseId: string, publication: Publication) {
		this.#published.set(courseId, { ...publication });
	}
}
