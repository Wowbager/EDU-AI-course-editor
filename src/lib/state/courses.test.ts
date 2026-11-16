import { describe, expect, it } from 'vitest';
import {
	DRAFT_PREFIX,
	META_PREFIX,
	draftKeyFor,
	listLocalCourses,
	mergeCourses,
	otherDraftKeys,
	readMeta,
	readOpenCourse,
	writeMeta,
	writeOpenCourse,
	type CourseStorage
} from './courses';

/** A Map-backed storage; `limit` caps the total characters, like a quota. */
export class FakeStorage implements CourseStorage {
	map = new Map<string, string>();
	limit = Number.POSITIVE_INFINITY;

	get length(): number {
		return this.map.size;
	}
	key(index: number): string | null {
		return [...this.map.keys()][index] ?? null;
	}
	getItem(key: string): string | null {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		let size = key.length + value.length;
		for (const [k, v] of this.map) if (k !== key) size += k.length + v.length;
		if (size > this.limit) throw new DOMException('full', 'QuotaExceededError');
		this.map.set(key, value);
	}
	removeItem(key: string): void {
		this.map.delete(key);
	}
}

describe('course meta', () => {
	it('round-trips a name and a time, and reads nothing from a broken record', () => {
		const storage = new FakeStorage();
		writeMeta(storage, 'KURZ_A', 'Zlomky', '2026-11-10T10:00:00.000Z');
		expect(readMeta(storage, 'KURZ_A')).toEqual({
			courseId: 'KURZ_A',
			name: 'Zlomky',
			savedAt: '2026-11-10T10:00:00.000Z'
		});
		storage.setItem(`${META_PREFIX}KURZ_B`, '{broken');
		expect(readMeta(storage, 'KURZ_B')).toBeNull();
		expect(readMeta(storage, 'KURZ_C')).toBeNull();
	});

	it('lists only the meta keys, never the drafts or anything else', () => {
		const storage = new FakeStorage();
		writeMeta(storage, 'KURZ_A', 'A', '2026-11-10T10:00:00.000Z');
		writeMeta(storage, 'KURZ_B', 'B', '2026-11-09T10:00:00.000Z');
		storage.setItem(draftKeyFor('KURZ_A'), '{"big":"draft"}');
		storage.setItem('edu-editor:ui:v1', '{}');
		expect(
			listLocalCourses(storage)
				.map((c) => c.courseId)
				.sort()
		).toEqual(['KURZ_A', 'KURZ_B']);
	});

	it('remembers which course was open last', () => {
		const storage = new FakeStorage();
		expect(readOpenCourse(storage)).toBeNull();
		writeOpenCourse(storage, 'KURZ_A');
		expect(readOpenCourse(storage)).toBe('KURZ_A');
	});

	it('offers the other courses’ draft keys for eviction, never the open one', () => {
		const storage = new FakeStorage();
		storage.setItem(draftKeyFor('KURZ_A'), 'a');
		storage.setItem(draftKeyFor('KURZ_B'), 'b');
		storage.setItem('edu-editor:draft:v1', 'legacy');
		expect(otherDraftKeys(storage, 'KURZ_A')).toEqual([`${DRAFT_PREFIX}KURZ_B`]);
	});
});

describe('merging drafts and histories into one list', () => {
	const draft = (courseId: string, name: string, savedAt: string) => ({
		courseId,
		name,
		savedAt
	});

	it('deduplicates by course and lets the fresher timestamp name the row', () => {
		const merged = mergeCourses(
			[draft('KURZ_A', 'Rozepsaný', '2026-11-10T10:00:00.000Z')],
			[
				{ courseId: 'KURZ_A', name: 'Uložený', savedAt: '2026-11-09T10:00:00.000Z', version: 2 },
				{ courseId: 'KURZ_B', name: 'Jen verze', savedAt: '2026-11-08T10:00:00.000Z', version: 1 }
			]
		);
		expect(merged).toEqual([
			{
				courseId: 'KURZ_A',
				name: 'Rozepsaný',
				savedAt: '2026-11-10T10:00:00.000Z',
				where: 'draft'
			},
			{
				courseId: 'KURZ_B',
				name: 'Jen verze',
				savedAt: '2026-11-08T10:00:00.000Z',
				where: 'history'
			}
		]);
	});

	it('a course with a draft reads as edited even when a version was saved later', () => {
		const merged = mergeCourses(
			[draft('KURZ_A', 'Rozepsaný', '2026-11-09T10:00:00.000Z')],
			[{ courseId: 'KURZ_A', name: 'Uložený', savedAt: '2026-11-10T10:00:00.000Z', version: 2 }]
		);
		expect(merged[0]).toMatchObject({ name: 'Uložený', where: 'draft' });
	});

	it('sorts newest first, and by name when the times agree', () => {
		const t = '2026-11-10T10:00:00.000Z';
		const merged = mergeCourses(
			[
				draft('KURZ_C', 'C', t),
				draft('KURZ_A', 'A', t),
				draft('KURZ_B', 'B', '2026-11-11T10:00:00.000Z')
			],
			[]
		);
		expect(merged.map((c) => c.courseId)).toEqual(['KURZ_B', 'KURZ_A', 'KURZ_C']);
	});
});
