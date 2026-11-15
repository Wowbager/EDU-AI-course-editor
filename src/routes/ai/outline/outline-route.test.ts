import { describe, expect, it, vi } from 'vitest';
import type { OutlineRequest } from '$lib/domain/outline';

vi.mock('$env/dynamic/private', () => ({ env: { AI_PROVIDER: 'fake' } }));
vi.mock('$lib/server/versions/http', () => ({ ownerOf: () => 'owner' }));

let signalSeen: AbortSignal | undefined;
let finished: Promise<void> | undefined;
vi.mock('$lib/server/ai/provider', async (original) => ({
	...(await original<typeof import('$lib/server/ai/provider')>()),
	// A host that goes on until it is told to stop.
	streamer: () => async (_m: unknown, onText: (t: string) => void, signal?: AbortSignal) => {
		signalSeen = signal;
		onText('{"scope":"lessons"}\n');
		onText('{"name":"A","cards":[{"kind":"display","name":"B"}]}\n');
		finished = new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
		await finished;
		throw new Error('aborted');
	}
}));

import { POST } from './+server';

const body = (): OutlineRequest => ({
	schema: 'eduai.outline-request/1',
	prompt: 'Kurz',
	course: { title: 'Z', language: 'cs', audience: {} },
	target: { lessons: 0 },
	context: ''
});

describe('POST /ai/outline', () => {
	it('ends the call at the host when the browser goes away, without an unhandled rejection', async () => {
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		const response = await POST({
			request: new Request('http://x/ai/outline', { method: 'POST', body: JSON.stringify(body()) })
		} as never);
		expect(response.headers.get('content-type')).toBe('application/x-ndjson');
		expect(response.headers.get('x-accel-buffering')).toBe('no');
		const reader = response.body!.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain('"type":"scope"');
		await reader.cancel();
		await finished;
		expect(signalSeen?.aborted).toBe(true);
		await new Promise((r) => setTimeout(r, 20));
		expect(unhandled).not.toHaveBeenCalled();
		process.off('unhandledRejection', unhandled);
	});
});
