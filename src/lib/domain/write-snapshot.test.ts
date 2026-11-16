import { describe, expect, it } from 'vitest';
import { addBlock, addLesson } from './commands';
import { emptyCourse } from './document';
import {
	makeSnapshot,
	restoreSnapshot,
	SNAPSHOT_MAX_AGE_MS,
	type PlanSnapshot
} from './write-snapshot';

const NOW = Date.UTC(2026, 10, 16);
const plan = (course: string) =>
	({
		course,
		request: {},
		turn: {},
		targets: { lessons: [], cards: [] }
	}) as unknown as PlanSnapshot;

function course() {
	let doc = addLesson(emptyCourse('K1', 'Zlomky'), 'Polovina').doc;
	const lessonId = doc.lessons[0].lesson_id;
	const a = addBlock(doc, lessonId, 'display');
	const b = addBlock(a.doc, lessonId, 'display');
	return { doc: b.doc, lessonId, ids: [a.ref!.blockId!, b.ref!.blockId!] };
}

describe('the batch kept for a reload', () => {
	it('keeps only cards not done, with the plan', () => {
		const { lessonId, ids } = course();
		const snap = makeSnapshot(
			'K1',
			[
				{ blockId: ids[0], lessonId, state: 'done' },
				{ blockId: ids[1], lessonId, state: 'failed' }
			],
			plan('K1'),
			NOW
		)!;
		expect(snap.rows).toEqual([{ blockId: ids[1], lessonId }]);
		expect(snap.plan?.course).toBe('K1');
	});

	it('is nothing when every card is done, and drops a plan of another course', () => {
		const { lessonId, ids } = course();
		expect(makeSnapshot('K1', [{ blockId: ids[0], lessonId, state: 'done' }], null, NOW)).toBe(
			undefined
		);
		const snap = makeSnapshot(
			'K1',
			[{ blockId: ids[0], lessonId, state: 'waiting' }],
			plan('K2'),
			NOW
		);
		expect(snap?.plan).toBe(null);
	});

	it('round-trips through JSON, without the cards that left the course', () => {
		const { doc, lessonId, ids } = course();
		const snap = makeSnapshot(
			'K1',
			[
				{ blockId: ids[0], lessonId, state: 'waiting' },
				{ blockId: 'gone', lessonId, state: 'waiting' }
			],
			plan('K1'),
			NOW
		)!;
		const back = restoreSnapshot(JSON.parse(JSON.stringify(snap)), doc, NOW + 1000)!;
		expect(back.rows).toEqual([{ blockId: ids[0], lessonId }]);
		expect(back.plan?.course).toBe('K1');
	});

	it('is gone when no card is left, when older than 7 days, of another course, or malformed', () => {
		const { doc, lessonId, ids } = course();
		const rows = [{ blockId: ids[0], lessonId, state: 'waiting' }];
		const snap = makeSnapshot('K1', rows, null, NOW)!;
		expect(restoreSnapshot(snap, doc, NOW + SNAPSHOT_MAX_AGE_MS)).toBeDefined();
		expect(restoreSnapshot(snap, doc, NOW + SNAPSHOT_MAX_AGE_MS + 1)).toBeUndefined();
		expect(restoreSnapshot({ ...snap, courseId: 'K2' }, doc, NOW)).toBeUndefined();
		expect(
			restoreSnapshot(makeSnapshot('K1', [{ ...rows[0], blockId: 'gone' }], null, NOW), doc, NOW)
		).toBeUndefined();
		expect(restoreSnapshot('x', doc, NOW)).toBeUndefined();
		expect(restoreSnapshot(undefined, doc, NOW)).toBeUndefined();
	});
});
