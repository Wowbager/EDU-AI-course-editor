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
	it('reads a one-character argument without braces, as the formula editor writes it', () => {
		expect(plainMath('\\sqrt9')).toBe('√9');
		expect(plainMath('\\frac12')).toBe('1/2');
		expect(plainMath('\\frac{1}{2+x^2}+\\sqrt9')).toBe('1/(2+x²)+√9');
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
	it('removes braces', () => {
		expect(plainMath('\\alpha{x}')).toBe('αx');
		expect(plainMath('{a}')).toBe('a');
	});
	it('leaves ordinary prose alone', () => {
		expect(plainMath('Cena je > 2 Kč')).toBe('Cena je > 2 Kč');
	});
});

describe('plainMath: commands it has no rule for', () => {
	it('draws accents as combining marks the UI font has, and a vector as its letter', () => {
		expect(plainMath('Vektor $\\vec{u}$')).toBe('Vektor u');
		expect(plainMath('\\vec u')).toBe('u');
		expect(plainMath('\\overline{AB}')).toBe('A\u0304B\u0304');
		expect(plainMath('\\bar{x}')).toBe('x\u0304');
		expect(plainMath('\\hat{a}')).toBe('a\u0302');
	});
	it('does not read a longer command as an accent', () => {
		expect(plainMath('a \\doteq b')).toBe('a ≐ b');
	});
	it('writes Greek letters and symbols as characters', () => {
		expect(plainMath('Změna $\\Delta{ }$ teploty')).toBe('Změna Δ teploty');
		expect(plainMath('\\alpha + \\beta')).toBe('α + β');
		expect(plainMath('x \\in \\mathbb{R}')).toBe('x ∈ ℝ');
		expect(plainMath('\\lim\\limits_{x \\to \\infty} x')).toBe('lim_x → ∞ x');
	});
	it('drops commands it does not know and keeps their content', () => {
		expect(plainMath('5\\,\\mathrm{m}')).toBe('5 m');
		expect(plainMath('\\text{rychlost}')).toBe('rychlost');
		expect(plainMath('\\ce{H2O}')).toBe('H2O');
		expect(plainMath('\\foo x')).toBe('x');
		expect(plainMath('\\begin{pmatrix} 1 & 2 \\end{pmatrix}')).toBe('1 2');
	});
	it('reads fractions, binomials and dots it used to spell out', () => {
		expect(plainMath('1, 2, \\ldots, n')).toBe('1, 2, …, n');
		expect(plainMath('\\tfrac{1}{2}')).toBe('1/2');
		expect(plainMath('\\binom{n}{k}')).toBe('(n nad k)');
	});
	it('keeps & outside a matrix, and reads a line break as a space', () => {
		expect(plainMath('Tom & Jerry')).toBe('Tom & Jerry');
		expect(plainMath('Zlomky & desetinná čísla')).toBe('Zlomky & desetinná čísla');
		expect(plainMath('a \\\\ b')).toBe('a b');
		expect(plainMath('\\begin{cases}\\begin{matrix}a&b\\end{matrix}&x\\end{cases}')).toBe('a b x');
		expect(plainMath('\\begin{aligned}x')).toBe('x');
		expect(plainMath('\\begin{matrix}a&b')).toBe('a b');
		expect(plainMath('\\begin{matrix}a&b\\end{matrix}'.repeat(30))).not.toContain('&');
		expect(plainMath('Tom & Jerry $\\begin{matrix}a&b\\end{matrix}$')).toBe('Tom & Jerry a b');
	});
	it('subscripts digits', () => {
		expect(plainMath('a_{12} + x_1')).toBe('a₁₂ + x₁');
	});
});
