import { describe, expect, it } from 'vitest';
import { isConfigured, readAiConfig } from '../config';

describe('readAiConfig', () => {
	it('defaults to OpenRouter with no key', () => {
		const c = readAiConfig({});
		expect(c).toMatchObject({
			provider: 'openrouter',
			apiKey: '',
			model: 'deepseek/deepseek-v4.1-flash',
			baseURL: 'https://openrouter.ai/api/v1',
			reasoningEffort: 'high',
			dailyTokenBudget: 2_000_000,
			maxRequestsPerMinute: 20,
			problem: null
		});
		expect(isConfigured(c)).toBe(false);
	});

	it('takes DeepSeek defaults and overrides', () => {
		const c = readAiConfig({ AI_PROVIDER: 'DeepSeek', AI_API_KEY: ' k ' });
		expect(c).toMatchObject({
			provider: 'deepseek',
			apiKey: 'k',
			model: 'deepseek-flash',
			baseURL: 'https://api.deepseek.com'
		});
		expect(isConfigured(c)).toBe(true);
		const o = readAiConfig({
			AI_API_KEY: 'k',
			AI_MODEL: 'x/y',
			AI_BASE_URL: 'https://proxy.example/v1/',
			AI_REASONING_EFFORT: 'LOW',
			AI_DAILY_TOKEN_BUDGET: '500',
			AI_MAX_REQUESTS_PER_MINUTE: '3'
		});
		expect(o).toMatchObject({
			model: 'x/y',
			baseURL: 'https://proxy.example/v1',
			reasoningEffort: 'low',
			dailyTokenBudget: 500,
			maxRequestsPerMinute: 3
		});
	});

	it('falls back on junk numbers and efforts', () => {
		const c = readAiConfig({
			AI_REASONING_EFFORT: 'extreme',
			AI_DAILY_TOKEN_BUDGET: '-5',
			AI_MAX_REQUESTS_PER_MINUTE: 'many'
		});
		expect(c.reasoningEffort).toBe('high');
		expect(c.dailyTokenBudget).toBe(2_000_000);
		expect(c.maxRequestsPerMinute).toBe(20);
	});

	it('reports an unknown provider as not configured', () => {
		const c = readAiConfig({ AI_PROVIDER: 'claude', AI_API_KEY: 'k' });
		expect(c.problem).toContain('claude');
		expect(isConfigured(c)).toBe(false);
	});
});
