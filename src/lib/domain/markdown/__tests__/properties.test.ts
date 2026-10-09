/**
 * Properties of the Markdown conversion over generated documents, not hand-picked
 * cases: whatever a teacher can build in the visual editor is written as Markdown that
 * reads back as the same document, and a written text does not change when it is read
 * and written again. A failing run prints the smallest document that breaks it.
 *
 * The generator builds what the editor produces — words, formatting that starts and
 * ends on a word, formulas, links, images, line breaks, headings, lists, quotes — and
 * plain text full of the characters Markdown treats as syntax, so escaping is tested
 * where it matters. It leaves out the shapes Markdown cannot hold and the editor
 * normalises on purpose (a formatted run starting with a space, two spaces at a line's
 * edge), which `serialize.ts` documents.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	ALWAYS_MARKDOWN,
	INLINE,
	SNIFFED,
	looksLikeHtml,
	looksLikeMarkdown,
	parseMarkdown,
	sameDoc,
	serializeMarkdown,
	toOneLine,
	type DocNode,
	type Mark,
	type MarkdownDialect
} from '../index';
import { doc, paragraph, pushInline } from '../doc';

const RUNS = { numRuns: 400 };

const word = fc.stringMatching(/^[a-zA-Z0-9áčďéěíňóřšťúůýžÁČŘŠŽ]{1,8}$/);
const words = fc.array(word, { minLength: 1, maxLength: 4 }).map((list) => list.join(' '));
/** Plain text with the characters Markdown reads as syntax, never at a line's edge as space. */
const syntaxy = fc
	.array(
		fc.oneof(
			word,
			fc.constantFrom(
				' ',
				'*',
				'**',
				'_',
				'__',
				'$',
				'[',
				']',
				'(',
				')',
				'\\',
				'#',
				'##',
				'>',
				'-',
				'+',
				'.',
				'1.',
				'2)',
				'!',
				'|',
				'~',
				'~~',
				'<',
				'<b>',
				'&',
				'&amp;',
				'`',
				'=',
				':',
				'"'
			)
		),
		{ minLength: 1, maxLength: 6 }
	)
	.map((parts) => parts.join(''))
	.filter((value) => value.trim() === value && value !== '');

const href = fc.constantFrom('https://a.cz/x', 'https://b.cz/y?z=1', 'https://c.cz/');
const title = fc.constantFrom(null, 'jedna', 'dvě');
const markSet = fc
	.record({
		bold: fc.boolean(),
		italic: fc.boolean(),
		strike: fc.boolean(),
		link: fc.option(fc.record({ href, title }), { nil: undefined })
	})
	.map(({ bold, italic, strike, link }) => {
		const marks: Mark[] = [];
		if (bold) marks.push({ type: 'bold' });
		if (italic) marks.push({ type: 'italic' });
		if (strike) marks.push({ type: 'strike' });
		if (link) marks.push({ type: 'link', attrs: { href: link.href, title: link.title } });
		return marks;
	});

const latex = fc
	.stringMatching(/^[a-z0-9+=^_{}\\ ]{1,10}$/)
	.filter((value) => value.trim() === value);

const inlineNode: fc.Arbitrary<DocNode> = fc.oneof(
	{ weight: 3, arbitrary: syntaxy.map((value) => ({ type: 'text', text: value })) },
	{
		weight: 3,
		arbitrary: fc
			.tuple(words, markSet)
			.map(([value, marks]) =>
				marks.length ? { type: 'text', text: value, marks } : { type: 'text', text: value }
			)
	},
	{
		weight: 1,
		arbitrary: words.map((value) => ({ type: 'text', text: value, marks: [{ type: 'code' as const }] }))
	},
	{
		weight: 1,
		arbitrary: latex.map((value) => ({ type: 'math', attrs: { latex: value, display: false } }))
	},
	{
		weight: 1,
		arbitrary: word.map((alt) => ({
			type: 'image',
			attrs: { src: `https://example.com/${alt}.png`, alt, title: null }
		}))
	}
);

/** A line of inline content, merged the way the editor holds it, with a word at each edge. */
const line = fc
	.array(fc.tuple(inlineNode, fc.boolean()), { minLength: 1, maxLength: 6 })
	.map((nodes) => {
		const merged: DocNode[] = [];
		// Neighbouring runs are usually apart by a space; sometimes they touch, as when
		// half a word is bold or two links sit side by side.
		const delimiters = (node?: DocNode) =>
			(node?.marks ?? []).filter((m) => ['bold', 'italic', 'strike'].includes(m.type)).length;
		nodes.forEach(([node, spaced], i) => {
			// Known limit of Markdown, not of the editor: two different emphases ending on
			// the same letter, a letter straight after (`~~a**b**~~c`), cannot close.
			const doubleEnd = delimiters(nodes[i - 1]?.[0]) > 1;
			if (i > 0 && (spaced || doubleEnd)) pushInline(merged, { type: 'text', text: ' ' });
			pushInline(merged, node);
		});
		return merged;
	});

const lines = fc.array(line, { minLength: 1, maxLength: 3 }).map((list) => {
	const content: DocNode[] = [];
	list.forEach((nodes, i) => {
		if (i > 0) content.push({ type: 'hardBreak' });
		nodes.forEach((node) => pushInline(content, node));
	});
	return content;
});

const block: fc.Arbitrary<DocNode> = fc.oneof(
	{ weight: 4, arbitrary: lines.map((content) => paragraph(content)) },
	{
		weight: 1,
		arbitrary: fc
			.tuple(fc.integer({ min: 1, max: 3 }), line)
			.map(([level, content]) => ({ type: 'heading', attrs: { level }, content }))
	},
	{
		weight: 1,
		arbitrary: fc
			.tuple(fc.boolean(), fc.array(lines, { minLength: 1, maxLength: 3 }))
			.map(([ordered, items]) => ({
				type: ordered ? 'orderedList' : 'bulletList',
				...(ordered ? { attrs: { start: 1 } } : {}),
				content: items.map((content) => ({ type: 'listItem', content: [paragraph(content)] }))
			}))
	},
	{
		weight: 1,
		arbitrary: lines.map((content) => ({ type: 'blockquote', content: [paragraph(content)] }))
	}
);

const document = fc.array(block, { minLength: 1, maxLength: 4 }).map((blocks) => doc(blocks));
const oneLine = line.map((content) => doc([paragraph(content)]));

function roundTrip(input: DocNode, dialect: MarkdownDialect) {
	const markdown = serializeMarkdown(input, dialect);
	const read = parseMarkdown(markdown, dialect);
	return { markdown, read };
}

const isPlain = (root: DocNode) =>
	(root.content ?? []).every(
		(block) =>
			block.type === 'paragraph' &&
			(block.content ?? []).every(
				(n) => n.type === 'hardBreak' || (n.type === 'text' && !n.marks?.length)
			)
	);

/**
 * The app shows a sniffed text as Markdown only when it holds a Markdown character
 * (OPEN-PROBLEMS #47). A formatted text without one — a link alone, a numbered list
 * alone — is plain to the app, and to the editor once reloaded, by design.
 */
function appReadsIt(input: DocNode, markdown: string, dialect: MarkdownDialect): boolean {
	if (!dialect.sniffed) return true;
	// A plain text with `<…>` in it and no Markdown character left once escaped goes
	// to the app's HTML renderer (`_looksLikeHtml`); the editor opens it as source.
	if (isPlain(input)) return looksLikeMarkdown(markdown) || !looksLikeHtml(markdown);
	return looksLikeMarkdown(markdown);
}

describe('what the visual editor writes reads back as the same document', () => {
	it.each([
		['hint and help (always Markdown)', ALWAYS_MARKDOWN],
		['text, question, solution, feedback (sniffed)', SNIFFED]
	] as const)('%s', (_, dialect) => {
		fc.assert(
			fc.property(document, (input) => {
				const { markdown, read } = roundTrip(input, dialect);
				fc.pre(appReadsIt(input, markdown, dialect));
				expect(read.unsupported, markdown).toEqual([]);
				expect(sameDoc(read.doc, input), `${markdown}\n${JSON.stringify(read.doc)}`).toBe(true);
			}),
			RUNS
		);
	});

	it('an answer, one line', () => {
		fc.assert(
			fc.property(oneLine, (input) => {
				const { markdown, read } = roundTrip(input, INLINE);
				fc.pre(appReadsIt(input, markdown, INLINE));
				expect(read.unsupported, markdown).toEqual([]);
				expect(sameDoc(read.doc, input), `${markdown}\n${JSON.stringify(read.doc)}`).toBe(true);
			}),
			RUNS
		);
	});
});

describe('a written text is stable', () => {
	it('reading and writing it again changes nothing', () => {
		fc.assert(
			fc.property(document, fc.constantFrom(ALWAYS_MARKDOWN, SNIFFED), (input, dialect) => {
				const once = serializeMarkdown(input, dialect);
				fc.pre(appReadsIt(input, once, dialect));
				const twice = serializeMarkdown(parseMarkdown(once, dialect).doc, dialect);
				expect(twice).toBe(once);
			}),
			RUNS
		);
	});
});

describe('pasting into an answer', () => {
	it('keeps one line of content exactly as it was', () => {
		fc.assert(
			fc.property(oneLine, (input) => {
				expect(sameDoc(toOneLine(input), input)).toBe(true);
			}),
			RUNS
		);
	});

	it('joins blocks and line breaks with one space, and nothing else', () => {
		fc.assert(
			fc.property(document, (input) => {
				const flat = toOneLine(input).content![0].content ?? [];
				const words = (nodes: DocNode[]): string =>
					nodes.map((n) => n.text ?? (n.type === 'hardBreak' ? ' \u0002 ' : `\u0001`)).join('');
				// Every block's own text survives, in order, with single spaces between.
				const expected: string[] = [];
				const collect = (node: DocNode) => {
					if (node.type === 'paragraph' || node.type === 'heading') {
						expected.push(
							...words(node.content ?? [])
								.split(' ')
								.filter((w) => w && w !== '\u0002')
						);
					} else node.content?.forEach(collect);
				};
				collect(input);
				expect(words(flat).split(' ').filter(Boolean)).toEqual(expected);
				// The lines here start and end on a word, so they join with exactly one space.
				const lines: string[] = [];
				const lineTexts = (node: DocNode) => {
					if (node.type === 'paragraph' || node.type === 'heading')
						lines.push(...words(node.content ?? []).split(' \u0002 '));
					else node.content?.forEach(lineTexts);
				};
				lineTexts(input);
				expect(words(flat)).toBe(lines.join(' '));
			}),
			RUNS
		);
	});
});
