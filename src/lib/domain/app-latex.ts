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

const REPLACEMENTS: [RegExp, string][] = [
	[/(?<!\\)\\placeholder(?:\[[^\]]*\])?\{\}/g, ''],
	[/(?<!\\)\\Colon(?![a-zA-Z])/g, '::'],
	[/(?<!\\)\\biconditional(?![a-zA-Z])/g, '\\leftrightarrow'],
	[/(?<!\\)\\roundimplies(?![a-zA-Z])/g, '\\Rightarrow'],
	[/(?<!\\)\\neq?(?![a-zA-Z])/g, '\\not=']
];

export function toAppLatex(latex: string): string {
	return REPLACEMENTS.reduce((out, [find, replace]) => out.replace(find, replace), latex);
}
