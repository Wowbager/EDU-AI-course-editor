/**
 * AI provider settings, read from the environment.
 *
 * `readAiConfig` is a pure function of an env record so tests need no `$env`. The route
 * passes `$env/dynamic/private`.
 *
 *   AI_PROVIDER   openrouter (default) | deepseek | fake
 *   AI_API_KEY    the provider's key; without one the editor offers no AI
 *   AI_MODEL, AI_BASE_URL, AI_REASONING_EFFORT   optional overrides
 *   AI_DAILY_TOKEN_BUDGET, AI_MAX_REQUESTS_PER_MINUTE   per-workspace limits
 *   AI_DAILY_TOKEN_BUDGET_PER_IP, AI_MAX_REQUESTS_PER_MINUTE_PER_IP   per client address
 *   AI_DAILY_TOKEN_BUDGET_TOTAL, AI_MAX_REQUESTS_PER_MINUTE_TOTAL   for the whole server
 *   AI_MAX_OUTPUT_TOKENS   `max_tokens` of a text call; unset, the host's own limit
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
	dailyTokenBudget: number;
	maxRequestsPerMinute: number;
	dailyTokenBudgetPerIp: number;
	maxRequestsPerMinutePerIp: number;
	dailyTokenBudgetTotal: number;
	maxRequestsPerMinuteTotal: number;
	/**
	 * What one text call may write, thinking included; `null` sends none. Not set by
	 * default: a host whose own limit is lower would refuse every call.
	 */
	maxOutputTokens: number | null;
	/** What is wrong with the settings, if anything. For the operator's log. */
	problem: string | null;
};

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULTS: Record<Provider, { model: string; baseURL: string }> = {
	openrouter: {
		model: 'deepseek/deepseek-v4.1-flash:nitro',
		baseURL: 'https://openrouter.ai/api/v1'
	},
	deepseek: { model: 'deepseek-flash', baseURL: 'https://api.deepseek.com' },
	fake: { model: 'fake', baseURL: '' }
};

const PROVIDERS: readonly string[] = ['openrouter', 'deepseek', 'fake'];
const EFFORTS: readonly string[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_DAILY_TOKEN_BUDGET = 20_000_000;
export const DEFAULT_MAX_REQUESTS_PER_MINUTE = 300;
/** A school is one address: several teachers' worth. */
export const DEFAULT_DAILY_TOKEN_BUDGET_PER_IP = 60_000_000;
export const DEFAULT_MAX_REQUESTS_PER_MINUTE_PER_IP = 900;
/** The ceiling on a day's bill, whoever asks. */
export const DEFAULT_DAILY_TOKEN_BUDGET_TOTAL = 200_000_000;
export const DEFAULT_MAX_REQUESTS_PER_MINUTE_TOTAL = 3000;

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
		dailyTokenBudget: positiveInt(env.AI_DAILY_TOKEN_BUDGET, DEFAULT_DAILY_TOKEN_BUDGET),
		maxRequestsPerMinute: positiveInt(
			env.AI_MAX_REQUESTS_PER_MINUTE,
			DEFAULT_MAX_REQUESTS_PER_MINUTE
		),
		dailyTokenBudgetPerIp: positiveInt(
			env.AI_DAILY_TOKEN_BUDGET_PER_IP,
			DEFAULT_DAILY_TOKEN_BUDGET_PER_IP
		),
		maxRequestsPerMinutePerIp: positiveInt(
			env.AI_MAX_REQUESTS_PER_MINUTE_PER_IP,
			DEFAULT_MAX_REQUESTS_PER_MINUTE_PER_IP
		),
		maxOutputTokens: positiveInt(env.AI_MAX_OUTPUT_TOKENS, 0) || null,
		dailyTokenBudgetTotal: positiveInt(
			env.AI_DAILY_TOKEN_BUDGET_TOTAL,
			DEFAULT_DAILY_TOKEN_BUDGET_TOTAL
		),
		maxRequestsPerMinuteTotal: positiveInt(
			env.AI_MAX_REQUESTS_PER_MINUTE_TOTAL,
			DEFAULT_MAX_REQUESTS_PER_MINUTE_TOTAL
		),
		problem: known ? null : `AI_PROVIDER "${raw}" is not known (openrouter, deepseek or fake).`
	};
}

/** AI can be offered: the provider name was understood and it has what it needs. */
export function isConfigured(config: AiConfig): boolean {
	if (config.problem !== null) return false;
	return config.provider === 'fake' || config.apiKey !== '';
}
