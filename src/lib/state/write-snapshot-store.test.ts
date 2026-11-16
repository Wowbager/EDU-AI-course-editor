import { afterEach, describe, expect, it, vi } from 'vitest';
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

	it('closes a database that opens after the open was given up as blocked', async () => {
		const handle = { close: vi.fn(), onversionchange: null as null | (() => void) };
		const request: any = {};
		vi.stubGlobal('indexedDB', { open: () => request });
		const loading = loadSnapshot('A');
		await Promise.resolve();
		request.onblocked();
		expect(await loading).toBeUndefined();
		request.result = handle;
		request.onsuccess();
		expect(handle.close).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it('closes its database when another tab wants to upgrade it', async () => {
		const handle = { close: vi.fn(), onversionchange: null as null | (() => void) };
		const request: any = { result: handle };
		vi.stubGlobal('indexedDB', {
			open: () => {
				queueMicrotask(() => request.onsuccess());
				return request;
			}
		});
		handle.close.mockClear();
		await loadSnapshot('A').catch(() => undefined);
		handle.onversionchange?.();
		expect(handle.close).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
