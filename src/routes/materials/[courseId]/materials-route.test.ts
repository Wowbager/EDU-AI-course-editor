import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/versions/http', () => ({ ownerOf: () => 'owner' }));
const add = vi.fn(async (_o: string, _c: string, body: unknown) => body);
vi.mock('$lib/server/materials/instance', () => ({ materialFiles: () => ({ add }) }));

import { MAX_FILE_BODY_BYTES } from '$lib/server/materials/files';
import { POST } from './+server';

const post = (body: string, headers: Record<string, string> = {}) =>
	POST({
		request: new Request('http://x/materials/kurz', { method: 'POST', body, headers }),
		params: { courseId: 'kurz' }
	} as never);
const status = async (promise: unknown): Promise<number> => {
	try {
		await promise;
	} catch (e) {
		return (e as { status: number }).status;
	}
	return 200;
};

describe('POST /materials/:course body size', () => {
	it('counts bytes, not characters: a Czech text under the limit in characters can be over it in bytes', async () => {
		// Three bytes each; fewer characters than the limit, more bytes.
		const body = JSON.stringify({ t: '€'.repeat(Math.floor(MAX_FILE_BODY_BYTES / 3) + 10) });
		expect(body.length).toBeLessThan(MAX_FILE_BODY_BYTES);
		expect(Buffer.byteLength(body)).toBeGreaterThan(MAX_FILE_BODY_BYTES);
		expect(await status(post(body))).toBe(413);
		expect(add).not.toHaveBeenCalled();
	});

	it('refuses by the declared length without reading the body', async () => {
		const request = new Request('http://x/materials/kurz', {
			method: 'POST',
			body: '{}',
			headers: { 'content-length': String(MAX_FILE_BODY_BYTES + 1) }
		});
		const read = vi.spyOn(request, 'text');
		expect(await status(POST({ request, params: { courseId: 'kurz' } } as never))).toBe(413);
		expect(read).not.toHaveBeenCalled();
	});

	it('takes a file that is within the limit', async () => {
		expect(await status(post('{"a":1}'))).toBe(200);
		expect(add).toHaveBeenCalledTimes(1);
	});
});
