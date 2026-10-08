/**
 * Markdown → the visual editor's document, read the way the app reads it.
 *
 * marked's lexer does the CommonMark/GFM work; the app's own rules (math, every
 * newline a line break, plain text when nothing looks like Markdown) come from
 * `app-dialect.ts`. Anything the editor cannot hold exactly is reported, not
 * dropped: `unsupported` lists it, and `canEditVisually` sends such a text to the
 * source view instead.
 */
import { Marked, type MarkedExtension, type Token, type Tokens } from 'marked';
import {
	DISPLAY_MATH,
	INLINE_MATH,
	isolateBlockMath,
	looksLikeHtml,
	looksLikeMarkdown,
	promoteBlockEnvironments
} from './app-dialect';
import {
	doc,
	hardBreak,
	paragraph,
	pushInline,
	text,
	type DocNode,
	type Mark,
	type MarkdownDialect
} from './doc';

export interface Parsed {
	doc: DocNode;
	/** What the editor cannot represent exactly; empty when the text is safe to edit. */
	unsupported: string[];
}

interface MathToken {
	type: 'math';
	raw: string;
	latex: string;
	display: boolean;
}

const math: MarkedExtension = {
	extensions: [
		{
			name: 'math',
			level: 'inline',
			start: (src: string) => {
				const at = src.indexOf('$');
				return at < 0 ? undefined : at;
			},
			tokenizer(src: string): MathToken | undefined {
				const display = DISPLAY_MATH.exec(src);
				if (display) return { type: 'math', raw: display[0], latex: display[1], display: true };
				const inline = INLINE_MATH.exec(src);
				if (inline) return { type: 'math', raw: inline[0], latex: inline[1], display: false };
				return undefined;
			}
		}
	]
};

const marked = new Marked({ gfm: true, breaks: true }, math);

const ENTITY = /&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;
const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;

export function parseMarkdown(markdown: string, dialect: MarkdownDialect): Parsed {
	const unsupported: string[] = [];
	if (markdown.trim() === '') return { doc: doc([paragraph()]), unsupported };

	if (dialect.sniffed && !looksLikeMarkdown(markdown)) {
		if (looksLikeHtml(markdown)) unsupported.push('html');
		const parsed = { doc: parsePlain(markdown), unsupported };
		return dialect.inline ? inlineOnly(parsed) : parsed;
	}

	// A paragraph line starting with `#` runs on into the next (`lineRunsOn`); marked
	// would break there. Rare enough to leave to the source view.
	const lines = markdown.split('\n');
	lines.forEach((line, i) => {
		if (
			/^\s*#/.test(line) &&
			!ATX_HEADING.test(line) &&
			i + 1 < lines.length &&
			lines[i + 1].trim() !== ''
		)
			unsupported.push('hash-line');
	});

	const tokens = marked.lexer(isolateBlockMath(promoteBlockEnvironments(markdown)));
	const content = blocks(tokens, unsupported);
	const parsed = { doc: doc(content.length ? content : [paragraph()]), unsupported };
	return dialect.inline ? inlineOnly(parsed) : parsed;
}

/**
 * A text the app shows as plain text: what is written is what is seen. A blank line
 * separates paragraphs; every other newline is a line break.
 */
function parsePlain(source: string): DocNode {
	const paragraphs = source
		.split(/\n[ \t]*\n\s*/)
		.map((chunk) => chunk.replace(/^\n+|\n+$/g, ''))
		.filter((chunk) => chunk !== '');
	return doc(
		paragraphs.map((chunk) => {
			const content: DocNode[] = [];
			chunk.split('\n').forEach((line, i) => {
				if (i > 0) content.push(hardBreak());
				pushInline(content, text(line));
			});
			return paragraph(content);
		})
	);
}

/** An answer is one paragraph of inline text. */
function inlineOnly(parsed: Parsed): Parsed {
	const content = parsed.doc.content ?? [];
	const only = content[0];
	if (content.length > 1 || (only && only.type !== 'paragraph')) parsed.unsupported.push('blocks');
	if (only?.content?.some((n) => n.type === 'hardBreak')) parsed.unsupported.push('line-break');
	if (only?.content?.some((n) => n.type === 'math' && n.attrs?.display))
		parsed.unsupported.push('display-math');
	return parsed;
}

function blocks(tokens: Token[], unsupported: string[]): DocNode[] {
	const out: DocNode[] = [];
	for (const token of tokens) {
		const node = block(token, unsupported);
		if (node) out.push(node);
	}
	return out;
}

function block(token: Token, unsupported: string[]): DocNode | null {
	switch (token.type) {
		case 'space':
			return null;
		case 'paragraph':
		case 'text': {
			const t = token as Tokens.Paragraph | Tokens.Text;
			return paragraph(
				inline(t.tokens ?? [{ type: 'text', raw: t.text, text: t.text }], [], unsupported)
			);
		}
		case 'heading': {
			const t = token as Tokens.Heading;
			if (t.depth > 3) unsupported.push('heading-depth');
			return {
				type: 'heading',
				attrs: { level: t.depth },
				content: inline(t.tokens, [], unsupported)
			};
		}
		case 'list': {
			const t = token as Tokens.List;
			const items = t.items.map((item) => {
				if (item.task) unsupported.push('task-list');
				const first = item.tokens.find((c) => c.type !== 'space');
				if (first && first.type !== 'text' && first.type !== 'paragraph')
					unsupported.push('list-item-start');
				const content = blocks(item.tokens, unsupported);
				return { type: 'listItem', content: content.length ? content : [paragraph()] };
			});
			return t.ordered
				? {
						type: 'orderedList',
						attrs: { start: typeof t.start === 'number' ? t.start : 1 },
						content: items
					}
				: { type: 'bulletList', content: items };
		}
		case 'blockquote': {
			const content = blocks((token as Tokens.Blockquote).tokens, unsupported);
			return { type: 'blockquote', content: content.length ? content : [paragraph()] };
		}
		case 'code': {
			const t = token as Tokens.Code;
			return {
				type: 'codeBlock',
				attrs: { language: t.lang || null },
				...(t.text ? { content: [text(t.text)] } : {})
			};
		}
		case 'hr':
			return { type: 'horizontalRule' };
		case 'table': {
			const t = token as Tokens.Table;
			if (t.align.some((a) => a !== null)) unsupported.push('table-align');
			const row = (cells: Tokens.TableCell[], header: boolean): DocNode => ({
				type: 'tableRow',
				content: cells.map((cell) => ({
					type: header ? 'tableHeader' : 'tableCell',
					content: [paragraph(inline(cell.tokens, [], unsupported))]
				}))
			});
			return { type: 'table', content: [row(t.header, true), ...t.rows.map((r) => row(r, false))] };
		}
		default:
			// html, def (link reference definitions), and anything a future marked adds.
			unsupported.push(token.type);
			return null;
	}
}

function inline(tokens: Token[], marks: Mark[], unsupported: string[]): DocNode[] {
	const out: DocNode[] = [];
	const walk = (list: Token[], active: Mark[]) => {
		for (const token of list) {
			switch (token.type) {
				case 'text': {
					const t = token as Tokens.Text;
					if (t.tokens?.length) {
						walk(t.tokens, active);
						break;
					}
					if (ENTITY.test(t.text)) unsupported.push('entity');
					// A newline marked kept as text is a soft break; with `breaks` on there
					// should be none outside the cases `parseMarkdown` already reported.
					t.text.split('\n').forEach((part, i) => {
						if (i > 0) out.push(hardBreak());
						pushInline(out, text(part, active));
					});
					break;
				}
				case 'escape':
					pushInline(out, text((token as Tokens.Escape).text, active));
					break;
				case 'br':
					out.push(hardBreak());
					break;
				case 'strong':
					walk((token as Tokens.Strong).tokens, [...active, { type: 'bold' }]);
					break;
				case 'em':
					walk((token as Tokens.Em).tokens, [...active, { type: 'italic' }]);
					break;
				case 'del':
					walk((token as Tokens.Del).tokens, [...active, { type: 'strike' }]);
					break;
				case 'codespan':
					pushInline(out, text((token as Tokens.Codespan).text, [...active, { type: 'code' }]));
					break;
				case 'link': {
					const t = token as Tokens.Link;
					walk(t.tokens, [
						...active,
						{ type: 'link', attrs: { href: t.href, title: t.title ?? null } }
					]);
					break;
				}
				case 'image': {
					const t = token as Tokens.Image;
					out.push(
						withMarks(
							{ type: 'image', attrs: { src: t.href, alt: t.text, title: t.title ?? null } },
							active
						)
					);
					break;
				}
				case 'math': {
					const t = token as unknown as MathToken;
					out.push(
						withMarks({ type: 'math', attrs: { latex: t.latex, display: t.display } }, active)
					);
					break;
				}
				default:
					unsupported.push(token.type);
			}
		}
	};
	walk(tokens, marks);
	return trimLineEnds(out);
}

/** Spaces at the end of a line are not shown, and Markdown does not keep them. */
function trimLineEnds(content: DocNode[]): DocNode[] {
	const out: DocNode[] = [];
	content.forEach((node, i) => {
		const next = content[i + 1];
		if (node.type === 'text' && (!next || next.type === 'hardBreak')) {
			const trimmed = node.text!.replace(/[ \t]+$/, '');
			if (trimmed) out.push({ ...node, text: trimmed });
			return;
		}
		out.push(node);
	});
	return out;
}

function withMarks(node: DocNode, marks: Mark[]): DocNode {
	return marks.length ? { ...node, marks } : node;
}
