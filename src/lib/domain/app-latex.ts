/**
 * What the visual formula editor (MathLive) writes, made into LaTeX the app draws.
 * The app renders formulas with flutter_math_fork 0.7.4; MathLive, given
 * `latex-expanded`, writes only commands it knows, except these:
 *
 * - `\placeholder{}`, an empty box still to fill: MathLive's own. Written so the app
 *   draws nothing there and `withSlots` can find the box again when the formula is
 *   reopened: an argument that is only a box is left empty (`\frac{1}{}`, `\sqrt[]{x}`),
 *   any other box becomes `{ }` (`\Delta{ }`, `({ };{ })`).
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

/** A box that is a whole `{…}` argument, or the index of `\sqrt[…]`. */
const ARGUMENT_BOX =
	/\{\\placeholder(?:\[[^\]]*\])?\{\}\}|(?<=\\sqrt)\[\\placeholder(?:\[[^\]]*\])?\{\}\]/g;

export function toAppLatex(latex: string): string {
	const boxed = latex.replace(ARGUMENT_BOX, (box) => (box.startsWith('{') ? '{}' : '[]'));
	const out = boxed.replace(TOKEN, (token) => {
		if (token === '\\\\') return token;
		if (token.startsWith('\\placeholder') && token.endsWith('{}')) return '{ }';
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

/**
 * The empty boxes `toAppLatex` wrote, found again: `{ }`, an empty argument of a
 * command (`\frac{1}{}`, `\vec{}`, `x^{}`) and an empty `\sqrt[]`. A bare `{}` that is
 * no command's argument, like the base of `{}^{14}_{6}C` or `\mathrm{H}{}_2`, is LaTeX's
 * empty group, not a box. `box` is what each one becomes.
 */
export function replaceSlots(latex: string, box: string): string {
	const args = emptyArguments(latex);
	return latex.replace(SLOT, (slot, offset: number) => {
		if (slot === '{ }') return box;
		if (slot === '{}' && !isSlotAt(latex, offset, args)) return slot;
		return slot.startsWith('[') ? `[${box}]` : `{${box}}`;
	});
}

/** Commands whose arguments the keypad and MathLive fill: an empty one is a box. */
const TAKES_ARGUMENTS = new Set([
	'frac',
	'dfrac',
	'tfrac',
	'cfrac',
	'binom',
	'dbinom',
	'tbinom',
	'overset',
	'underset',
	'stackrel',
	'sqrt',
	'vec',
	'bar',
	'overline',
	'underline',
	'overrightarrow',
	'overleftarrow',
	'overleftrightarrow',
	'hat',
	'widehat',
	'tilde',
	'widetilde',
	'dot',
	'ddot',
	'boxed',
	'cancel',
	'mathrm',
	'mathit',
	'mathbf',
	'mathsf',
	'mathtt',
	'mathbb',
	'mathcal',
	'boldsymbol',
	'operatorname',
	'text',
	'ce',
	'pu',
	'xrightarrow',
	'xleftarrow'
]);

/** How many `{…}` arguments a command reads, where it is more than one. */
const ARITY: Record<string, number> = {
	frac: 2,
	dfrac: 2,
	tfrac: 2,
	cfrac: 2,
	binom: 2,
	dbinom: 2,
	tbinom: 2,
	overset: 2,
	underset: 2,
	stackrel: 2
};

/**
 * Where an empty `{}` is an argument of a command that takes arguments: every
 * argument of `\frac{a}{}`, so `\frac{a}{}^2` keeps its denominator box though
 * `\mathrm{H}{}_2`, which reads the same to a pattern, is an empty base.
 */
function emptyArguments(latex: string): Set<number> {
	const found = new Set<number>();
	const command = /\\([a-zA-Z]+)/g;
	for (let m = command.exec(latex); m; m = command.exec(latex)) {
		if (!TAKES_ARGUMENTS.has(m[1])) continue;
		let at = m.index + m[0].length;
		if (/^(?:sqrt|xrightarrow|xleftarrow)$/.test(m[1]) && latex[at] === '[')
			at = skipGroup(latex, at, '[', ']');
		for (let n = 0; n < (ARITY[m[1]] ?? 1); n += 1) {
			while (latex[at] === ' ') at += 1;
			if (latex[at] !== '{') break;
			if (latex.startsWith('{}', at)) found.add(at);
			at = skipGroup(latex, at, '{', '}');
		}
	}
	return found;
}

/** The index just past the balanced group that opens at `at`. */
function skipGroup(latex: string, at: number, open: string, close: string): number {
	let depth = 0;
	for (let i = at; i < latex.length; i += 1) {
		if (latex[i] === '\\') i += 1;
		else if (latex[i] === open) depth += 1;
		else if (latex[i] === close && --depth === 0) return i + 1;
	}
	return latex.length;
}

/** `{}` after `^` or `_` is always a box; after a command or a group, only as an argument. */
function isSlotAt(latex: string, offset: number, args: Set<number>): boolean {
	return /[\^_]/.test(latex[offset - 1] ?? '') || args.has(offset);
}

/**
 * - `{ }`, except as the argument of a text or font command: `\text{ }` is a space as
 *   written.
 * - `{}` that is an argument (`x^{}`, `\vec{}_x`, `\frac{1}{}^2`), see `emptyArguments`.
 * - `[]` right after `\sqrt`.
 */
const SLOT =
	/(?<!\\(?:text|textrm|textit|textbf|textsf|texttt|mbox|mathrm|mathit|mathbf|mathsf|mathtt|mathbb|mathcal|boldsymbol|operatorname))\{ \}|\{\}|(?<=\\sqrt)\[\]/g;

/** The formula as the visual editor should open it: every empty box fillable again. */
export function withSlots(latex: string): string {
	return replaceSlots(latex, '\\placeholder{}');
}

/**
 * The limits of `\lim`, `\max`, `\min`, `\sup`, `\inf`, `\det`, `\gcd` and `\Pr` drawn
 * under the name, as the app does in a sentence too (flutter_math_fork 0.7.4,
 * `parser/tex/functions/katex_base/op.dart`: `mathLimits` are parsed with
 * `defaultLimits: true`). KaTeX puts them beside the name inline, so the editor's
 * drawing says `\limits`. Display only; the stored LaTeX is not changed.
 */
export function withAppLimits(latex: string): string {
	return latex.replace(
		/\\(lim|max|min|sup|inf|det|gcd|Pr)(?![a-zA-Z])(?=\s*[_^])/g,
		'\\$1\\limits'
	);
}
