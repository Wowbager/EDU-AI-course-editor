/**
 * Room left in `DATA_DIR`, by two measures:
 *
 * - **The budget** (`DATA_MAX_MB`, default 900): what the editor's files may take on
 *   disk in all. Uploads (pictures, materials) stop at 85 % of it, saving a course's
 *   version only at all of it.
 * - **The disk** (`DATA_MIN_FREE_MB`, default 1024): uploads stop while less is free,
 *   saving a version only at a quarter of it.
 *
 * Either way what a teacher has written is the last thing to be refused, and the versions
 * already kept are never lost.
 */
import { lstat, readdir, statfs as nodeStatfs } from 'node:fs/promises';
import { join } from 'node:path';

export type Need = 'upload' | 'version';

const MB = 1024 * 1024;
const DEFAULT_MIN_FREE_MB = 1024;
const DEFAULT_MAX_MB = 900;
/** Of the budget, the share uploads may fill; versions may fill the rest. */
const UPLOAD_SHARE = 0.85;
/**
 * Asked again at most this often: an upload burst does not stat the disk each time, and
 * what a second of uploads can write past the floor is bounded by the per-address limits.
 */
const FRESH_MS = 1_000;
/**
 * The files are counted again this often. In between, what was let in is added to the
 * last count; a deletion counts only from the next one.
 */
const MEASURE_MS = 5 * 60_000;
/** A file takes whole blocks, and a write rewrites an index beside it. */
const BLOCK = 4096;
const OVERHEAD = 2 * BLOCK;

type Statfs = (path: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;
/** What the files under a directory take on disk, in bytes. */
export type Measure = (root: string) => Promise<number>;

function megabytes(raw: string | undefined, fallback: number): number {
	const text = (raw ?? '').trim();
	const mb = text === '' ? NaN : Number(text);
	return (Number.isFinite(mb) && mb >= 0 ? mb : fallback) * MB;
}

export function minFreeBytes(env: Readonly<Record<string, string | undefined>>): number {
	return megabytes(env.DATA_MIN_FREE_MB, DEFAULT_MIN_FREE_MB);
}

/** The budget in bytes; 0 means none. */
export function maxUsedBytes(env: Readonly<Record<string, string | undefined>>): number {
	return megabytes(env.DATA_MAX_MB, DEFAULT_MAX_MB);
}

/** Every file and directory under `root`, as the blocks it takes (its size where unknown). */
export async function measureDir(root: string): Promise<number> {
	let total = 0;
	const walk = async (dir: string) => {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const path = join(dir, entry.name);
			try {
				const info = await lstat(path);
				total += info.blocks > 0 ? info.blocks * 512 : info.size;
			} catch {
				continue;
			}
			if (entry.isDirectory()) await walk(path);
		}
	};
	await walk(root);
	return total;
}

const blocksOf = (bytes: number) => Math.ceil(Math.max(0, bytes) / BLOCK) * BLOCK + OVERHEAD;

interface Usage {
	at: number;
	used: number;
	/** Let in since `used` was counted. */
	pending: number;
}

export interface DiskOptions {
	statfs?: Statfs;
	now?: () => number;
	/** The budget in bytes; 0 means none. */
	maxUsed?: number;
	measure?: Measure;
}

export class Disk {
	#seen = new Map<string, { at: number; free: number | null }>();
	#usage = new Map<string, Usage>();
	#counting = new Map<string, Promise<Usage | null>>();
	/** The needs refused for the budget, so the log says it once, not per request. */
	#full = new Set<Need>();
	private readonly statfs: Statfs;
	private readonly now: () => number;
	private readonly maxUsed: number;
	private readonly measure: Measure;

	constructor(
		private readonly minFree: number,
		options: DiskOptions = {}
	) {
		this.statfs = options.statfs ?? nodeStatfs;
		this.now = options.now ?? Date.now;
		this.maxUsed = options.maxUsed ?? 0;
		this.measure = options.measure ?? measureDir;
	}

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

	/**
	 * The last count, made again when it is old; one count at a time per root. A count
	 * that fails keeps the last one, or, with none, is `null` and asked again next time.
	 */
	async #used(root: string): Promise<Usage | null> {
		const usage = this.#usage.get(root);
		if (usage !== undefined && this.now() - usage.at < MEASURE_MS) return usage;
		let counting = this.#counting.get(root);
		if (counting === undefined) {
			counting = this.measure(root)
				.then((used) => {
					const fresh = { at: this.now(), used, pending: 0 };
					this.#usage.set(root, fresh);
					return fresh;
				})
				.catch(() => {
					// Kept, and asked again only after another while: a failing count is not
					// made again on every request.
					if (usage === undefined) return null;
					usage.at = this.now();
					return usage;
				})
				.finally(() => this.#counting.delete(root));
			this.#counting.set(root, counting);
		}
		return counting;
	}

	/**
	 * Whether `need` may write about `bytes` under `root` now. When it may, the bytes are
	 * counted as used until the files are counted again.
	 */
	async roomFor(root: string, need: Need, bytes = 0): Promise<boolean> {
		const free = await this.#free(root);
		if (free !== null && free < (need === 'version' ? this.minFree / 4 : this.minFree))
			return false;
		if (this.maxUsed <= 0) return true;
		const usage = await this.#used(root);
		// Nothing to go by, as with a disk that cannot say: not refused.
		if (usage === null) return true;
		const cost = blocksOf(bytes);
		const limit = need === 'version' ? this.maxUsed : this.maxUsed * UPLOAD_SHARE;
		const room = usage.used + usage.pending + cost <= limit;
		if (!room && !this.#full.has(need))
			console.warn(
				`[storage] ${need}s refused: DATA_DIR takes ${Math.round((usage.used + usage.pending) / MB)} MB of DATA_MAX_MB ${Math.round(this.maxUsed / MB)}`
			);
		if (room) this.#full.delete(need);
		else this.#full.add(need);
		if (room) usage.pending += cost;
		return room;
	}

	/** Bytes `roomFor` let in that were not written after all. */
	release(root: string, bytes: number): void {
		const usage = this.#usage.get(root);
		if (usage !== undefined) usage.pending = Math.max(0, usage.pending - blocksOf(bytes));
	}
}

let shared: Disk | null = null;

/** One per process, from the environment. */
export function disk(): Disk {
	shared ??= new Disk(minFreeBytes(process.env), { maxUsed: maxUsedBytes(process.env) });
	return shared;
}

/** What a teacher is told when the server has no room. */
export const DISK_FULL = 'Na serveru teď není místo na další soubory. Zkus to prosím později.';
