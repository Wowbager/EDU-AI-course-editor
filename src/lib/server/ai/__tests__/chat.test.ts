import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '$lib/agent/protocol';
import type { ToolDefinition } from '$lib/agent/server-prompt';
import { WORKSPACE_HEADER } from '$lib/server/versions/owner';
import { handleChat, MAX_MESSAGES, MAX_TOOL_CONTENT, type ChatDeps } from '../chat';
import { readAiConfig } from '../config';
import { AiLimits } from '../limits';
import type { ChatParams } from '../provider';

const KEY = 'A'.repeat(43);
const tools: ToolDefinition[] = [{ name: 'read_lesson', description: 'x', parameters: {} }];
const done: StreamEvent = {
	type: 'done',
	finishReason: 'stop',
	assistant: { role: 'assistant', text: 'Ahoj', toolCalls: [] },
	usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
};

function deps(over: Partial<ChatDeps> = {}, calls: ChatParams[] = []): ChatDeps {
	const config = readAiConfig({ AI_API_KEY: 'k' });
	return {
		config,
		limits: new AiLimits({ maxRequestsPerMinute: 5, dailyTokenBudget: 1000 }),
		system: 'SYS',
		tools,
		stream: async function* (params) {
			calls.push(params);
			yield { type: 'text_delta', text: 'Ah' };
			yield done;
		},
		...over
	};
}

function post(body: unknown, headers: Record<string, string> = { [WORKSPACE_HEADER]: KEY }) {
	return new Request('http://x/ai/chat', {
		method: 'POST',
		headers,
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

const user = (content = 'Ahoj') => ({ role: 'user', content });

describe('POST /ai/chat', () => {
	it('503 without a key, before anything else', async () => {
		const res = await handleChat(post('{'), deps({ config: readAiConfig({}) }));
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ message: 'AI není nastavena.', code: 'not_configured' });
	});

	it('401 without a workspace key', async () => {
		const res = await handleChat(post({ messages: [user()] }, {}), deps());
		expect(res.status).toBe(401);
	});

	it('streams SSE events, one JSON per data line, with the server system and tools', async () => {
		const calls: ChatParams[] = [];
		const d = deps({}, calls);
		const res = await handleChat(post({ messages: [user()] }), d);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		const text = await res.text();
		const events = text
			.split('\n\n')
			.filter(Boolean)
			.map((block) => JSON.parse(block.replace(/^data: /, '')));
		expect(events).toEqual([{ type: 'text_delta', text: 'Ah' }, done]);
		expect(calls[0].system).toBe('SYS');
		expect(calls[0].tools).toBe(tools);
	});

	it('records the tokens a finished answer used', async () => {
		const d = deps();
		const res = await handleChat(post({ messages: [user()] }), d);
		await res.text();
		const { resolveOwner } = await import('$lib/server/versions/owner');
		const owner = resolveOwner(post({}))!;
		expect(d.limits.usedToday(owner.id)).toBe(15);
	});

	it('ignores system and tools sent by the browser', async () => {
		const calls: ChatParams[] = [];
		const res = await handleChat(
			post({ messages: [user()], system: 'EVIL', tools: [{ name: 'rm' }] }),
			deps({}, calls)
		);
		await res.text();
		expect(calls[0].system).toBe('SYS');
		expect(calls[0].tools).toBe(tools);
	});

	it.each([
		['not JSON', '{'],
		['no messages', { messages: [] }],
		['a bad role', { messages: [{ role: 'system', content: 'x' }] }],
		['a missing field', { messages: [{ role: 'user' }] }],
		['too many messages', { messages: Array.from({ length: MAX_MESSAGES + 1 }, () => user()) }],
		[
			'a huge tool result',
			{
				messages: [
					{
						role: 'assistant',
						text: '',
						toolCalls: [{ id: 'c', name: 'read_lesson', arguments: '{}' }]
					},
					{ role: 'tool', toolCallId: 'c', content: 'x'.repeat(MAX_TOOL_CONTENT + 1) }
				]
			}
		],
		[
			'too many characters in all',
			{ messages: Array.from({ length: 5 }, () => user('x'.repeat(100_000))) }
		],
		[
			'an unknown tool',
			{
				messages: [
					user(),
					{
						role: 'assistant',
						text: '',
						toolCalls: [{ id: 'c', name: 'delete_all', arguments: '{}' }]
					},
					{ role: 'tool', toolCallId: 'c', content: '{}' }
				]
			}
		],
		[
			'a tool result with no call',
			{ messages: [user(), { role: 'tool', toolCallId: 'zz', content: '{}' }] }
		],
		[
			'ending on the assistant',
			{ messages: [user(), { role: 'assistant', text: 'hm', toolCalls: [] }] }
		]
	])('400 for %s', async (_name, payload) => {
		const calls: ChatParams[] = [];
		const res = await handleChat(post(payload), deps({}, calls));
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	it('accepts a tool round with reasoning and a notice', async () => {
		const res = await handleChat(
			post({
				messages: [
					user(),
					{
						role: 'assistant',
						text: '',
						toolCalls: [{ id: 'c', name: 'read_lesson', arguments: '{bad json' }],
						reasoning: [{ type: 'reasoning.text', text: 'hm' }]
					},
					{ role: 'tool', toolCallId: 'c', content: '{}' },
					{ role: 'notice', content: 'Pozor.' }
				]
			}),
			deps()
		);
		expect(res.status).toBe(200);
		await res.text();
	});

	it('429 with Retry-After when the rate limit is hit', async () => {
		const d = deps({ limits: new AiLimits({ maxRequestsPerMinute: 1, dailyTokenBudget: 1000 }) });
		await (await handleChat(post({ messages: [user()] }), d)).text();
		const res = await handleChat(post({ messages: [user()] }), d);
		expect(res.status).toBe(429);
		expect((await res.json()).code).toBe('rate_limit');
		expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
	});

	it('429 when the daily budget is spent', async () => {
		const d = deps({ limits: new AiLimits({ maxRequestsPerMinute: 5, dailyTokenBudget: 10 }) });
		await (await handleChat(post({ messages: [user()] }), d)).text();
		const res = await handleChat(post({ messages: [user()] }), d);
		expect(res.status).toBe(429);
		expect((await res.json()).code).toBe('budget');
	});

	it('aborts the provider call when the client goes away', async () => {
		let signal: AbortSignal | undefined;
		const ctl = new AbortController();
		const request = new Request('http://x/ai/chat', {
			method: 'POST',
			headers: { [WORKSPACE_HEADER]: KEY },
			body: JSON.stringify({ messages: [user()] }),
			signal: ctl.signal
		});
		const res = await handleChat(
			request,
			deps({
				stream: async function* (p) {
					signal = p.signal;
					yield { type: 'text_delta', text: 'a' };
					yield done;
				}
			})
		);
		const reader = res.body!.getReader();
		await reader.read();
		ctl.abort();
		expect(signal?.aborted).toBe(true);
		await reader.cancel();
	});
});
