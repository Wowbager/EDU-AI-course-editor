import { describe, expect, it, vi } from 'vitest';
import { genRequestSchema, MAX_CONTEXT_CHARS, type GenRequest } from '$lib/domain/authoring';
import { isConfigured, readAiConfig } from '../config';
import { fakeChat } from '../fake';
import {
	buildBody,
	buildChatBody,
	chatter,
	completer,
	hostMessages,
	ProviderError,
	streamer,
	textOf,
	withPictures,
	TOOLS,
	turnOf,
	visionist,
	RETRY as RETRY_FOR_TEST,
	withRetry,
	type ChatMessage,
	type RetryPolicy
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
/** For the tests of one call's failure: none is made again. */
const ONCE: RetryPolicy = { attempts: 1, baseMs: 0, maxDelayMs: 0, maxWaitMs: 0 };
/** Calls made again at once, without waiting. */
const QUICK: RetryPolicy = { attempts: 5, baseMs: 1, maxDelayMs: 4, maxWaitMs: 1000 };

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

	it('bounds what one text call may write: 32000 on OpenRouter, elsewhere only when set', () => {
		expect(buildBody(openrouter, []).max_tokens).toBe(32_000);
		expect(buildBody(openrouter, [], { stream: true }).max_tokens).toBe(32_000);
		expect(buildChatBody(openrouter, [], { tool: 'write_card' }).max_tokens).toBe(32_000);
		expect(buildBody(deepseek, [])).not.toHaveProperty('max_tokens');
		expect(buildChatBody(deepseek, [], { tool: 'write_card' })).not.toHaveProperty('max_tokens');
		const capped = readAiConfig({
			AI_PROVIDER: 'deepseek',
			AI_API_KEY: 'k',
			AI_MAX_OUTPUT_TOKENS: '8000'
		});
		expect(buildChatBody(capped, [], { tool: 'write_card' }).max_tokens).toBe(8000);
		expect(readAiConfig({ AI_MAX_OUTPUT_TOKENS: '8000' }).maxOutputTokens).toBe(8000);
		expect(readAiConfig({ AI_MAX_OUTPUT_TOKENS: '' }).maxOutputTokens).toBe(32_000);
	});
});

describe('buildChatBody', () => {
	it('defines both tools, whichever is asked for and whichever the provider', () => {
		for (const config of [openrouter, deepseek])
			for (const tool of ['save_plan', 'write_card'] as const) {
				const body = buildChatBody(config, messages, { tool });
				expect(body.tools).toBe(TOOLS);
				expect(TOOLS.map((t) => t.function.name)).toEqual(['save_plan', 'write_card']);
				expect(body.messages).toEqual(messages);
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
				(async () => new Response('no', { status })) as unknown as typeof fetch,
				undefined,
				ONCE
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
		const chat = chatter(
			readAiConfig({ AI_API_KEY: 'k' }),
			(async () => {
				throw new TypeError('fetch failed');
			}) as unknown as typeof fetch,
			undefined,
			ONCE
		);
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

	it('a refusal for credit or for speed stays one when its body never arrives', async () => {
		const stalled = (status: number) =>
			chatter(
				readAiConfig({ AI_API_KEY: 'k' }),
				(async (_url: string, init: RequestInit) => {
					const body = new ReadableStream<Uint8Array>({
						start(controller) {
							init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason));
						}
					});
					return new Response(body, { status });
				}) as unknown as typeof fetch,
				undefined,
				ONCE
			)(messages, { tool: 'write_card', timeoutMs: 20 });
		await expect(stalled(402)).rejects.toMatchObject({ kind: 'auth' });
		await expect(stalled(429)).rejects.toMatchObject({ kind: 'busy' });
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
				(async () => new Response('no', { status })) as unknown as typeof fetch,
				ONCE
			)([]);
		await expect(failing(401)).rejects.toMatchObject({ kind: 'auth' });
		await expect(failing(429)).rejects.toMatchObject({ kind: 'busy' });
		await expect(failing(500)).rejects.toBeInstanceOf(ProviderError);
	});
});

describe('turnOf', () => {
	const reasoningDetails = [{ type: 'reasoning.text', text: 'a', index: 0 }];

	it('keeps none of the reasoning, but DeepSeek\u2019s own reasoning_content for DeepSeek', () => {
		const message = {
			content: 'x',
			reasoning_details: reasoningDetails,
			reasoning_content: 'rc',
			reasoning: 'r'
		};
		expect(turnOf(message)).toEqual({ role: 'assistant', content: 'x' });
		expect(turnOf(message, 'openrouter')).toEqual({ role: 'assistant', content: 'x' });
		expect(turnOf(message, 'deepseek')).toEqual({
			role: 'assistant',
			content: 'x',
			reasoning_content: 'rc'
		});
	});

	it('sends no reasoning back, also from a turn kept from before', () => {
		const old: ChatMessage[] = [
			{ role: 'user', content: 'a' },
			{
				role: 'assistant',
				content: '',
				reasoning_details: reasoningDetails,
				reasoning_content: 'rc',
				reasoning: 'r'
			}
		];
		const sent = buildChatBody(openrouter, old, { tool: 'write_card' }).messages;
		expect(sent).toEqual([old[0], { role: 'assistant', content: '' }]);
		expect(buildChatBody(deepseek, old, { tool: 'write_card' }).messages).toEqual([
			old[0],
			{ role: 'assistant', content: '', reasoning_content: 'rc' }
		]);
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

describe('pictures in a conversation', () => {
	const ID = '0123abcd-0000-4000-8000-000000000001-pizza.jpg';
	const asked: ChatMessage[] = [
		{ role: 'system', content: 'pravidla' },
		{ role: 'user', content: withPictures('Materiály', [{ key: 'bbbbbbbb.0', id: ID }]) }
	];

	it('are only their keys until the call, where each is read and sent inline after its key', async () => {
		expect(textOf(asked[1].content as string)).toBe('Materiály');
		let sent: { messages: { content: unknown }[] } | undefined;
		const fetcher = (async (_url: string, init: RequestInit) => {
			sent = JSON.parse(String(init.body));
			return Response.json({
				choices: [{ message: { content: '', tool_calls: [] } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 }
			});
		}) as unknown as typeof fetch;
		const loads: string[] = [];
		const chat = chatter(openrouter, fetcher, async (id) => {
			loads.push(id);
			return { mime: 'image/jpeg', base64: 'QUJD' };
		});
		await chat(asked, { tool: 'write_card' });
		expect(loads).toEqual([ID]);
		expect(sent?.messages[0].content).toBe('pravidla');
		expect(sent?.messages[1].content).toEqual([
			{ type: 'text', text: 'Materiály' },
			{ type: 'text', text: '\n\nPicture [bbbbbbbb.0]:' },
			{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } }
		]);
	});

	it('says a picture that is gone is gone, and the call goes on', async () => {
		const out = await hostMessages(asked, async () => undefined);
		expect(out[1].content).toEqual([
			{ type: 'text', text: 'Materiály' },
			{ type: 'text', text: '\n\nPicture [bbbbbbbb.0]: no longer available.' }
		]);
	});
});

describe('a call that may pass is made again', () => {
	const answer = () => Response.json({ choices: [{ message: { content: '{}', tool_calls: [] } }] });
	/** Answers `failures` in order, then the answer; counts the calls. */
	const flaky = (...failures: (() => Response | never)[]) => {
		let calls = 0;
		const fetcher = (async () => {
			const next = failures[calls++];
			return next === undefined ? answer() : next();
		}) as unknown as typeof fetch;
		return { fetcher, calls: () => calls };
	};
	const status =
		(code: number, body = 'no', headers?: HeadersInit) =>
		() =>
			new Response(body, { status: code, headers });
	const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

	it('after a busy host, a host error or a call that did not get through', async () => {
		const warn = quiet();
		const host = flaky(status(429), status(503), status(502), () => {
			throw new TypeError('fetch failed');
		});
		const chat = chatter(openrouter, host.fetcher, undefined, QUICK);
		expect((await chat(messages, { tool: 'write_card' })).turn.content).toBe('{}');
		expect(host.calls()).toBe(5);
		expect(warn).toHaveBeenCalledTimes(4);
		warn.mockRestore();
	});

	it('after OpenRouter\u2019s 402 for the calls running at once, not for spent credit', async () => {
		const warn = quiet();
		const inFlight = JSON.stringify({
			error: {
				code: 402,
				message: 'in_flight_budget_exhausted',
				metadata: { limit_source: 'openrouter_in_flight_budget' }
			}
		});
		const busy = flaky(status(402, inFlight));
		await completer(openrouter, busy.fetcher, QUICK)([]);
		expect(busy.calls()).toBe(2);
		const spent = flaky(status(402, '{"error":{"message":"Insufficient credits"}}'));
		await expect(completer(openrouter, spent.fetcher, QUICK)([])).rejects.toMatchObject({
			kind: 'auth'
		});
		expect(spent.calls()).toBe(1);
		const tooBig = flaky(
			status(402, '{"error":{"message":"weight_exceeds_budget in_flight_budget"}}')
		);
		await expect(completer(openrouter, tooBig.fetcher, QUICK)([])).rejects.toMatchObject({
			kind: 'auth'
		});
		warn.mockRestore();
	});

	it('not after a refusal that would come again', async () => {
		for (const code of [400, 401, 403, 404]) {
			const host = flaky(status(code));
			await expect(
				chatter(openrouter, host.fetcher, undefined, QUICK)(messages, { tool: 'write_card' })
			).rejects.toBeInstanceOf(ProviderError);
			expect(host.calls()).toBe(1);
		}
	});

	it('gives up after the attempts, with the last failure', async () => {
		const warn = quiet();
		const host = flaky(...Array.from({ length: 9 }, () => status(529)));
		await expect(
			visionist(openrouter, host.fetcher, QUICK)('i', { mime: 'image/png', base64: '' })
		).rejects.toMatchObject({ kind: 'busy' });
		expect(host.calls()).toBe(5);
		warn.mockRestore();
	});

	it('a call the time limit ended is made once more only', async () => {
		const warn = quiet();
		const lost = () =>
			Promise.reject(
				new ProviderError('network', 'the answer did not arrive in time', { slow: true })
			);
		let calls = 0;
		await expect(
			withRetry(QUICK, () => {
				calls++;
				return lost();
			})
		).rejects.toMatchObject({ kind: 'network' });
		expect(calls).toBe(2);
		warn.mockRestore();
	});

	it('waits as long as Retry-After asks, up to the longest wait', async () => {
		const warn = quiet();
		const waits: number[] = [];
		const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
			fn: () => void,
			ms: number
		) => {
			waits.push(ms);
			queueMicrotask(fn);
			return 0;
		}) as unknown as typeof setTimeout);
		try {
			const policy: RetryPolicy = { ...RETRY_FOR_TEST, random: () => 0 };
			const host = flaky(
				status(429, 'no', { 'retry-after': '7' }),
				status(429, 'no', { 'retry-after': '600' }),
				status(503)
			);
			await completer(openrouter, host.fetcher, policy)([]);
			// 7 s asked; 600 s asked, 30 s at most; then the doubling alone (half of 8 s, by chance 0).
			expect(waits).toEqual([7000, 30_000, 4000]);
		} finally {
			timer.mockRestore();
			warn.mockRestore();
		}
	});

	it('stops waiting when the teacher leaves', async () => {
		const warn = quiet();
		const gone = new AbortController();
		let calls = 0;
		const failing = withRetry(
			{ attempts: 5, baseMs: 60_000, maxDelayMs: 60_000, maxWaitMs: 600_000 },
			async () => {
				calls++;
				throw new ProviderError('busy', '429');
			},
			{ signal: gone.signal }
		);
		gone.abort();
		await expect(failing).rejects.toMatchObject({ kind: 'busy' });
		expect(calls).toBe(1);
		warn.mockRestore();
	});

	it('a stream only until its first text', async () => {
		const warn = quiet();
		const sse = (text: string) =>
			new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
		const cut = 'data: {"choices":[{"delta":{"content":"Lekce"}}]}\n\n';
		const done =
			'data: {"choices":[{"delta":{"content":"Lekce"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
		let calls = 0;
		const answers = [() => status(503)(), () => sse(cut), () => sse(done)];
		const fetcher = (async () => answers[calls++]()) as unknown as typeof fetch;
		const pieces: string[] = [];
		await expect(
			streamer(openrouter, fetcher, undefined, QUICK)([], (p) => pieces.push(p))
		).rejects.toMatchObject({ kind: 'network' });
		// The busy host was asked again; the cut stream, which had shown text, was not.
		expect(calls).toBe(2);
		expect(pieces).toEqual(['Lekce']);
		warn.mockRestore();
	});
});
