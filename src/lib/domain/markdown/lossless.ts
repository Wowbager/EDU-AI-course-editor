/**
 * Whether a text can be opened in the visual editor without changing what the pupil
 * sees once the teacher edits it. If not — legacy HTML, a `<video>`, a footnote, a
 * heading the app does not style — the field opens in the source view instead, and
 * the text is never rewritten behind the teacher's back.
 */
import { sameDoc, type MarkdownDialect } from './doc';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';

export function canEditVisually(markdown: string, dialect: MarkdownDialect): boolean {
	const first = parseMarkdown(markdown, dialect);
	if (first.unsupported.length > 0) return false;
	const again = parseMarkdown(serializeMarkdown(first.doc, dialect), dialect);
	return again.unsupported.length === 0 && sameDoc(first.doc, again.doc);
}

export { sameDoc };
