/**
 * The visual editor's document → Markdown the app shows the same way.
 *
 * - Every line break is a bare newline: the app turns each one into a break itself
 *   (`_addHardLineBreaks`), so no trailing spaces or backslashes.
 * - Bullets are `*` and the toolbar's heading is `##`: both are characters the app
 *   looks for before it renders Markdown at all (`looksLikeMarkdown`), so a list or a
 *   heading is shown as one even in a text with nothing else formatted.
 * - A text with no formatting, whose words hold none of those characters, is written
 *   exactly as typed. The app shows it as plain text, where a backslash escape would be
 *   printed rather than read.
 * - Escapes only where the character would otherwise be read as syntax.
 */
import { looksLikeHtml, looksLikeMarkdown } from './app-dialect';
import { sameDoc, sameMark, type DocNode, type Mark, type MarkdownDialect } from './doc';
import { parseMarkdown } from './parse';

export function serializeMarkdown(root: DocNode, dialect: MarkdownDialect): string {
	const content = root.content ?? [];
	const markdown = blocks(content, { table: false }).trim();
	if (!dialect.sniffed || !isPlain(content)) return markdown;
	const plain = content
		.map((p) => (p.content ?? []).map((n) => (n.type === 'hardBreak' ? '\n' : n.text)).join(''))
		.filter((p) => p.trim() !== '')
		.join('\n\n');
	if (!looksLikeMarkdown(plain) && !looksLikeHtml(plain)) return plain;
	// Escaping can take away the very character that makes the app read Markdown
	// (`__` becomes `\_\_`), and the app would then print the backslashes. Of the two
	// ways to write a plain text, keep the one that reads back as what was typed.
	// One run of underscores left as typed keeps `__` — a blank to fill in, "Doplň: ____"
	// — where the app looks for it. Alone, with every other `_` escaped, it has nothing
	// to pair with, so it can never be emphasis.
	const oneRunAsTyped = markdown.replace(/(?<!\\)((?:\\_){2,})/, (run) => run.replace(/\\_/g, '_'));
	for (const candidate of [markdown, oneRunAsTyped, plain]) {
		const read = parseMarkdown(candidate, dialect);
		if (read.unsupported.length === 0 && sameDoc(read.doc, root)) return candidate;
	}
	return markdown;
}

/** Paragraphs of unformatted text and line breaks: what the app could show as plain text. */
function isPlain(content: DocNode[]): boolean {
	return content.every(
		(block) =>
			block.type === 'paragraph' &&
			(block.content ?? []).every(
				(n) => n.type === 'hardBreak' || (n.type === 'text' && !n.marks?.length)
			)
	);
}

interface Context {
	table: boolean;
	/** This list follows one of its own kind, so it takes the other marker. */
	alternate?: boolean;
}

/** A list's own items start afresh: the alternation is about siblings only. */
const inner = (ctx: Context): Context => ({ ...ctx, alternate: false });

function blocks(content: DocNode[], ctx: Context): string {
	let alternate = false;
	return content
		.map((node, i) => {
			// Two lists of a kind one after another are one list in Markdown, whatever
			// separates them; a different marker keeps the second its own.
			const previous = content[i - 1];
			alternate = previous?.type === node.type && LISTS.includes(node.type) ? !alternate : false;
			return block(node, { ...ctx, alternate });
		})
		.filter((out) => out.trim() !== '')
		.join('\n\n');
}

const LISTS = ['bulletList', 'orderedList'];

function block(node: DocNode, ctx: Context): string {
	const content = node.content ?? [];
	switch (node.type) {
		case 'paragraph':
			return inline(content, ctx);
		case 'heading': {
			const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 1), 6);
			// A heading is one line; the app does not break it.
			const body = inline(content, ctx)
				.replace(/\n/g, ' ')
				// `# Úkol #` would lose its last `#` as a closing sequence.
				.replace(/(\s)(#+)(\s*)$/, '$1\\$2$3');
			return body.trim() === '' ? '' : `${'#'.repeat(level)} ${body}`;
		}
		case 'bulletList': {
			const marker = ctx.alternate ? '- ' : '* ';
			return content.map((item) => listItem(item, marker, inner(ctx))).join('\n');
		}
		case 'orderedList': {
			const start = Number(node.attrs?.start ?? 1) || 1;
			const delimiter = ctx.alternate ? ')' : '.';
			return content
				.map((item, i) => listItem(item, `${start + i}${delimiter} `, inner(ctx)))
				.join('\n');
		}
		case 'blockquote':
			return blocks(content, ctx)
				.split('\n')
				.map((line) => (line === '' ? '>' : `> ${line}`))
				.join('\n');
		case 'codeBlock': {
			const code = content.map((n) => n.text ?? '').join('');
			const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
			const fence = '`'.repeat(Math.max(3, longest + 1));
			const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
			return `${fence}${language}\n${code}\n${fence}`;
		}
		case 'horizontalRule':
			return '***';
		case 'table':
			return table(content);
		default:
			// An unknown block: keep its text rather than lose it.
			return content.length ? blocks(content, ctx) : '';
	}
}

function listItem(item: DocNode, marker: string, ctx: Context): string {
	const indent = ' '.repeat(marker.length);
	const children = item.content ?? [];
	const parts: string[] = [];
	children.forEach((child, i) => {
		const out = block(child, ctx);
		if (i === 0) {
			parts.push(out);
			return;
		}
		// A nested list follows its paragraph directly; a second paragraph needs a
		// blank line, as it would in any Markdown.
		const isList = child.type === 'bulletList' || child.type === 'orderedList';
		parts.push(isList ? '\n' : '\n\n', out);
	});
	const body = parts.join('');
	return (
		marker.trimEnd() +
		(body === '' ? '' : ' ') +
		body
			.split('\n')
			.map((line, i) => (i === 0 || line === '' ? line : indent + line))
			.join('\n')
	);
}

function table(rows: DocNode[]): string {
	const cells = rows.map((row) =>
		(row.content ?? []).map((cell) =>
			blocks(cell.content ?? [], { table: true })
				.replace(/\n+/g, ' ')
				.trim()
		)
	);
	const width = Math.max(1, ...cells.map((row) => row.length));
	const line = (row: string[]) =>
		'| ' + Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ') + ' |';
	const [header = [], ...body] = cells;
	return [line(header), line(Array(width).fill('---')), ...body.map(line)].join('\n');
}

// ─── Inline ──────────────────────────────────────────────────────────────────

/** Opening order, outermost first; code is always innermost. */
const ORDER: Mark['type'][] = ['link', 'bold', 'italic', 'strike', 'code'];
const DELIMITER: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };

function inline(content: DocNode[], ctx: Context): string {
	let out = '';
	let stack: Mark[] = [];
	let atLineStart = true;

	const close = (keep: number) => {
		while (stack.length > keep) {
			const mark = stack.pop()!;
			if (mark.type === 'link')
				out += `](${destination(String(mark.attrs?.href ?? ''))}${title(mark)})`;
			else if (mark.type !== 'code') out += DELIMITER[mark.type];
		}
	};
	const transition = (target: Mark[]) => {
		let keep = 0;
		while (keep < stack.length && target.some((m) => sameMark(m, stack[keep]))) keep++;
		// A link's edge is a clean break. Emphasis closed right after `](…)` and before a
		// letter cannot close at all (`*a[b](u)*c` is not italic), so formatting is
		// closed before a link starts or ends and opened again on the other side.
		const linkOf = (marks: Mark[]) => marks.find((m) => m.type === 'link');
		const before = linkOf(stack);
		const after = linkOf(target);
		if ((before || after) && !(before && after && sameMark(before, after))) keep = 0;
		close(keep);
		const opening = target
			.filter((m) => !stack.some((s) => sameMark(s, m)))
			.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
		for (const mark of opening) {
			if (mark.type === 'link') out += '[';
			else if (mark.type !== 'code') out += DELIMITER[mark.type];
			stack.push(mark);
			atLineStart = false;
		}
	};

	for (const node of splitEdgeSpace(content)) {
		switch (node.type) {
			case 'hardBreak':
				close(0);
				out += '\n';
				atLineStart = true;
				break;
			case 'text': {
				const marks = node.marks ?? [];
				const value = node.text ?? '';
				const code = marks.some((m) => m.type === 'code');
				const link = marks.find((m) => m.type === 'link');
				// A bare address the author typed or pasted: GFM links it by itself, and
				// escaping would break it.
				if (
					link &&
					!code &&
					marks.length === 1 &&
					link.attrs?.href === value &&
					/^https?:\/\/\S+$/.test(value)
				) {
					transition([]);
					out += value;
					atLineStart = false;
					break;
				}
				transition(marks.filter((m) => m.type !== 'code'));
				if (code) {
					out += codeSpan(value);
				} else {
					out += escapeText(value, atLineStart, ctx);
				}
				atLineStart = false;
				break;
			}
			case 'math': {
				transition(node.marks ?? []);
				const latex = String(node.attrs?.latex ?? '').replace(/\$/g, '');
				out += node.attrs?.display ? `$$${latex}$$` : `$${latex.replace(/\n/g, ' ')}$`;
				atLineStart = false;
				break;
			}
			case 'image': {
				transition((node.marks ?? []).filter((m) => m.type !== 'code'));
				const alt = String(node.attrs?.alt ?? '').replace(/([[\]\\])/g, '\\$1');
				const src = destination(String(node.attrs?.src ?? ''));
				out += `![${alt}](${src}${title(node)})`;
				atLineStart = false;
				break;
			}
			default:
				if (node.text) out += escapeText(node.text, atLineStart, ctx);
		}
	}
	close(0);
	return out;
}

/**
 * `** bold**` is not bold in Markdown: emphasis may not start or end on a space. Move
 * spaces at a formatted run's edges outside the formatting, where they look the same.
 */
function splitEdgeSpace(content: DocNode[]): DocNode[] {
	const out: DocNode[] = [];
	for (const node of content) {
		const marks = node.marks ?? [];
		if (node.type !== 'text' || !marks.length || marks.some((m) => m.type === 'code')) {
			out.push(node);
			continue;
		}
		const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.text ?? '')!;
		const bare = marks.filter((m) => m.type === 'link');
		const spaced = (value: string) =>
			bare.length ? { type: 'text', text: value, marks: bare } : { type: 'text', text: value };
		if (match[1]) out.push(spaced(match[1]));
		if (match[2]) out.push({ ...node, text: match[2] });
		if (match[3]) out.push(spaced(match[3]));
	}
	return out;
}

function codeSpan(value: string): string {
	const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
	const fence = '`'.repeat(longest + 1);
	const pad = value.startsWith('`') || value.endsWith('`') || /^ .* $/.test(value) ? ' ' : '';
	return `${fence}${pad}${value}${pad}${fence}`;
}

function destination(url: string): string {
	return url
		.replace(/ /g, '%20')
		.replace(/\(/g, '%28')
		.replace(/\)/g, '%29')
		.replace(/</g, '%3C')
		.replace(/>/g, '%3E');
}

function title(node: { attrs?: Record<string, unknown> }): string {
	const value = node.attrs?.title;
	return typeof value === 'string' && value !== '' ? ` "${value.replace(/"/g, '\\"')}"` : '';
}

const WORD = /[\p{L}\p{N}]/u;

/** Escape what Markdown would read as syntax, and nothing else. */
export function escapeText(value: string, atLineStart: boolean, ctx: Context): string {
	let out = '';
	for (let i = 0; i < value.length; i++) {
		const c = value[i];
		const prev = value[i - 1] ?? '';
		const next = value[i + 1] ?? '';
		switch (c) {
			case '\\':
			case '*':
			case '`':
			case '$':
			case '[':
			case ']':
			case '~':
				out += '\\' + c;
				break;
			case '_':
				// `a_b` is never emphasis; `_a_` is.
				out += WORD.test(prev) && WORD.test(next) ? c : '\\_';
				break;
			// `<` and `>` around other text read as an HTML tag, which hides the
			// formatting between them (marked masks `<…>` before it reads emphasis).
			case '<':
				out += /\s/.test(next) ? c : '\\<';
				break;
			case '>':
				out += /\s/.test(prev) ? c : '\\>';
				break;
			// A `!` just before a link would make it an image.
			case '!':
				out += next === '' ? '\\!' : c;
				break;
			case '&':
				out += /^&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i.test(value.slice(i)) ? '\\&' : c;
				break;
			case '|':
				out += ctx.table ? '\\|' : c;
				break;
			default:
				out += c;
		}
	}
	if (!atLineStart) return out;
	// Leading spaces are dropped by Markdown, and four of them make a code block.
	out = out.replace(/^[ \t]+/, '');
	return out
		.replace(/^(#|>|\||[-+=](?=\s|$)|-{2,}\s*$|={2,}\s*$)/, '\\$1')
		.replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2');
}
