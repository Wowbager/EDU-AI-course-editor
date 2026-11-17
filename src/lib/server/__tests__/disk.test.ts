import { describe, expect, it } from 'vitest';
import { Disk, minFreeBytes } from '../disk';
import { UploadLimits } from '../upload-limits';

const MB = 1024 * 1024;

function diskWith(freeMb: number) {
	const state = { free: freeMb, calls: 0, t: 0 };
	const disk = new Disk(
		1000 * MB,
		async () => {
			state.calls++;
			return { bavail: state.free, bsize: MB };
		},
		() => state.t
	);
	return { disk, state };
}

describe('Disk', () => {
	it('stops uploads before saving a version, and both on a full disk', async () => {
		expect(await diskWith(2000).disk.roomFor('/d', 'upload')).toBe(true);
		const low = diskWith(500).disk;
		expect(await low.roomFor('/d', 'upload')).toBe(false);
		expect(await low.roomFor('/d', 'version')).toBe(true);
		expect(await diskWith(100).disk.roomFor('/d', 'version')).toBe(false);
	});

	it('asks the disk again only after a few seconds', async () => {
		const { disk, state } = diskWith(2000);
		await disk.roomFor('/d', 'upload');
		state.free = 10;
		expect(await disk.roomFor('/d', 'upload')).toBe(true);
		state.t += 6_000;
		expect(await disk.roomFor('/d', 'upload')).toBe(false);
		expect(state.calls).toBe(2);
	});

	it('refuses nothing when the disk cannot say', async () => {
		const disk = new Disk(MB, async () => {
			throw new Error('ENOENT');
		});
		expect(await disk.roomFor('/missing', 'upload')).toBe(true);
	});

	it('takes its floor from DATA_MIN_FREE_MB', () => {
		expect(minFreeBytes({})).toBe(1024 * MB);
		expect(minFreeBytes({ DATA_MIN_FREE_MB: '50' })).toBe(50 * MB);
		expect(minFreeBytes({ DATA_MIN_FREE_MB: 'x' })).toBe(1024 * MB);
	});
});

describe('UploadLimits', () => {
	it('bounds one address by files a minute and bytes a day, not by workspace', () => {
		const clock = { t: Date.UTC(2026, 10, 1, 12) };
		const limits = new UploadLimits({ perMinute: 2, bytesPerDay: 10 * MB, now: () => clock.t });
		expect(limits.admit('1.2.3.4', MB).ok).toBe(true);
		expect(limits.admit('1.2.3.4', MB).ok).toBe(true);
		expect(limits.admit('1.2.3.4', MB)).toMatchObject({ ok: false, reason: 'rate' });
		expect(limits.admit('5.6.7.8', MB).ok).toBe(true);
		clock.t += 61_000;
		expect(limits.admit('1.2.3.4', 9 * MB).ok).toBe(true);
		clock.t += 61_000;
		expect(limits.admit('1.2.3.4', MB)).toMatchObject({ ok: false, reason: 'budget' });
	});
});
