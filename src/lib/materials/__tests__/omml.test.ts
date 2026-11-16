import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { equationsToPlaceholders, fillEquations, latexOf } from '../omml';
import { readMaterial, type Libraries } from '../read';

const r = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;
const e = (x: string) => `<m:e>${x}</m:e>`;
const math = (x: string) => latexOf(`<m:oMath>${x}</m:oMath>`);

describe('Word equations as LaTeX', () => {
	it('runs, with the Unicode operators and Greek letters as commands', () => {
		expect(math(r('a·b×c÷d'))).toBe('a\\cdot b\\times c\\div d');
		expect(math(r('x≤y≥z≠w'))).toBe('x\\le y\\ge z\\ne w');
		expect(math(r('−5±π'))).toBe('-5\\pm \\pi');
		expect(math(r('α+β=γ'))).toBe('\\alpha +\\beta =\\gamma');
		expect(math(r('A∪B∩C∈ℝ'))).toBe('A\\cup B\\cap C\\in \\mathbb{R}');
		expect(math(r('50%'))).toBe('50\\%');
	});

	it('a run marked as normal text is text', () => {
		expect(math('<m:r><m:rPr><m:nor/></m:rPr><m:t>kde</m:t></m:r>')).toBe('\\text{kde}');
	});

	it('fractions: stacked, linear and without a bar', () => {
		const f = (type?: string) =>
			`<m:f>${type ? `<m:fPr><m:type m:val="${type}"/></m:fPr>` : ''}<m:num>${r('a')}</m:num><m:den>${r('b+1')}</m:den></m:f>`;
		expect(math(f())).toBe('\\frac{a}{b+1}');
		expect(math(f('lin'))).toBe('a/{b+1}');
		expect(math(f('noBar'))).toBe('\\binom{a}{b+1}');
	});

	it('superscripts, subscripts, both, and before the base', () => {
		expect(math(`<m:sSup>${e(r('x'))}<m:sup>${r('2')}</m:sup></m:sSup>`)).toBe('x^{2}');
		expect(math(`<m:sSub>${e(r('a'))}<m:sub>${r('n')}</m:sub></m:sSub>`)).toBe('a_{n}');
		expect(
			math(`<m:sSubSup>${e(r('x'))}<m:sub>${r('i')}</m:sub><m:sup>${r('2')}</m:sup></m:sSubSup>`)
		).toBe('x_{i}^{2}');
		expect(
			math(`<m:sPre><m:sub>${r('1')}</m:sub><m:sup>${r('2')}</m:sup>${e(r('C'))}</m:sPre>`)
		).toBe('{}_{1}^{2}C');
		// A longer base is grouped, a bracket is its own group.
		expect(math(`<m:sSup>${e(r('ab'))}<m:sup>${r('2')}</m:sup></m:sSup>`)).toBe('{ab}^{2}');
		expect(math(`<m:sSup>${e(`<m:d>${e(r('a+b'))}</m:d>`)}<m:sup>${r('2')}</m:sup></m:sSup>`)).toBe(
			'\\left(a+b\\right)^{2}'
		);
	});

	it('radicals, with and without a degree', () => {
		expect(
			math(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(r('x'))}</m:rad>`)
		).toBe('\\sqrt{x}');
		expect(math(`<m:rad><m:deg>${r('3')}</m:deg>${e(r('8'))}</m:rad>`)).toBe('\\sqrt[3]{8}');
		expect(math(`<m:rad><m:deg/>${e(r('2'))}</m:rad>`)).toBe('\\sqrt{2}');
	});

	it('delimiters: the default, other brackets, and separators', () => {
		expect(math(`<m:d>${e(r('a'))}</m:d>`)).toBe('\\left(a\\right)');
		const d = (beg: string, end: string, body: string) =>
			`<m:d><m:dPr><m:begChr m:val="${beg}"/><m:endChr m:val="${end}"/></m:dPr>${body}</m:d>`;
		expect(math(d('[', ']', e(r('a')) + e(r('b'))))).toBe('\\left[a | b\\right]');
		expect(math(d('{', '', e(r('x'))))).toBe('\\left\\{x\\right.');
		expect(math(d('|', '|', e(r('x'))))).toBe('\\left|x\\right|');
		expect(math(d('⌊', '⌋', e(r('x'))))).toBe('\\left\\lfloor x\\right\\rfloor');
		expect(math(`<m:d><m:dPr><m:sepChr m:val=";"/></m:dPr>${e(r('1'))}${e(r('2'))}</m:d>`)).toBe(
			'\\left(1 ; 2\\right)'
		);
	});

	it('n-ary operators with limits, and without', () => {
		const nary = (chr: string, pr = '') =>
			`<m:nary><m:naryPr><m:chr m:val="${chr}"/>${pr}</m:naryPr><m:sub>${r('i=1')}</m:sub><m:sup>${r('n')}</m:sup>${e(r('i'))}</m:nary>`;
		expect(math(nary('∑'))).toBe('\\sum_{i=1}^{n} i');
		expect(math(nary('∏'))).toBe('\\prod_{i=1}^{n} i');
		expect(math(nary('∫'))).toBe('\\int_{i=1}^{n} i');
		expect(math(nary('∑', '<m:supHide m:val="1"/>'))).toBe('\\sum_{i=1} i');
		expect(math(nary('∫', '<m:subHide m:val="1"/><m:supHide m:val="1"/>'))).toBe('\\int i');
	});

	it('accents and bars', () => {
		const acc = (chr: string) =>
			`<m:acc><m:accPr><m:chr m:val="${chr}"/></m:accPr>${e(r('v'))}</m:acc>`;
		expect(math(acc('⃗'))).toBe('\\vec{v}');
		expect(math(acc('̂'))).toBe('\\hat{v}');
		expect(math(acc('̄'))).toBe('\\bar{v}');
		expect(math(`<m:bar>${e(r('AB'))}</m:bar>`)).toBe('\\overline{AB}');
		expect(math(`<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>${e(r('AB'))}</m:bar>`)).toBe(
			'\\underline{AB}'
		);
	});

	it('functions and limits', () => {
		expect(math(`<m:func><m:fName>${r('sin')}</m:fName>${e(r('x'))}</m:func>`)).toBe('\\sin x');
		expect(math(`<m:func><m:fName>${r('tg')}</m:fName>${e(r('x'))}</m:func>`)).toBe(
			'\\operatorname{tg} x'
		);
		expect(
			math(
				`<m:func><m:fName><m:limLow>${e(r('lim'))}<m:lim>${r('x→0')}</m:lim></m:limLow></m:fName>${e(r('f'))}</m:func>`
			)
		).toBe('\\lim_{x\\to 0} f');
		expect(math(`<m:limUpp>${e(r('x'))}<m:lim>${r('→')}</m:lim></m:limUpp>`)).toBe(
			'\\overset{\\to}{x}'
		);
	});

	it('matrices and equation arrays', () => {
		expect(
			math(`<m:m><m:mr>${e(r('1'))}${e(r('2'))}</m:mr><m:mr>${e(r('3'))}${e(r('4'))}</m:mr></m:m>`)
		).toBe('\\begin{matrix} 1 & 2 \\\\ 3 & 4 \\end{matrix}');
		expect(math(`<m:eqArr>${e(r('x&=1'))}${e(r('y&=2'))}</m:eqArr>`)).toBe(
			'\\begin{aligned} x&=1 \\\\ y&=2 \\end{aligned}'
		);
	});

	it('what it does not know keeps its text, and properties add nothing', () => {
		expect(math(`<m:fooBar>${r('a')}</m:fooBar>`)).toBe('a');
		expect(math(`<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>a</m:t></m:r>`)).toBe('a');
	});

	it('constructs inside one another', () => {
		const inner = `<m:f><m:num>${r('1')}</m:num><m:den><m:rad><m:deg/>${e(r('x'))}</m:rad></m:den></m:f>`;
		expect(math(`<m:sSup>${e(r('e'))}<m:sup>${inner}</m:sup></m:sSup>`)).toBe(
			'e^{\\frac{1}{\\sqrt{x}}}'
		);
	});
});

describe('equations in a document', () => {
	const xml =
		'<w:p><w:r><w:t>a </w:t></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>' +
		'<w:p><m:oMathPara><m:oMath><m:r><m:t>y=1</m:t></m:r></m:oMath></m:oMathPara></w:p>';

	it('swaps each for a word in order and puts the LaTeX back, inline or as a display', () => {
		const swapped = equationsToPlaceholders(xml);
		expect(swapped.xml).not.toContain('m:oMath');
		expect(swapped.equations).toEqual([
			{ latex: 'y=1', display: true },
			{ latex: 'x', display: false }
		]);
		// The words go where the equations stood, whatever order they were numbered in.
		expect(fillEquations('a OMMLEQ1END\n\nOMMLEQ0END', swapped.equations)).toBe(
			'a $x$\n\n\n\n$$y=1$$\n\n'
		);
	});
});

describe('a Word file with equations', () => {
	const libraries: Libraries = {
		mammoth: async () =>
			((await import('mammoth/mammoth.browser.js')) as unknown as { default: never }).default,
		jszip: async () => JSZip,
		pdfjs: async () => {
			throw new Error('not used');
		},
		utif: async () => {
			throw new Error('not used');
		},
		heic: async () => {
			throw new Error('not used');
		}
	};
	const io = {
		ocr: async () => '',
		shrink: async (b: Blob) => b,
		fromPixels: async () => new Blob(),
		renderPage: async () => new Blob()
	};

	it('keeps the equations where they stand, as LaTeX', async () => {
		const here = dirname(fileURLToPath(import.meta.url));
		const bytes = await readFile(join(here, 'fixtures', 'equations.docx'));
		const file = await readMaterial(
			Object.assign(new Blob([new Uint8Array(bytes)]), { name: 'equations.docx' }),
			io,
			{ pages: 100 },
			libraries
		);
		const text = file.sections.map((s) => s.text).join('\n\n');
		expect(text).toContain(
			'Kvadratická rovnice se řeší vzorcem:\n\n$$x=\\frac{-b\\pm \\sqrt{b^{2}-4ac}}{2a}$$'
		);
		expect(text).toContain(
			'Součet prvních čísel: $\\sum_{i=1}^{n} i=\\frac{n\\left(n+1\\right)}{2}$ pro každé n.'
		);
		expect(text).toContain('$$\\left(\\begin{matrix} 1 & 2 \\\\ 3 & 4 \\end{matrix}\\right)$$');
		expect(text).toContain('$$\\lim_{x\\to 0} \\frac{\\sin x}{x}=1$$');
		expect(text).toContain('Skalární součin $\\vec{v}\\cdot w\\le \\pi$ je číslo.');
		expect(text).not.toContain('OMMLEQ');
	});
});
