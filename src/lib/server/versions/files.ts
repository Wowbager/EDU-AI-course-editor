/**
 * Versions on the editor's server: plain JSON files, one per version, under
 *
 *     DATA_DIR/owners/<owner>/courses/<course_id>/v<N>.json
 *     DATA_DIR/owners/<owner>/courses/<course_id>/published.json
 *
 * Files rather than a database because the editor ships as one container with no
 * database, and a course history is small and written rarely. Every write goes to a
 * temporary file first and is renamed into place, so a crash never leaves half a
 * version; writes to one course are queued, so two tabs cannot interleave.
 *
 * Nothing from the request reaches a path unchecked: the owner is a hash, the course
 * id and the number are validated against strict patterns, and the document must
 * parse as a course whose content matches the hash it claims.
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { courseSchema, type CourseV2 } from '$lib/domain/schema';
import { contentHash, type CourseVersion, type Publication, type VersionIndex, type VersionMeta } from '$lib/domain/versions';

export const COURSE_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const MAX_VERSION = 1_000_000;
/** Per course, and per owner across all courses. Generous; they stop runaway loops. */
export const MAX_VERSIONS_PER_COURSE = 500;
export const MAX_VERSIONS_PER_OWNER = 5000;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class VersionError extends Error {
	constructor(
		readonly status: 400 | 404 | 409 | 413 | 429,
		message: string
	) {
		super(message);
	}
}

export class VersionFiles {
	#root: string;
	#queues = new Map<string, Promise<unknown>>();

	constructor(root: string) {
		this.#root = root;
	}

	#courseDir(owner: string, courseId: string) {
		if (!/^ws_[0-9a-f]{64}$|^user_[A-Za-z0-9_-]{1,64}$/.test(owner)) throw new VersionError(400, 'Neplatný vlastník.');
		if (!COURSE_ID.test(courseId)) throw new VersionError(400, 'Neplatný identifikátor kurzu.');
		return join(this.#root, 'owners', owner, 'courses', courseId);
	}

	/** Run writes to one course one after another. */
	#serial<T>(key: string, work: () => Promise<T>): Promise<T> {
		const previous = this.#queues.get(key) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(work);
		this.#queues.set(key, next);
		// The caller sees the failure; the queue's own bookkeeping must not raise it again.
		next
			.finally(() => {
				if (this.#queues.get(key) === next) this.#queues.delete(key);
			})
			.catch(() => {});
		return next;
	}

	async index(owner: string, courseId: string): Promise<VersionIndex> {
		const dir = this.#courseDir(owner, courseId);
		const names = await readdir(dir).catch(() => [] as string[]);
		const versions: VersionMeta[] = [];
		for (const name of names) {
			if (!/^v\d+\.json$/.test(name)) continue;
			const stored = await readJson<CourseVersion>(join(dir, name));
			if (stored === null) continue;
			const { doc: _doc, ...meta } = stored;
			void _doc;
			versions.push(meta);
		}
		versions.sort((a, b) => a.version - b.version);
		const published = await readJson<Publication>(join(dir, 'published.json'));
		return { courseId, versions, ...(published ? { published } : {}) };
	}

	async get(owner: string, courseId: string, version: number): Promise<CourseVersion | null> {
		checkNumber(version);
		return readJson<CourseVersion>(join(this.#courseDir(owner, courseId), `v${version}.json`));
	}

	/** Store a version. The same content again is fine; other content under a taken number is a 409. */
	async put(owner: string, courseId: string, body: unknown): Promise<VersionMeta> {
		const version = parseVersion(courseId, body);
		const dir = this.#courseDir(owner, courseId);
		return this.#serial(dir, async () => {
			const existing = await this.get(owner, courseId, version.version);
			if (existing !== null) {
				if (existing.hash !== version.hash) {
					throw new VersionError(409, `Verze ${version.version} už existuje s jiným obsahem.`);
				}
				return strip(existing);
			}
			const inCourse = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^v\d+\.json$/.test(n));
			if (inCourse.length >= MAX_VERSIONS_PER_COURSE) throw new VersionError(429, 'Kurz má příliš mnoho verzí.');
			if ((await this.#ownerCount(owner)) >= MAX_VERSIONS_PER_OWNER) {
				throw new VersionError(429, 'Uloženo je příliš mnoho verzí.');
			}
			await mkdir(dir, { recursive: true });
			await atomicWrite(join(dir, `v${version.version}.json`), JSON.stringify(version));
			return strip(version);
		});
	}

	async setPublished(owner: string, courseId: string, body: unknown): Promise<Publication> {
		const publication = parsePublication(body);
		const dir = this.#courseDir(owner, courseId);
		return this.#serial(dir, async () => {
			await mkdir(dir, { recursive: true });
			await atomicWrite(join(dir, 'published.json'), JSON.stringify(publication));
			return publication;
		});
	}

	async #ownerCount(owner: string): Promise<number> {
		const courses = join(this.#root, 'owners', owner, 'courses');
		let count = 0;
		for (const course of await readdir(courses).catch(() => [] as string[])) {
			count += (await readdir(join(courses, course)).catch(() => [] as string[])).filter((n) =>
				/^v\d+\.json$/.test(n)
			).length;
		}
		return count;
	}
}

function strip(version: CourseVersion): VersionMeta {
	const { doc: _doc, ...meta } = version;
	void _doc;
	return meta;
}

function checkNumber(version: number) {
	if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) {
		throw new VersionError(400, 'Neplatné číslo verze.');
	}
}

function parseVersion(courseId: string, body: unknown): CourseVersion {
	if (typeof body !== 'object' || body === null) throw new VersionError(400, 'Chybí verze.');
	const raw = body as Record<string, unknown>;
	const version = raw.version;
	if (typeof version !== 'number') throw new VersionError(400, 'Chybí číslo verze.');
	checkNumber(version);
	if (raw.courseId !== courseId) throw new VersionError(400, 'Verze patří k jinému kurzu.');
	const parsed = courseSchema.safeParse(raw.doc);
	if (!parsed.success) throw new VersionError(400, 'Obsah verze není kurz.');
	const doc = parsed.data as CourseV2;
	if (doc.course_id !== courseId || doc.version !== version) {
		throw new VersionError(400, 'Obsah verze nesouhlasí s jejím číslem nebo kurzem.');
	}
	const hash = contentHash(doc);
	if (raw.hash !== hash) throw new VersionError(400, 'Otisk verze nesouhlasí s obsahem.');
	const savedAt = typeof raw.savedAt === 'string' && !Number.isNaN(Date.parse(raw.savedAt)) ? raw.savedAt : null;
	if (savedAt === null) throw new VersionError(400, 'Chybí čas uložení.');
	const note = typeof raw.note === 'string' ? raw.note.slice(0, 500) : undefined;
	const restoredFrom = typeof raw.restoredFrom === 'number' && Number.isInteger(raw.restoredFrom) ? raw.restoredFrom : undefined;
	const origin = raw.origin === 'import' || raw.origin === 'saved' ? raw.origin : undefined;
	return {
		courseId,
		version,
		savedAt,
		hash,
		...(note ? { note } : {}),
		...(restoredFrom !== undefined ? { restoredFrom } : {}),
		...(origin ? { origin } : {}),
		// Stored as sent, not as parsed: parsing may normalise, and a version is a copy.
		doc: raw.doc as CourseV2
	};
}

const VISIBILITIES = new Set(['private', 'public', 'logged_only', 'draft', 'approved', 'locked']);

function parsePublication(body: unknown): Publication {
	if (typeof body !== 'object' || body === null) throw new VersionError(400, 'Chybí zveřejnění.');
	const raw = body as Record<string, unknown>;
	if (typeof raw.version !== 'number') throw new VersionError(400, 'Chybí číslo verze.');
	checkNumber(raw.version);
	if (typeof raw.visibility !== 'string' || !VISIBILITIES.has(raw.visibility)) {
		throw new VersionError(400, 'Neplatná viditelnost.');
	}
	if (typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) throw new VersionError(400, 'Chybí čas.');
	return { version: raw.version, visibility: raw.visibility as Publication['visibility'], at: raw.at };
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch {
		return null;
	}
}

async function atomicWrite(path: string, text: string) {
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temp, text, 'utf8');
	await rename(temp, path);
}
