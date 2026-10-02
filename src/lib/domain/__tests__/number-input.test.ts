import { describe, expect, it } from 'vitest';
import { parseNumberInput } from '../number-input';
import { formatDateTimeCs } from '../format-date';

describe('parseNumberInput', () => {
	it('treats empty and blank as not set, not 0', () => {
		expect(parseNumberInput('')).toBeUndefined();
		expect(parseNumberInput('   ')).toBeUndefined();
		expect(parseNumberInput(undefined)).toBeUndefined();
	});
	it('keeps a real 0', () => {
		expect(parseNumberInput('0')).toBe(0);
	});
	it('accepts a decimal comma', () => {
		expect(parseNumberInput('0,3')).toBe(0.3);
		expect(parseNumberInput(' 2.5 ')).toBe(2.5);
		expect(parseNumberInput('-1,5')).toBe(-1.5);
	});
	it('is not set for text', () => {
		expect(parseNumberInput('abc')).toBeUndefined();
		expect(parseNumberInput('1,2,3')).toBeUndefined();
		expect(parseNumberInput('Infinity')).toBeUndefined();
	});
});

describe('formatDateTimeCs', () => {
	it('formats an ISO timestamp in local time', () => {
		const iso = '2026-02-12T12:00:00.000Z';
		const d = new Date(iso);
		expect(formatDateTimeCs(iso)).toBe(
			`${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
		);
		expect(formatDateTimeCs('2026-02-12T12:00:00.000Z')).toMatch(/^12\. 2\. 2026, \d{1,2}:00$/);
	});
	it('shows what is not a date as it is', () => {
		expect(formatDateTimeCs('včera')).toBe('včera');
		expect(formatDateTimeCs('')).toBe('');
	});
});
