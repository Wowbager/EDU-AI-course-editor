import { describe, expect, it } from 'vitest';
import type { GenRequest } from '$lib/domain/authoring';
import { isConfigured, readAiConfig } from '../config';
import { fakeComplete, fakeGenerated } from '../fake';
import { generateBlock, parseJson } from '../generate';
import { buildBody, completer, ProviderError, type Complete } from '../provider';

const request = (over: Partial<GenRequest['block']> = {}): GenRequest => ({
	schema: 'eduai.gen-request/1',
	mode: 'complete',
	course: { title: 'Zlomky', language: 'cs', audience: { grade: 4 } },
	lesson: { name: 'Polovina', neighbors: [] },
	block: {
		kind: 'exercise',
		title: 'Kolik je polovina',
		missing: ['help'],
		given: { content_md: 'Kolik je polovina z osmi?', hint_md: 'Děl dvěma.' },
		...over
	}
});

/** A model that says the given things, one per call. */
const scripted = (...answers: unknown[]): Complete & { calls: number } => {
	const fn = (async () => {
		const answer = answers[Math.min(fn.calls, answers.length - 1)];
		fn.calls++;
		return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), tokens: 10 };
	}) as unknown as Complete & { calls: number };
	fn.calls = 0;
	return fn;
};

describe('generateBlock', () => {
	it('returns only what was asked, whatever else the model wrote', async () => {
		const model = scripted({
			help_md: 'Polovina je jedna ze dvou stejných částí.',
			hint_md: 'Přepsaná nápověda',
			content_md: 'Přepsané zadání'
		});
		const { response, tokens } = await generateBlock(request(), model);
		expect(response).toEqual({
			status: 'ok',
			block: { help_md: 'Polovina je jedna ze dvou stejných částí.' }
		});
		expect(tokens).toBe(10);
	});

	it('reads JSON the model wrapped in a code fence', async () => {
		const model = scripted('```json\n{"help_md":"Pomoc."}\n```');
		expect((await generateBlock(request(), model)).response.status).toBe('ok');
		expect(parseJson('nothing here')).toBeUndefined();
	});

	it('asks again when a part is missing, and takes the second answer', async () => {
		const model = scripted({}, { help_md: 'Pomoc.' });
		const { response, tokens } = await generateBlock(request(), model);
		expect(response.status).toBe('ok');
		expect(model.calls).toBe(2);
		expect(tokens).toBe(20);
	});

	it('gives up after two repeats and writes nothing', async () => {
		const model = scripted('not json');
		const { response } = await generateBlock(request(), model);
		expect(response).toEqual({ status: 'failed', block: {} });
		expect(model.calls).toBe(3);
	});

	it('does not take a question with the wrong number of right answers', async () => {
		const options = ['a', 'b', 'c'].map((text) => ({ text, correct: true, feedback: 'x' }));
		const model = scripted({ question: { type: 'mcq_1', options } });
		const { response } = await generateBlock(request({ missing: ['question'] }), model);
		expect(response.status).toBe('failed');
	});

	it('holds the model to the question type the teacher chose', async () => {
		const model = scripted(
			{ question: { type: 'open', answer: 'čtyři' } },
			{ question: { type: 'number', answer: 4 } }
		);
		const { response } = await generateBlock(
			request({ missing: ['question'], question_type: 'number' }),
			model
		);
		expect(response).toEqual({
			status: 'ok',
			block: { question: { type: 'number', answer: 4 } }
		});
	});

	it('wants one reaction per answer the teacher wrote', async () => {
		const given = {
			content_md: 'Kolik?',
			question: { type: 'mcq_1', options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }
		};
		const model = scripted(
			{ option_feedback: ['jen jedna'] },
			{ option_feedback: ['1', '2', '3'] }
		);
		const { response } = await generateBlock(request({ missing: ['feedback'], given }), model);
		expect(response.status).toBe('ok');
		expect(model.calls).toBe(2);
	});
});

describe('the fake provider', () => {
	it('answers every kind of request in a shape the generator accepts', async () => {
		for (const type of ['yes_no', 'number', 'mcq_1', 'mcq_n', 'open', undefined] as const) {
			const r = request({
				missing: ['content', 'question', 'hint', 'help', 'solution'],
				given: {},
				...(type === undefined ? {} : { question_type: type })
			});
			const { response } = await generateBlock(r, fakeComplete);
			expect(response.status, String(type)).toBe('ok');
			expect(Object.keys(response.block).sort()).toEqual(Object.keys(fakeGenerated(r)).sort());
		}
	});
});

describe('settings and the provider call', () => {
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
		expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
		expect(body.response_format).toEqual({ type: 'json_object' });
		expect(buildBody(readAiConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'k' }), []).provider).toBe(
			undefined
		);
	});

	it('sends the key to the provider and reads the answer', async () => {
		let seen: { url: string; auth: string | null } | undefined;
		const fetcher = (async (url: string, init: RequestInit) => {
			seen = { url, auth: new Headers(init.headers).get('authorization') };
			return Response.json({
				choices: [{ message: { content: '{"help_md":"x"}' } }],
				usage: { total_tokens: 7 }
			});
		}) as unknown as typeof fetch;
		const complete = completer(readAiConfig({ AI_API_KEY: 'secret' }), fetcher);
		expect(await complete([])).toEqual({ text: '{"help_md":"x"}', tokens: 7 });
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
