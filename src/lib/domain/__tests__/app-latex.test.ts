import { describe, expect, it } from 'vitest';
import { toAppLatex } from '../app-latex';

describe('toAppLatex', () => {
	it('drops the empty boxes still to fill', () => {
		expect(toAppLatex('\\frac{1}{\\placeholder{}}')).toBe('\\frac{1}{}');
		expect(toAppLatex('\\placeholder{}^2')).toBe('^2');
	});
	it('writes ≠ so a text step does not break it into a line', () => {
		expect(toAppLatex('a\\ne b')).toBe('a\\not= b');
		expect(toAppLatex('a\\neq b')).toBe('a\\not= b');
		expect(toAppLatex('\\nu\\neg\\nearrow')).toBe('\\nu\\neg\\nearrow');
	});
	it('maps the logic keys the app cannot draw', () => {
		expect(toAppLatex('p\\roundimplies q')).toBe('p\\Rightarrow q');
		expect(toAppLatex('p\\biconditional q')).toBe('p\\leftrightarrow q');
		expect(toAppLatex('a\\Colon b')).toBe('a:: b');
		// Czech division is a plain `:` (a ratio); the app has no `\colon`.
		expect(toAppLatex('a\\colon b')).toBe('a: b');
	});
	it('does not take a row break for a command', () => {
		expect(toAppLatex('\\begin{cases}a\\\\ne\\end{cases}')).toBe(
			'\\begin{cases}a\\\\ne\\end{cases}'
		);
		expect(toAppLatex('\\begin{cases}a\\\\\\neq b\\end{cases}')).toBe(
			'\\begin{cases}a\\\\\\not= b\\end{cases}'
		);
	});
	it('canonicalises operator names and unit groups (§6)', () => {
		expect(toAppLatex('\\operatorname{\\mathrm{tg}} \\alpha')).toBe('\\operatorname{tg} \\alpha');
		expect(toAppLatex('12\\,\\mathrm{m}\\cdot\\mathrm{s}^{-1}')).toBe(
			'12\\,\\mathrm{m\\cdot s^{-1}}'
		);
		expect(toAppLatex('\\mathrm{m}\\cdot\\mathrm{s}\\cdot\\mathrm{kg}')).toBe(
			'\\mathrm{m\\cdot s\\cdot kg}'
		);
		// A teacher-typed exponent on an upright group stays as written only when it
		// is not a unit sequence — but this is MathLive output, so it folds.
		expect(toAppLatex('\\mathrm{m}^{2}')).toBe('\\mathrm{m^{2}}');
	});
	it('leaves everything else as it is', () => {
		expect(toAppLatex('\\frac{\\sqrt{x}}{2}\\cdot\\pi')).toBe('\\frac{\\sqrt{x}}{2}\\cdot\\pi');
		expect(toAppLatex('\\constructor\\toString')).toBe('\\constructor\\toString');
	});
});
