import { describe, expect, it } from 'vitest';
import { plainMath } from '../plain-math';

describe('plainMath', () => {
	it('turns a fraction into a slash', () => {
		expect(plainMath('\\frac{5}{7}')).toBe('5/7');
		expect(plainMath('\\dfrac{1}{2}')).toBe('1/2');
	});
	it('handles nested fractions and brackets compound parts', () => {
		expect(plainMath('\\frac{1}{\\frac{2}{3}}')).toBe('1/(2/3)');
		expect(plainMath('\\frac{a+b}{c}')).toBe('(a+b)/c');
	});
	it('maps operators', () => {
		expect(plainMath('2 \\cdot 3 \\times 4 \\div 5')).toBe('2 · 3 × 4 : 5');
	});
	it('roots', () => {
		expect(plainMath('\\sqrt{9}')).toBe('√9');
		expect(plainMath('\\sqrt{x+1}')).toBe('√(x+1)');
	});
	it('powers', () => {
		expect(plainMath('x^{2}')).toBe('x²');
		expect(plainMath('x^2')).toBe('x²');
		expect(plainMath('10^{12}')).toBe('10¹²');
		expect(plainMath('x^n')).toBe('x^n');
		expect(plainMath('x^{n+1}')).toBe('x^(n+1)');
	});
	it('drops \\left, \\right and math delimiters', () => {
		expect(plainMath('$\\left(1+2\\right)$')).toBe('(1+2)');
		expect(plainMath('\\(a\\) a \\[b\\]')).toBe('a a b');
	});
	it('keeps unknown commands as their name and removes braces', () => {
		expect(plainMath('\\alpha{x}')).toBe('alphax');
		expect(plainMath('{a}')).toBe('a');
	});
	it('leaves ordinary prose alone', () => {
		expect(plainMath('Cena je > 2 Kč')).toBe('Cena je > 2 Kč');
	});
});
