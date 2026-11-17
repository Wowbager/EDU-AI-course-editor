import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Disk, maxUsedBytes, measureDir, minFreeBytes } from '../disk';
import { UploadLimits } from '../upload-limits';

const MB = 1024 * 1024;

function diskWith(freeMb: number) {
	const state = { free: freeMb, calls: 0, t: 0 };
	const disk = new Disk(1000 * MB, {
		statfs: async () => {
			state.calls++;
			return { bavail: state.free, bsize: MB };
		},
		now: () => state.t
	});
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

	it('asks the disk again only after a second', async () => {
		const { disk, state } = diskWith(2000);
		await disk.roomFor('/d', 'upload');
		state.free = 10;
		expect(await disk.roomFor('/d', 'upload')).toBe(true);
		state.t += 1_500;
		expect(await disk.roomFor('/d', 'upload')).toBe(false);
		expect(state.calls).toBe(2);
	});

	it('refuses nothing when the disk cannot say', async () => {
		const disk = new Disk(MB, {
			statfs: async () => {
				throw new Error('ENOENT');
			}
		});
		expect(await disk.roomFor('/missing', 'upload')).toBe(true);
	});

	it('takes its floor from DATA_MIN_FREE_MB', () => {
		expect(minFreeBytes({})).toBe(1024 * MB);
		expect(minFreeBytes({ DATA_MIN_FREE_MB: '50' })).toBe(50 * MB);
		expect(minFreeBytes({ DATA_MIN_FREE_MB: 'x' })).toBe(1024 * MB);
		// Left empty in a compose file: the default, not no floor at all.
		expect(minFreeBytes({ DATA_MIN_FREE_MB: '' })).toBe(1024 * MB);
		expect(minFreeBytes({ DATA_MIN_FREE_MB: '0' })).toBe(0);
	});
});

describe('the storage budget', () => {
	const plenty = async () => ({ bavail: 1_000_000, bsize: MB });

	function budget(usedMb: number) {
		const state = { used: usedMb * MB, counts: 0, t: 0 };
		const disk = new Disk(0, {
			statfs: plenty,
			now: () => state.t,
			maxUsed: 100 * MB,
			measure: async () => {
				state.counts++;
				return state.used;
			}
		});
		return { disk, state };
	}

	it('stops uploads at 85 % of the budget and versions only at all of it', async () => {
		const { disk } = budget(80);
		expect(await disk.roomFor('/d', 'upload', 4 * MB)).toBe(true);
		// What was just let in counts: 84 MB and more is past 85 MB.
		expect(await disk.roomFor('/d', 'upload', MB)).toBe(false);
		expect(await disk.roomFor('/d', 'version', 10 * MB)).toBe(true);
		expect(await disk.roomFor('/d', 'version', 10 * MB)).toBe(false);
	});

	it('counts the files again after five minutes, and only once for requests at the same time', async () => {
		const { disk, state } = budget(10);
		await Promise.all([disk.roomFor('/d', 'upload'), disk.roomFor('/d', 'upload')]);
		expect(state.counts).toBe(1);
		state.used = 99 * MB;
		expect(await disk.roomFor('/d', 'upload')).toBe(true);
		state.t += 5 * 60_000;
		expect(await disk.roomFor('/d', 'upload')).toBe(false);
		expect(state.counts).toBe(2);
	});

	it('does not take a failed count for an empty disk, and counts again next time', async () => {
		const state = { fail: true, counts: 0 };
		const disk = new Disk(0, {
			statfs: plenty,
			maxUsed: 100 * MB,
			measure: async () => {
				state.counts++;
				if (state.fail) throw new Error('EIO');
				return 99 * MB;
			}
		});
		expect(await disk.roomFor('/d', 'upload')).toBe(true);
		state.fail = false;
		expect(await disk.roomFor('/d', 'upload')).toBe(false);
		expect(state.counts).toBe(2);
	});

	it('gives back what was let in but not written', async () => {
		const disk = new Disk(0, { statfs: plenty, maxUsed: 100 * MB, measure: async () => 80 * MB });
		expect(await disk.roomFor('/d', 'upload', 4 * MB)).toBe(true);
		disk.release('/d', 4 * MB);
		expect(await disk.roomFor('/d', 'upload', 4 * MB)).toBe(true);
	});

	it('has no budget when DATA_MAX_MB is 0', async () => {
		const disk = new Disk(0, { statfs: plenty, maxUsed: 0, measure: async () => 1e15 });
		expect(await disk.roomFor('/d', 'upload', MB)).toBe(true);
		expect(maxUsedBytes({})).toBe(900 * MB);
		expect(maxUsedBytes({ DATA_MAX_MB: '' })).toBe(900 * MB);
		expect(maxUsedBytes({ DATA_MAX_MB: '500' })).toBe(500 * MB);
		expect(maxUsedBytes({ DATA_MAX_MB: '0' })).toBe(0);
	});

	it('measures what the files take on disk, in whole blocks', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'measure-'));
		try {
			await mkdir(join(dir, 'a', 'b'), { recursive: true });
			await writeFile(join(dir, 'a', 'b', 'x.json'), 'x');
			await writeFile(join(dir, 'y.bin'), Buffer.alloc(10_000));
			const used = await measureDir(dir);
			// The directories count too, and a file takes whole blocks where the disk says.
			expect(used).toBeGreaterThanOrEqual(10_001);
			expect(await measureDir(join(dir, 'missing'))).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
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
