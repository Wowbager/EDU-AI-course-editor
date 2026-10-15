import { describe, expect, it } from 'vitest';
import { formatNumberInput, parseNumberInput } from '../number-input';
import { formatDateTimeCs } from '../format-date';

describe('parseNumberInput', () => {
	it('takes the number a type="number" input binds, which broke adding an RVP output', () => {
		expect(parseNumberInput(70)).toBe(70);
		expect(parseNumberInput(0)).toBe(0);
		expect(parseNumberInput(Number.NaN)).toBeUndefined();
	});

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

describe('formatNumberInput', () => {
	it('shows a decimal comma and every digit, never a rounded value', () => {
		expect(formatNumberInput(3.14159)).toBe('3,14159');
		expect(formatNumberInput(0.0005)).toBe('0,0005');
		expect(formatNumberInput(-5)).toBe('-5');
		expect(formatNumberInput(0)).toBe('0');
	});
	it('is empty for no value', () => {
		expect(formatNumberInput(undefined)).toBeUndefined();
		expect(formatNumberInput(Number.NaN)).toBeUndefined();
	});
	it('reads back to the same number, so leaving a field never changes it', () => {
		for (const n of [3.14159, -3.14159, 0.0001, 1e-7, 1e21, 123456.789, -0.5, 0]) {
			expect(parseNumberInput(formatNumberInput(n))).toBe(n);
		}
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
