import { describe, expect, it } from 'vitest';
import { toAppLatex, withSlots, withAppLimits } from '../app-latex';

describe('toAppLatex', () => {
	it('writes the empty boxes still to fill as nothing the app draws', () => {
		expect(toAppLatex('\\frac{1}{\\placeholder{}}')).toBe('\\frac{1}{}');
		expect(toAppLatex('\\sqrt[\\placeholder{}]{x}')).toBe('\\sqrt[]{x}');
		// Not an argument: kept as an empty group, so the box can be found again.
		expect(toAppLatex('\\placeholder{}^2')).toBe('{ }^2');
		expect(toAppLatex('[\\placeholder{}]=\\placeholder{}')).toBe('[{ }]={ }');
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

/**
 * What MathLive writes for every keypad template inserted and left empty (read from the
 * field in the browser). Closing the formula and opening it again must give back every
 * box: before, a reopened `\\vec{}` had nowhere to type.
 */
const EMPTY_TEMPLATES = [
	'\\frac{\\placeholder{}}{\\placeholder{}}',
	'\\placeholder{}^{\\placeholder{}}',
	'\\sqrt{\\placeholder{}}',
	'\\placeholder{}\\frac{\\placeholder{}}{\\placeholder{}}',
	'\\sqrt[\\placeholder{}]{\\placeholder{}}',
	'\\placeholder{}_{\\placeholder{}}',
	'\\lvert\\placeholder{}\\rvert',
	'\\log_{\\placeholder{}}\\placeholder{}',
	'\\langle\\placeholder{};\\placeholder{}\\rangle',
	'(\\placeholder{};\\placeholder{})',
	'\\langle\\placeholder{};\\placeholder{})',
	'\\begin{cases}\\placeholder{}\\\\ \\placeholder{}\\end{cases}',
	'\\left(\\placeholder{}\\right)',
	'\\overline{\\placeholder{}}',
	'\\vec{\\placeholder{}}',
	'\\placeholder{}[\\placeholder{};\\placeholder{}]',
	'(\\placeholder{};\\placeholder{};\\placeholder{})',
	'\\{\\placeholder{};\\placeholder{}\\}',
	'\\{\\placeholder{},\\placeholder{}\\}',
	'\\binom{\\placeholder{}}{\\placeholder{}}',
	'V(\\placeholder{},\\placeholder{})',
	'\\sum_{\\placeholder{}}^{\\placeholder{}}\\placeholder{}',
	'\\lim_{\\placeholder{}\\to\\placeholder{}}\\placeholder{}',
	'\\placeholder{}^{\\prime}(\\placeholder{})',
	'\\int_{\\placeholder{}}^{\\placeholder{}}\\placeholder{}\\,\\mathrm{d}x',
	'\\bar{\\placeholder{}}',
	'\\begin{pmatrix}\\placeholder{} & \\placeholder{}\\\\ \\placeholder{} & \\placeholder{}\\end{pmatrix}',
	'\\placeholder{}\\cdot10^{\\placeholder{}}',
	'\\placeholder{}\\,\\placeholder{}',
	'[\\placeholder{}]=\\placeholder{}',
	'\\lvert\\vec{\\placeholder{}}\\rvert',
	'\\Delta\\placeholder{}',
	'{}_{\\placeholder{}}^{\\placeholder{}}\\placeholder{}'
];

describe('withSlots', () => {
	it.each(EMPTY_TEMPLATES)('gives back every box of %s', (written) => {
		expect(withSlots(toAppLatex(written))).toBe(written);
	});
	it('fills an empty argument stored before boxes were kept', () => {
		expect(withSlots('\\vec{}')).toBe('\\vec{\\placeholder{}}');
		expect(withSlots('\\frac{1}{}')).toBe('\\frac{1}{\\placeholder{}}');
		expect(withSlots('x^{}')).toBe('x^{\\placeholder{}}');
		// A script after the box does not hide it.
		expect(withSlots('\\sqrt{}^{2}')).toBe('\\sqrt{\\placeholder{}}^{2}');
		expect(withSlots('\\vec{}_x')).toBe('\\vec{\\placeholder{}}_x');
		// An empty denominator under an exponent is still the fraction's argument.
		expect(withSlots('\\frac{a}{}^2')).toBe('\\frac{a}{\\placeholder{}}^2');
		expect(withSlots('\\xrightarrow[a]{}')).toBe('\\xrightarrow[a]{\\placeholder{}}');
		expect(withSlots('\\binom{}{}')).toBe('\\binom{\\placeholder{}}{\\placeholder{}}');
		expect(withSlots('\\frac{\\mathrm{H}{}_2}{}')).toBe('\\frac{\\mathrm{H}{}_2}{\\placeholder{}}');
	});
	it('leaves an empty group after a symbol alone', () => {
		for (const latex of ['\\alpha{}_2', '\\Delta{}^{2}', '\\pi{}'])
			expect(withSlots(latex)).toBe(latex);
	});
	it('leaves a spaced text and an empty base written on purpose alone', () => {
		for (const latex of [
			'a\\text{ }b',
			'\\mathrm{ }',
			'\\mathbb{ }',
			'\\mathrm{H}{}_2',
			'\\mathrm{C}{}^{14}'
		])
			expect(withSlots(latex)).toBe(latex);
	});
	it('leaves LaTeX empty groups, escaped braces and full formulas alone', () => {
		for (const latex of ['{}^{14}_{6}\\mathrm{C}', '3{,}14', '\\{1;2\\}', '\\frac{1}{2}', 'a\\\\b'])
			expect(withSlots(latex)).toBe(latex);
	});
});

describe('withAppLimits', () => {
	it('puts the limits of lim and its kin under the name, as the app does', () => {
		expect(withAppLimits('\\lim_{x \\to 0} f')).toBe('\\lim\\limits_{x \\to 0} f');
		expect(withAppLimits('\\max_{i} a_i')).toBe('\\max\\limits_{i} a_i');
	});
	it('leaves sums, a written choice and a bare name alone', () => {
		for (const latex of [
			'\\sum_{i}^{n} i',
			'\\lim\\nolimits_{x}',
			'\\lim\\limits_{x}',
			'\\lim x',
			'\\limsup_x'
		])
			expect(withAppLimits(latex)).toBe(latex);
	});
});
