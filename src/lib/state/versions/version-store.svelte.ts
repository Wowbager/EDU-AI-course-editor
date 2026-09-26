/**
 * The editor's version control: the history of the open course, merged from every
 * place it is kept, and the three things a teacher does with it — save the working
 * copy as a version, restore one, publish one.
 *
 * The working copy is the document in `DocStore`, always. A version is a frozen,
 * numbered copy of it (`domain/versions.ts`). Restoring is an ordinary undoable edit
 * to the working copy; nothing here replaces the document behind the author's back.
 *
 * Backends are tried in order and a failing one is reported, not fatal: a course
 * whose history could not be written anywhere is still a course being edited.
 */
import type { CourseV2 } from '$lib/domain/schema';
import {
	contentHash,
	emptyIndex,
	latest,
	nextVersion,
	publishPlan,
	publishedDocument,
	snapshot,
	type CourseVersion,
	type Publication,
	type VersionIndex,
	type VersionMeta,
	type Visibility
} from '$lib/domain/versions';
import { VersionConflict, type VersionBackend } from './backend';

export type KeptIn = 'browser' | 'server';

export interface ListedVersion extends VersionMeta {
	/** Where this version is known to be kept. Empty only for a moment during a save. */
	keptIn: KeptIn[];
}

export class VersionStore {
	#backends: VersionBackend[];
	#now: () => Date;

	courseId = $state<string | null>(null);
	versions = $state<ListedVersion[]>([]);
	published = $state<Publication | null>(null);
	/** Backends that failed on the last load or write, so the dialog can say where not. */
	unavailable = $state<KeptIn[]>([]);
	loading = $state(false);

	constructor(backends: VersionBackend[], now: () => Date = () => new Date()) {
		this.#backends = backends;
		this.#now = now;
	}

	get index(): VersionIndex {
		return {
			courseId: this.courseId ?? '',
			versions: this.versions,
			...(this.published ? { published: this.published } : {})
		};
	}

	/** The newest saved version, if any. */
	get latest(): VersionMeta | undefined {
		return latest(this.index);
	}

	/** The number the working copy would be saved as. */
	next(doc: CourseV2): number {
		return nextVersion(this.index, doc);
	}

	/** Whether the working copy has changed since the newest saved version. */
	modified(doc: CourseV2): boolean {
		const newest = this.latest;
		return newest === undefined || newest.hash !== contentHash($state.snapshot(doc) as CourseV2);
	}

	/**
	 * Load the history of a course from every backend and merge it. A version kept
	 * in one place and not another is copied across — this is how a history written
	 * while the server was unreachable gets there later, and how one kept on the
	 * server comes back to a browser whose site data was cleared.
	 */
	async load(courseId: string): Promise<void> {
		if (this.courseId !== courseId) {
			this.versions = [];
			this.published = null;
		}
		this.courseId = courseId;
		this.loading = true;
		const found = await Promise.all(
			this.#backends.map(async (backend) => {
				try {
					return { backend, index: await backend.index(courseId) };
				} catch {
					return { backend, index: null };
				}
			})
		);
		if (this.courseId !== courseId) return; // another course was opened meanwhile

		const merged = new Map<number, ListedVersion>();
		let published: Publication | null = null;
		for (const { backend, index } of found) {
			if (index === null) continue;
			for (const meta of index.versions) {
				const seen = merged.get(meta.version);
				if (seen === undefined) merged.set(meta.version, { ...meta, keptIn: [backend.name] });
				else if (seen.hash === meta.hash) seen.keptIn = [...seen.keptIn, backend.name];
			}
			if (index.published && (published === null || index.published.at > published.at)) {
				published = index.published;
			}
		}
		// A save that finished while this load was reading is not in what it read.
		for (const saved of this.versions) if (!merged.has(saved.version)) merged.set(saved.version, saved);
		this.unavailable = found.filter((f) => f.index === null).map((f) => f.backend.name);
		this.versions = [...merged.values()].sort((a, b) => a.version - b.version);
		this.published = published;
		this.loading = false;
		void this.#spread(courseId, found.filter((f) => f.index !== null).map((f) => f.backend));
	}

	/** Copy each version, and the publication, to every reachable backend lacking it. */
	async #spread(courseId: string, reachable: VersionBackend[]) {
		for (const listed of this.versions) {
			const missing = reachable.filter((b) => !listed.keptIn.includes(b.name));
			if (missing.length === 0) continue;
			const source = this.#backends.find((b) => listed.keptIn.includes(b.name));
			const full = source ? await source.get(courseId, listed.version).catch(() => null) : null;
			if (full === null) continue;
			for (const backend of missing) {
				try {
					await backend.put(full);
					listed.keptIn = [...listed.keptIn, backend.name];
				} catch {
					// Left for the next load; the list says where it is kept.
				}
			}
		}
		const publication = this.published;
		if (publication !== null) {
			for (const backend of reachable) await backend.setPublished(courseId, publication).catch(() => {});
		}
	}

	async #write(version: CourseVersion): Promise<KeptIn[]> {
		const kept: KeptIn[] = [];
		const failed: KeptIn[] = [];
		for (const backend of this.#backends) {
			try {
				await backend.put(version);
				kept.push(backend.name);
			} catch (error) {
				if (error instanceof VersionConflict) throw error;
				failed.push(backend.name);
			}
		}
		this.unavailable = failed;
		return kept;
	}

	/**
	 * Freeze the working copy as the next version. A number another tab took in the
	 * meantime is skipped rather than overwritten.
	 */
	async save(doc: CourseV2, note?: string, extra: Pick<VersionMeta, 'origin' | 'restoredFrom'> = {}) {
		const plain = $state.snapshot(doc) as CourseV2;
		for (let attempt = 0; attempt < 5; attempt++) {
			const number = this.next(plain) + attempt;
			const version = snapshot(plain, number, this.#now(), { note, ...extra });
			try {
				const keptIn = await this.#write(version);
				const { doc: _doc, ...meta } = version;
				this.versions = [...this.versions.filter((v) => v.version !== number), { ...meta, keptIn }].sort(
					(a, b) => a.version - b.version
				);
				return version;
			} catch (error) {
				if (!(error instanceof VersionConflict)) throw error;
			}
		}
		throw new Error('Verzi se nepodařilo uložit: čísla verzí jsou obsazená.');
	}

	/**
	 * An imported course brings its own history with it: its number. Recorded once, as
	 * the version it was imported as, so that the next save cannot reuse the number
	 * it was already published under, and so that the imported state can be returned to.
	 */
	async recordImport(doc: CourseV2) {
		await this.load(doc.course_id);
		if (this.versions.length > 0) return;
		await this.save(doc, 'Načteno ze souboru', { origin: 'import' });
	}

	async get(version: number): Promise<CourseVersion | null> {
		const courseId = this.courseId;
		if (courseId === null) return null;
		for (const backend of this.#backends) {
			const found = await backend.get(courseId, version).catch(() => null);
			if (found !== null) return found;
		}
		return null;
	}

	/**
	 * Publish a version with a visibility. An older version, or the one already out
	 * with a new visibility, goes out as a new number (`publishPlan`). Returns the
	 * document as handed to the platform.
	 */
	async publish(version: number, visibility: Visibility, workingDoc: CourseV2): Promise<CourseV2> {
		const courseId = this.courseId;
		const source = await this.get(version);
		if (courseId === null || source === null) throw new Error(`Verze ${version} se nenašla.`);
		const plan = publishPlan(this.index, version, workingDoc);
		let number = plan.version;
		let frozen = source;
		if (plan.kind === 'republish') {
			frozen = await this.save(source.doc, `Znovu zveřejněná verze ${plan.from}`, { restoredFrom: plan.from });
			number = frozen.version;
		}
		const publication: Publication = { version: number, visibility, at: this.#now().toISOString() };
		for (const backend of this.#backends) await backend.setPublished(courseId, publication).catch(() => {});
		this.published = publication;
		return publishedDocument(frozen, number, visibility);
	}
}
