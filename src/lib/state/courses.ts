/**
 * The courses this browser knows about: their drafts, the small meta the switcher
 * lists, and which one was open last.
 *
 * Each course's draft lives under its own `localStorage` key (`draftKeyFor`), so
 * two tabs editing two courses never see each other's writes as a conflict, and
 * switching courses never overwrites one. The keys are small enough to scan; the
 * drafts themselves are not parsed to build the list — `writeMeta` keeps a name
 * and a timestamp beside each, updated on every flush.
 *
 * A durable copy of every draft goes to IndexedDB (`draft-archive.ts`). When the
 * quota forces a draft out of `localStorage` (`DraftSession.flush`), the meta stays
 * and the course opens from that copy.
 */
import { z } from 'zod';
import { DRAFT_KEY } from './draft';
import type { CourseSummary } from '$lib/domain/versions';

/** The single-course key of builds before the switcher; migrated on first restore. */
export const LEGACY_DRAFT_KEY = DRAFT_KEY;
export const DRAFT_PREFIX = `${DRAFT_KEY}:`;
export const META_PREFIX = 'edu-editor:course:v1:';
export const OPEN_KEY = 'edu-editor:open-course:v1';

export const draftKeyFor = (courseId: string): string => DRAFT_PREFIX + courseId;
export const metaKeyFor = (courseId: string): string => META_PREFIX + courseId;

/** What these helpers need from storage; `localStorage` satisfies it, tests fake it. */
export interface CourseStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key(index: number): string | null;
	readonly length: number;
}

export interface CourseMeta {
	courseId: string;
	name: string;
	/** ISO timestamp of the last flush (draft) or save (history). */
	savedAt: string;
}

/** One row of „Moje kurzy“. `where` picks the quiet verb: upraveno / uloženo. */
export interface CourseEntry extends CourseMeta {
	where: 'draft' | 'history';
}

const metaSchema = z.object({ name: z.string(), savedAt: z.string() });

export function readMeta(storage: CourseStorage, courseId: string): CourseMeta | null {
	try {
		const text = storage.getItem(metaKeyFor(courseId));
		if (text === null) return null;
		const parsed = metaSchema.parse(JSON.parse(text));
		return { courseId, ...parsed };
	} catch {
		return null;
	}
}

/** Best-effort: a missing meta costs a row in the list, never the draft itself. */
export function writeMeta(
	storage: CourseStorage,
	courseId: string,
	name: string,
	savedAt: string
): void {
	try {
		storage.setItem(metaKeyFor(courseId), JSON.stringify({ name, savedAt }));
	} catch {
		// The list also reads the server's histories; nothing else depends on this.
	}
}

export function readOpenCourse(storage: CourseStorage): string | null {
	try {
		return storage.getItem(OPEN_KEY);
	} catch {
		return null;
	}
}

export function writeOpenCourse(storage: CourseStorage, courseId: string): void {
	try {
		storage.setItem(OPEN_KEY, courseId);
	} catch {
		// Without the pointer the next load restores the legacy key or seeds; no loss.
	}
}

/** Every course with a meta key, newest first. The drafts are never parsed here. */
export function listLocalCourses(storage: CourseStorage): CourseMeta[] {
	const found: CourseMeta[] = [];
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);
		if (key === null || !key.startsWith(META_PREFIX)) continue;
		const meta = readMeta(storage, key.slice(META_PREFIX.length));
		if (meta !== null) found.push(meta);
	}
	return found;
}

/** The draft keys of every course except `keepCourseId` — eviction candidates. */
export function otherDraftKeys(storage: CourseStorage, keepCourseId: string): string[] {
	const keep = draftKeyFor(keepCourseId);
	const found: string[] = [];
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);
		if (key !== null && key.startsWith(DRAFT_PREFIX) && key !== keep) found.push(key);
	}
	return found;
}

/**
 * The switcher's list: local drafts and saved histories as one, deduplicated by
 * course. The fresher timestamp names the row; a course with a draft is always
 * „upraveno“, even when a version was saved after the last flush.
 */
export function mergeCourses(drafts: CourseMeta[], history: CourseSummary[]): CourseEntry[] {
	const byId = new Map<string, CourseEntry>();
	for (const h of history) {
		const seen = byId.get(h.courseId);
		if (seen === undefined || h.savedAt > seen.savedAt) {
			byId.set(h.courseId, {
				courseId: h.courseId,
				name: h.name,
				savedAt: h.savedAt,
				where: 'history'
			});
		}
	}
	for (const d of drafts) {
		const seen = byId.get(d.courseId);
		if (seen === undefined) {
			byId.set(d.courseId, { ...d, where: 'draft' });
		} else {
			const fresher = d.savedAt >= seen.savedAt ? d : seen;
			byId.set(d.courseId, {
				courseId: d.courseId,
				name: fresher.name,
				savedAt: fresher.savedAt,
				where: 'draft'
			});
		}
	}
	return [...byId.values()].sort(
		(a, b) => b.savedAt.localeCompare(a.savedAt) || a.name.localeCompare(b.name, 'cs')
	);
}
