/**
 * Word's equation editor (OMML: `m:oMath`, `m:oMathPara`) into LaTeX, for the maths in a
 * teacher's Word file, which mammoth leaves out.
 *
 * `latexOf` turns one equation; `equationsToPlaceholders` swaps every equation of a
 * `document.xml` for a plain word at its own place, so the text goes through mammoth in its
 * order, and `fillEquations` puts the LaTeX back (`$…$` inline, `$$…$$` for a paragraph of
 * its own). The XML is read with a small reader, not a DOM, so this runs the same in a
 * browser and in a test.
 *
 * Covered: runs, fractions (also linear and without a bar), super- and subscripts, both at
 * once and before the base, radicals with a degree, delimiters with their separators,
 * n-ary operators with limits, accents, bars, limits above and below, functions, matrices
 * and equation arrays. Anything else keeps its text.
 */

interface El {
	name: string;
	attrs: Record<string, string>;
	kids: (El | string)[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s: string): string =>
	s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e] ?? m;
	});

/** The XML as a tree; markup that is not an element (declarations, comments) is skipped. */
export function parseXml(xml: string): El {
	const root: El = { name: '#root', attrs: {}, kids: [] };
	const stack: El[] = [root];
	for (const token of xml.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? []) {
		const top = stack[stack.length - 1];
		if (token[0] !== '<') {
			top.kids.push(unescapeXml(token));
			continue;
		}
		if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!')) continue;
		if (token.startsWith('</')) {
			if (stack.length > 1) stack.pop();
			continue;
		}
		const name = /^<([^\s/>]+)/.exec(token)![1];
		const attrs: Record<string, string> = {};
		for (const a of token.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = unescapeXml(a[2]);
		const el: El = { name, attrs, kids: [] };
		top.kids.push(el);
		if (!token.endsWith('/>')) stack.push(el);
	}
	return root;
}

const elements = (el: El): El[] => el.kids.filter((k): k is El => typeof k !== 'string');
const child = (el: El, name: string): El | undefined => elements(el).find((k) => k.name === name);
const on = (el: El | undefined): boolean =>
	el !== undefined && !['0', 'false', 'off'].includes(el.attrs['m:val'] ?? '1');

// ───────────────────────────────── characters ─────────────────────────────────

const SYMBOLS: Record<string, string> = {
	'·': '\\cdot ',
	'⋅': '\\cdot ',
	'×': '\\times ',
	'÷': '\\div ',
	'±': '\\pm ',
	'∓': '\\mp ',
	'−': '-',
	'–': '-',
	'≤': '\\le ',
	'≥': '\\ge ',
	'≠': '\\ne ',
	'≈': '\\approx ',
	'≡': '\\equiv ',
	'∼': '\\sim ',
	'≅': '\\cong ',
	'∝': '\\propto ',
	'∞': '\\infty ',
	'√': '\\sqrt ',
	'∂': '\\partial ',
	'∇': '\\nabla ',
	'°': '^{\\circ}',
	'′': "'",
	'″': "''",
	'…': '\\ldots ',
	'⋯': '\\cdots ',
	'⋮': '\\vdots ',
	'⋱': '\\ddots ',
	'→': '\\to ',
	'←': '\\leftarrow ',
	'↔': '\\leftrightarrow ',
	'⇒': '\\Rightarrow ',
	'⇐': '\\Leftarrow ',
	'⇔': '\\Leftrightarrow ',
	'↦': '\\mapsto ',
	'∈': '\\in ',
	'∉': '\\notin ',
	'∋': '\\ni ',
	'⊂': '\\subset ',
	'⊃': '\\supset ',
	'⊆': '\\subseteq ',
	'⊇': '\\supseteq ',
	'∪': '\\cup ',
	'∩': '\\cap ',
	'∅': '\\emptyset ',
	'∀': '\\forall ',
	'∃': '\\exists ',
	'¬': '\\neg ',
	'∧': '\\wedge ',
	'∨': '\\vee ',
	'⊥': '\\perp ',
	'∥': '\\parallel ',
	'∠': '\\angle ',
	'△': '\\triangle ',
	'∑': '\\sum ',
	'∏': '\\prod ',
	'∫': '\\int ',
	'∬': '\\iint ',
	'∭': '\\iiint ',
	'∮': '\\oint ',
	'⋃': '\\bigcup ',
	'⋂': '\\bigcap ',
	ℝ: '\\mathbb{R}',
	ℕ: '\\mathbb{N}',
	ℤ: '\\mathbb{Z}',
	ℚ: '\\mathbb{Q}',
	ℂ: '\\mathbb{C}',
	'{': '\\{',
	'}': '\\}',
	'%': '\\%',
	'#': '\\#',
	_: '\\_',
	$: '\\$',
	' ': ' '
};
const GREEK = 'α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ ς σ τ υ φ χ ψ ω'.split(' ');
const GREEK_NAMES =
	'alpha beta gamma delta varepsilon zeta eta theta iota kappa lambda mu nu xi o pi rho varsigma sigma tau upsilon varphi chi psi omega'.split(
		' '
	);
GREEK.forEach((c, i) => {
	if (GREEK_NAMES[i] !== 'o') SYMBOLS[c] = `\\${GREEK_NAMES[i]} `;
});
Object.assign(SYMBOLS, {
	ϵ: '\\epsilon ',
	ϑ: '\\vartheta ',
	ϕ: '\\phi ',
	ϖ: '\\varpi ',
	Γ: '\\Gamma ',
	Δ: '\\Delta ',
	Θ: '\\Theta ',
	Λ: '\\Lambda ',
	Ξ: '\\Xi ',
	Π: '\\Pi ',
	Σ: '\\Sigma ',
	Φ: '\\Phi ',
	Ψ: '\\Psi ',
	Ω: '\\Omega '
});

/** Plain characters as LaTeX. */
const chars = (text: string): string => [...text].map((c) => SYMBOLS[c] ?? c).join('');

/** What is left after the text of an element is tidied: `\alpha x` stays, a trailing space goes. */
const tidy = (s: string): string => s.replace(/\s+$/, '').replace(/ {2,}/g, ' ');

// ───────────────────────────────── the conversion ─────────────────────────────────

const FUNCTIONS = new Set([
	'sin',
	'cos',
	'tan',
	'cot',
	'sec',
	'csc',
	'arcsin',
	'arccos',
	'arctan',
	'sinh',
	'cosh',
	'tanh',
	'coth',
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
	'deg',
	'arg',
	'dim',
	'ker'
]);
const CZECH_FUNCTIONS: Record<string, string> = {
	tg: '\\operatorname{tg}',
	cotg: '\\operatorname{cotg}',
	sgn: '\\operatorname{sgn}'
};

const ACCENTS: Record<string, string> = {
	'̂': '\\hat',
	'^': '\\hat',
	'̃': '\\tilde',
	'~': '\\tilde',
	'̄': '\\bar',
	'¯': '\\bar',
	'̅': '\\overline',
	'⃗': '\\vec',
	'→': '\\vec',
	'̇': '\\dot',
	'̈': '\\ddot',
	'̌': '\\check',
	'́': '\\acute',
	'̀': '\\grave',
	'̆': '\\breve'
};
const DELIMITERS: Record<string, string> = {
	'(': '(',
	')': ')',
	'[': '[',
	']': ']',
	'{': '\\{',
	'}': '\\}',
	'|': '|',
	'‖': '\\|',
	'⌊': '\\lfloor ',
	'⌋': '\\rfloor ',
	'⌈': '\\lceil ',
	'⌉': '\\rceil ',
	'⟨': '\\langle ',
	'⟩': '\\rangle ',
	'〈': '\\langle ',
	'〉': '\\rangle ',
	'': '.'
};

/** A base or a script as one LaTeX argument: bare when it is one token, else in braces. */
const arg = (s: string): string =>
	/^(\\[A-Za-z]+|[A-Za-z0-9])$/.test(s.trim()) ? s.trim() : `{${s}}`;

function text(el: El): string {
	return el.kids.map((k) => (typeof k === 'string' ? k : text(k))).join('');
}

/** The content of a child element of `el`, or ''. */
const part = (el: El, name: string): string => {
	const c = child(el, name);
	return c === undefined ? '' : tidy(run(c));
};

/** All the children of an element, in order. */
const run = (el: El): string => elements(el).map(convert).join('');

function convert(el: El): string {
	switch (el.name) {
		case 'm:r': {
			const t = elements(el)
				.filter((k) => k.name === 'm:t')
				.map(text)
				.join('');
			const plain = on(child(child(el, 'm:rPr') ?? { name: '', attrs: {}, kids: [] }, 'm:nor'));
			return plain ? `\\text{${t}}` : chars(t);
		}
		case 'm:t':
			return chars(text(el));
		case 'm:f': {
			const type = child(el, 'm:fPr') && child(child(el, 'm:fPr')!, 'm:type')?.attrs['m:val'];
			const [n, d] = [part(el, 'm:num'), part(el, 'm:den')];
			if (type === 'lin') return `${arg(n)}/${arg(d)}`;
			if (type === 'noBar') return `\\binom{${n}}{${d}}`;
			return `\\frac{${n}}{${d}}`;
		}
		case 'm:sSup':
			return `${base(el)}^{${part(el, 'm:sup')}}`;
		case 'm:sSub':
			return `${base(el)}_{${part(el, 'm:sub')}}`;
		case 'm:sSubSup':
			return `${base(el)}_{${part(el, 'm:sub')}}^{${part(el, 'm:sup')}}`;
		case 'm:sPre':
			return `{}_{${part(el, 'm:sub')}}^{${part(el, 'm:sup')}}${base(el)}`;
		case 'm:rad': {
			const hidden = on(
				child(child(el, 'm:radPr') ?? { name: '', attrs: {}, kids: [] }, 'm:degHide')
			);
			const degree = part(el, 'm:deg');
			return hidden || degree === ''
				? `\\sqrt{${part(el, 'm:e')}}`
				: `\\sqrt[${degree}]{${part(el, 'm:e')}}`;
		}
		case 'm:d': {
			const pr = child(el, 'm:dPr');
			const chr = (name: string, fallback: string) => {
				const c = pr && child(pr, name);
				return c === undefined ? fallback : (c.attrs['m:val'] ?? '');
			};
			const open = DELIMITERS[chr('m:begChr', '(')] ?? chr('m:begChr', '(');
			const close = DELIMITERS[chr('m:endChr', ')')] ?? chr('m:endChr', ')');
			const sep = DELIMITERS[chr('m:sepChr', '|')] ?? chr('m:sepChr', '|');
			const inner = elements(el)
				.filter((k) => k.name === 'm:e')
				.map((e) => tidy(run(e)))
				.join(sep === '.' ? '' : ` ${sep} `);
			return `\\left${open}${inner}\\right${close}`;
		}
		case 'm:nary': {
			const pr = child(el, 'm:naryPr');
			const chrEl = pr && child(pr, 'm:chr');
			const operator =
				SYMBOLS[chrEl === undefined ? '∫' : (chrEl.attrs['m:val'] ?? '')] ?? '\\int ';
			const hide = (name: string) => on(pr && child(pr, name));
			const lower = hide('m:subHide') ? '' : part(el, 'm:sub');
			const upper = hide('m:supHide') ? '' : part(el, 'm:sup');
			return `${operator.trim()}${lower === '' ? '' : `_{${lower}}`}${upper === '' ? '' : `^{${upper}}`} ${part(el, 'm:e')}`;
		}
		case 'm:acc': {
			const c = child(el, 'm:accPr') && child(child(el, 'm:accPr')!, 'm:chr');
			const command = ACCENTS[c === undefined ? '̂' : (c.attrs['m:val'] ?? '')] ?? '\\hat';
			return `${command}{${part(el, 'm:e')}}`;
		}
		case 'm:bar': {
			const pos = child(el, 'm:barPr') && child(child(el, 'm:barPr')!, 'm:pos')?.attrs['m:val'];
			return `${pos === 'bot' ? '\\underline' : '\\overline'}{${part(el, 'm:e')}}`;
		}
		case 'm:limLow': {
			const [e, lim] = [part(el, 'm:e'), part(el, 'm:lim')];
			return /^\\?(lim|max|min|sup|inf)$/.test(e)
				? `\\${e.replace('\\', '')}_{${lim}}`
				: `\\underset{${lim}}{${e}}`;
		}
		case 'm:limUpp':
			return `\\overset{${part(el, 'm:lim')}}{${part(el, 'm:e')}}`;
		case 'm:func': {
			const raw = text(child(el, 'm:fName') ?? el).trim();
			const name = child(el, 'm:fName');
			// `lim` has its limit under it, so the name is converted as a whole.
			const fn = name === undefined ? '' : tidy(run(name));
			const head = FUNCTIONS.has(raw)
				? `\\${raw}`
				: (CZECH_FUNCTIONS[raw] ?? (fn === '' ? raw : fn));
			return `${head.trim()} ${part(el, 'm:e')}`;
		}
		case 'm:m':
		case 'm:eqArr': {
			const rows = elements(el)
				.filter((k) => k.name === (el.name === 'm:m' ? 'm:mr' : 'm:e'))
				.map((row) =>
					el.name === 'm:m'
						? elements(row)
								.filter((k) => k.name === 'm:e')
								.map((c) => tidy(run(c)))
								.join(' & ')
						: tidy(run(row))
				);
			const env = el.name === 'm:m' ? 'matrix' : 'aligned';
			return `\\begin{${env}} ${rows.join(' \\\\ ')} \\end{${env}}`;
		}
		case 'm:fName':
		case 'm:e':
		case 'm:num':
		case 'm:den':
		case 'm:sup':
		case 'm:sub':
		case 'm:deg':
		case 'm:lim':
		case 'm:oMath':
		case 'm:box':
		case 'm:borderBox':
		case 'm:groupChr':
		case 'm:phant':
			return run(el);
		// Properties say how, not what.
		case 'm:rPr':
		case 'm:fPr':
		case 'm:dPr':
		case 'm:naryPr':
		case 'm:radPr':
		case 'm:accPr':
		case 'm:barPr':
		case 'm:ctrlPr':
		case 'm:mPr':
		case 'm:eqArrPr':
		case 'm:sSupPr':
		case 'm:sSubPr':
		case 'm:sSubSupPr':
		case 'm:sPrePr':
		case 'm:limLowPr':
		case 'm:limUppPr':
		case 'm:funcPr':
		case 'm:boxPr':
		case 'm:borderBoxPr':
		case 'm:groupChrPr':
		case 'm:phantPr':
		case 'm:mr':
			return el.name === 'm:mr' ? run(el) : '';
		default:
			// Not known: its text, so nothing is lost.
			return el.name.startsWith('w:') || el.name.startsWith('m:') ? chars(text(el)) : '';
	}
}

/** The base `m:e` of a script construct, in braces unless it is one token (or one delimiter). */
function base(el: El): string {
	const e = child(el, 'm:e');
	if (e === undefined) return '{}';
	const inner = elements(e).filter((k) => k.name !== 'm:ctrlPr');
	const s = tidy(run(e));
	return inner.length === 1 && inner[0].name === 'm:d' ? s : arg(s);
}

/** One equation (an `m:oMath` element's XML) as LaTeX. */
export function latexOf(xml: string): string {
	const root = parseXml(xml);
	const math = elements(root).find((k) => k.name === 'm:oMath') ?? root;
	return tidy(run(math)).trim();
}

// ───────────────────────────────── in a document ─────────────────────────────────

const TOKEN = (n: number) => `OMMLEQ${n}END`;

export interface Equation {
	latex: string;
	/** A paragraph of its own (`m:oMathPara`): `$$…$$`. */
	display: boolean;
}

/**
 * `document.xml` with every equation replaced by a word at its place, and the equations
 * in the order of those words.
 */
export function equationsToPlaceholders(xml: string): { xml: string; equations: Equation[] } {
	const equations: Equation[] = [];
	const swap = (match: string, display: boolean) => {
		const parts = display ? (match.match(/<m:oMath\b[\s\S]*?<\/m:oMath>/g) ?? []) : [match];
		const latex = parts
			.map(latexOf)
			.filter((l) => l !== '')
			.join(' \\\\ ');
		if (latex === '') return '';
		equations.push({ latex, display });
		return `<w:r><w:t>${TOKEN(equations.length - 1)}</w:t></w:r>`;
	};
	const out = xml
		.replace(/<m:oMathPara\b[\s\S]*?<\/m:oMathPara>/g, (m) => swap(m, true))
		.replace(/<m:oMath\b[\s\S]*?<\/m:oMath>/g, (m) => swap(m, false));
	return { xml: out, equations };
}

/** The words put back as `$…$` or, for an equation of its own, `$$…$$` between blank lines. */
export function fillEquations(markdown: string, equations: readonly Equation[]): string {
	return markdown.replace(/OMMLEQ(\d+)END/g, (_, n: string) => {
		const eq = equations[Number(n)];
		if (eq === undefined) return '';
		return eq.display ? `\n\n$$${eq.latex}$$\n\n` : `$${eq.latex}$`;
	});
}
