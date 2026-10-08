/**
 * Whether a text can be opened in the visual editor without changing what the pupil
 * sees once the teacher edits it. If not — legacy HTML, a `<video>`, a footnote, a
 * heading the app does not style — the field opens in the source view instead, and
 * the text is never rewritten behind the teacher's back.
 */
import type { DocNode, MarkdownDialect } from './doc';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';

export function canEditVisually(markdown: string, dialect: MarkdownDialect): boolean {
	const first = parseMarkdown(markdown, dialect);
	if (first.unsupported.length > 0) return false;
	const again = parseMarkdown(serializeMarkdown(first.doc, dialect), dialect);
	return again.unsupported.length === 0 && sameDoc(first.doc, again.doc);
}

export function sameDoc(a: DocNode, b: DocNode): boolean {
	return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

/** Attributes the Markdown does not carry (a link's title when empty) don't count. */
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
						.map((m) => (m.type === 'link' ? `link:${m.attrs?.href}` : m.type))
						.sort()
				}
			: {}),
		...(node.content?.length ? { content: node.content.map(normalise) } : {})
	};
}
