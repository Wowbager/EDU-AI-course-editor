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
		expect(toAppLatex('a\\colon b')).toBe('a\\colon b');
	});
	it('does not take a row break for a command', () => {
		expect(toAppLatex('\\begin{cases}a\\\\ne\\end{cases}')).toBe(
			'\\begin{cases}a\\\\ne\\end{cases}'
		);
		expect(toAppLatex('\\begin{cases}a\\\\\\neq b\\end{cases}')).toBe(
			'\\begin{cases}a\\\\\\not= b\\end{cases}'
		);
	});
	it('leaves everything else as it is', () => {
		expect(toAppLatex('\\frac{\\sqrt{x}}{2}\\cdot\\pi')).toBe('\\frac{\\sqrt{x}}{2}\\cdot\\pi');
		expect(toAppLatex('\\constructor\\toString')).toBe('\\constructor\\toString');
	});
});
