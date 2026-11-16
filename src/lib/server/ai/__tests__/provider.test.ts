import { describe, expect, it } from 'vitest';
import { genRequestSchema, MAX_CONTEXT_CHARS, type GenRequest } from '$lib/domain/authoring';
import { isConfigured, readAiConfig } from '../config';
import { fakeChat } from '../fake';
import {
	buildBody,
	buildChatBody,
	chatter,
	completer,
	ProviderError,
	TOOLS,
	turnOf,
	type ChatMessage
} from '../provider';

const request = (context = ''): GenRequest => ({
	schema: 'eduai.gen-request/2',
	mode: 'complete',
	course: { title: 'Zlomky', language: 'cs', audience: { grade: 4 } },
	lesson: { name: 'Polovina' },
	card: { kind: 'exercise', title: 'Kolik je polovina', steps: [] },
	context
});

const openrouter = readAiConfig({ AI_API_KEY: 'k' });
const deepseek = readAiConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'k' });
const messages: ChatMessage[] = [{ role: 'user', content: 'ahoj' }];

describe('settings', () => {
	it('allows 20 million weighted tokens a day by default', () => {
		expect(readAiConfig({}).dailyTokenBudget).toBe(20_000_000);
		expect(readAiConfig({ AI_DAILY_TOKEN_BUDGET: '5' }).dailyTokenBudget).toBe(5);
	});

	it('takes a dossier up to the limit and no longer', () => {
		expect(genRequestSchema.safeParse(request('x'.repeat(MAX_CONTEXT_CHARS))).success).toBe(true);
		expect(genRequestSchema.safeParse(request('x'.repeat(MAX_CONTEXT_CHARS + 1))).success).toBe(
			false
		);
	});

	it('offers AI only with a key, or with the fake provider', () => {
		expect(isConfigured(readAiConfig({}))).toBe(false);
		expect(isConfigured(readAiConfig({ AI_API_KEY: 'k' }))).toBe(true);
		expect(isConfigured(readAiConfig({ AI_PROVIDER: 'fake' }))).toBe(true);
		const unknown = readAiConfig({ AI_PROVIDER: 'nobody', AI_API_KEY: 'k' });
		expect(unknown.problem).not.toBeNull();
		expect(isConfigured(unknown)).toBe(false);
	});
});

describe('buildBody', () => {
	it('asks OpenRouter for hosts that do not keep the text', () => {
		const body = buildBody(openrouter, []);
		expect(body.provider).toEqual({
			require_parameters: true,
			data_collection: 'deny',
			max_price: { prompt: 0.5, completion: 2 }
		});
		// Thinking stays on, at the low setting.
		expect(body.reasoning).toEqual({ effort: 'low' });
		expect(body.model).toBe('deepseek/deepseek-v4.1-flash:nitro');
		expect(body.response_format).toEqual({ type: 'json_object' });
		expect(buildBody(deepseek, []).provider).toBe(undefined);
	});
});

describe('buildChatBody', () => {
	it('defines both tools, whichever is asked for and whichever the provider', () => {
		for (const config of [openrouter, deepseek])
			for (const tool of ['save_plan', 'write_card'] as const) {
				const body = buildChatBody(config, messages, { tool });
				expect(body.tools).toBe(TOOLS);
				expect(TOOLS.map((t) => t.function.name)).toEqual(['save_plan', 'write_card']);
				expect(body.messages).toBe(messages);
			}
	});

	it("forces the turn's tool and sets the effort for OpenRouter, with the privacy parameters", () => {
		const body = buildChatBody(openrouter, messages, { tool: 'write_card' });
		expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'write_card' } });
		expect(body.reasoning).toEqual({ effort: 'low' });
		expect(body.provider).toEqual({
			require_parameters: true,
			data_collection: 'deny',
			max_price: { prompt: 0.5, completion: 2 }
		});
		expect(body.response_format).toBeUndefined();
		const plan = buildChatBody(openrouter, messages, { tool: 'save_plan', effort: 'high' });
		expect(plan.tool_choice).toEqual({ type: 'function', function: { name: 'save_plan' } });
		expect(plan.reasoning).toEqual({ effort: 'high' });
	});

	it('turns thinking on for DeepSeek, without tool_choice or OpenRouter parameters', () => {
		const body = buildChatBody(deepseek, messages, { tool: 'write_card' });
		expect(body.thinking).toEqual({ type: 'enabled' });
		expect(body).not.toHaveProperty('tool_choice');
		expect(body).not.toHaveProperty('reasoning');
		expect(body).not.toHaveProperty('provider');
		const off = readAiConfig({
			AI_PROVIDER: 'deepseek',
			AI_API_KEY: 'k',
			AI_REASONING_EFFORT: 'none'
		});
		expect(buildChatBody(off, messages, { tool: 'write_card' }).thinking).toEqual({
			type: 'disabled'
		});
		expect(buildChatBody(off, messages, { tool: 'save_plan', effort: 'high' }).thinking).toEqual({
			type: 'enabled'
		});
	});
});

describe('chatter', () => {
	const answer = (message: unknown, usage?: unknown) =>
		Response.json({ choices: [{ message }], ...(usage === undefined ? {} : { usage }) });

	it('sends the key, reads the tool call and the weighted tokens', async () => {
		let seen: { url: string; auth: string | null; body: any } | undefined;
		const fetcher = (async (url: string, init: RequestInit) => {
			seen = {
				url,
				auth: new Headers(init.headers).get('authorization'),
				body: JSON.parse(String(init.body))
			};
			return answer(
				{
					content: null,
					tool_calls: [
						{
							id: 'c1',
							type: 'function',
							function: { name: 'write_card', arguments: '{"steps":[]}' }
						}
					]
				},
				{
					prompt_tokens: 100,
					prompt_tokens_details: { cached_tokens: 50 },
					completion_tokens: 2
				}
			);
		}) as unknown as typeof fetch;
		const chat = chatter(readAiConfig({ AI_API_KEY: 'secret' }), fetcher);
		const { turn, tokens } = await chat(messages, { tool: 'write_card' });
		// 50 fresh + 50 cached at a tenth + 2 written.
		expect(tokens).toBe(57);
		expect(turn).toEqual({
			role: 'assistant',
			content: '',
			tool_calls: [
				{ id: 'c1', type: 'function', function: { name: 'write_card', arguments: '{"steps":[]}' } }
			]
		});
		expect(seen?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(seen?.auth).toBe('Bearer secret');
		expect(seen?.body.tool_choice).toEqual({ type: 'function', function: { name: 'write_card' } });
	});

	it('says what kind of failure it was', async () => {
		const failing = (status: number) =>
			chatter(
				readAiConfig({ AI_API_KEY: 'k' }),
				(async () => new Response('no', { status })) as unknown as typeof fetch
			)(messages, { tool: 'write_card' });
		for (const status of [401, 402, 403])
			await expect(failing(status)).rejects.toMatchObject({ kind: 'auth' });
		for (const status of [429, 503, 529])
			await expect(failing(status)).rejects.toMatchObject({ kind: 'busy' });
		for (const status of [400, 404, 500])
			await expect(failing(status)).rejects.toMatchObject({ kind: 'failed' });
		await expect(failing(500)).rejects.toBeInstanceOf(ProviderError);
	});

	it('maps a network error to `network`', async () => {
		const chat = chatter(readAiConfig({ AI_API_KEY: 'k' }), (async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof fetch);
		await expect(chat(messages, { tool: 'write_card' })).rejects.toMatchObject({
			kind: 'network'
		});
	});

	it('an answer whose body never arrives is a call that did not get through', async () => {
		const chat = chatter(readAiConfig({ AI_API_KEY: 'k' }), (async (
			_url: string,
			init: RequestInit
		) => {
			// Headers at once; the body ends only when the time limit aborts it.
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason));
				}
			});
			return new Response(body, { status: 200 });
		}) as unknown as typeof fetch);
		await expect(chat(messages, { tool: 'write_card', timeoutMs: 20 })).rejects.toMatchObject({
			kind: 'network'
		});
	});

	it('so is an error whose body never arrives', async () => {
		const chat = chatter(readAiConfig({ AI_API_KEY: 'k' }), (async (
			_url: string,
			init: RequestInit
		) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason));
				}
			});
			return new Response(body, { status: 502 });
		}) as unknown as typeof fetch);
		await expect(chat(messages, { tool: 'write_card', timeoutMs: 20 })).rejects.toMatchObject({
			kind: 'network'
		});
	});

	it('fails when the host answers without a message', async () => {
		const chat = chatter(readAiConfig({ AI_API_KEY: 'k' }), (async () =>
			Response.json({ choices: [] })) as unknown as typeof fetch);
		await expect(chat(messages, { tool: 'write_card' })).rejects.toMatchObject({
			kind: 'failed'
		});
	});

	it('is the fake chat for the fake provider', () => {
		expect(chatter(readAiConfig({ AI_PROVIDER: 'fake' }))).toBe(fakeChat);
	});
});

describe('completer', () => {
	it('sends the key to the provider and reads the answer', async () => {
		let seen: { url: string; auth: string | null } | undefined;
		const fetcher = (async (url: string, init: RequestInit) => {
			seen = { url, auth: new Headers(init.headers).get('authorization') };
			return Response.json({
				choices: [{ message: { content: '{"help_md":"x"}' } }],
				usage: {
					prompt_tokens: 100,
					prompt_tokens_details: { cached_tokens: 50 },
					completion_tokens: 2
				}
			});
		}) as unknown as typeof fetch;
		const complete = completer(readAiConfig({ AI_API_KEY: 'secret' }), fetcher);
		expect(await complete([])).toEqual({ text: '{"help_md":"x"}', tokens: 57 });
		expect(seen).toEqual({
			url: 'https://openrouter.ai/api/v1/chat/completions',
			auth: 'Bearer secret'
		});
	});

	it('says what kind of failure it was', async () => {
		const failing = (status: number) =>
			completer(
				readAiConfig({ AI_API_KEY: 'k' }),
				(async () => new Response('no', { status })) as unknown as typeof fetch
			)([]);
		await expect(failing(401)).rejects.toMatchObject({ kind: 'auth' });
		await expect(failing(429)).rejects.toMatchObject({ kind: 'busy' });
		await expect(failing(500)).rejects.toBeInstanceOf(ProviderError);
	});
});

describe('turnOf', () => {
	const reasoningDetails = [{ type: 'reasoning.text', text: 'a', index: 0 }];

	it('keeps reasoning_details as returned and nothing else of the reasoning', () => {
		const turn = turnOf({
			content: 'x',
			reasoning_details: reasoningDetails,
			reasoning_content: 'rc',
			reasoning: 'r'
		});
		expect(turn.reasoning_details).toBe(reasoningDetails);
		expect(turn).not.toHaveProperty('reasoning_content');
		expect(turn).not.toHaveProperty('reasoning');
	});

	it('falls back to reasoning_content, then to reasoning', () => {
		const second = turnOf({ reasoning_details: [], reasoning_content: 'rc', reasoning: 'r' });
		expect(second.reasoning_content).toBe('rc');
		expect(second).not.toHaveProperty('reasoning_details');
		expect(second).not.toHaveProperty('reasoning');
		const third = turnOf({ reasoning_content: '', reasoning: 'r' });
		expect(third.reasoning).toBe('r');
		expect(third).not.toHaveProperty('reasoning_content');
		const none = turnOf({ content: 'text' });
		expect(none).toEqual({ role: 'assistant', content: 'text' });
	});

	it('normalises tool calls: arguments become JSON text, malformed calls are dropped', () => {
		const turn = turnOf({
			content: null,
			tool_calls: [
				{ id: 'a', type: 'function', function: { name: 'write_card', arguments: { steps: [] } } },
				{ id: 'b', function: { name: 'save_plan', arguments: '{"x":1}' } },
				{ id: 'c', function: { name: 'write_card' } },
				{ function: { name: 'write_card', arguments: '{}' } },
				{ id: 'e', function: {} }
			]
		});
		expect(turn.content).toBe('');
		expect(turn.tool_calls).toEqual([
			{ id: 'a', type: 'function', function: { name: 'write_card', arguments: '{"steps":[]}' } },
			{ id: 'b', type: 'function', function: { name: 'save_plan', arguments: '{"x":1}' } },
			{ id: 'c', type: 'function', function: { name: 'write_card', arguments: '{}' } }
		]);
	});

	it('leaves out tool_calls when none is usable', () => {
		expect(turnOf({ content: 'x', tool_calls: [] })).not.toHaveProperty('tool_calls');
		expect(turnOf({ content: 'x', tool_calls: [{}] })).not.toHaveProperty('tool_calls');
	});
});
