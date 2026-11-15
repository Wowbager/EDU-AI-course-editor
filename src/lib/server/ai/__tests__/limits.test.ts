import { describe, expect, it } from 'vitest';
import { AiLimits, CACHED_TOKEN_WEIGHT, weightedTokens } from '../limits';

function setup(max = 2, budget = 100) {
	const clock = { t: Date.UTC(2026, 9, 6, 12, 0, 0) };
	const limits = new AiLimits({
		maxRequestsPerMinute: max,
		dailyTokenBudget: budget,
		now: () => clock.t
	});
	return { clock, limits };
}

describe('AiLimits', () => {
	it('allows a number of requests a minute, per owner', () => {
		const { clock, limits } = setup();
		expect(limits.check('a').ok).toBe(true);
		expect(limits.check('a').ok).toBe(true);
		const third = limits.check('a');
		expect(third).toMatchObject({ ok: false, reason: 'rate' });
		expect(limits.check('b').ok).toBe(true);
		clock.t += 61_000;
		expect(limits.check('a').ok).toBe(true);
	});

	it('reports when to retry', () => {
		const { clock, limits } = setup(1);
		limits.check('a');
		clock.t += 20_000;
		expect(limits.check('a')).toMatchObject({ ok: false, retryAfterSeconds: 40 });
	});

	it('stops at the daily token budget and resets the next day', () => {
		const { clock, limits } = setup(100, 100);
		limits.check('a');
		limits.record('a', 60);
		expect(limits.check('a').ok).toBe(true);
		limits.record('a', 50);
		expect(limits.usedToday('a')).toBe(110);
		expect(limits.check('a')).toMatchObject({ ok: false, reason: 'budget' });
		expect(limits.check('b').ok).toBe(true);
		clock.t += 13 * 3_600_000;
		expect(limits.check('a').ok).toBe(true);
		expect(limits.usedToday('a')).toBe(0);
	});

	it('ignores nonsense token counts', () => {
		const { limits } = setup();
		limits.record('a', NaN);
		limits.record('a', -4);
		expect(limits.usedToday('a')).toBe(0);
	});
});

describe('weightedTokens', () => {
	it('counts cached prompt tokens at a tenth', () => {
		expect(CACHED_TOKEN_WEIGHT).toBe(0.1);
		const usage = {
			prompt_tokens: 100_000,
			completion_tokens: 2_000,
			total_tokens: 102_000,
			prompt_tokens_details: { cached_tokens: 90_000 }
		};
		expect(weightedTokens(usage)).toBe(10_000 + 9_000 + 2_000);
	});

	it('counts everything in full when nothing was cached, and reads the other provider name', () => {
		expect(weightedTokens({ prompt_tokens: 10, completion_tokens: 5 })).toBe(15);
		expect(
			weightedTokens({ prompt_tokens: 100, completion_tokens: 0, prompt_cache_hit_tokens: 100 })
		).toBe(10);
	});

	it('falls back to the total, and ignores a cache count larger than the prompt', () => {
		expect(weightedTokens({ total_tokens: 7 })).toBe(7);
		expect(weightedTokens(undefined)).toBe(0);
		expect(
			weightedTokens({
				prompt_tokens: 10,
				completion_tokens: 0,
				prompt_tokens_details: { cached_tokens: 99 }
			})
		).toBe(1);
	});

	it('lets many cards of one course fit in the default daily budget', () => {
		const dossier = 150_000;
		const call = weightedTokens({
			prompt_tokens: dossier + 2_000,
			completion_tokens: 4_000,
			prompt_tokens_details: { cached_tokens: dossier }
		});
		expect(call).toBeLessThan(25_000);
		expect(Math.floor(20_000_000 / call)).toBeGreaterThan(500);
	});
});
