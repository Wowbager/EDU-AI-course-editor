import { describe, expect, it, vi } from 'vitest';
import { genRequestSchema, MAX_CONTEXT_CHARS, type GenRequest } from '$lib/domain/authoring';
import { isConfigured, readAiConfig } from '../config';
import { fakeComplete } from '../fake';
import { generateCard, parseJson, SPEC_VERSION, SYSTEM_PROMPT } from '../generate';
import { buildBody, completer, ProviderError, type Complete, type Message } from '../provider';

const request = (over: Partial<GenRequest['card']> = {}, context = ''): GenRequest => ({
	schema: 'eduai.gen-request/2',
	mode: 'complete',
	course: { title: 'Zlomky', language: 'cs', audience: { grade: 4 } },
	lesson: { name: 'Polovina' },
	card: {
		kind: 'exercise',
		title: 'Kolik je polovina',
		steps: [
			{
				id: 's1',
				kind: 'question',
				content_md: 'Kolik je polovina z osmi?',
				hint_md: 'Děl dvěma.',
				missing: ['help']
			}
		],
		...over
	},
	context
});

/** A model that says the given things, one per call. */
const scripted = (...answers: unknown[]): Complete & { calls: number; seen: Message[][] } => {
	const fn = (async (messages: readonly Message[]) => {
		fn.seen.push([...messages]);
		const answer = answers[Math.min(fn.calls, answers.length - 1)];
		fn.calls++;
		return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), tokens: 10 };
	}) as unknown as Complete & { calls: number; seen: Message[][] };
	fn.calls = 0;
	fn.seen = [];
	return fn;
};

const GOOD = { steps: [{ keep: 's1', fill: { help_md: 'Polovina je jedna ze dvou částí.' } }] };
const MORE = {
	kind: 'question',
	content_md: 'Kolik je polovina z deseti?',
	question: { type: 'number', answer: 5 },
	hint_md: 'Děl dvěma.',
	help_md: 'Polovina je jedna ze dvou částí.',
	solution_md: 'Deset děleno dvěma je pět.'
};

describe('generateCard', () => {
	it('returns the card: the kept step with its fill, and the steps added', async () => {
		const model = scripted({ steps: [GOOD.steps[0], MORE] });
		const { response, tokens } = await generateCard(request(), model);
		expect(response).toMatchObject({
			status: 'ok',
			card: { steps: [{ keep: 's1' }, { kind: 'question' }] }
		});
		expect(tokens).toBe(10);
	});

	it('sends the system prompt, then the dossier, then the request without the dossier', async () => {
		const model = scripted(GOOD);
		await generateCard(request({}, 'KURZ: Zlomky\nLEKCE 1'), model);
		const [system, dossier, last] = model.seen[0];
		expect(system).toEqual({ role: 'system', content: SYSTEM_PROMPT });
		expect(dossier.role).toBe('user');
		expect(dossier.content).toContain('KURZ: Zlomky');
		expect(last.content.startsWith('{')).toBe(true);
		expect(JSON.parse(last.content)).toMatchObject({ schema: 'eduai.gen-request/2' });
		expect(last.content).not.toContain('LEKCE 1');
		// Without a dossier there is no message for it.
		const bare = scripted(GOOD);
		await generateCard(request(), bare);
		expect(bare.seen[0]).toHaveLength(2);
	});

	it('asks again with the mistake named when a step the teacher wrote is missing', async () => {
		const model = scripted({ steps: [MORE] }, GOOD);
		const { response, tokens } = await generateCard(request(), model);
		expect(response.status).toBe('ok');
		expect(model.calls).toBe(2);
		expect(tokens).toBe(20);
		expect(model.seen[1].at(-1)!.content).toContain('"s1"');
	});

	it('asks again when the model overwrites something the teacher wrote', async () => {
		const model = scripted(
			{ steps: [{ keep: 's1', fill: { help_md: 'Pomoc.', hint_md: 'Přepsaná nápověda' } }] },
			GOOD
		);
		await generateCard(request(), model);
		expect(model.calls).toBe(2);
		expect(model.seen[1].at(-1)!.content).toContain('hint_md');
	});

	it('reports what each call used, even when a later call fails', async () => {
		let calls = 0;
		const model: Complete = async () => {
			if (calls++ > 0) throw new ProviderError('busy', '429');
			return { text: 'not json', tokens: 10 };
		};
		let used = 0;
		await expect(generateCard(request(), model, (n) => (used += n))).rejects.toBeInstanceOf(
			ProviderError
		);
		expect(used).toBe(10);
	});

	it('reads JSON the model wrapped in a code fence', async () => {
		const model = scripted('```json\n' + JSON.stringify(GOOD) + '\n```');
		expect((await generateCard(request(), model)).response.status).toBe('ok');
		expect(parseJson('nothing here')).toBeUndefined();
	});

	it('gives up after two repeats, writes nothing, and logs why without the course text', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const model = scripted('not json');
			const { response } = await generateCard(request({}, 'TAJNÝ TEXT KURZU'), model);
			expect(response).toEqual({ status: 'failed' });
			expect(model.calls).toBe(3);
			expect(log).toHaveBeenCalledTimes(1);
			const logged = JSON.stringify(log.mock.calls[0]);
			expect(logged).toContain('[ai]');
			expect(logged).toContain('not valid JSON');
			expect(logged).toContain('exercise');
			expect(logged).not.toContain('TAJNÝ');
			expect(logged).not.toContain('Kolik je polovina');
		} finally {
			log.mockRestore();
		}
	});

	it('does not take a question with the wrong number of right answers', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const options = ['a', 'b', 'c'].map((text) => ({ text, correct: true, feedback: 'x' }));
		const model = scripted({
			steps: [GOOD.steps[0], { ...MORE, question: { type: 'mcq_1', options } }]
		});
		const { response } = await generateCard(request(), model);
		expect(response.status).toBe('failed');
		vi.restoreAllMocks();
	});

	it('holds the model to the question type the teacher chose', async () => {
		const steps = [
			{
				id: 's1',
				kind: 'question' as const,
				question_type: 'number' as const,
				missing: ['question' as const]
			}
		];
		const model = scripted(
			{ steps: [{ keep: 's1', fill: { question: { type: 'open', answer: 'čtyři' } } }] },
			{ steps: [{ keep: 's1', fill: { question: { type: 'number', answer: 4 } } }] }
		);
		const { response } = await generateCard(request({ steps }), model);
		expect(response).toEqual({
			status: 'ok',
			card: { steps: [{ keep: 's1', fill: { question: { type: 'number', answer: 4 } } }] }
		});
		expect(model.seen[1].at(-1)!.content).toContain('"number"');
	});

	it('states in the prompt what the card kinds hold and that a stated count wins', () => {
		expect(SPEC_VERSION).toBe('2');
		expect(SYSTEM_PROMPT).toContain('"display"');
		expect(SYSTEM_PROMPT).toContain('2 to 8 question steps');
		expect(SYSTEM_PROMPT).toContain('it wins');
		expect(SYSTEM_PROMPT).toContain('$x$');
	});
});

describe('the fake provider', () => {
	it('answers every kind of request in a shape the generator accepts, keeping given steps', async () => {
		for (const kind of ['display', 'exercise', 'question'] as const) {
			for (const type of ['yes_no', 'number', 'mcq_1', 'mcq_n', 'open', undefined] as const) {
				const r = request({
					kind,
					steps: [
						{ id: 's0', kind: 'text', content_md: 'Úvod od učitele', missing: [] },
						{
							id: 's1',
							kind: 'question',
							missing: ['content', 'question', 'hint', 'help', 'solution'],
							...(type === undefined ? {} : { question_type: type })
						}
					]
				});
				const { response } = await generateCard(r, fakeComplete);
				expect(response.status, `${kind} ${String(type)}`).toBe('ok');
				if (response.status !== 'ok') continue;
				expect(response.card.steps.slice(0, 2).map((s) => ('keep' in s ? s.keep : '?'))).toEqual([
					's0',
					's1'
				]);
				expect(response.card.steps.length).toBeGreaterThan(2);
			}
		}
	});
});

describe('settings and the provider call', () => {
	it('allows 20 million weighted tokens a day by default', () => {
		expect(readAiConfig({}).dailyTokenBudget).toBe(20_000_000);
		expect(readAiConfig({ AI_DAILY_TOKEN_BUDGET: '5' }).dailyTokenBudget).toBe(5);
	});

	it('takes a dossier up to the limit and no longer', () => {
		expect(genRequestSchema.safeParse(request({}, 'x'.repeat(MAX_CONTEXT_CHARS))).success).toBe(
			true
		);
		expect(genRequestSchema.safeParse(request({}, 'x'.repeat(MAX_CONTEXT_CHARS + 1))).success).toBe(
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

	it('asks OpenRouter for hosts that do not keep the text', () => {
		const body = buildBody(readAiConfig({ AI_API_KEY: 'k' }), []);
		expect(body.provider).toMatchObject({ require_parameters: true, data_collection: 'deny' });
		expect(body.model).toBe('deepseek/deepseek-v4.1-flash-1017');
		expect(body.response_format).toEqual({ type: 'json_object' });
		expect(buildBody(readAiConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'k' }), []).provider).toBe(
			undefined
		);
	});

	it('asks OpenRouter for fast hosts at a decent price, and for given hosts first', () => {
		const routing = buildBody(readAiConfig({ AI_API_KEY: 'k' }), []).provider;
		expect(routing).toMatchObject({
			max_price: { prompt: 0.3, completion: 1.2 },
			preferred_min_throughput: { p50: 100 }
		});
		const kinds = (routing as { quantizations: string[] }).quantizations;
		for (const four of ['int4', 'fp4', 'mxfp4', 'nvfp4']) expect(kinds).not.toContain(four);
		expect(kinds).toContain('int8');
		expect(routing).not.toHaveProperty('order');
		// Another model has other prices and hosts: only the speed preference is kept.
		const other = buildBody(readAiConfig({ AI_API_KEY: 'k', AI_MODEL: 'x/y' }), []).provider;
		expect(other).not.toHaveProperty('max_price');
		expect(other).not.toHaveProperty('quantizations');
		expect(other).toHaveProperty('preferred_min_throughput');
		const pinned = readAiConfig({
			AI_API_KEY: 'k',
			AI_HOSTS: ' DeepInfra, fireworks ,',
			AI_MIN_TOKENS_PER_SECOND: '150'
		});
		expect(buildBody(pinned, []).provider).toMatchObject({
			order: ['deepinfra', 'fireworks'],
			preferred_min_throughput: { p50: 150 }
		});
	});

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
		// 50 fresh + 50 cached at a tenth + 2 written.
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
