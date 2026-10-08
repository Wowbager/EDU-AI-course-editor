import { describe, expect, it } from 'vitest';
import {
	ALWAYS_MARKDOWN,
	INLINE,
	SNIFFED,
	canEditVisually,
	looksLikeMarkdown,
	parseMarkdown,
	serializeMarkdown,
	type DocNode
} from '../index';
import { doc, hardBreak, paragraph, text } from '../doc';

const roundTrip = (md: string, dialect = SNIFFED) =>
	serializeMarkdown(parseMarkdown(md, dialect).doc, dialect);
const parse = (md: string, dialect = SNIFFED) => parseMarkdown(md, dialect).doc;
const p = (...content: DocNode[]) => doc([paragraph(content)]);

describe('reading Markdown the way the app does', () => {
	it('makes every single newline a line break (_addHardLineBreaks)', () => {
		expect(parse('**a**\nb')).toEqual(p(text('a', [{ type: 'bold' }]), hardBreak(), text('b')));
	});

	it('shows a text without a Markdown character as written (_looksLikeMarkdown)', () => {
		expect(parse('- a\n1. b')).toEqual(p(text('- a'), hardBreak(), text('1. b')));
	});

	it('always reads hint and help as Markdown', () => {
		expect(parse('- a', ALWAYS_MARKDOWN).content?.[0].type).toBe('bulletList');
	});

	it('keeps math whole, underscores and stars included', () => {
		expect(parse('Je $x_1*y_2$ dost?')).toEqual(
			p(text('Je '), { type: 'math', attrs: { latex: 'x_1*y_2', display: false } }, text(' dost?'))
		);
	});

	it('reads $$…$$ before $…$, across lines', () => {
		const math = parse('$$\\frac{a}{b}\n= c$$').content?.[0].content?.[0];
		expect(math).toEqual({ type: 'math', attrs: { latex: '\\frac{a}{b}\n= c', display: true } });
	});

	it('promotes a $\\begin…\\end$ environment to display math', () => {
		const math = parse('$\\begin{aligned}x&=1\\end{aligned}$').content?.[0].content?.[0];
		expect(math?.attrs?.display).toBe(true);
	});

	it('gives a line that is only $$…$$ its own paragraph (_isolateBlockMath)', () => {
		expect(parse('a *b*\n$$x$$\nc').content?.map((n) => n.type)).toEqual([
			'paragraph',
			'paragraph',
			'paragraph'
		]);
	});

	it('reads an escaped dollar as a dollar, not as math', () => {
		expect(parse('Stojí \\$5 a *víc*').content?.[0].content?.[0]).toEqual(text('Stojí $5 a '));
	});
});

describe('writing Markdown the app shows the same way', () => {
	const cases: [string, string][] = [
		['bold and italic', '**tučně** a *kurzíva*'],
		['line breaks are bare newlines', '**a**\nb\nc'],
		['bullets use * so the app renders them', '* jedna\n* dvě\n  * vnořená'],
		['numbered list', '1. a *x*\n2. b'],
		['heading', '## Nadpis *s* důrazem'],
		['quote', '> citace *x*\n> další řádek'],
		['inline math', 'Spočítej $\\frac{1}{2} + \\frac{1}{3}$.'],
		['display math', 'Vzorec *zní*:\n\n$$a^2 + b^2 = c^2$$'],
		['table', '| a | *b* |\n| --- | --- |\n| 1 | $x$ |'],
		['image', '![Kruh](https://example.com/kruh.png)'],
		['code', 'Napiš `x * y` *teď*'],
		['strike', '~~špatně~~ *dobře*'],
		['intraword underscore', 'proměnná a_b je *x*'],
		['escaped star', 'a \\* b je *x*']
	];
	it.each(cases)('%s survives a round trip unchanged', (_, md) => {
		expect(roundTrip(md)).toBe(md);
	});

	it('writes a plain text exactly as typed, with no escapes', () => {
		const typed = p(text('Úkol #1: a_b, [poznámka] ~ 3 < 5'));
		expect(serializeMarkdown(typed, SNIFFED)).toBe('Úkol #1: a_b, [poznámka] ~ 3 < 5');
	});

	it('escapes a typed star once the text is Markdown', () => {
		expect(serializeMarkdown(p(text('a * b')), SNIFFED)).toBe('a \\* b');
		expect(looksLikeMarkdown('a \\* b')).toBe(true);
	});

	it('escapes what would start a block at the start of a line', () => {
		const typed = p(text('**x'), hardBreak(), text('# ne'), hardBreak(), text('1. ne'));
		const md = serializeMarkdown(typed, ALWAYS_MARKDOWN);
		expect(md).toBe('\\*\\*x\n\\# ne\n1\\. ne');
		expect(parse(md, ALWAYS_MARKDOWN)).toEqual(
			p(text('**x'), hardBreak(), text('# ne'), hardBreak(), text('1. ne'))
		);
	});

	it('moves spaces out of formatting', () => {
		expect(
			serializeMarkdown(p(text('a'), text(' tučně ', [{ type: 'bold' }]), text('b')), SNIFFED)
		).toBe('a **tučně** b');
	});

	it('escapes a literal dollar so it is not read as math', () => {
		const md = serializeMarkdown(p(text('Stojí $5 a $7')), SNIFFED);
		expect(parse(md)).toEqual(p(text('Stojí $5 a $7')));
	});

	it('never writes an empty paragraph', () => {
		expect(
			serializeMarkdown(doc([paragraph(), paragraph([text('*a*')]), paragraph()]), SNIFFED)
		).toBe('\\*a\\*');
	});
});

describe('canEditVisually', () => {
	it.each([
		['legacy HTML', "<div style='x'><p>a</p></div>", SNIFFED],
		['HTML inside Markdown', '**a** <b>b</b>', SNIFFED],
		['a video', '$x$ <video src="https://a.cz/v.mp4"></video>', SNIFFED],
		['h4', '#### malý', ALWAYS_MARKDOWN],
		['an entity', '**a** &nbsp; b', SNIFFED],
		['a task list', '* [ ] úkol', SNIFFED],
		['an aligned table', '| a |\n|:-:|\n| *b* |', SNIFFED],
		['two paragraphs in an answer', '*a*\n\nb', INLINE]
	] as const)('sends %s to the source view', (_, md, dialect) => {
		expect(canEditVisually(md, dialect)).toBe(false);
	});

	it.each(['', 'Prostý text', '**a**\nb', '$x$ je *y*', '* a\n* b'])('opens %j visually', (md) => {
		expect(canEditVisually(md, SNIFFED)).toBe(true);
	});
});
