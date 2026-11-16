/**
 * What survives a reload of a batch of cards being written: the plan (its request, the
 * model's turn and its targets) and the cards not written yet. Kept per course, and gone
 * once every card is written or no longer in the course, or after a week.
 *
 * Only data and decisions are here; `state/write-snapshot-store.ts` keeps it in IndexedDB.
 */
import type { CourseV2 } from './schema';
import type { PlanRequest, PlanTargets } from './plan';
import type { AssistantTurnData } from './lesson-writing';

export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PlanSnapshot {
	course: string;
	request: PlanRequest;
	turn: AssistantTurnData;
	targets: PlanTargets;
}

export interface WriteSnapshot {
	courseId: string;
	savedAt: number;
	/** The cards not done, in queue order. */
	rows: { blockId: string; lessonId: string }[];
	/** None when the batch was stopped or reloaded before the plan was made. */
	plan: PlanSnapshot | null;
}

/** The snapshot of `rows` still to write, or `undefined` when all are done. */
export function makeSnapshot(
	courseId: string,
	rows: readonly { blockId: string; lessonId: string; state: string }[],
	plan: PlanSnapshot | null,
	now: number
): WriteSnapshot | undefined {
	const rest = rows
		.filter((r) => r.state !== 'done')
		.map(({ blockId, lessonId }) => ({ blockId, lessonId }));
	if (rest.length === 0) return undefined;
	return { courseId, savedAt: now, rows: rest, plan: plan?.course === courseId ? plan : null };
}

/**
 * What is still worth writing in `doc`: the rows whose card is in the course, with the
 * plan. `undefined` when the snapshot is too old, is of another course, is malformed or
 * has no card left; the caller then removes it.
 */
export function restoreSnapshot(
	snapshot: unknown,
	doc: CourseV2,
	now: number
): { rows: WriteSnapshot['rows']; plan: PlanSnapshot | null } | undefined {
	const s = snapshot as Partial<WriteSnapshot> | null | undefined;
	if (typeof s !== 'object' || s === null || !Array.isArray(s.rows)) return undefined;
	if (s.courseId !== doc.course_id || typeof s.savedAt !== 'number') return undefined;
	if (now - s.savedAt > SNAPSHOT_MAX_AGE_MS) return undefined;
	const present = new Set(doc.blocks.map((b) => b.block_id));
	const rows = s.rows.filter(
		(r) =>
			typeof r?.blockId === 'string' && typeof r.lessonId === 'string' && present.has(r.blockId)
	);
	if (rows.length === 0) return undefined;
	const plan = s.plan?.course === doc.course_id ? s.plan : null;
	return { rows, plan };
}
