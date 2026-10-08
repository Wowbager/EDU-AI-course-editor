/**
 * The visual editor's document, as plain JSON in the shape Tiptap (ProseMirror)
 * reads and writes. The domain converts Markdown to and from it without loading the
 * editor, so the conversion runs — and is tested — anywhere.
 */

export interface Mark {
	type: 'bold' | 'italic' | 'strike' | 'code' | 'link';
	attrs?: { href?: string; title?: string | null; [key: string]: unknown };
}

export interface DocNode {
	type: string;
	attrs?: Record<string, unknown>;
	content?: DocNode[];
	text?: string;
	marks?: Mark[];
}

/** Which renderer the app gives a field. */
export interface MarkdownDialect {
	/**
	 * The app sniffs the text and shows it plainly unless it holds a Markdown
	 * character (`looksLikeMarkdown`). False for hint and help, which are always
	 * Markdown.
	 */
	sniffed: boolean;
	/** One line of inline text: an answer. No blocks, no line breaks. */
	inline?: boolean;
}

export const SNIFFED: MarkdownDialect = { sniffed: true };
export const ALWAYS_MARKDOWN: MarkdownDialect = { sniffed: false };
export const INLINE: MarkdownDialect = { sniffed: true, inline: true };

export const doc = (content: DocNode[]): DocNode => ({ type: 'doc', content });
export const paragraph = (content: DocNode[] = []): DocNode =>
	content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
export const text = (value: string, marks?: Mark[]): DocNode =>
	marks?.length ? { type: 'text', text: value, marks } : { type: 'text', text: value };
export const hardBreak = (): DocNode => ({ type: 'hardBreak' });

/** Same mark, same target: a link is the same link only with the same address and title. */
export function sameMark(a: Mark, b: Mark): boolean {
	if (a.type !== b.type) return false;
	if (a.type !== 'link') return true;
	return a.attrs?.href === b.attrs?.href && (a.attrs?.title || null) === (b.attrs?.title || null);
}

/**
 * Everything a pasted text holds, on one line, for an answer: blocks and line breaks
 * become one space each, and the inline content between them — formatted runs,
 * formulas, images — is kept exactly as it was.
 */
export function toOneLine(root: DocNode): DocNode {
	const inline: DocNode[] = [];
	let pendingSpace = false;
	const separate = () => {
		if (inline.length) pendingSpace = true;
	};
	const walk = (node: DocNode) => {
		if (node.type === 'text' || node.type === 'math' || node.type === 'image') {
			if (pendingSpace) {
				const last = inline[inline.length - 1];
				const leading = node.type === 'text' && /^\s/.test(node.text ?? '');
				const trailing = last?.type === 'text' && /\s$/.test(last.text ?? '');
				if (!leading && !trailing) pushInline(inline, text(' '));
				pendingSpace = false;
			}
			pushInline(
				inline,
				node.type === 'math' ? { ...node, attrs: { ...node.attrs, display: false } } : node
			);
		} else if (node.type === 'hardBreak') {
			separate();
		} else {
			// A block: whatever it holds is separated from what came before it.
			if (node.type !== 'doc') separate();
			node.content?.forEach(walk);
		}
	};
	walk(root);
	return doc([inline.length ? paragraph(inline) : paragraph()]);
}

export function sameMarks(a: Mark[] = [], b: Mark[] = []): boolean {
	return a.length === b.length && a.every((m) => b.some((n) => sameMark(m, n)));
}

/**
 * Append inline content, merging a text into the previous one when they carry the
 * same marks — so "a", "<", "b" from three Markdown tokens is one run of text, the
 * way the editor would hold it.
 */
export function pushInline(into: DocNode[], node: DocNode): void {
	const last = into[into.length - 1];
	if (node.type === 'text') {
		if (!node.text) return;
		if (last?.type === 'text' && sameMarks(last.marks, node.marks)) {
			into[into.length - 1] = { ...last, text: last.text! + node.text };
			return;
		}
	}
	into.push(node);
}

/** The same document, as far as the app can tell: attributes Markdown does not carry don't count. */
export function sameDoc(a: DocNode, b: DocNode): boolean {
	return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function normalise(node: DocNode): unknown {
	const attrs = node.attrs
		? Object.fromEntries(
				Object.entries(node.attrs).filter(([, v]) => v !== null && v !== undefined)
			)
		: undefined;
	return {
		type: node.type,
		...(attrs && Object.keys(attrs).length ? { attrs } : {}),
		...(node.text !== undefined ? { text: node.text } : {}),
		...(node.marks?.length
			? {
					marks: node.marks
						.map((m) =>
							m.type === 'link' ? `link:${m.attrs?.href} ${m.attrs?.title || ''}` : m.type
						)
						.sort()
				}
			: {}),
		...(node.content?.length ? { content: node.content.map(normalise) } : {})
	};
}
