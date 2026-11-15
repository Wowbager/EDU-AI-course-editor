/**
 * One call to an OpenAI-compatible chat endpoint (OpenRouter, or DeepSeek directly),
 * asking for a JSON object. This is the only file that knows a provider; everything
 * else sees `Complete`.
 */
import type { AiConfig } from './config';
import { fakeComplete } from './fake';
import { weightedTokens, type Usage } from './limits';

export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export type Completion = { text: string; tokens: number };
export type Complete = (messages: readonly Message[]) => Promise<Completion>;

/** Why a call failed, in the terms the route answers with. */
export class ProviderError extends Error {
	constructor(
		readonly kind: 'auth' | 'busy' | 'network' | 'failed',
		detail: string
	) {
		super(detail);
		this.name = 'ProviderError';
	}
}

/** A whole card with a long dossier and some thinking: more than a single step took. */
const TIMEOUT_MS = 150_000;

export function buildBody(config: AiConfig, messages: readonly Message[]): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: config.model,
		messages,
		response_format: { type: 'json_object' }
	};
	if (config.provider === 'deepseek') {
		body.thinking = { type: config.reasoningEffort === 'none' ? 'disabled' : 'enabled' };
	} else {
		body.reasoning = { effort: config.reasoningEffort };
		// Only hosts that honour the parameters above, and none that train on what they see.
		body.provider = { require_parameters: true, data_collection: 'deny' };
	}
	return body;
}

export function completer(config: AiConfig, fetcher: typeof fetch = fetch): Complete {
	if (config.provider === 'fake') return fakeComplete;
	return async (messages) => {
		let response: Response;
		try {
			response = await fetcher(`${config.baseURL}/chat/completions`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${config.apiKey}`,
					// ASCII only: a header with a Czech letter fails the request.
					...(config.provider === 'openrouter'
						? { 'HTTP-Referer': 'https://edu-ai.eu', 'X-Title': 'EDU-AI course editor' }
						: {})
				},
				body: JSON.stringify(buildBody(config, messages)),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (e) {
			throw new ProviderError('network', e instanceof Error ? e.message : String(e));
		}
		if (!response.ok) {
			const detail = `${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`;
			if (response.status === 401 || response.status === 403 || response.status === 402)
				throw new ProviderError('auth', detail);
			if (response.status === 429 || response.status === 503 || response.status === 529)
				throw new ProviderError('busy', detail);
			throw new ProviderError('failed', detail);
		}
		const data = (await response.json().catch(() => null)) as {
			choices?: { message?: { content?: unknown } }[];
			usage?: Usage;
		} | null;
		const content = data?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') throw new ProviderError('failed', 'no message content');
		return { text: content, tokens: weightedTokens(data?.usage) };
	};
}
