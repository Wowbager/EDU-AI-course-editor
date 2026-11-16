import { afterEach, describe, expect, it } from 'vitest';
import type { WriteSnapshot } from '$lib/domain/write-snapshot';
import {
	dropSnapshot,
	loadSnapshot,
	saveSnapshot,
	useSnapshotBackend,
	type SnapshotBackend
} from './write-snapshot-store';

const snap = (courseId: string): WriteSnapshot => ({
	courseId,
	savedAt: 1,
	rows: [{ blockId: 'B1', lessonId: 'L1' }],
	plan: null
});

afterEach(() => useSnapshotBackend());

describe('the batch store', () => {
	it('keeps a snapshot per course and forgets it when dropped', async () => {
		const map = new Map<string, WriteSnapshot>();
		useSnapshotBackend({
			get: async (id) => map.get(id),
			put: async (s) => void map.set(s.courseId, s),
			delete: async (id) => void map.delete(id)
		});
		await saveSnapshot(snap('A'));
		await saveSnapshot(snap('B'));
		expect(await loadSnapshot('A')).toEqual(snap('A'));
		await dropSnapshot('A');
		expect(await loadSnapshot('A')).toBeUndefined();
		expect(await loadSnapshot('B')).toEqual(snap('B'));
	});

	it('works when storage fails: nothing throws, nothing is found', async () => {
		const fail = async () => {
			throw new Error('blocked');
		};
		useSnapshotBackend({ get: fail, put: fail, delete: fail } as SnapshotBackend);
		await expect(saveSnapshot(snap('A'))).resolves.toBeUndefined();
		await expect(dropSnapshot('A')).resolves.toBeUndefined();
		expect(await loadSnapshot('A')).toBeUndefined();
	});

	it('works without IndexedDB at all', async () => {
		expect(await loadSnapshot('A')).toBeUndefined();
		await expect(saveSnapshot(snap('A'))).resolves.toBeUndefined();
	});
});
