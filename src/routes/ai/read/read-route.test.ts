import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { AI_PROVIDER: 'fake' } }));
vi.mock('$lib/server/versions/http', () => ({ ownerOf: () => 'owner' }));

import { FAKE_READING } from '$lib/server/ai/fake';
import { POST, MAX_PICTURE_BYTES } from './+server';

const post = (body: BodyInit, type = 'image/png') =>
	POST({
		request: new Request('http://x/ai/read', {
			method: 'POST',
			headers: { 'content-type': type },
			body
		})
	} as never);

const refused = async (promise: unknown) => {
	try {
		await promise;
	} catch (e) {
		return (e as { status: number }).status;
	}
	return 200;
};

describe('POST /ai/read', () => {
	it('reads a picture with the fake provider', async () => {
		const response = await post(new Uint8Array([137, 80, 78, 71]));
		expect(await response.json()).toEqual({ text: FAKE_READING });
	});

	it('refuses what is not a PNG, JPEG or WebP, what is empty and what is too big', async () => {
		expect(await refused(post(new Uint8Array([1]), 'application/pdf'))).toBe(415);
		expect(await refused(post(new Uint8Array(0)))).toBe(400);
		expect(await refused(post(new Uint8Array(MAX_PICTURE_BYTES + 1)))).toBe(413);
	});
});
