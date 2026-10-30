/**
 * The on-screen math keypad as data (design brief §4.1): every key is a definition here —
 * id, the glyph drawn, its Czech name (tooltip, search, screen reader), search aliases,
 * the LaTeX it inserts (`#@`/`#?` placeholders, `#0` the selection) or the editing
 * command it runs — never component code. The tab tables in §4.3 will change after
 * teacher feedback; they live here, not in the component.
 *
 * Renderer notes: the editor draws formulas with KaTeX (mhchem contrib for `\ce`), the
 * student app with flutter_math_fork 0.7.4. Every `insert` below was checked against both
 * (see `math-render.test.ts`, which renders each one through KaTeX). Where a command is
 * not in the app's renderer, the key says so in `note` and the gap is in
 * `docs/OPEN-PROBLEMS.md` — the stored LaTeX stays canonical.
 */

/** A drawn glyph the component can render instead of a text label. */
export type KeyGlyph =
	| 'frac'
	| 'root'
	| 'nth-root'
	| 'abs'
	| 'power'
	| 'subscript'
	| 'binom'
	| 'sum'
	| 'product'
	| 'integral'
	| 'limit'
	| 'cases'
	| 'interval'
	| 'vector'
	| 'angle'
	| 'triangle'
	| 'chem';

export type KeyZone = 'symbol' | 'template';

export interface KeyVariant {
	label: string;
	name: string;
	insert: string;
}

export interface KeyDef {
	/** Stable id: used by tests, search results and the recently-used row. */
	id: string;
	/** The glyph drawn on the key. */
	label: string;
	/** Czech name: tooltip, `aria-label`, search. */
	name: string;
	/** Extra search words, without diacritics needed (search folds both sides). */
	aliases: string[];
	/** LaTeX to insert at the caret; `#@`/`#?` placeholders, `#0` the selection. */
	insert: string;
	zone: KeyZone;
	/** A drawn glyph instead of the label. */
	glyph?: KeyGlyph;
	/** Long-press variants (e.g. ε/ϵ). */
	variants?: KeyVariant[];
	/** Renderer-support note, when a command is not everywhere (kept with the key, §1). */
	note?: string;
	/**
	 * On the Chemie tab: an ordinary-math key (pH, c = n/V, …) that leaves the `\ce{…}`
	 * node — the rest of the tab types mhchem source into it (chem mode).
	 */
	outside?: boolean;
}

/** The keys on every tab, in the same position (§4.1): arrows are icons, never `<` `>`. */
export interface FixedKeyDef {
	id: string;
	name: string;
	command?: string;
	/** `done` is the Enter/next-placeholder key. */
	kind: 'command' | 'done';
	icon: 'backspace' | 'left' | 'right' | 'enter';
}

export const FIXED_KEYS: FixedKeyDef[] = [
	{
		id: 'key-left',
		name: 'Předchozí znak',
		command: 'moveToPreviousChar',
		kind: 'command',
		icon: 'left'
	},
	{
		id: 'key-right',
		name: 'Další znak',
		command: 'moveToNextChar',
		kind: 'command',
		icon: 'right'
	},
	{
		id: 'key-backspace',
		name: 'Smazat znak',
		command: 'deleteBackward',
		kind: 'command',
		icon: 'backspace'
	},
	{ id: 'key-enter', name: 'Potvrdit', kind: 'done', icon: 'enter' }
];

export interface TabDef {
	id: string;
	/** The short label on the tab strip: `123`, `f(x)`, … */
	label: string;
	/** Czech tab name, for search results and screen readers. */
	name: string;
	keys: KeyDef[];
}

const sym = (
	id: string,
	label: string,
	name: string,
	insert: string,
	aliases: string[] = [],
	extra: Partial<KeyDef> = {}
): KeyDef => ({ id, label, name, aliases, insert, zone: 'symbol', ...extra });

const tpl = (
	id: string,
	label: string,
	name: string,
	insert: string,
	aliases: string[] = [],
	extra: Partial<KeyDef> = {}
): KeyDef => ({ id, label, name, aliases, insert, zone: 'template', ...extra });

/** Digits 0–9; `prefix` keeps ids unique when a tab repeats them (Chemie). */
const digits = (prefix = 'digit'): KeyDef[] =>
	'0123456789'.split('').map((d) => sym(`${prefix}-${d}`, d, `Číslice ${d}`, d, [`cislo ${d}`]));

/** §4.3, tab 1 — Základ. */
const TAB_ZAKLAD: TabDef = {
	id: 'zaklad',
	label: '123',
	name: 'Základ',
	keys: [
		...digits(),
		sym('decimal-comma', ',', 'Desetinná čárka', '{,}', ['carka', 'desetinna carka', 'decimal']),
		sym('plus', '+', 'Plus', '+', ['součet', 'plus']),
		sym('minus', '−', 'Minus', '-', ['mínus', 'odečítání']),
		sym('cdot', '·', 'Krát tečkou', '\\cdot', ['nasobeni', 'krat', 'tecka']),
		sym('colon-div', ':', 'Děleno dvěma tečkami', ':', ['deleno', 'pomer', 'ratio']),
		sym('equals', '=', 'Rovná se', '=', ['rovna se']),
		sym('lparen', '(', 'Levná závorka', '(', ['oteviraci zavorka']),
		sym('rparen', ')', 'Pravá závorka', ')', ['zaviraci zavorka']),
		sym('pi', 'π', 'Pí', '\\pi', ['pi', 'pí']),
		sym('percent', '%', 'Procento', '\\%', ['procenta']),
		sym('per-mille', '‰', 'Promile', '\\,‰', ['promile'], {
			note: 'KaTeX in the editor renders ‰; flutter_math_fork in the app has no ‰ glyph yet (OPEN-PROBLEMS).'
		}),
		sym('x', 'x', 'Písmeno x', 'x', ['x']),
		sym('y', 'y', 'Písmeno y', 'y', ['y']),
		tpl('frac', 'a/b', 'Zlomek', '\\frac{#@}{#?}', ['zlomek', 'deleno', 'fraction'], {
			glyph: 'frac'
		}),
		tpl('power', 'x²', 'Mocnina', '#@^{#?}', ['mocnina', 'power', 'na druhou'], { glyph: 'power' }),
		tpl('sqrt', '√', 'Odmocnina', '\\sqrt{#?}', ['odmocnina', 'sqrt', 'druhá odmocnina'], {
			glyph: 'root'
		}),
		tpl('mixed', '2¾', 'Smíšené číslo', '#@\\frac{#?}{#@}', ['smisene cislo', 'mixed number'])
	]
};

/** §4.3, tab 2 — Algebra a funkce. */
const TAB_ALGEBRA: TabDef = {
	id: 'algebra',
	label: 'f(x)',
	name: 'Algebra a funkce',
	keys: [
		sym('lt', '<', 'Menší', '<', ['mensi']),
		sym('gt', '>', 'Větší', '>', ['vetsi']),
		sym('le', '≤', 'Menší nebo rovno', '\\le', ['mene nebo rovno', 'le']),
		sym('ge', '≥', 'Větší nebo rovno', '\\ge', ['vetsi nebo rovno', 'ge']),
		sym('ne', '≠', 'Nerovná se', '\\ne', ['nerovna se', 'ne', 'ruzne'], {
			note: 'Stored as \\not= — the app turns \\n in a text step into a line break (OPEN-PROBLEMS #50).'
		}),
		sym('doteq', '≐', 'Rovná se přibližně', '\\doteq', [
			'priblizne rovno',
			'doteq',
			'je priblizne'
		]),
		sym('pm', '±', 'Plus minus', '\\pm', ['plus minus', 'tolerance']),
		sym('infty', '∞', 'Nekonečno', '\\infty', ['nekonecno', 'infinity']),
		sym('e', 'e', 'Eulerovo číslo', 'e', ['eulerovo cislo']),
		sym('nat', 'ℕ', 'Přirozená čísla', '\\mathbb{N}', ['prirozena cisla', 'n', 'natural']),
		sym('int', 'ℤ', 'Celá čísla', '\\mathbb{Z}', ['cela cisla', 'z', 'integer']),
		sym('rat', 'ℚ', 'Racionální čísla', '\\mathbb{Q}', ['racionalni cisla', 'q']),
		sym('real', 'ℝ', 'Reálná čísla', '\\mathbb{R}', ['realna cisla', 'r', 'real']),
		sym('complex', 'ℂ', 'Komplexní čísla', '\\mathbb{C}', ['komplexni cisla', 'c']),
		sym('real-pos', 'ℝ⁺', 'Kladná reálná čísla', '\\mathbb{R}^{+}', ['kladna realna']),
		sym('real-nonneg', 'ℝ₀⁺', 'Nezáporná reálná čísla', '\\mathbb{R}_{0}^{+}', [
			'nezaporna realna'
		]),
		sym('real-neg', 'ℝ⁻', 'Záporná reálná čísla', '\\mathbb{R}^{-}', ['zaporna realna']),
		sym('f-x', 'f(x)', 'Funkce f', 'f(x)', ['funkce', 'f']),
		sym('g-x', 'g(x)', 'Funkce g', 'g(x)', ['funkce g']),
		sym('f-inv', 'f⁻¹', 'Inverzní funkce', 'f^{-1}', ['inverzni funkce', 'f na minus jedna']),
		sym('domain', 'D(f)', 'Definiční obor', 'D(f)', ['definicni obor', 'domain']),
		sym('range', 'H(f)', 'Obor hodnot', 'H(f)', ['obor hodnot', 'range']),
		sym('log', 'log', 'Logaritmus', '\\log #@', ['logaritmus']),
		sym('ln', 'ln', 'Přirozený logaritmus', '\\ln #@', ['prirozeny logaritmus', 'ln']),
		tpl(
			'nth-root',
			'ⁿ√',
			'Obecná odmocnina',
			'\\sqrt[#@]{#?}',
			['odmocnina', 'n-ta odmocnina', 'sqrt'],
			{
				glyph: 'nth-root'
			}
		),
		tpl('subscript', 'x₁', 'Index', '#@_{#?}', ['index', 'subscript', 'dolni index'], {
			glyph: 'subscript'
		}),
		tpl('abs', '|x|', 'Absolutní hodnota', '\\lvert #@ \\rvert', ['absolutni hodnota', 'abs'], {
			glyph: 'abs'
		}),
		tpl('log-base', 'logₐx', 'Logaritmus se základem', '\\log_{#@} #?', ['logaritmus se zakladem']),
		tpl(
			'interval-closed',
			'⟨a;b⟩',
			'Uzavřený interval',
			'\\langle #@; #? \\rangle',
			['interval', 'uzavreny', 'angle'],
			{ glyph: 'interval' }
		),
		tpl('interval-open', '(a;b)', 'Otevřený interval', '(#@; #?)', ['interval', 'otevreny'], {
			glyph: 'interval'
		}),
		tpl(
			'interval-left-open',
			'⟨a;b)',
			'Interval otevřený vlevo',
			'\\langle #@; #? )',
			['interval', 'polouzavreny'],
			{ glyph: 'interval' }
		),
		tpl(
			'interval-right-open',
			'(a;b⟩',
			'Interval otevřený vpravo',
			'(#@; #? \\rangle',
			['interval', 'polouzavreny'],
			{ glyph: 'interval' }
		),
		tpl(
			'cases',
			'{…',
			'Soustava rovnic',
			'\\begin{cases} #@ \\\\ #? \\end{cases}',
			['soustava', 'cases', 'system'],
			{ glyph: 'cases' }
		),
		tpl('parens', '( )', 'Kulaté závorky', '\\left( #@ \\right)', ['zavorky', 'kulate zavorky'])
	]
};

/** §4.3, tab 3 — Geometrie a goniometrie. */
const TAB_GEOMETRIE: TabDef = {
	id: 'geometrie',
	label: '∢',
	name: 'Geometrie a goniometrie',
	keys: [
		sym('measuredangle', '∢', 'Úhel', '\\measuredangle #@', ['uhel', 'measuredangle', 'angle'], {
			glyph: 'angle'
		}),
		sym('triangle', '△', 'Trojúhelník', '\\triangle #@', ['trojuhelnik', 'triangle'], {
			glyph: 'triangle'
		}),
		sym('parallel', '∥', 'Rovnoběžné', '\\parallel', ['rovnobezne', 'parallel']),
		sym('nparallel', '∦', 'Nerovnoběžné', '\\nparallel', ['nerovnobezne']),
		sym('perp', '⊥', 'Kolmé', '\\perp', ['kolme', 'perpendicular']),
		sym('cong', '≅', 'Shodné', '\\cong', ['shodne', 'shodnost']),
		sym('sim', '∼', 'Podobné', '\\sim', ['podobne', 'sim']),
		sym('degree', '°', 'Stupeň', '^{\\circ}', ['stupen', 'uhel stupne', 'degree']),
		sym('minute', '′', 'Úhlová minuta', '^{\\prime}', ['minuta', 'prime']),
		sym('second', '″', 'Úhlová vteřina', '^{\\prime\\prime}', ['vterina', 'second']),
		sym('mapsto', '↦', 'Polopřímka', '\\mapsto #@', ['poloprimka', 'ray', 'mapsto']),
		sym('geo-alpha', 'α', 'Alfa', '\\alpha', ['alfa', 'alpha', 'uhel alfa']),
		sym('geo-beta', 'β', 'Beta', '\\beta', ['beta']),
		sym('geo-gamma', 'γ', 'Gama', '\\gamma', ['gama', 'gamma']),
		sym('geo-delta', 'δ', 'Delta', '\\delta', ['delta']),
		sym('geo-phi', 'φ', 'Fí', '\\varphi', ['fi', 'phi', 'fí'], {
			variants: [{ label: 'ϕ', name: 'Fí (druhá podoba)', insert: '\\phi' }]
		}),
		sym('geo-omega', 'ω', 'Omega', '\\omega', ['omega']),
		sym('geo-pi', 'π', 'Pí', '\\pi', ['pi']),
		sym('cdot-g', '·', 'Skalární součin', '\\cdot', ['skalarni soucin', 'dot']),
		sym('times-g', '×', 'Vektorový součin', '\\times', ['vektorovy soucin', 'cross', 'krizek']),
		sym('sin', 'sin', 'Sinus', '\\sin #@', ['sinus', 'sin']),
		sym('cos', 'cos', 'Kosinus', '\\cos #@', ['kosinus', 'cos']),
		sym('tg', 'tg', 'Tangens', '\\operatorname{tg} #@', ['tangens', 'tg', 'tan']),
		sym('cotg', 'cotg', 'Kotangens', '\\operatorname{cotg} #@', ['kotangens', 'cotg', 'cot']),
		sym('arcsin', 'arcsin', 'Arkussinus', '\\arcsin #@', ['arkussinus', 'arcsin']),
		sym('arccos', 'arccos', 'Arkuskosinus', '\\arccos #@', ['arkuskosinus', 'arccos']),
		sym('arctg', 'arctg', 'Arkustangens', '\\operatorname{arctg} #@', ['arkustangens', 'arctg']),
		sym('arccotg', 'arccotg', 'Arkuskotangens', '\\operatorname{arccotg} #@', [
			'arkuskotangens',
			'arccotg'
		]),
		tpl(
			'segment-length',
			'|AB|',
			'Délka úsečky',
			'\\lvert #@ \\rvert',
			['delka usecky', 'abs', 'vzdalenost'],
			{ glyph: 'abs' }
		),
		tpl('overline', 'AB‾', 'Úsečka, oblouk, perioda', '\\overline{#@}', [
			'preškrtnuto',
			'usecka',
			'oblouk',
			'periodicke cislo',
			'overline'
		]),
		tpl('vec', 'u⃗', 'Vektor', '\\vec{#@}', ['vektor', 'sipicka', 'vec'], { glyph: 'vector' }),
		tpl('point', 'A[;]', 'Bod se souřadnicemi', '#@[#?; #@]', [
			'bod',
			'souradnice',
			'point',
			'a[1;2]'
		]),
		tpl('vec-coords-2', '(u₁;u₂)', 'Souřadnice vektoru 2D', '(#@; #?)', [
			'souradnice vektoru',
			'vektor 2d'
		]),
		tpl('vec-coords-3', '(u₁;u₂;u₃)', 'Souřadnice vektoru 3D', '(#@; #?; #@)', [
			'souradnice vektoru',
			'vektor 3d'
		])
	]
};

/** §4.3, tab 4 — Množiny a logika. */
const TAB_MNOZINY: TabDef = {
	id: 'mnoziny',
	label: '∈',
	name: 'Množiny a logika',
	keys: [
		sym('in', '∈', 'Je prvkem', '\\in', ['je prvkem', 'in', 'element']),
		sym('notin', '∉', 'Není prvkem', '\\notin', ['neni prvkem']),
		sym('subset', '⊂', 'Podmnožina', '\\subset', ['podmnozina', 'subset']),
		sym('subseteq', '⊆', 'Podmnožina nebo rovno', '\\subseteq', ['podmnozina nebo rovno']),
		sym('nsubseteq', '⊄', 'Není podmnožina', '\\nsubseteq', ['neni podmnozina']),
		sym('cup', '∪', 'Sjednocení', '\\cup', ['sjednoceni', 'union']),
		sym('cap', '∩', 'Průnik', '\\cap', ['prunik', 'intersection']),
		sym('setminus', '∖', 'Rozdíl množin', '\\setminus', ['rozdil mnozin', 'minus']),
		sym('emptyset', '∅', 'Prázdná množina', '\\emptyset', ['prazdna mnozina', 'empty']),
		sym('complement', 'A′', 'Doplněk množiny', '#@^{\\prime}', ['doplnek', 'complement']),
		sym('wedge', '∧', 'A (konjunkce)', '\\wedge', ['a', 'konjunkce', 'and']),
		sym('vee', '∨', 'Nebo (disjunkce)', '\\vee', ['nebo', 'disjunkce', 'or']),
		sym('neg', '¬', 'Negace', '\\neg #@', ['negace', 'not', '¬']),
		sym('Rightarrow', '⇒', 'Implikace', '\\Rightarrow', ['implikace', 'implies', '⇒']),
		sym('Leftrightarrow', '⇔', 'Ekvivalence', '\\Leftrightarrow', ['ekvivalence', 'iff', '⇔']),
		sym('forall', '∀', 'Pro každé', '\\forall', ['pro kazde', 'for all', '∀']),
		sym('exists', '∃', 'Existuje', '\\exists', ['existuje', 'exists', '∃']),
		tpl('set-builder', '{x|…}', 'Množina zadaná podmínkou', '\\{#@; #@\\}', [
			'mnozina',
			'podminka',
			'set builder',
			'vycet podminky'
		]),
		tpl('set-list', '{…}', 'Množina výčtem prvků', '\\{#@, #@\\}', [
			'mnozina',
			'vycet prvku',
			'enumerated'
		]),
		tpl(
			'cardinality',
			'|M|',
			'Mohutnost množiny',
			'\\lvert #@ \\rvert',
			['mohutnost', 'cardinality', 'abs'],
			{ glyph: 'abs' }
		)
	]
};

/** §4.3, tab 5 — Pokročilé. */
const TAB_POKROCILE: TabDef = {
	id: 'pokrocile',
	label: 'Σ',
	name: 'Pokročilé',
	keys: [
		sym('factorial', '!', 'Faktoriál', '!', ['faktorial', 'exklamace']),
		sym('imag-i', 'i', 'Imaginární jednotka', 'i', ['i', 'im']),
		sym('re', 'Re', 'Reálná část', '\\Re', ['realna cast']),
		sym('im', 'Im', 'Imaginární část', '\\Im', ['imaginarni cast']),
		sym('prob', 'P(A)', 'Pravděpodobnost', 'P(#@)', ['pravdepodobnost', 'p(a)', 'udsálost']),
		sym('mean-x', 'x̄', 'Průměr', '\\bar{x}', ['prumer', 'mean', 'carka nad x']),
		sym('sigma', 'σ', 'Směrodatná odchylka', '\\sigma', ['sigma', 'odchylka']),
		sym('s2', 's²', 'Rozptyl', 's^{2}', ['rozptyl', 'variance']),
		sym('mo', 'Mo', 'Modus', '\\mathrm{Mo}', ['modus', 'nejcastejsi hodnota']),
		sym('me', 'Me', 'Medián', '\\mathrm{Me}', ['median']),
		sym('dx', 'dx', 'Diferenciál dx', '\\mathrm{d}x', ['dx', 'diferencial']),
		sym('approx', '≈', 'Přibližně rovno (≈)', '\\approx', ['priblizne', 'approx']),
		sym('propto', '∝', 'Přímo úměrné', '\\propto', ['primo umerne', 'propto']),
		tpl(
			'binom',
			'(n k)',
			'Kombinační číslo „n nad k“',
			'\\binom{#@}{#?}',
			['n nad k', 'kombinacni cislo', 'binom', 'nad'],
			{ glyph: 'binom' }
		),
		tpl('variation', 'V(k,n)', 'Variace', 'V(#@, #?)', ['variace', 'v', 'variation']),
		tpl('combination', 'K(k,n)', 'Kombinace', 'K(#@, #?)', ['kombinace', 'k', 'combination']),
		tpl('permutation', 'P(n)', 'Permutace', 'P(#@)', ['permutace', 'p']),
		tpl('sum', 'Σ', 'Sumace', '\\sum_{#@}^{#?} #@', ['suma', 'soucet', 'sum', 'sigma'], {
			glyph: 'sum'
		}),
		tpl('product', 'Π', 'Produkce', '\\prod_{#@}^{#?} #@', ['produkt', 'soucin', 'product'], {
			glyph: 'product'
		}),
		tpl('seq-term', 'aₙ', 'Člen posloupnosti', 'a_{#@}', ['clen posloupnosti', 'a n']),
		tpl('sequence', '(aₙ)', 'Posloupnost', '(a_{n})_{n=1}^{\\infty}', ['posloupnost', 'sequence']),
		tpl('limit', 'lim', 'Limita', '\\lim_{#@ \\to #?} #@', ['limita', 'lim', 'limit'], {
			glyph: 'limit'
		}),
		tpl('derivative', 'f′(x)', 'Derivace', "#@'(#?)", ['derivace', 'derivative']),
		tpl('derivative2', 'f″(x)', 'Druhá derivace', "#@''(#?)", ['druha derivace']),
		tpl(
			'integral',
			'∫',
			'Neurčitý integrál',
			'\\int #@ \\,\\mathrm{d}x',
			['integral', 'int', 'neurcity'],
			{ glyph: 'integral' }
		),
		tpl(
			'integral-def',
			'∫ₐᵇ',
			'Určitý integrál',
			'\\int_{#@}^{#?} #@ \\,\\mathrm{d}x',
			['urcity integral', 'definite'],
			{ glyph: 'integral' }
		),
		tpl('conjugate', 'z̄', 'Komplexně sdružené', '\\bar{#@}', ['sdruzene', 'conjugate', 'carka']),
		tpl('matrix-2', '2×2', 'Matice 2×2', '\\begin{pmatrix} #@ & #@ \\\\ #@ & #@ \\end{pmatrix}', [
			'matice',
			'matrix',
			'determinant',
			'2x2'
		]),
		tpl(
			'matrix-3',
			'3×3',
			'Matice 3×3',
			'\\begin{pmatrix} #@ & #@ & #@ \\\\ #@ & #@ & #@ \\\\ #@ & #@ & #@ \\end{pmatrix}',
			['matice', 'matrix', 'determinant', '3x3']
		)
	]
};

/** §4.3, tab 6 — Řecká písmena. Czech textbooks use \varepsilon and \varphi by default. */
const GREEK_LOWER: [string, string, string, string, string[]][] = [
	['gr-alpha', 'α', 'Alfa', '\\alpha', ['alfa']],
	['gr-beta', 'β', 'Beta', '\\beta', ['beta']],
	['gr-gamma', 'γ', 'Gama', '\\gamma', ['gama']],
	['gr-delta', 'δ', 'Delta', '\\delta', ['delta']],
	['gr-epsilon', 'ε', 'Epsilon', '\\varepsilon', ['epsilon']],
	['gr-zeta', 'ζ', 'Zéta', '\\zeta', ['zeta']],
	['gr-eta', 'η', 'Éta', '\\eta', ['eta']],
	['gr-theta', 'θ', 'Théta', '\\theta', ['theta', 'téta']],
	['gr-iota', 'ι', 'Ióta', '\\iota', ['iota']],
	['gr-kappa', 'κ', 'Kapa', '\\kappa', ['kappa']],
	['gr-lambda', 'λ', 'Lambda', '\\lambda', ['lambda']],
	['gr-mu', 'μ', 'Mí', '\\mu', ['mu', 'mí']],
	['gr-nu', 'ν', 'Ný', '\\nu', ['nu', 'ný']],
	['gr-xi', 'ξ', 'Ksí', '\\xi', ['xi', 'ksí']],
	['gr-omicron', 'ο', 'Omikron', '\\omicron', ['omikron']],
	['gr-pi', 'π', 'Pí', '\\pi', ['pi', 'pí']],
	['gr-rho', 'ρ', 'Ró', '\\rho', ['rho', 'ró']],
	['gr-sigma', 'σ', 'Sigma', '\\sigma', ['sigma']],
	['gr-tau', 'τ', 'Tau', '\\tau', ['tau']],
	['gr-upsilon', 'υ', 'Ypsilon', '\\upsilon', ['upsilon', 'ypsilon']],
	['gr-phi', 'φ', 'Fí', '\\varphi', ['phi', 'fí']],
	['gr-chi', 'χ', 'Chí', '\\chi', ['chi', 'chí']],
	['gr-psi', 'ψ', 'Psí', '\\psi', ['psi', 'psí']],
	['gr-omega', 'ω', 'Omega', '\\omega', ['omega']]
];
const GREEK_UPPER: [string, string, string, string, string[]][] = [
	['gr-Gamma', 'Γ', 'Gama velké', '\\Gamma', ['gama velke']],
	['gr-Delta', 'Δ', 'Delta velké', '\\Delta', ['delta velke']],
	['gr-Theta', 'Θ', 'Théta velké', '\\Theta', ['theta velke']],
	['gr-Lambda', 'Λ', 'Lambda velké', '\\Lambda', ['lambda velke']],
	['gr-Pi', 'Π', 'Pí velké', '\\Pi', ['pi velke']],
	['gr-Sigma', 'Σ', 'Sigma velké', '\\Sigma', ['sigma velke']],
	['gr-Phi', 'Φ', 'Fí velké', '\\Phi', ['phi velke']],
	['gr-Psi', 'Ψ', 'Psí velké', '\\Psi', ['psi velke']],
	['gr-Omega', 'Ω', 'Omega velké', '\\Omega', ['omega velke']]
];
const TAB_RECKA: TabDef = {
	id: 'recka',
	label: 'αβ',
	name: 'Řecká písmena',
	keys: [
		...GREEK_LOWER.map(([id, label, name, insert, aliases]) =>
			sym(id, label, name, insert, aliases, {
				variants:
					id === 'gr-epsilon'
						? [{ label: 'ϵ', name: 'Epsilon (druhá podoba)', insert: '\\epsilon' }]
						: id === 'gr-phi'
							? [{ label: 'ϕ', name: 'Fí (druhá podoba)', insert: '\\phi' }]
							: undefined
			})
		),
		...GREEK_UPPER.map(([id, label, name, insert, aliases]) =>
			sym(id, label, name, insert, aliases)
		)
	]
};

/**
 * §4.3, tab 7 — Fyzika. Unit keys insert upright (`\mathrm{…}`); the number+unit template
 * groups the unit into one `\mathrm{}` and separates it from the number with `\,` (§5.2).
 */
const UNITS: [string, string, string, string, string[]][] = [
	['u-m', 'm', 'Metr', 'm', ['metr']],
	['u-s', 's', 'Sekunda', 's', ['sekunda']],
	['u-kg', 'kg', 'Kilogram', 'kg', ['kilogram']],
	['u-g', 'g', 'Gram', 'g', ['gram']],
	['u-N', 'N', 'Newton', 'N', ['newton']],
	['u-J', 'J', 'Joule', 'J', ['joule']],
	['u-W', 'W', 'Watt', 'W', ['watt']],
	['u-Pa', 'Pa', 'Pascal', 'Pa', ['pascal']],
	['u-V', 'V', 'Volt', 'V', ['volt']],
	['u-A', 'A', 'Ampér', 'A', ['amper']],
	['u-ohm', 'Ω', 'Ohm', '\\Omega', ['ohm']],
	['u-Hz', 'Hz', 'Hertz', 'Hz', ['hertz']],
	['u-K', 'K', 'Kelvin', 'K', ['kelvin']],
	[
		'u-degC',
		'°C',
		'Stupeň Celsia',
		'{}^{\\circ}\\mathrm{C}',
		['celsius', 'stupne celsia', 'teplota']
	],
	['u-mol', 'mol', 'Mol', 'mol', ['mol']],
	['u-l', 'l', 'Litr', 'l', ['litr']],
	['u-C', 'C', 'Coulomb', 'C', ['coulomb']],
	['u-T', 'T', 'Tesla', 'T', ['tesla']],
	['u-eV', 'eV', 'Elektronvolt', 'eV', ['elektronvolt']],
	['u-h', 'h', 'Hodina', 'h', ['hodina']],
	['u-min', 'min', 'Minuta', 'min', ['minuta']]
];
const PREFIXES: [string, string, string, string, string[]][] = [
	['p-G', 'G', 'Giga', 'G', ['giga']],
	['p-M', 'M', 'Mega', 'M', ['mega']],
	['p-k', 'k', 'Kilo', 'k', ['kilo']],
	['p-c', 'c', 'Centi', 'c', ['centi']],
	['p-m', 'm', 'Mili', 'm', ['mili']],
	['p-mu', 'μ', 'Mikro', '\\mu', ['mikro', 'u']],
	['p-n', 'n', 'Nano', 'n', ['nano']]
];
const TAB_FYZIKA: TabDef = {
	id: 'fyzika',
	label: 'm/s',
	name: 'Fyzika',
	keys: [
		tpl(
			'sci-notation',
			'·10ⁿ',
			'Vědecký zápis (·)',
			'#@ \\cdot 10^{#?}',
			['vedecky zapis', 'nasobek deseti', 'sci', '10 na'],
			{ note: 'The × variant comes from the scientific-notation setting (§3).' }
		),
		tpl('sci-notation-x', '×10ⁿ', 'Vědecký zápis (×)', '#@ \\times 10^{#?}', [
			'vedecky zapis',
			'krat'
		]),
		tpl(
			'number-unit',
			'5 m',
			'Číslo s jednotkou',
			'#@ \\,#?',
			['jednotka', 'unit', 'cislo s jednotkou'],
			{
				// The unit placeholder is plain: unit keys insert `\mathrm{…}` groups into it,
				// and `toAppLatex` merges them into one `\mathrm{m\cdot s^{-1}}` (§6).
				note: 'MathLive drops a \\mathrm around a placeholder, so the unit is filled with unit keys and merged on write.'
			}
		),
		tpl('unit-of', '[v] =', 'Jednotka veličiny', '[#@] = #?', [
			'jednotka veličiny',
			'hranate zavorky'
		]),
		tpl('vec-f', 'u⃗', 'Vektor', '\\vec{#@}', ['vektor', 'vec']),
		tpl('vec-mag', '|u⃗|', 'Velikost vektoru', '\\lvert \\vec{#@} \\rvert', [
			'velikost vektoru',
			'abs'
		]),
		tpl('delta', 'Δ', 'Změna', '\\Delta #@', ['změna', 'delta', 'rozdil']),
		tpl('nuclide', '²³⁵₉₂U', 'Nuklid', '{}^{#@}_{#?}#@', ['nuklid', 'jadro', 'izotop']),
		tpl('average', 'x̄', 'Průměrná hodnota', '\\bar{#@}', ['prumer', 'mean']),
		...UNITS.map(([id, label, name, insert, aliases]) =>
			sym(
				id,
				label,
				name,
				// Plain letters go upright inside \mathrm{}; °C already carries its own upright C.
				insert.includes('\\') || insert.includes('{') ? insert : `\\mathrm{${insert}}`,
				[...aliases, 'jednotka']
			)
		),
		...PREFIXES.map(([id, label, name, insert, aliases]) =>
			sym(id, label, `${name} (předpona)`, `\\mathrm{${insert}}`, [
				...aliases,
				'jednotka',
				'predpona'
			])
		),
		sym('u-cdot', '·', 'Jednotky krát', '\\cdot', ['jednotky krat', 'tecka']),
		sym('u-slash', '/', 'Jednotky děleno', '/', ['jednotky deleno', 'lomeno', 'na']),
		tpl('u-power', 's⁻¹', 'Jednotka mocniny', '#@^{#?}', ['mocnina jednotky']),
		sym('u-inv', '⁻¹', 'Jednotka na minus první', '^{-1}', [
			'na minus prvni',
			'prevracena hodnota'
		]),
		sym('f-Delta', 'Δ', 'Delta velké', '\\Delta', ['delta']),
		sym('f-lambda', 'λ', 'Vlnová délka', '\\lambda', ['lambda', 'vlnova delka']),
		sym('f-rho', 'ρ', 'Hustota', '\\rho', ['rho', 'hustota']),
		sym('f-eta', 'η', 'Účinnost', '\\eta', ['eta', 'ucinnost']),
		sym('f-omega', 'ω', 'Úhlová rychlost', '\\omega', ['omega', 'uhlova rychlost']),
		sym('f-degree', '°', 'Stupeň', '^{\\circ}', ['stupen']),
		sym('f-doteq', '≐', 'Rovná se přibližně', '\\doteq', ['priblizne rovno']),
		sym('f-sim', '∼', 'Podobné', '\\sim', ['podobne']),
		sym('f-propto', '∝', 'Přímo úměrné', '\\propto', ['primo umerne']),
		sym('f-to', '→', 'Šipka', '\\to', ['sipka', 'to', 'rovna se pres']),
		sym('f-hbar', 'ħ', 'Redukovaná Planckova konstanta', '\\hbar', ['hbar', 'planck']),
		sym('e-minus', 'e⁻', 'Elektron', 'e^{-}', ['elektron', 'e minus'], {
			note: 'mhchem writes it e^-; plain math e^{-} renders the same in both renderers.'
		}),
		sym('p-plus', 'p⁺', 'Proton', 'p^{+}', ['proton']),
		sym('n-zero', 'n⁰', 'Neutron', 'n^{0}', ['neutron']),
		sym('f-gamma', 'γ', 'Gama záření', '\\gamma', ['gama zareni']),
		sym('f-nu', 'ν', 'Neutrino', '\\nu', ['neutrino']),
		sym('f-beta-minus', 'β⁻', 'Beta záření (elektron)', '\\beta^{-}', ['beta minus']),
		sym('f-beta-plus', 'β⁺', 'Beta plus (pozitron)', '\\beta^{+}', ['beta plus'])
	]
};

/**
 * §4.3, tab 8 — Chemie. A separate mode: the structure keys insert a `\ce{…}` node
 * (mhchem) and keep the caret inside it; the symbol keys write mhchem tokens, which only
 * mean something inside `\ce{…}` — digits after an element symbol become subscripts in the
 * renderer itself. The editor draws `\ce` with KaTeX's mhchem contrib; the app's
 * flutter_math_fork has no mhchem yet, so `\ce` is an app-side gap (OPEN-PROBLEMS).
 */
const CE_NOTE =
	'Editor: KaTeX + mhchem. App: flutter_math_fork zatím neumí \\ce — app-side gap (OPEN-PROBLEMS).';
const TAB_CHEMIE: TabDef = {
	id: 'chemie',
	label: 'H₂O',
	name: 'Chemie',
	keys: [
		// Chem mode (§4.3 tab 8): the tab opens a `\ce{…}` node and every key types its
		// mhchem source into it — MathLive cannot edit inside a `\ce{}` atom, so the field
		// rewrites the whole node per key (`mathfield.ts` chem mode). Digits after an
		// element symbol become subscripts in the renderer itself.
		...digits('cdigit'),
		sym('ce-arrow', '→', 'Šipka reakce', '->', ['sipka', 'reakce', 'arrow'], { note: CE_NOTE }),
		sym(
			'ce-equilibrium',
			'⇌',
			'Rovnovážná šipka',
			'<=>',
			['rovnovaha', 'rovnovazna sipka', 'equilibrium'],
			{ note: CE_NOTE }
		),
		sym('ce-resonance', '↔', 'Rezonanční šipka', '<->', ['rezonance', 'obousmerna sipka'], {
			note: CE_NOTE
		}),
		sym('ce-plus', '+', 'Plus', '+', ['plus', 'soucet']),
		sym('ce-gas', '↑', 'Plyn (vznáší se)', '^', ['plyn', 'gas', 'sipka nahoru'], { note: CE_NOTE }),
		sym('ce-precip', '↓', 'Sraženina', 'v', ['srazenina', 'precipitate', 'sipka dolu'], {
			note: CE_NOTE
		}),
		sym('ce-state-s', '(s)', 'Pevná látka', '(s)', ['pevna latka', 'solid']),
		sym('ce-state-l', '(l)', 'Kapalina', '(l)', ['kapalina', 'liquid']),
		sym('ce-state-g', '(g)', 'Plynné skupenství', '(g)', ['plyn', 'gas state']),
		sym('ce-state-aq', '(aq)', 'Vodný roztok', '(aq)', ['vodny roztok', 'aqueous']),
		sym('ce-charge-plus', 'x⁺', 'Náboj +', '^{+}', ['naboj', 'kladny', 'charge plus'], {
			note: CE_NOTE
		}),
		sym('ce-charge-minus', 'x⁻', 'Náboj −', '^{-}', ['naboj', 'zaporny', 'charge minus'], {
			note: CE_NOTE
		}),
		sym('ce-charge-2plus', 'x²⁺', 'Náboj 2+', '^{2+}', ['naboj 2 plus'], { note: CE_NOTE }),
		sym('ce-charge-2minus', 'x²⁻', 'Náboj 2−', '^{2-}', ['naboj 2 minus'], { note: CE_NOTE }),
		sym('ce-charge-3plus', 'x³⁺', 'Náboj 3+', '^{3+}', ['naboj 3 plus'], { note: CE_NOTE }),
		sym('ce-charge-3minus', 'x³⁻', 'Náboj 3−', '^{3-}', ['naboj 3 minus'], { note: CE_NOTE }),
		sym('ce-ox-I', '^I', 'Oxidační číslo I', '^{I}', ['oxidacni cislo', 'jedna'], {
			note: CE_NOTE
		}),
		sym('ce-ox-II', '^II', 'Oxidační číslo II', '^{II}', ['oxidacni cislo', 'dve'], {
			note: CE_NOTE
		}),
		sym('ce-ox-III', '^III', 'Oxidační číslo III', '^{III}', ['oxidacni cislo', 'tri'], {
			note: CE_NOTE
		}),
		sym('ce-ox-IV', '^IV', 'Oxidační číslo IV', '^{IV}', ['oxidacni cislo', 'ctyri'], {
			note: CE_NOTE
		}),
		sym('ce-ox-V', '^V', 'Oxidační číslo V', '^{V}', ['oxidacni cislo', 'pet'], { note: CE_NOTE }),
		sym('ce-ox-VI', '^VI', 'Oxidační číslo VI', '^{VI}', ['oxidacni cislo', 'sest'], {
			note: CE_NOTE
		}),
		sym('ce-ox-VII', '^VII', 'Oxidační číslo VII', '^{VII}', ['oxidacni cislo', 'sedm'], {
			note: CE_NOTE
		}),
		sym('ce-ox-VIII', '^VIII', 'Oxidační číslo VIII', '^{VIII}', ['oxidacni cislo', 'osm'], {
			note: CE_NOTE
		}),
		sym('ce-ox-mI', '^−I', 'Oxidační číslo −I', '^{-I}', ['oxidacni cislo minus jedna'], {
			note: CE_NOTE
		}),
		sym('ce-ox-mII', '^−II', 'Oxidační číslo −II', '^{-II}', ['oxidacni cislo minus dve'], {
			note: CE_NOTE
		}),
		sym('ce-ox-mIII', '^−III', 'Oxidační číslo −III', '^{-III}', ['oxidacni cislo minus tri'], {
			note: CE_NOTE
		}),
		sym('ce-ox-mIV', '^−IV', 'Oxidační číslo −IV', '^{-IV}', ['oxidacni cislo minus ctyri'], {
			note: CE_NOTE
		}),
		sym('ce-electron', 'e⁻', 'Elektron', 'e^{-}', ['elektron'], { note: CE_NOTE }),
		sym('ce-hydrate', '·', 'Hydrátová tečka', '*', ['hydrat', 'tepka', 'dot'], { note: CE_NOTE }),
		sym('ce-bracket-l', '[', 'Hranatá závorka otevírací', '[', [
			'hranata zavorka',
			'koncentrace',
			'komplex'
		]),
		sym('ce-bracket-r', ']', 'Hranatá závorka zavírací', ']', ['hranata zavorka']),
		// Outside the chem node these are ordinary math (§4.3 tab 8).
		sym('ph', 'pH', 'pH', '\\mathrm{pH}', ['ph', 'kyselost'], { outside: true }),
		tpl('c-n-V', 'c = n/V', 'Koncentrace', 'c = \\frac{n}{V}', ['koncentrace', 'c', 'n lomeno v'], {
			outside: true
		}),
		sym('k-eq', 'K', 'Rovnovážná konstanta', 'K', ['rovnovazna konstanta'], { outside: true }),
		sym('kc', 'K_c', 'Koncentrace v rovnováze', 'K_{c}', ['kc', 'koncentracni konstanta'], {
			outside: true
		}),
		sym('ka', 'K_a', 'Konstanta kyselosti', 'K_{a}', ['ka', 'kyselost konstanta'], {
			outside: true
		}),
		sym('rate', 'v', 'Rychlost reakce', 'v', ['rychlost reakce'], { outside: true })
	]
};

export const TABS: TabDef[] = [
	TAB_ZAKLAD,
	TAB_ALGEBRA,
	TAB_GEOMETRIE,
	TAB_MNOZINY,
	TAB_POKROCILE,
	TAB_RECKA,
	TAB_FYZIKA,
	TAB_CHEMIE
];

export const TAB_BY_ID = new Map(TABS.map((t) => [t.id, t]));

/** §4.2 — subject profiles: which tabs are visible, in what order. */
export type ProfileId = 'zs' | 'ss' | 'fyzika' | 'chemie' | 'vse';

export interface ProfileDef {
	id: ProfileId;
	name: string;
	tabs: string[];
}

export const PROFILES: ProfileDef[] = [
	{ id: 'zs', name: 'Matematika ZŠ', tabs: ['zaklad', 'algebra', 'geometrie', 'recka'] },
	{
		id: 'ss',
		name: 'Matematika SŠ',
		tabs: ['zaklad', 'algebra', 'geometrie', 'mnoziny', 'pokrocile', 'recka']
	},
	{ id: 'fyzika', name: 'Fyzika', tabs: ['zaklad', 'fyzika', 'algebra', 'geometrie', 'recka'] },
	{ id: 'chemie', name: 'Chemie', tabs: ['zaklad', 'chemie', 'algebra', 'recka'] },
	{
		id: 'vse',
		name: 'Vše',
		tabs: ['zaklad', 'algebra', 'geometrie', 'mnoziny', 'pokrocile', 'recka', 'fyzika', 'chemie']
	}
];

export const PROFILE_BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

/** All keys of all tabs, fixed keys excluded — the search index and the recent row use it. */
export const ALL_KEYS: KeyDef[] = TABS.flatMap((t) => t.keys);
export const KEY_BY_ID = new Map(ALL_KEYS.map((k) => [k.id, k]));

/** Lower case without diacritics, so „uhel“ finds „Úhel“. Same rule as the settings search. */
export function foldCs(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

export interface SearchHit {
	key: KeyDef;
	tab: TabDef;
	/** Which word matched, for the result line. */
	matched: string;
}

/**
 * §5.3 — match a query against Czech names and aliases, without diacritics. Every word of
 * the query must appear in the folded name or in one of the folded aliases.
 */
export function searchKeys(query: string, tabs: TabDef[] = TABS): SearchHit[] {
	const words = foldCs(query)
		.split(/\s+/)
		.filter((w) => w !== '');
	if (words.length === 0) return [];
	const hits: SearchHit[] = [];
	for (const tab of tabs) {
		for (const key of tab.keys) {
			const haystack = [key.name, ...key.aliases, key.label].map(foldCs);
			const matched = words.find((w) => haystack.some((h) => h.includes(w)));
			if (matched !== undefined && words.every((w) => haystack.some((h) => h.includes(w)))) {
				hits.push({ key, tab, matched });
			}
		}
	}
	return hits;
}
