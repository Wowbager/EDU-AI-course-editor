/**
 * Room left in `DATA_DIR`. Uploads (pictures, materials) stop while less than
 * `DATA_MIN_FREE_MB` is free (default 1024), saving a course's version only at a quarter
 * of it: what a teacher has written is the last thing to be refused, and the versions
 * already kept are never lost to a full disk.
 */
import { statfs as nodeStatfs } from 'node:fs/promises';

export type Need = 'upload' | 'version';

const DEFAULT_MIN_FREE_MB = 1024;
/** Asked again at most this often: an upload burst does not stat the disk each time. */
const FRESH_MS = 5_000;

type Statfs = (path: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;

export function minFreeBytes(env: Readonly<Record<string, string | undefined>>): number {
	const mb = Number(env.DATA_MIN_FREE_MB);
	return (Number.isFinite(mb) && mb >= 0 ? mb : DEFAULT_MIN_FREE_MB) * 1024 * 1024;
}

export class Disk {
	#seen = new Map<string, { at: number; free: number | null }>();

	constructor(
		private readonly minFree: number,
		private readonly statfs: Statfs = nodeStatfs,
		private readonly now: () => number = Date.now
	) {}

	async #free(root: string): Promise<number | null> {
		const seen = this.#seen.get(root);
		if (seen !== undefined && this.now() - seen.at < FRESH_MS) return seen.free;
		let free: number | null;
		try {
			const s = await this.statfs(root);
			free = Number(s.bavail) * Number(s.bsize);
		} catch {
			// Not made yet, or a platform that cannot say: nothing to go by, so not refused.
			free = null;
		}
		this.#seen.set(root, { at: this.now(), free });
		return free;
	}

	/** Whether `need` may write under `root` now. */
	async roomFor(root: string, need: Need): Promise<boolean> {
		const free = await this.#free(root);
		if (free === null) return true;
		return free >= (need === 'version' ? this.minFree / 4 : this.minFree);
	}
}

let shared: Disk | null = null;

/** One per process, from the environment. */
export function disk(): Disk {
	shared ??= new Disk(minFreeBytes(process.env));
	return shared;
}

/** What a teacher is told when the disk is full. */
export const DISK_FULL = 'Na serveru teď nejde nic uložit. Zkus to prosím za chvíli.';
