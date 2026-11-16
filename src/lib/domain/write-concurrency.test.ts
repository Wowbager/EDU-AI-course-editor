import { describe, expect, it } from 'vitest';
import { concurrencyFor, LIMITED_CONCURRENCY } from './write-concurrency';

describe('how many lessons are written at once', () => {
	it('has no cap over HTTP/2 and HTTP/3: every lesson at once', () => {
		expect(concurrencyFor('h2')).toBe(Infinity);
		expect(concurrencyFor('h3')).toBe(Infinity);
	});

	it('keeps four over HTTP/1.1, another protocol, or when the browser does not say', () => {
		expect(concurrencyFor('http/1.1')).toBe(LIMITED_CONCURRENCY);
		expect(concurrencyFor('')).toBe(4);
		expect(concurrencyFor(undefined)).toBe(4);
	});
});
