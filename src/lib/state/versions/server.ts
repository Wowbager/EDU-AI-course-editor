/**
 * Versions on the editor's own server (`routes/versions/`), so that a course's
 * history outlives this browser's site data.
 *
 * There is no login yet, so the owner is a random key this browser makes once and
 * keeps in `localStorage`. It is never shown to a teacher (§8) and the server stores
 * only its hash. Losing it — clearing site data, another browser — means the server
 * history is out of reach until sign-in exists (docs/OPEN-PROBLEMS.md); the browser's
 * own copy is unaffected by the server being down, and the server's copy is
 * unaffected by the browser's being cleared, as long as the key survives.
 */
import type { CourseVersion, Publication, VersionIndex } from '$lib/domain/versions';
import { VersionConflict, type VersionBackend } from './backend';

const KEY_STORAGE = 'edu-editor:workspace:v1';
const HEADER = 'x-editor-workspace';

/** This browser's key, made on first use. `null` where storage is unavailable. */
export function workspaceKey(): string | null {
	try {
		const existing = localStorage.getItem(KEY_STORAGE);
		if (existing !== null && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		localStorage.setItem(KEY_STORAGE, key);
		return key;
	} catch {
		return null;
	}
}

export class ServerBackend implements VersionBackend {
	readonly name = 'server' as const;
	#key: string;
	#fetch: typeof fetch;

	constructor(key: string, fetcher: typeof fetch = fetch) {
		this.#key = key;
		this.#fetch = fetcher;
	}

	async #call(path: string, init: RequestInit = {}): Promise<Response> {
		const response = await this.#fetch(`/versions/${path}`, {
			...init,
			headers: { ...(init.headers ?? {}), [HEADER]: this.#key, 'content-type': 'application/json' }
		});
		return response;
	}

	async index(courseId: string): Promise<VersionIndex> {
		const response = await this.#call(encodeURIComponent(courseId));
		if (!response.ok) throw new Error(`Server: ${response.status}`);
		return (await response.json()) as VersionIndex;
	}

	async get(courseId: string, version: number): Promise<CourseVersion | null> {
		const response = await this.#call(`${encodeURIComponent(courseId)}/${version}`);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`Server: ${response.status}`);
		return (await response.json()) as CourseVersion;
	}

	async put(version: CourseVersion): Promise<void> {
		const response = await this.#call(encodeURIComponent(version.courseId), {
			method: 'POST',
			body: JSON.stringify(version)
		});
		if (response.status === 409) throw new VersionConflict(version.courseId, version.version);
		if (!response.ok) throw new Error(`Server: ${response.status}`);
	}

	async setPublished(courseId: string, publication: Publication): Promise<void> {
		const response = await this.#call(`${encodeURIComponent(courseId)}/published`, {
			method: 'PUT',
			body: JSON.stringify(publication)
		});
		if (!response.ok) throw new Error(`Server: ${response.status}`);
	}
}
