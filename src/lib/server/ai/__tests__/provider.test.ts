import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { APIError, AuthenticationError, RateLimitError, APIUserAbortError } from 'openai/error';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, StreamEvent } from '$lib/agent/protocol';
import { readAiConfig } from '../config';
import {
	assembleStream,
	buildRequest,
	describeError,
	streamChat,
	toProviderMessages,
	type ChatClient
} from '../provider';

function fixture(name: string): ChatCompletionChunk[] {
	return JSON.parse(
		readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8')
	);
}

async function* replay(chunks: ChatCompletionChunk[]) {
	for (const c of chunks) yield c;
}

async function collect(it: AsyncIterable<StreamEvent>) {
	const events: StreamEvent[] = [];
	for await (const e of it) events.push(e);
	return events;
}

const openrouter = readAiConfig({ AI_API_KEY: 'k' });
const deepseek = readAiConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'k' });

function fakeClient(chunks: ChatCompletionChunk[], seen?: unknown[]): ChatClient {
	return {
		chat: {
			completions: {
				create: async (body, options) => {
					seen?.push({ body, options });
					return replay(chunks);
				}
			}
		}
	};
}

const params = (messages: ChatMessage[] = [{ role: 'user', content: 'Ahoj' }]) => ({
	system: 'SYS',
	tools: [],
	messages
});

describe('stream assembly', () => {
	it('plain text', async () => {
		const events = await collect(
			assembleStream('openrouter', replay(fixture('openrouter-plain-text')))
		);
		expect(
			events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text)
		).toEqual(['Ahoj', ', co ', 'potřebuješ?']);
		expect(events.at(-1)).toEqual({
			type: 'done',
			finishReason: 'stop',
			assistant: { role: 'assistant', text: 'Ahoj, co potřebuješ?', toolCalls: [] },
			usage: { promptTokens: 812, completionTokens: 9, totalTokens: 821, cachedTokens: 640 }
		});
	});

	it('assembles two parallel calls with fragmented arguments, in index order', async () => {
		const events = await collect(
			assembleStream('openrouter', replay(fixture('openrouter-parallel-tool-calls')))
		);
		const calls = events.filter((e) => e.type === 'tool_call');
		expect(calls).toEqual([
			{ type: 'tool_call', id: 'call_a1', name: 'read_lesson', arguments: '{"lessonId":"l1"}' },
			{ type: 'tool_call', id: 'call_b2', name: 'list_skills', arguments: '{}' }
		]);
		const done = events.at(-1);
		expect(done).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
		// tool_call events come before done
		expect(events.indexOf(calls[1])).toBeLessThan(events.length - 1);
	});

	it('passes malformed JSON arguments on as received', async () => {
		const events = await collect(
			assembleStream('openrouter', replay(fixture('openrouter-malformed-arguments')))
		);
		const call = events.find((e) => e.type === 'tool_call');
		expect(call).toMatchObject({ arguments: '{"stepId": "s1", "text": "Ahoj světe' });
		expect(() => JSON.parse((call as { arguments: string }).arguments)).toThrow();
		expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
	});

	it('length finish', async () => {
		const events = await collect(
			assembleStream('openrouter', replay(fixture('openrouter-length')))
		);
		expect(events.at(-1)).toMatchObject({
			type: 'done',
			finishReason: 'length',
			assistant: { text: 'Lekce má několik částí, první je' }
		});
	});

	it('DeepSeek reasoning_content is kept as a string', async () => {
		const events = await collect(
			assembleStream('deepseek', replay(fixture('deepseek-reasoning-content')))
		);
		expect(events.filter((e) => e.type === 'reasoning_delta')).toEqual([
			{ type: 'reasoning_delta', text: 'Učitel chce ' },
			{ type: 'reasoning_delta', text: 'přečíst lekci.' }
		]);
		const done = events.at(-1) as Extract<StreamEvent, { type: 'done' }>;
		expect(done.assistant.reasoning).toBe('Učitel chce přečíst lekci.');
		expect(done.usage.cachedTokens).toBe(512);
		expect(done.assistant.toolCalls).toEqual([
			{ id: 'call_0_read', name: 'read_lesson', arguments: '{"lessonId":"l2"}' }
		]);
	});

	it('OpenRouter reasoning_details are merged into blocks', async () => {
		const events = await collect(
			assembleStream('openrouter', replay(fixture('openrouter-reasoning-details')))
		);
		const done = events.at(-1) as Extract<StreamEvent, { type: 'done' }>;
		expect(done.assistant.reasoning).toEqual([
			{
				type: 'reasoning.text',
				text: 'Nejdřív zjistím lekci.',
				signature: 'sig-abc123==',
				format: 'unknown',
				index: 0
			}
		]);
		expect(events.filter((e) => e.type === 'reasoning_delta')).toHaveLength(2);
		expect(done.assistant.text).toBe('Podívám se.');
	});

	it('a stream that ends with no finish reason is an error', async () => {
		const chunks = fixture('openrouter-plain-text').slice(0, 2);
		const events = await collect(assembleStream('openrouter', replay(chunks)));
		expect(events.at(-1)).toMatchObject({ type: 'error', code: 'network' });
	});

	it('an unknown finish reason is an error finish', async () => {
		const chunks = fixture('openrouter-plain-text');
		chunks[4].choices[0].finish_reason = 'content_filter';
		const events = await collect(assembleStream('openrouter', replay(chunks)));
		expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'error' });
	});
});

describe('message mapping', () => {
	const history = (reasoning: unknown): ChatMessage[] => [
		{ role: 'user', content: 'Oprav lekci' },
		{
			role: 'assistant',
			text: '',
			toolCalls: [{ id: 'c1', name: 'read_lesson', arguments: '{"lessonId":"l1"}' }],
			reasoning
		},
		{ role: 'tool', toolCallId: 'c1', content: '{"ok":true}' },
		{ role: 'notice', content: 'Učitel zrovna smazal lekci.' },
		{ role: 'user', content: 'Pokračuj' }
	];

	it('maps every role, notices to system at their position', () => {
		const out = toProviderMessages('openrouter', 'SYS', history(undefined));
		expect(out).toEqual([
			{ role: 'system', content: 'SYS' },
			{ role: 'user', content: 'Oprav lekci' },
			{
				role: 'assistant',
				content: null,
				tool_calls: [
					{
						id: 'c1',
						type: 'function',
						function: { name: 'read_lesson', arguments: '{"lessonId":"l1"}' }
					}
				]
			},
			{ role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
			{ role: 'system', content: 'Učitel zrovna smazal lekci.' },
			{ role: 'user', content: 'Pokračuj' }
		]);
	});

	it('DeepSeek: reasoning_content survives a full round trip', async () => {
		const events = await collect(
			assembleStream('deepseek', replay(fixture('deepseek-reasoning-content')))
		);
		const assistant = (events.at(-1) as Extract<StreamEvent, { type: 'done' }>).assistant;
		const out = toProviderMessages('deepseek', 'SYS', [
			{ role: 'user', content: 'x' },
			assistant,
			{ role: 'tool', toolCallId: 'call_0_read', content: '{}' }
		]);
		expect(out[2]).toMatchObject({ reasoning_content: 'Učitel chce přečíst lekci.' });
		expect(out[2]).not.toHaveProperty('reasoning_details');
	});

	it('OpenRouter: reasoning_details survive a full round trip, unmodified', async () => {
		const events = await collect(
			assembleStream('openrouter', replay(fixture('openrouter-reasoning-details')))
		);
		const assistant = (events.at(-1) as Extract<StreamEvent, { type: 'done' }>).assistant;
		const wire = JSON.parse(JSON.stringify(assistant)); // through the browser
		const out = toProviderMessages('openrouter', 'SYS', [
			{ role: 'user', content: 'x' },
			wire,
			{ role: 'tool', toolCallId: 'call_r1', content: '{}' }
		]);
		expect((out[2] as { reasoning_details?: unknown }).reasoning_details).toEqual(
			assistant.reasoning
		);
		expect(out[2]).not.toHaveProperty('reasoning_content');
	});

	it("does not send one provider's reasoning to the other", () => {
		const asString = toProviderMessages('openrouter', 'S', history('thinking'));
		expect(asString[2]).not.toHaveProperty('reasoning_details');
		const asArray = toProviderMessages('deepseek', 'S', history([{ type: 'reasoning.text' }]));
		expect(asArray[2]).not.toHaveProperty('reasoning_content');
	});
});

describe('request', () => {
	it('OpenRouter: pinned hosts go first, so the same host answers every turn', () => {
		const pinned = { ...openrouter, openrouterProviders: ['DeepInfra', 'Together'] };
		const body = buildRequest(pinned, params()) as unknown as Record<string, any>;
		expect(body.provider).toEqual({
			require_parameters: true,
			data_collection: 'deny',
			order: ['DeepInfra', 'Together'],
			allow_fallbacks: true
		});
	});

	const tools = [
		{ name: 'b_tool', description: 'B', parameters: { type: 'object' }, strict: true },
		{ name: 'a_tool', description: 'A', parameters: { type: 'object' } }
	];

	it('OpenRouter: reasoning, routing, strict, order kept', () => {
		const body = buildRequest(openrouter, { ...params(), tools }) as unknown as Record<string, any>;
		expect(body.reasoning).toEqual({ effort: 'high' });
		expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
		expect(body.thinking).toBeUndefined();
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
		expect(body.tools.map((t: any) => t.function.name)).toEqual(['b_tool', 'a_tool']);
		expect(body.tools[0]).toEqual({
			type: 'function',
			function: { name: 'b_tool', description: 'B', parameters: { type: 'object' }, strict: true }
		});
		expect(body.tools[1].function).not.toHaveProperty('strict');
	});

	it('DeepSeek: thinking and effort, no routing', () => {
		const body = buildRequest(deepseek, { ...params(), tools }) as unknown as Record<string, any>;
		expect(body.thinking).toEqual({ type: 'enabled' });
		expect(body.reasoning_effort).toBe('high');
		expect(body.provider).toBeUndefined();
		expect(body.reasoning).toBeUndefined();
		expect(body.tools[0].function).not.toHaveProperty('strict');
		const max = buildRequest(
			{ ...deepseek, reasoningEffort: 'xhigh' },
			params()
		) as unknown as Record<string, any>;
		expect(max.reasoning_effort).toBe('max');
		const off = buildRequest(
			{ ...deepseek, reasoningEffort: 'none' },
			params()
		) as unknown as Record<string, any>;
		expect(off.thinking).toEqual({ type: 'disabled' });
		expect(off.reasoning_effort).toBeUndefined();
	});

	it('omits an empty tool list', () => {
		const body = buildRequest(openrouter, params()) as unknown as Record<string, unknown>;
		expect(body).not.toHaveProperty('tools');
	});
});

describe('streamChat', () => {
	it('streams events from the client and passes the signal', async () => {
		const seen: any[] = [];
		const signal = new AbortController().signal;
		const events = await collect(
			streamChat(
				{ ...params(), signal },
				openrouter,
				fakeClient(fixture('openrouter-plain-text'), seen)
			)
		);
		expect(events.at(-1)).toMatchObject({ type: 'done' });
		expect(seen[0].options.signal).toBe(signal);
		expect(seen[0].body.model).toBe(openrouter.model);
	});

	const failing = (error: unknown): ChatClient => ({
		chat: {
			completions: {
				create: async () => {
					throw error;
				}
			}
		}
	});

	it('turns SDK errors into Czech error events, never throwing', async () => {
		const rate = new RateLimitError(429, {}, 'slow down', new Headers());
		const events = await collect(streamChat(params(), openrouter, failing(rate)));
		expect(events).toEqual([
			{ type: 'error', message: 'AI je přetížená, zkus to za chvíli.', code: 'rate_limit' }
		]);
	});

	it('is silent when the client aborted', async () => {
		const ctl = new AbortController();
		ctl.abort();
		const events = await collect(
			streamChat({ ...params(), signal: ctl.signal }, openrouter, failing(new APIUserAbortError()))
		);
		expect(events).toEqual([]);
	});
});

describe('describeError', () => {
	it('maps the SDK classes and statuses', () => {
		expect(describeError(new AuthenticationError(401, {}, 'no', new Headers()))?.code).toBe('auth');
		expect(describeError(new AuthenticationError(401, {}, 'no', new Headers()))?.message).toBe(
			'AI není správně nastavena. Řekni to správci editoru.'
		);
		expect(describeError(new APIError(402, {}, 'credits', new Headers()))?.code).toBe('payment');
		expect(describeError(new APIError(503, {}, 'busy', new Headers()))?.code).toBe('overloaded');
		expect(describeError(new APIError(500, {}, 'boom', new Headers()))?.code).toBe('unavailable');
		expect(describeError(new Error('?'))?.code).toBe('unknown');
		expect(describeError(new APIUserAbortError())).toBeNull();
	});
});
