/**
 * Per-owner limits for the chat: requests per minute and tokens per day.
 *
 * In memory, so a restart resets them; that is enough to stop a runaway loop or a
 * leaked workspace key from spending without bound (plan, safeguard 9). The clock is
 * injected for tests.
 */

export type LimitVerdict =
	{ ok: true } | { ok: false; reason: 'rate' | 'budget'; retryAfterSeconds: number };

type Options = {
	maxRequestsPerMinute: number;
	dailyTokenBudget: number;
	now?: () => number;
};

const MINUTE = 60_000;
const DAY = 86_400_000;

export class AiLimits {
	private readonly requests = new Map<string, number[]>();
	private readonly tokens = new Map<string, { day: number; used: number }>();
	private readonly now: () => number;

	constructor(private readonly options: Options) {
		this.now = options.now ?? Date.now;
	}

	/** Counts a request when it is allowed. */
	check(owner: string): LimitVerdict {
		const now = this.now();
		const day = Math.floor(now / DAY);
		const spent = this.tokens.get(owner);
		if (spent && spent.day === day && spent.used >= this.options.dailyTokenBudget) {
			return {
				ok: false,
				reason: 'budget',
				retryAfterSeconds: Math.ceil(((day + 1) * DAY - now) / 1000)
			};
		}
		const recent = (this.requests.get(owner) ?? []).filter((t) => now - t < MINUTE);
		if (recent.length >= this.options.maxRequestsPerMinute) {
			this.requests.set(owner, recent);
			return {
				ok: false,
				reason: 'rate',
				retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + MINUTE - now) / 1000))
			};
		}
		recent.push(now);
		this.requests.set(owner, recent);
		this.sweep(now, day);
		return { ok: true };
	}

	/** Adds what a finished request used to today's total. */
	record(owner: string, tokens: number): void {
		if (!Number.isFinite(tokens) || tokens <= 0) return;
		const day = Math.floor(this.now() / DAY);
		const spent = this.tokens.get(owner);
		if (spent && spent.day === day) spent.used += tokens;
		else this.tokens.set(owner, { day, used: tokens });
	}

	usedToday(owner: string): number {
		const spent = this.tokens.get(owner);
		return spent && spent.day === Math.floor(this.now() / DAY) ? spent.used : 0;
	}

	/** Forget owners who have been quiet, so the maps cannot grow without bound. */
	private sweep(now: number, day: number): void {
		if (this.requests.size < 1000) return;
		for (const [owner, times] of this.requests) {
			if (times.every((t) => now - t >= MINUTE)) this.requests.delete(owner);
		}
		for (const [owner, spent] of this.tokens) if (spent.day !== day) this.tokens.delete(owner);
	}
}

let shared: { key: string; limits: AiLimits } | null = null;

/** One instance per process; replaced if the settings change. */
export function sharedLimits(options: Omit<Options, 'now'>): AiLimits {
	const key = `${options.maxRequestsPerMinute}/${options.dailyTokenBudget}`;
	if (shared === null || shared.key !== key) shared = { key, limits: new AiLimits(options) };
	return shared.limits;
}
