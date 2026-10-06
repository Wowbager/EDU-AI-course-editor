/**
 * AI provider settings, read from the environment.
 *
 * `readAiConfig` is a pure function of an env record so tests need no `$env`. The route
 * passes `$env/dynamic/private`.
 */

export type Provider = 'openrouter' | 'deepseek';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AiConfig = {
	provider: Provider;
	/** Empty when no key is set; the route answers 503. */
	apiKey: string;
	model: string;
	baseURL: string;
	reasoningEffort: ReasoningEffort;
	/**
	 * OpenRouter hosts to try first, in order (`AI_OPENROUTER_PROVIDERS`). Empty: OpenRouter
	 * chooses per request, which can send consecutive turns to different hosts, and a host's
	 * prompt cache is only hit by the same host.
	 */
	openrouterProviders: string[];
	dailyTokenBudget: number;
	maxRequestsPerMinute: number;
	/** What is wrong with the settings, if anything. Czech, for the operator's log. */
	problem: string | null;
};

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULTS: Record<Provider, { model: string; baseURL: string }> = {
	openrouter: { model: 'deepseek/deepseek-v4.1-flash', baseURL: 'https://openrouter.ai/api/v1' },
	deepseek: { model: 'deepseek-flash', baseURL: 'https://api.deepseek.com' }
};

const EFFORTS: readonly string[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_DAILY_TOKEN_BUDGET = 2_000_000;
export const DEFAULT_MAX_REQUESTS_PER_MINUTE = 20;

function positiveInt(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === '') return fallback;
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

function text(value: string | undefined): string {
	return (value ?? '').trim();
}

export function readAiConfig(env: Env): AiConfig {
	const raw = text(env.AI_PROVIDER).toLowerCase();
	const known = raw === '' || raw === 'openrouter' || raw === 'deepseek';
	const provider: Provider = raw === 'deepseek' ? 'deepseek' : 'openrouter';
	const effort = text(env.AI_REASONING_EFFORT).toLowerCase();
	return {
		provider,
		apiKey: text(env.AI_API_KEY),
		model: text(env.AI_MODEL) || DEFAULTS[provider].model,
		baseURL: (text(env.AI_BASE_URL) || DEFAULTS[provider].baseURL).replace(/\/+$/, ''),
		reasoningEffort: EFFORTS.includes(effort) ? (effort as ReasoningEffort) : 'high',
		openrouterProviders: text(env.AI_OPENROUTER_PROVIDERS)
			.split(',')
			.map((name) => name.trim())
			.filter((name) => name !== ''),
		dailyTokenBudget: positiveInt(env.AI_DAILY_TOKEN_BUDGET, DEFAULT_DAILY_TOKEN_BUDGET),
		maxRequestsPerMinute: positiveInt(
			env.AI_MAX_REQUESTS_PER_MINUTE,
			DEFAULT_MAX_REQUESTS_PER_MINUTE
		),
		problem: known ? null : `AI_PROVIDER „${raw}“ není známý (openrouter nebo deepseek).`
	};
}

/** The chat is usable: there is a key and the provider name was understood. */
export function isConfigured(config: AiConfig): boolean {
	return config.apiKey !== '' && config.problem === null;
}
