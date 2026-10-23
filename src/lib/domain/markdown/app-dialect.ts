/**
 * The app's Markdown rules, one function each, mirrored from the player so the visual
 * editor shows a text the way the pupil's app will. Each cites the Dart it copies;
 * when the app changes, these change with it.
 *
 * - `lib/widgets/markdown_latex_widget.dart` — the Markdown + LaTeX renderer.
 * - `lib/core/utils/content_format.dart` — which renderer a text gets.
 */

/**
 * The app's guess at a text's format (`lib/core/utils/content_format.dart`), copied
 * pattern for pattern. A text step, question, answer, solution or feedback that
 * matches neither is shown as plain text, exactly as written: `Teplota > 30` and
 * `out-of-the-box` stay as they are. Hint and help skip this test; they are always
 * Markdown (`hint_sheet.dart`).
 *
 * Block markers count only at the start of a line, after up to three spaces, and need
 * whitespace after them (a quote's `>` needs only a character): a heading, a bullet, a
 * number, a quote or a table row.
 */
const MD_BLOCK_MARKERS = /^[ \t]{0,3}(>[ \t]?\S|#{1,6}[ \t]|[-*+][ \t]|\d+\.[ \t]|\|)/m;

/** Inline markers anywhere: `**`, `__`, a backtick, `![`, `[x](`, `$`, and `*` before a character. */
const MD_INLINE_MARKERS = /(\*\*|__|`|!\[|\[[^\]\n]+\]\(|\$|(?<!\w)\*\S)/;

/** A real tag, name required, so `5 < 10 a 20 > 15` is not mistaken for HTML. */
const HTML_TAG = /<\s*\/?\s*[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/;

/** `MD_BLOCK_MARKERS` for one line, not any line of a text. */
const LINE_BLOCK_MARKER = new RegExp(MD_BLOCK_MARKERS.source);

/** Leading backslashes, then something the app reads as a line-start marker. */
const ESCAPED_MARKER_LINE = /^(\\*)([^\\][^]*)?$/;

function marker(line: string): { slashes: string; rest: string } | undefined {
	const match = ESCAPED_MARKER_LINE.exec(line);
	if (!match) return undefined;
	const rest = match[2] ?? '';
	return LINE_BLOCK_MARKER.test(rest) ? { slashes: match[1], rest } : undefined;
}

/**
 * RULE 1, the one place the editor and the app disagree on a plain text, written once.
 *
 * The app reads a sniffed field as Markdown when a line starts with `- `, `1. `, `> `,
 * `# ` or `|` (`content_format.dart`, OPEN-PROBLEMS #55). To keep a teacher's plain
 * `- a` from becoming a list, a plain text is stored with one backslash in front of
 * such a line: `\- a`. The app, which finds no marker then, prints the backslash;
 * the editor undoes it, so the teacher always sees what they typed.
 *
 * It is one backslash more in front of a line that is, after any backslashes, a marker
 * (`\- a` is stored `\\- a`), and one fewer when read. Every other line is untouched,
 * so `\x` and `a\- b` stay as typed, and `unescapePlainLines(escapePlainLines(x)) === x`
 * for every text.
 */
export function escapePlainLines(text: string): string {
	return text
		.split('\n')
		.map((line) => {
			const found = marker(line);
			return found ? `\\${found.slashes}${found.rest}` : line;
		})
		.join('\n');
}

/** The reverse of `escapePlainLines`: what a plain text stored by the editor looked like when typed. */
export function unescapePlainLines(text: string): string {
	return text
		.split('\n')
		.map((line) => {
			const found = marker(line);
			return found && found.slashes !== '' ? found.slashes.slice(1) + found.rest : line;
		})
		.join('\n');
}

/** Whether the app renders a text as Markdown at all (`looksLikeMarkdown`). */
export function looksLikeMarkdown(text: string): boolean {
	return MD_BLOCK_MARKERS.test(text) || MD_INLINE_MARKERS.test(text);
}

/** Text the app hands to its HTML renderer when it is not Markdown (`looksLikeHtml`). */
export function looksLikeHtml(text: string): boolean {
	return HTML_TAG.test(text);
}

/**
 * `$\begin{aligned}…\end{aligned}$` is display math, written with single dollars
 * (`_promoteBlockEnvironments`).
 */
export function promoteBlockEnvironments(text: string): string {
	return text.replace(
		/(?<!\$)\$(?!\$)(\s*\\begin\{[\s\S]*?\\end\{[^}]+\}\s*)\$(?!\$)/g,
		(_, tex: string) => `$$${tex}$$`
	);
}

/**
 * A line that is only `$$…$$` is a paragraph of its own (`_isolateBlockMath`), so two
 * formulas on consecutive lines stack instead of flowing on one line.
 */
export function isolateBlockMath(text: string): string {
	const lines = text.split('\n');
	const blockMath = /^[ \t]*\$\$.*?\$\$[ \t]*$/;
	const result: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (blockMath.test(line)) {
			if (result.length > 0 && result[result.length - 1].trim() !== '') result.push('');
			result.push(line);
			if (i + 1 < lines.length && lines[i + 1].trim() !== '') result.push('');
		} else {
			result.push(line);
		}
	}
	return result.join('\n');
}

/**
 * Display math, `$$…$$`, tried before inline math (`_DisplayLatexSyntax`). Anchored:
 * the app matches at the parser's position.
 */
export const DISPLAY_MATH = /^\$\$([^$]+?)\$\$/;

/** Inline math, `$…$`, on one line (`_InlineLatexSyntax`). */
export const INLINE_MATH = /^\$([^$\n]+?)\$/;

/**
 * Every line break the author typed is a line break on screen: the app appends two
 * spaces to each non-empty line (`_addHardLineBreaks`), except table rows and lines
 * that start with `#`. A paragraph line starting with `#` therefore runs on into the
 * next one — the one place a single newline is not a break.
 */
export function lineRunsOn(line: string): boolean {
	return line.trimStart().startsWith('#');
}
