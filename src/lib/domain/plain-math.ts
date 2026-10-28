/**
 * Inline LaTeX as words, for places where a teacher reads a card's name: the sidebar,
 * the title placeholder, validation messages. Display only — the result is never
 * written back into the document, where the LaTeX stays as authored.
 */

const SUPERSCRIPT: Record<string, string> = {
	'0': '⁰',
	'1': '¹',
	'2': '²',
	'3': '³',
	'4': '⁴',
	'5': '⁵',
	'6': '⁶',
	'7': '⁷',
	'8': '⁸',
	'9': '⁹'
};

const SYMBOLS: Record<string, string> = {
	cdot: '·',
	times: '×',
	div: ':',
	pm: '±',
	leq: '≤',
	le: '≤',
	geq: '≥',
	ge: '≥',
	neq: '≠',
	ne: '≠',
	approx: '≈',
	pi: 'π'
};

/**
 * An argument: a group with no braces inside, or one character without braces, as in
 * `\sqrt9` and `\frac12`, which the formula editor writes.
 */
const ARG = String.raw`(?:\{([^{}]*)\}|([0-9a-zA-Z]))`;

/** A group read as one token needs no brackets when it is put next to an operator. */
const isSimple = (text: string) => /^[\p{L}\p{N}.,]+$/u.test(text);
const wrap = (text: string) => (isSimple(text) ? text : `(${text})`);

export function plainMath(text: string): string {
	let out = text
		.replace(/\\[()[\]]/g, '')
		.replace(/\$+/g, '')
		.replace(/\\(?:left|right)(?![a-zA-Z])\s*/g, '');

	// Innermost first: a group with no braces inside is complete, so repeat until nothing
	// is left to fold. That handles nesting without a parser.
	for (let guard = 0; guard < 50; guard += 1) {
		const before = out;
		out = out
			.replace(
				new RegExp(String.raw`\\d?frac\s*${ARG}\s*${ARG}`, 'g'),
				(_, a1?: string, a2?: string, b1?: string, b2?: string) =>
					`${wrap((a1 ?? a2)!.trim())}/${wrap((b1 ?? b2)!.trim())}`
			)
			.replace(
				new RegExp(String.raw`\\sqrt\s*${ARG}`, 'g'),
				(_, x1?: string, x2?: string) => `√${wrap((x1 ?? x2)!.trim())}`
			)
			.replace(/\^\s*\{([^{}]*)\}/g, (_, x: string) => superscript(x.trim()))
			.replace(/\^\s*([0-9a-zA-Z])/g, (_, x: string) => superscript(x));
		if (out === before) break;
	}

	return out
		.replace(/\\([a-zA-Z]+)/g, (_, cmd: string) => SYMBOLS[cmd] ?? cmd)
		.replace(/\\(.)/g, (_, ch: string) => (/[\s,;:!]/.test(ch) ? ' ' : ch))
		.replace(/[{}]/g, '')
		.replace(/[ \t]+/g, ' ')
		.trim();
}

function superscript(x: string): string {
	if (/^[0-9]+$/.test(x)) return [...x].map((d) => SUPERSCRIPT[d]).join('');
	return isSimple(x) ? `^${x}` : `^(${x})`;
}
