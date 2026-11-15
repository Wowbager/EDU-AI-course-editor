/**
 * AI provider settings, read from the environment.
 *
 * `readAiConfig` is a pure function of an env record so tests need no `$env`. The route
 * passes `$env/dynamic/private`.
 *
 *   AI_PROVIDER   openrouter (default) | deepseek | fake
 *   AI_API_KEY    the provider's key; without one the editor offers no AI
 *   AI_MODEL, AI_BASE_URL, AI_REASONING_EFFORT   optional overrides
 *   AI_HOSTS      OpenRouter only: host slugs to try first, in order (`deepinfra,fireworks`)
 *   AI_MIN_TOKENS_PER_SECOND   OpenRouter only: hosts slower than this go to the back
 *   AI_DAILY_TOKEN_BUDGET, AI_MAX_REQUESTS_PER_MINUTE   per-workspace limits
 *
 * `fake` needs no key and calls nobody: it answers from the request alone, the same
 * way every time. It is what the end-to-end suite runs against.
 */

export type Provider = 'openrouter' | 'deepseek' | 'fake';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AiConfig = {
	provider: Provider;
	/** Empty when no key is set; the route answers 503. */
	apiKey: string;
	model: string;
	baseURL: string;
	reasoningEffort: ReasoningEffort;
	/** OpenRouter host slugs to try first; empty leaves the choice to OpenRouter. */
	hosts: string[];
	/** OpenRouter puts hosts whose median speed is below this at the back of the line. */
	minTokensPerSecond: number;
	dailyTokenBudget: number;
	maxRequestsPerMinute: number;
	/** What is wrong with the settings, if anything. For the operator's log. */
	problem: string | null;
};

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULTS: Record<Provider, { model: string; baseURL: string }> = {
	// The dated build, so a new release behind the alias changes nothing unannounced.
	openrouter: {
		model: 'deepseek/deepseek-v4.1-flash-1017',
		baseURL: 'https://openrouter.ai/api/v1'
	},
	deepseek: { model: 'deepseek-flash', baseURL: 'https://api.deepseek.com' },
	fake: { model: 'fake', baseURL: '' }
};

const PROVIDERS: readonly string[] = ['openrouter', 'deepseek', 'fake'];
const EFFORTS: readonly string[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_DAILY_TOKEN_BUDGET = 20_000_000;
export const DEFAULT_MAX_REQUESTS_PER_MINUTE = 20;
/** About what DeepSeek's own API does; a whole card at less makes the teacher wait. */
export const DEFAULT_MIN_TOKENS_PER_SECOND = 100;

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
	const known = raw === '' || PROVIDERS.includes(raw);
	const provider: Provider = known && raw !== '' ? (raw as Provider) : 'openrouter';
	const effort = text(env.AI_REASONING_EFFORT).toLowerCase();
	return {
		provider,
		apiKey: text(env.AI_API_KEY),
		model: text(env.AI_MODEL) || DEFAULTS[provider].model,
		baseURL: (text(env.AI_BASE_URL) || DEFAULTS[provider].baseURL).replace(/\/+$/, ''),
		// A card is a small job; a long think only makes the teacher wait.
		reasoningEffort: EFFORTS.includes(effort) ? (effort as ReasoningEffort) : 'low',
		hosts: text(env.AI_HOSTS)
			.split(',')
			.map((h) => h.trim().toLowerCase())
			.filter((h) => h !== ''),
		minTokensPerSecond: positiveInt(env.AI_MIN_TOKENS_PER_SECOND, DEFAULT_MIN_TOKENS_PER_SECOND),
		dailyTokenBudget: positiveInt(env.AI_DAILY_TOKEN_BUDGET, DEFAULT_DAILY_TOKEN_BUDGET),
		maxRequestsPerMinute: positiveInt(
			env.AI_MAX_REQUESTS_PER_MINUTE,
			DEFAULT_MAX_REQUESTS_PER_MINUTE
		),
		problem: known ? null : `AI_PROVIDER "${raw}" is not known (openrouter, deepseek or fake).`
	};
}

/** AI can be offered: the provider name was understood and it has what it needs. */
export function isConfigured(config: AiConfig): boolean {
	if (config.problem !== null) return false;
	return config.provider === 'fake' || config.apiKey !== '';
}
