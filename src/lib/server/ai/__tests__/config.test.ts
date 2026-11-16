import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_REQUESTS_PER_MINUTE, readAiConfig } from '../config';

describe('the per-minute request limit', () => {
	it('lets a course of many lessons start at once: 300 a minute unless the operator says', () => {
		expect(DEFAULT_MAX_REQUESTS_PER_MINUTE).toBe(300);
		expect(readAiConfig({}).maxRequestsPerMinute).toBe(300);
		expect(readAiConfig({ AI_MAX_REQUESTS_PER_MINUTE: '40' }).maxRequestsPerMinute).toBe(40);
	});
});
