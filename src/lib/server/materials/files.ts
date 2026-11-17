/**
 * A course's materials on the editor's server: one JSON file per attached file, under
 *
 *     DATA_DIR/owners/<owner>/courses/<course_id>/materials/<hash>.json
 *
 * the same place, owner and rules as the versions beside them (`versions/files.ts`): no
 * database, every write goes to a temporary file first and is renamed into place, writes
 * to one course are queued. The file name is the file's content hash, so the same file
 * attached twice is one file.
 *
 * What is stored is what the browser read (`domain/materials.ts`): sections of Markdown.
 * The original file is never sent or kept.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	HASH,
	MAX_FILES,
	MAX_PAGES,
	materialFileSchema,
	pagesIn,
	type MaterialFile
} from '$lib/domain/materials';
import { courseDirOf, VersionError } from '../versions/files';
import { disk, DISK_FULL } from '../disk';

export const MAX_FILE_BODY_BYTES = 6 * 1024 * 1024;

type Stored = MaterialFile & { addedAt: string };

export class MaterialFiles {
	#root: string;
	#queues = new Map<string, Promise<unknown>>();

	constructor(root: string) {
		this.#root = root;
	}

	#dir(owner: string, courseId: string): string {
		return join(courseDirOf(this.#root, owner, courseId), 'materials');
	}

	#serial<T>(key: string, work: () => Promise<T>): Promise<T> {
		const previous = this.#queues.get(key) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(work);
		this.#queues.set(key, next);
		next
			.finally(() => {
				if (this.#queues.get(key) === next) this.#queues.delete(key);
			})
			.catch(() => {});
		return next;
	}

	async #all(dir: string): Promise<Stored[]> {
		const names = await readdir(dir).catch(() => [] as string[]);
		const out: Stored[] = [];
		for (const name of names) {
			if (!/^[0-9a-f]{8,64}\.json$/.test(name)) continue;
			try {
				const raw = JSON.parse(await readFile(join(dir, name), 'utf8')) as { addedAt?: unknown };
				const parsed = materialFileSchema.safeParse(raw);
				if (parsed.success)
					out.push({
						...parsed.data,
						addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : ''
					});
			} catch {
				// A file that cannot be read is not a material.
			}
		}
		return out.sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.name.localeCompare(b.name));
	}

	/** The course's files, in the order they were attached. */
	async list(owner: string, courseId: string): Promise<MaterialFile[]> {
		return (await this.#all(this.#dir(owner, courseId))).map(({ addedAt: _at, ...file }) => file);
	}

	/** Store one file. The same file again replaces itself; past the limits it is refused. */
	async add(owner: string, courseId: string, body: unknown): Promise<MaterialFile> {
		const parsed = materialFileSchema.safeParse(body);
		if (!parsed.success) throw new VersionError(400, 'Podklad nemá očekávaný tvar.');
		const file = parsed.data;
		const dir = this.#dir(owner, courseId);
		return this.#serial(dir, async () => {
			const others = (await this.#all(dir)).filter((f) => f.hash !== file.hash);
			if (others.length >= MAX_FILES) throw new VersionError(429, 'Podkladů je příliš mnoho.');
			if (pagesIn(others) + file.pages > MAX_PAGES)
				throw new VersionError(429, `Podklady mohou mít nejvýše ${MAX_PAGES} stran nebo snímků.`);
			const previous = (await this.#all(dir)).find((f) => f.hash === file.hash);
			const stored: Stored = { ...file, addedAt: previous?.addedAt || new Date().toISOString() };
			const text = JSON.stringify(stored);
			if (!(await disk().roomFor(this.#root, 'upload', Buffer.byteLength(text))))
				throw new VersionError(507, DISK_FULL);
			await mkdir(dir, { recursive: true });
			await atomicWrite(join(dir, `${file.hash}.json`), text);
			return file;
		});
	}

	async remove(owner: string, courseId: string, hash: string): Promise<void> {
		if (!HASH.test(hash)) throw new VersionError(400, 'Neplatný podklad.');
		const dir = this.#dir(owner, courseId);
		await this.#serial(dir, () => rm(join(dir, `${hash}.json`), { force: true }));
	}
}

async function atomicWrite(path: string, text: string) {
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temp, text, 'utf8');
	await rename(temp, path);
}
