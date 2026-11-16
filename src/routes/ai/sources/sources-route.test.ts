import { describe, expect, it, vi } from 'vitest';
import type { SourcesRequest } from '$lib/domain/source-assign';

vi.mock('$env/dynamic/private', () => ({
	env: { AI_PROVIDER: 'fake', AI_MAX_REQUESTS_PER_MINUTE: '2' }
}));
vi.mock('$lib/server/versions/http', () => ({ ownerOf: () => 'sources-owner' }));

import { POST } from './+server';

const body = (): SourcesRequest => ({
	schema: 'eduai.sources-request/1',
	course: { title: 'Zlomky', language: 'cs' },
	cards: [{ id: '1', kind: 'display', name: 'Co je půlka', lesson: 'Polovina' }],
	materials: '- [abcdef01.0] Učebnice — Úvod',
	material_keys: ['abcdef01.0']
});
const post = (payload: unknown) =>
	POST({
		request: new Request('http://x/ai/sources', { method: 'POST', body: JSON.stringify(payload) })
	} as never);

describe('POST /ai/sources', () => {
	it('answers with the sources the fake names, refuses a wrong shape, and counts against the limits', async () => {
		const response = await post(body());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: 'ok',
			cards: [{ id: '1', sources: ['abcdef01.0'] }]
		});
		await expect(post({ ...body(), cards: [] })).rejects.toMatchObject({ status: 400 });
		// The two of the minute are spent (the refused shape is not counted).
		expect((await post(body())).status).toBe(200);
		expect((await post(body())).status).toBe(429);
	});
});
