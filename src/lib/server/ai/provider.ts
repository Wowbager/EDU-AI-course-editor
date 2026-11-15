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

/** USD per million tokens. */
const MAX_PRICE = { prompt: 0.3, completion: 1.2 };

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
		body.provider = {
			// Only hosts that honour the parameters above, and none that train on what they see.
			require_parameters: true,
			data_collection: 'deny',
			// No host that says it is 4-bit (the cheapest are; Czech is where that slips). One that
			// does not say is let through, or too few would be left.
			quantizations: ['fp8', 'mxfp8', 'fp16', 'bf16', 'fp32', 'unknown'],
			// Dearer than DeepSeek's own peak price is not "decent"; a whole card costs cents anyway.
			max_price: MAX_PRICE,
			// A preference, not a filter: OpenRouter keeps its own routing, which stays on the host
			// whose prompt cache holds the dossier, and only moves slow hosts to the back.
			preferred_min_throughput: { p50: config.minTokensPerSecond },
			...(config.hosts.length > 0 ? { order: config.hosts } : {})
		};
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
