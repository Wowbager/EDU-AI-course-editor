import { describe, expect, it, vi } from 'vitest';
import { readAiConfig } from '../config';
import { FAKE_READING } from '../fake';
import { buildVisionBody, visionist, type Vision } from '../provider';
import { READ_PROMPT, readPicture } from '../read';

const picture = { mime: 'image/png', base64: 'AAAA' };
const answering =
	(text: string): Vision =>
	async () => ({ text, tokens: 5 });

describe('reading a picture', () => {
	it('returns the transcription, without a code fence around it', async () => {
		expect(await readPicture(answering('```markdown\n# Rovnice\n$x=1$\n```'), picture)).toEqual({
			text: '# Rovnice\n$x=1$',
			tokens: 5
		});
		expect((await readPicture(answering('  Text.  '), picture)).text).toBe('Text.');
	});

	it('an empty page is no text', async () => {
		expect((await readPicture(answering('[prázdná strana]'), picture)).text).toBe('');
	});

	it('asks for Czech Markdown with maths in dollar signs and figures in one line', () => {
		expect(READ_PROMPT).toContain('$');
		expect(READ_PROMPT).toContain('[Obrázek:');
		expect(READ_PROMPT).toContain('Handwriting');
	});

	it('the provider call sends the picture as an image_url part, without reasoning', () => {
		const config = readAiConfig({ AI_PROVIDER: 'openrouter', AI_API_KEY: 'k' });
		const body = buildVisionBody(config, 'instructions', picture) as {
			messages: { role: string; content: unknown }[];
			reasoning: unknown;
			provider: { data_collection: string };
		};
		expect(body.messages[0]).toEqual({ role: 'system', content: 'instructions' });
		expect(body.messages[1].content).toContainEqual({
			type: 'image_url',
			image_url: { url: 'data:image/png;base64,AAAA' }
		});
		expect(body.reasoning).toEqual({ effort: 'none' });
		expect(body.provider.data_collection).toBe('deny');
	});

	it('the provider call returns the text and what the call used', async () => {
		const config = readAiConfig({ AI_PROVIDER: 'openrouter', AI_API_KEY: 'k' });
		const fetcher = vi.fn(async () =>
			Response.json({
				choices: [{ message: { content: 'Přepis' } }],
				usage: { prompt_tokens: 1000, completion_tokens: 20 }
			})
		);
		const vision = visionist(config, fetcher as unknown as typeof fetch);
		expect(await vision('i', picture)).toEqual({ text: 'Přepis', tokens: 1020 });
		await expect(
			visionist(config, (async () => new Response('', { status: 503 })) as never, {
				attempts: 1,
				baseMs: 0,
				maxDelayMs: 0,
				maxWaitMs: 0
			})('i', picture)
		).rejects.toMatchObject({ kind: 'busy' });
	});

	it('the fake reads every picture the same way', async () => {
		const vision = visionist(readAiConfig({ AI_PROVIDER: 'fake' }));
		expect((await vision('i', picture)).text).toBe(FAKE_READING);
	});
});
