import { describe, expect, it } from 'vitest';
import { handle, SECURITY_HEADERS } from './hooks.server';

const run = (response: Response) =>
	handle({ event: {} as never, resolve: async () => response }) as Promise<Response>;

describe('the server hook', () => {
	it('adds the security headers to every answer, keeping one a route set itself', async () => {
		const plain = await run(new Response('x'));
		for (const [name, value] of Object.entries(SECURITY_HEADERS))
			expect(plain.headers.get(name)).toBe(value);
		const own = await run(new Response('x', { headers: { 'referrer-policy': 'no-referrer' } }));
		expect(own.headers.get('referrer-policy')).toBe('no-referrer');
	});

	it('leaves a response with fixed headers as it is', async () => {
		const fixed = Response.redirect('http://x/', 302);
		expect((await run(fixed)).status).toBe(302);
	});
});
