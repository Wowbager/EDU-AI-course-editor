import { describe, expect, it } from 'vitest';
import { AiLimits } from '../limits';

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
