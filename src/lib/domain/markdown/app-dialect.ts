/**
 * The app's Markdown rules, one function each, mirrored from the player so the visual
 * editor shows a text the way the pupil's app will. Each cites the Dart it copies;
 * when the app changes, these change with it.
 *
 * - `lib/widgets/markdown_latex_widget.dart` — the Markdown + LaTeX renderer.
 * - `lib/widgets/step_content_renderer.dart` — which renderer a text gets.
 */

/**
 * Whether the app renders a text as Markdown at all (`_looksLikeMarkdown`). A text
 * step, question, answer, solution or feedback without one of these characters is
 * shown as plain text, exactly as written: `- a` stays a dash, `1. a` stays a number.
 * Hint and help skip this test; they are always Markdown (`hint_sheet.dart`).
 */
export function looksLikeMarkdown(text: string): boolean {
	return (
		text.includes('*') ||
		text.includes('__') ||
		text.includes('##') ||
		text.includes('```') ||
		text.includes('$') ||
		text.includes('![')
	);
}

/** Text the app hands to its HTML renderer when it is not Markdown (`_looksLikeHtml`). */
export function looksLikeHtml(text: string): boolean {
	return text.includes('<') && text.includes('>');
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
