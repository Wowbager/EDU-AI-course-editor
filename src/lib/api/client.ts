/**
 * The API the editor talks to.
 *
 * Requests go to a same-origin `/api` path, which the SvelteKit server layer proxies
 * to the Laravel API with the session cookie attached — the pattern the admin already
 * uses, rather than a second auth scheme in the browser.
 *
 * Everything here degrades: if the API is unreachable, the editor still edits. What it
 * cannot do without the skill configuration is check vector length, and validation
 * says so rather than guessing a dimension count (§3 invariant 6).
 */
import type { GpfDomain, SkillConfig, SkillDimension } from '$lib/domain/skill-config';
import { skillConfigFromDimensions, skillConfigFromGpfTaxonomy } from '$lib/domain/skill-config';
import gpfMatematika from '$lib/gpf/gpf-matematika.json';

const API = '/api';

async function getJson<T>(path: string): Promise<T | null> {
	try {
		const response = await fetch(`${API}${path}`, {
			headers: { accept: 'application/json' },
			credentials: 'include'
		});
		if (!response.ok) return null;
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

/**
 * The course's own skill configuration, or the platform's canonical dimension list
 * when the course has none yet.
 *
 * `GET /api/courses/{id}/skill-config` → `{ data: { vector: { dimension_count, dimensions[] } } | null }`
 * `GET /api/gpf/dimensions`           → `{ data: SkillDimension[] }`
 */
export async function loadSkillConfig(courseId: string): Promise<SkillConfig | null> {
	if (courseId !== '') {
		const response = await getJson<{ data: SkillConfig | null }>(
			`/courses/${encodeURIComponent(courseId)}/skill-config`
		);
		if (response?.data?.vector != null) return response.data;
	}

	const fallback = await getJson<{ data: SkillDimension[] }>('/gpf/dimensions');
	if (fallback?.data != null && fallback.data.length > 0) {
		return skillConfigFromDimensions(fallback.data);
	}

	// Last resort: the taxonomy shipped with the editor, the same export the admin
	// page produces. It is marked `is_default`, and the vector editor says so — an
	// author editing a course on a different vector must load that course's own.
	return skillConfigFromGpfTaxonomy(gpfMatematika as GpfDomain[], 'GPF – Matematika');
}

export interface PublishResult {
	ok: boolean;
	status: number;
	message?: string;
	currentVersion?: number;
}

/**
 * Publish: `POST /api/courses/upload` with the whole document as the body.
 *
 * The API refuses a version that is not higher than the stored one, which is why the
 * editor bumps `version` before sending and shows a diff against the last published
 * version first (§2).
 */
export async function publishCourse(doc: Record<string, unknown>): Promise<PublishResult> {
	try {
		const response = await fetch(`${API}/courses/upload`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			credentials: 'include',
			body: JSON.stringify(doc)
		});
		const payload = (await response.json().catch(() => ({}))) as {
			message?: string;
			current_version?: number;
		};
		return {
			ok: response.ok,
			status: response.status,
			message: payload.message,
			currentVersion: payload.current_version
		};
	} catch (error) {
		return { ok: false, status: 0, message: error instanceof Error ? error.message : String(error) };
	}
}
