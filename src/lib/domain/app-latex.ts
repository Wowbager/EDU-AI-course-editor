/**
 * What the visual formula editor (MathLive) writes, made into LaTeX the app draws.
 * The app renders formulas with flutter_math_fork 0.7.4; MathLive, given
 * `latex-expanded`, writes only commands it knows, except these:
 *
 * - `\placeholder{}`, an empty box still to fill: MathLive's own. Dropped, so
 *   `\frac{1}{\placeholder{}}` is the empty fraction `\frac{1}{}`.
 * - `\Colon`, `\biconditional`, `\roundimplies` from its keyboard's logic keys: not in
 *   flutter_math_fork, written as the nearest symbol it has.
 * - `\colon`: not in flutter_math_fork; Czech division is a plain `:` (a ratio), which
 *   the app draws as the relation sign.
 * - `\ne`: the app turns `\n` in a text step into a line break (OPEN-PROBLEMS #50), so
 *   the ≠ the keyboard writes is stored as `\not=`, which survives it.
 *
 * It also canonicalises what MathLive's insert path writes differently from the brief's
 * canonical forms: `\operatorname{\mathrm{tg}}` → `\operatorname{tg}`, and unit groups
 * `\mathrm{m}\cdot\mathrm{s}^{-1}` → one `\mathrm{m\cdot s^{-1}}` (§6).
 *
 * Applied only to what MathLive writes. LaTeX a teacher types stays as typed.
 */

/** The commands rewritten, by name. */
const COMMANDS = new Map([
	['Colon', '::'],
	['biconditional', '\\leftrightarrow'],
	['roundimplies', '\\Rightarrow'],
	['colon', ':'],
	['ne', '\\not='],
	['neq', '\\not=']
]);

/**
 * Read as tokens, so a `\\` row break is never the start of a command and a command is
 * matched whole (`\nearrow` is not `\ne`).
 */
const TOKEN = /\\(?:\\|placeholder(?:\[[^\]]*\])?\{\}|[a-zA-Z]+)/g;

export function toAppLatex(latex: string): string {
	const out = latex.replace(TOKEN, (token) => {
		if (token === '\\\\') return token;
		if (token.startsWith('\\placeholder') && token.endsWith('{}')) return '';
		return COMMANDS.get(token.slice(1)) ?? token;
	});
	// Canonical forms (§6): MathLive's insert path writes `\operatorname{\mathrm{tg}}`
	// for an operator name, and unit keys land as `\mathrm{m}\cdot\mathrm{s}^{-1}`; the
	// canonical forms are `\operatorname{tg}` and one `\mathrm{m\cdot s^{-1}}` group.
	let canonical = out.replace(/\\operatorname\{\\mathrm\{([^{}]*)\}\}/g, '\\operatorname{$1}');
	// Merge unit groups joined by `\cdot`, then fold a trailing `^{…}` into the group;
	// repeat so `m·s·kg` becomes one group too.
	for (let i = 0; i < 5; i++) {
		const merged = canonical
			.replace(/\\mathrm\{([^{}]*)\}\\cdot\\mathrm\{([^{}]*)\}/g, '\\mathrm{$1\\cdot $2}')
			.replace(/\\mathrm\{([^{}]*)\}(\^\{[^{}]*\})/g, '\\mathrm{$1$2}');
		if (merged === canonical) break;
		canonical = merged;
	}
	return canonical;
}
