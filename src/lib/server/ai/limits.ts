/**
 * Limits for AI requests: requests per minute and tokens per day, for each workspace,
 * for each client address, and for the whole server.
 *
 * A workspace key is made up by the browser, so a script can make a new one for every
 * request: the workspace limit alone stops a runaway loop, not someone spending on
 * purpose. The address limit stops one machine (a school shares one, so it is several
 * workspaces' worth) and the server's total is the ceiling on a day's bill.
 *
 * In memory, so a restart resets them. The clock is injected for tests.
 */

/** What a provider reports for one call (OpenRouter, DeepSeek). */
export type Usage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
	/** DeepSeek's own name for the cached part of the prompt. */
	prompt_cache_hit_tokens?: number;
};

/** A cached prompt token costs a tenth of a fresh one, so it counts a tenth. */
export const CACHED_TOKEN_WEIGHT = 0.1;

/**
 * What a call counts against the daily budget: fresh prompt tokens and output tokens in
 * full, cached prompt tokens at `CACHED_TOKEN_WEIGHT`. A dossier of a whole course is
 * sent for every card, and the cache makes all but the first nearly free.
 */
export function weightedTokens(usage: Usage | undefined): number {
	if (usage === undefined) return 0;
	const prompt = usage.prompt_tokens;
	if (typeof prompt !== 'number') return usage.total_tokens ?? 0;
	const cachedRaw =
		usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
	const cached = Math.min(Math.max(cachedRaw, 0), prompt);
	const output = usage.completion_tokens ?? Math.max(0, (usage.total_tokens ?? prompt) - prompt);
	return Math.ceil(prompt - cached + cached * CACHED_TOKEN_WEIGHT + output);
}

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
		const verdict = this.verdict(owner);
		if (verdict.ok) this.count(owner);
		return verdict;
	}

	/** Whether a request may be made now, without counting it. */
	verdict(owner: string): LimitVerdict {
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
		return { ok: true };
	}

	/** Counts a request. */
	count(owner: string): void {
		const now = this.now();
		const recent = (this.requests.get(owner) ?? []).filter((t) => now - t < MINUTE);
		recent.push(now);
		this.requests.set(owner, recent);
		this.sweep(now, Math.floor(now / DAY));
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

/** Who asks: the workspace and the client address (`server/ip.ts`, `clientOf`). */
export type Who = { owner: string; ip: string };

export type GuardOptions = {
	perOwner: Omit<Options, 'now'>;
	perIp: Omit<Options, 'now'>;
	total: Omit<Options, 'now'>;
	now?: () => number;
};

/** The server's one key for its total. */
const TOTAL = '*';

/** The three limits together: a request is counted by all of them or by none. */
export class AiGuard {
	readonly perOwner: AiLimits;
	readonly perIp: AiLimits;
	readonly total: AiLimits;

	constructor(options: GuardOptions) {
		const now = options.now;
		this.perOwner = new AiLimits({ ...options.perOwner, now });
		this.perIp = new AiLimits({ ...options.perIp, now });
		this.total = new AiLimits({ ...options.total, now });
	}

	#each(who: Who): [AiLimits, string][] {
		return [
			[this.perOwner, who.owner],
			[this.perIp, who.ip],
			[this.total, TOTAL]
		];
	}

	check(who: Who): LimitVerdict {
		const each = this.#each(who);
		for (const [limits, key] of each) {
			const verdict = limits.verdict(key);
			if (!verdict.ok) return verdict;
		}
		for (const [limits, key] of each) limits.count(key);
		return { ok: true };
	}

	record(who: Who, tokens: number): void {
		for (const [limits, key] of this.#each(who)) limits.record(key, tokens);
	}
}

/** What the guard is built from: the provider's settings (`config.ts`). */
export type LimitSettings = {
	maxRequestsPerMinute: number;
	dailyTokenBudget: number;
	maxRequestsPerMinutePerIp: number;
	dailyTokenBudgetPerIp: number;
	maxRequestsPerMinuteTotal: number;
	dailyTokenBudgetTotal: number;
};

let shared: { key: string; guard: AiGuard } | null = null;

/** One instance per process; replaced if the settings change. */
export function sharedLimits(settings: LimitSettings): AiGuard {
	const key = [
		settings.maxRequestsPerMinute,
		settings.dailyTokenBudget,
		settings.maxRequestsPerMinutePerIp,
		settings.dailyTokenBudgetPerIp,
		settings.maxRequestsPerMinuteTotal,
		settings.dailyTokenBudgetTotal
	].join('/');
	if (shared === null || shared.key !== key)
		shared = {
			key,
			guard: new AiGuard({
				perOwner: {
					maxRequestsPerMinute: settings.maxRequestsPerMinute,
					dailyTokenBudget: settings.dailyTokenBudget
				},
				perIp: {
					maxRequestsPerMinute: settings.maxRequestsPerMinutePerIp,
					dailyTokenBudget: settings.dailyTokenBudgetPerIp
				},
				total: {
					maxRequestsPerMinute: settings.maxRequestsPerMinuteTotal,
					dailyTokenBudget: settings.dailyTokenBudgetTotal
				}
			})
		};
	return shared.guard;
}
