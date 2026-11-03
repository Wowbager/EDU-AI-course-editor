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

const SUBSCRIPT: Record<string, string> = {
	'0': '₀',
	'1': '₁',
	'2': '₂',
	'3': '₃',
	'4': '₄',
	'5': '₅',
	'6': '₆',
	'7': '₇',
	'8': '₈',
	'9': '₉'
};

const GREEK: Record<string, string> = {
	alpha: 'α',
	beta: 'β',
	gamma: 'γ',
	delta: 'δ',
	epsilon: 'ϵ',
	varepsilon: 'ε',
	zeta: 'ζ',
	eta: 'η',
	theta: 'θ',
	vartheta: 'ϑ',
	iota: 'ι',
	kappa: 'κ',
	lambda: 'λ',
	mu: 'μ',
	nu: 'ν',
	xi: 'ξ',
	omicron: 'ο',
	rho: 'ρ',
	sigma: 'σ',
	tau: 'τ',
	upsilon: 'υ',
	phi: 'ϕ',
	varphi: 'φ',
	chi: 'χ',
	psi: 'ψ',
	omega: 'ω',
	Gamma: 'Γ',
	Delta: 'Δ',
	Theta: 'Θ',
	Lambda: 'Λ',
	Xi: 'Ξ',
	Pi: 'Π',
	Sigma: 'Σ',
	Upsilon: 'Υ',
	Phi: 'Φ',
	Psi: 'Ψ',
	Omega: 'Ω'
};

/**
 * Accents become the letter with a combining mark from the UI font (Poppins has the macron
 * and the diaeresis); the hat and dots sit on the last letter. A vector is its letter
 * alone: no font the editor loads has the combining arrow (U+20D7), and the fallback
 * draws a box.
 */
const ACCENTS: Record<string, { mark: string; each?: boolean }> = {
	vec: { mark: '' },
	overrightarrow: { mark: '' },
	hat: { mark: '\u0302' },
	widehat: { mark: '\u0302' },
	tilde: { mark: '\u0303' },
	widetilde: { mark: '\u0303' },
	dot: { mark: '\u0307' },
	ddot: { mark: '\u0308' },
	bar: { mark: '\u0304', each: true },
	overline: { mark: '\u0304', each: true }
};

const BLACKBOARD: Record<string, string> = { N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ' };

/** Function names that read as themselves: `\sin x` is "sin x". */
const WORDS = new Set([
	'sin',
	'cos',
	'tan',
	'tg',
	'cot',
	'cotg',
	'arcsin',
	'arccos',
	'arctan',
	'arctg',
	'sinh',
	'cosh',
	'tanh',
	'log',
	'ln',
	'lg',
	'exp',
	'lim',
	'max',
	'min',
	'sup',
	'inf',
	'det',
	'gcd',
	'mod',
	'Re',
	'Im'
]);

const SYMBOLS: Record<string, string> = {
	...GREEK,
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
	pi: 'π',
	infty: '∞',
	to: '→',
	rightarrow: '→',
	Rightarrow: '⇒',
	Leftrightarrow: '⇔',
	mapsto: '↦',
	in: '∈',
	notin: '∉',
	ni: '∋',
	subset: '⊂',
	subseteq: '⊆',
	nsubseteq: '⊈',
	cup: '∪',
	cap: '∩',
	setminus: '∖',
	emptyset: '∅',
	varnothing: '∅',
	forall: '∀',
	exists: '∃',
	neg: '¬',
	wedge: '∧',
	vee: '∨',
	perp: '⊥',
	parallel: '∥',
	nparallel: '∦',
	angle: '∠',
	measuredangle: '∡',
	triangle: '△',
	circ: '∘',
	sim: '∼',
	cong: '≅',
	doteq: '≐',
	propto: '∝',
	hbar: 'ℏ',
	prime: '′',
	langle: '⟨',
	rangle: '⟩',
	lvert: '|',
	rvert: '|',
	sum: 'Σ',
	prod: 'Π',
	int: '∫',
	partial: '∂',
	nabla: '∇',
	percent: '%',
	ldots: '…',
	dots: '…',
	cdots: '⋯',
	vdots: '⋮',
	leftarrow: '←',
	Leftarrow: '⇐',
	leftrightarrow: '↔',
	longrightarrow: '⟶',
	Longrightarrow: '⟹',
	uparrow: '↑',
	downarrow: '↓',
	rightleftharpoons: '⇌',
	quad: ' ',
	qquad: ' ',
	degree: '°',
	circledast: '⊛',
	mid: '|',
	nmid: '∤',
	lt: '<',
	gt: '>',
	ll: '≪',
	gg: '≫',
	equiv: '≡',
	nexists: '∄',
	supset: '⊃',
	supseteq: '⊇',
	ast: '∗',
	star: '⋆',
	bullet: '•',
	square: '□',
	backslash: '∖',
	lfloor: '⌊',
	rfloor: '⌋',
	lceil: '⌈',
	rceil: '⌉'
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
		.replace(/\\(?:left|right)(?![a-zA-Z])\s*/g, '')
		.replace(/\\\\/g, ' ')
		.replace(/\\(?:limits|nolimits)(?![a-zA-Z])/g, '');

	// A matrix or cases block: its cells side by side, innermost block first. An `&`
	// outside every block is text ("Tom & Jerry"). A `\begin` never closed (a formula
	// still being typed) runs to the end; an `\end` left unpaired is dropped.
	for (let guard = 0; guard < 50; guard += 1) {
		const before = out;
		out = out.replace(
			/\\begin\s*\{[^{}]*\}((?:(?!\\begin(?![a-zA-Z]))[\s\S])*?)(?:\\end\s*\{[^{}]*\}|$)/g,
			(_, body: string) => ` ${body.replace(/&/g, ' ')} `
		);
		if (out === before) break;
	}
	out = out.replace(/\\(?:begin|end)\s*\{[^{}]*\}/g, ' ');

	// Innermost first: a group with no braces inside is complete, so repeat until nothing
	// is left to fold. That handles nesting without a parser.
	for (let guard = 0; guard < 50; guard += 1) {
		const before = out;
		out = out
			.replace(
				new RegExp(String.raw`\\[dtc]?frac\s*${ARG}\s*${ARG}`, 'g'),
				(_, a1?: string, a2?: string, b1?: string, b2?: string) =>
					`${wrap((a1 ?? a2)!.trim())}/${wrap((b1 ?? b2)!.trim())}`
			)
			.replace(
				new RegExp(String.raw`\\[dt]?binom\s*${ARG}\s*${ARG}`, 'g'),
				(_, a1?: string, a2?: string, b1?: string, b2?: string) =>
					`(${(a1 ?? a2)!.trim()} nad ${(b1 ?? b2)!.trim()})`
			)
			.replace(
				new RegExp(String.raw`\\sqrt\s*${ARG}`, 'g'),
				(_, x1?: string, x2?: string) => `√${wrap((x1 ?? x2)!.trim())}`
			)
			.replace(
				new RegExp(String.raw`\\(${Object.keys(ACCENTS).join('|')})(?![a-zA-Z])\s*${ARG}`, 'g'),
				(_, cmd: string, x1?: string, x2?: string) => accent((x1 ?? x2)!.trim(), cmd)
			)
			.replace(
				new RegExp(String.raw`\\mathbb(?![a-zA-Z])\s*${ARG}`, 'g'),
				(_, x1?: string, x2?: string) => {
					const x = (x1 ?? x2)!.trim();
					return BLACKBOARD[x] ?? x;
				}
			)
			.replace(/\^\s*\{([^{}]*)\}/g, (_, x: string) => superscript(x.trim()))
			.replace(/\^\s*([0-9a-zA-Z])/g, (_, x: string) => superscript(x))
			.replace(/_\s*\{([0-9]+)\}/g, (_, x: string) => subscript(x))
			.replace(/_\s*([0-9])/g, (_, x: string) => subscript(x));
		if (out === before) break;
	}

	return (
		out
			// A command not known here is dropped, not spelled out: `\\text{m}` is "m".
			.replace(/\\([a-zA-Z]+)/g, (_, cmd: string) => SYMBOLS[cmd] ?? (WORDS.has(cmd) ? cmd : ''))
			.replace(/\\(.)/g, (_, ch: string) => (/[\s,;:!]/.test(ch) ? ' ' : ch))
			.replace(/[{}]/g, '')
			.replace(/[ \t]+/g, ' ')
			.trim()
	);
}

function superscript(x: string): string {
	if (/^[0-9]+$/.test(x)) return [...x].map((d) => SUPERSCRIPT[d]).join('');
	return isSimple(x) ? `^${x}` : `^(${x})`;
}

function subscript(x: string): string {
	return [...x].map((d) => SUBSCRIPT[d]).join('');
}

function accent(x: string, cmd: string): string {
	const { mark, each } = ACCENTS[cmd];
	const chars = [...x];
	if (each) return chars.map((ch) => ch + mark).join('');
	return x + mark;
}
