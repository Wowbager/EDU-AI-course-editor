import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { AI_PROVIDER: 'fake' } }));
vi.mock('$lib/server/versions/http', () => ({ ownerOf: () => 'budget-owner' }));

let fail: false | 'busy' | 'failed' = false;
vi.mock('$lib/server/ai/provider', async (original) => {
	const real = await original<typeof import('$lib/server/ai/provider')>();
	return {
		...real,
		visionist: () => async () => {
			if (fail) throw new real.ProviderError(fail, fail === 'busy' ? '503' : '500');
			// A host that did not say what it used.
			return { text: 'Text', tokens: 0 };
		}
	};
});

import { readAiConfig } from '$lib/server/ai/config';
import { sharedLimits } from '$lib/server/ai/limits';
import { ESTIMATED_READ_TOKENS } from '$lib/server/ai/read';
import { POST } from './+server';

const post = () =>
	POST({
		request: new Request('http://x/ai/read', {
			method: 'POST',
			headers: { 'content-type': 'image/png' },
			body: new Uint8Array([1, 2, 3])
		})
	} as never);
const used = () =>
	sharedLimits(readAiConfig({ AI_PROVIDER: 'fake' })).perOwner.usedToday('budget-owner');

describe('what a reading costs the day’s budget', () => {
	it('is counted by estimate when the host does not say, and when the call fails', async () => {
		expect(used()).toBe(0);
		await post();
		expect(used()).toBe(ESTIMATED_READ_TOKENS);
		fail = 'failed';
		await expect(post()).rejects.toMatchObject({ status: 502 });
		expect(used()).toBe(2 * ESTIMATED_READ_TOKENS);
	});

	it('is not charged when a busy host turned the call away, and says when to come back', async () => {
		const before = used();
		fail = 'busy';
		const response = (await post()) as Response;
		expect(response.status).toBe(503);
		expect(response.headers.get('retry-after')).not.toBeNull();
		expect(used()).toBe(before);
	});
});
