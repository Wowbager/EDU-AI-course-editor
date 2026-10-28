/**
 * What the visual formula editor (MathLive) writes, made into LaTeX the app draws.
 * The app renders formulas with flutter_math_fork 0.7.4; MathLive, given
 * `latex-expanded`, writes only commands it knows, except these:
 *
 * - `\placeholder{}`, an empty box still to fill: MathLive's own. Dropped, so
 *   `\frac{1}{\placeholder{}}` is the empty fraction `\frac{1}{}`.
 * - `\Colon`, `\biconditional`, `\roundimplies` from its keyboard's logic keys: not in
 *   flutter_math_fork, written as the nearest symbol it has.
 * - `\ne`: the app turns `\n` in a text step into a line break (OPEN-PROBLEMS #50), so
 *   the ≠ the keyboard writes is stored as `\not=`, which survives it.
 *
 * Applied only to what MathLive writes. LaTeX a teacher types stays as typed.
 */

/** The commands rewritten, by name. */
const COMMANDS: Record<string, string> = {
	Colon: '::',
	biconditional: '\\leftrightarrow',
	roundimplies: '\\Rightarrow',
	ne: '\\not=',
	neq: '\\not='
};

/**
 * Read as tokens, so a `\\` row break is never the start of a command and a command is
 * matched whole (`\nearrow` is not `\ne`).
 */
const TOKEN = /\\(?:\\|placeholder(?:\[[^\]]*\])?\{\}|[a-zA-Z]+)/g;

export function toAppLatex(latex: string): string {
	return latex.replace(TOKEN, (token) => {
		if (token === '\\\\') return token;
		if (token.startsWith('\\placeholder') && token.endsWith('{}')) return '';
		return COMMANDS[token.slice(1)] ?? token;
	});
}
