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

/** Same mark, same target. */
export function sameMark(a: Mark, b: Mark): boolean {
	return a.type === b.type && (a.type !== 'link' || a.attrs?.href === b.attrs?.href);
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
