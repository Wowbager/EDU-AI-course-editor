/**
 * The teacher's materials for the course being edited: the files read so far (kept on the
 * server, so they survive a reload and belong to the course) and the ones being read now.
 *
 * Reading happens in the browser (`$lib/materials/`, loaded only when a file is attached,
 * so the first load does not carry the libraries). What a file was read into is stored by
 * `POST /materials/:course`; the course document keeps only `source_refs` on its cards.
 */
import {
	materialFileSchema,
	MAX_FILES,
	MAX_PAGES,
	pagesIn,
	refusal,
	type MaterialFile,
	type Section
} from '$lib/domain/materials';
import { workspaceKey } from '$lib/state/versions/server';

export interface Reading {
	id: number;
	name: string;
}

const WORDS = {
	failed: (name: string) => `Soubor ${name} se nepodařilo přečíst.`,
	offline: 'Podklady se nepodařilo uložit. Zkontroluj připojení.'
};

class Materials {
	/** Files read and stored. */
	files = $state<MaterialFile[]>([]);
	/** Files being read now. */
	reading = $state<Reading[]>([]);
	/** One line for the teacher about the last thing that did not work, or empty. */
	message = $state('');
	#course: string | null = null;
	#loaded: Promise<void> = Promise.resolve();
	#next = 0;

	get sections(): Section[] {
		return this.files.flatMap((f) => f.sections);
	}

	#headers(json = false): Record<string, string> | null {
		const key = workspaceKey();
		return key
			? { 'x-editor-workspace': key, ...(json ? { 'content-type': 'application/json' } : {}) }
			: null;
	}

	/** The course's materials are here: loaded already, or loading, or loaded now. */
	ready(courseId: string): Promise<void> {
		if (this.#course !== courseId) void this.load(courseId);
		return this.#loaded;
	}

	/** The course's files from the server; another course empties the list first. */
	load(courseId: string): Promise<void> {
		return (this.#loaded = this.#fetch(courseId));
	}

	async #fetch(courseId: string): Promise<void> {
		if (this.#course !== courseId) {
			this.#course = courseId;
			this.files = [];
			this.reading = [];
			this.message = '';
		}
		const headers = this.#headers();
		if (headers === null) return;
		try {
			const response = await fetch(`/materials/${encodeURIComponent(courseId)}`, { headers });
			if (!response.ok || this.#course !== courseId) return;
			const body = (await response.json()) as { files?: unknown[] };
			this.files = (body.files ?? []).flatMap((f) => {
				const parsed = materialFileSchema.safeParse(f);
				return parsed.success ? [parsed.data] : [];
			});
		} catch {
			// Unknown, so unchanged.
		}
	}

	/** Read the files one after another and store them; the ones that cannot be taken say why. */
	async add(courseId: string, picked: readonly File[]): Promise<void> {
		this.message = '';
		const { kindOf, unsupported, readMaterial } = await import('$lib/materials/read');
		const { Refused } = await import('$lib/materials/types');
		for (const file of picked) {
			if (this.#course !== courseId) return;
			if (kindOf(file.name) === undefined) {
				this.message = unsupported(file.name);
				continue;
			}
			const why = refusal(file, { files: this.files.length, pages: pagesIn(this.files) });
			if (why !== undefined) {
				this.message = why;
				continue;
			}
			const chip = { id: ++this.#next, name: file.name };
			this.reading = [...this.reading, chip];
			try {
				const { browserIO, libraries } = await import('$lib/materials/browser');
				const read = await readMaterial(
					file,
					browserIO,
					{ pages: Math.max(0, MAX_PAGES - pagesIn(this.files)) },
					libraries
				);
				if (this.files.some((f) => f.hash === read.hash)) continue;
				const stored = await this.#store(courseId, read);
				if (this.#course === courseId && typeof stored !== 'string')
					this.files = [...this.files, stored];
				else if (typeof stored === 'string') this.message = stored;
			} catch (e) {
				this.message = e instanceof Refused ? e.message : WORDS.failed(file.name);
			} finally {
				this.reading = this.reading.filter((r) => r.id !== chip.id);
			}
		}
	}

	/** The stored file, or a sentence about why it was not stored. */
	async #store(courseId: string, file: MaterialFile): Promise<MaterialFile | string> {
		const headers = this.#headers(true);
		if (headers === null) return WORDS.offline;
		try {
			const response = await fetch(`/materials/${encodeURIComponent(courseId)}`, {
				method: 'POST',
				headers,
				body: JSON.stringify(file)
			});
			if (response.status === 429) {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				return body?.message ?? WORDS.failed(file.name);
			}
			if (!response.ok) return WORDS.failed(file.name);
			return file;
		} catch {
			return WORDS.offline;
		}
	}

	async remove(courseId: string, hash: string): Promise<void> {
		const headers = this.#headers();
		const before = this.files;
		this.files = this.files.filter((f) => f.hash !== hash);
		this.message = '';
		if (headers === null) return;
		try {
			const response = await fetch(
				`/materials/${encodeURIComponent(courseId)}/${encodeURIComponent(hash)}`,
				{ method: 'DELETE', headers }
			);
			if (!response.ok && this.#course === courseId) this.files = before;
		} catch {
			if (this.#course === courseId) this.files = before;
		}
	}

	get full(): boolean {
		return this.files.length >= MAX_FILES;
	}
}

export const materials = new Materials();
