/**
 * The acceptance table (§8): a teacher enters each formula with the on-screen keyboard
 * alone — `keys` lists the key ids from `keypad-data.ts` in order (`next` is the
 * Tab/Enter between placeholders; a plain string is a letter typed on the physical
 * keyboard). `expected` is the canonical LaTeX, modulo whitespace.
 *
 * The render/parse test lives in `math-render.test.ts`; the key-press fidelity against
 * the real MathLive field is in `e2e/math-keypad.spec.ts`.
 */

export interface AcceptanceRow {
	n: number;
	formula: string;
	keys: (string | 'next')[];
	expected: string;
}

export const ACCEPTANCE: AcceptanceRow[] = [
	{
		n: 1,
		formula: '3,75 : 1,5 = 2,5',
		keys: [
			'digit-3',
			'decimal-comma',
			'digit-7',
			'digit-5',
			'colon-div',
			'digit-1',
			'decimal-comma',
			'digit-5',
			'equals',
			'digit-2',
			'decimal-comma',
			'digit-5'
		],
		expected: '3{,}75 : 1{,}5 = 2{,}5'
	},
	{
		n: 2,
		formula: '(5/3)⁻² — mocnina zlomku se sama obalí závorkami',
		keys: ['lparen', 'digit-5', 'frac', 'digit-3', 'rparen', 'power', 'minus', 'digit-2'],
		expected: '\\left(\\frac{5}{3}\\right)^{-2}'
	},
	{
		n: 3,
		formula: 'x ∈ ⟨−2; 5)',
		keys: ['x', 'in', 'interval-left-open', 'minus', 'digit-2', 'next', 'digit-5'],
		expected: 'x \\in \\langle -2; 5)'
	},
	{
		n: 4,
		formula: '{x ∈ ℝ; x² ≤ 4}',
		keys: ['set-builder', 'x', 'in', 'real', 'next', 'x', 'power', 'digit-2', 'le', 'digit-4'],
		expected: '\\{x \\in \\mathbb{R};\\ x^{2} \\le 4\\}'
	},
	{
		n: 5,
		formula: 'tg α = sin α / cos α',
		keys: ['tg', 'geo-alpha', 'equals', 'sin', 'geo-alpha', 'frac', 'cos', 'geo-alpha'],
		expected: '\\operatorname{tg} \\alpha = \\frac{\\sin \\alpha}{\\cos \\alpha}'
	},
	{
		n: 6,
		formula: '|∢ABC| = 60°',
		keys: [
			'segment-length',
			'measuredangle',
			'A',
			'B',
			'C',
			'next',
			'equals',
			'digit-6',
			'digit-0',
			'degree'
		],
		expected: '\\lvert \\measuredangle ABC \\rvert = 60^{\\circ}'
	},
	{
		n: 7,
		formula: 'A[1; −3], u⃗ = (2; 4)',
		keys: [
			'A',
			'point',
			'digit-1',
			'next',
			'minus',
			'digit-3',
			',',
			'vec',
			'u',
			'equals',
			'vec-coords-2',
			'digit-2',
			'next',
			'digit-4'
		],
		expected: 'A[1; -3],\\ \\vec{u} = (2; 4)'
	},
	{
		n: 8,
		formula: 'log₂ 8 = 3',
		keys: ['log-base', 'digit-2', 'next', 'digit-8', 'equals', 'digit-3'],
		expected: '\\log_{2} 8 = 3'
	},
	{
		n: 9,
		formula: '(n k) = n! / (k!(n − k)!)',
		keys: [
			'binom',
			'n',
			'next',
			'k',
			'equals',
			'n',
			'factorial',
			'frac',
			'k',
			'factorial',
			'lparen',
			'n',
			'minus',
			'k',
			'rparen',
			'factorial'
		],
		expected: '\\binom{n}{k} = \\frac{n!}{k!\\,(n-k)!}'
	},
	{
		n: 10,
		formula: 'Σ k=1..n k = n(n+1)/2',
		keys: [
			'sum',
			'k',
			'equals',
			'digit-1',
			'next',
			'n',
			'next',
			'k',
			'equals',
			'frac',
			'n',
			'lparen',
			'n',
			'plus',
			'digit-1',
			'rparen',
			'digit-2'
		],
		expected: '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}'
	},
	{
		n: 11,
		formula: 'π ≐ 3,14',
		keys: ['pi', 'doteq', 'digit-3', 'decimal-comma', 'digit-1', 'digit-4'],
		expected: '\\pi \\doteq 3{,}14'
	},
	{
		n: 12,
		formula: '0,3̄ = 1/3',
		keys: [
			'digit-0',
			'decimal-comma',
			'overline',
			'digit-3',
			'equals',
			'frac',
			'digit-1',
			'next',
			'digit-3'
		],
		expected: '0{,}\\overline{3} = \\frac{1}{3}'
	},
	{
		n: 13,
		formula: 'v = 12,5 m·s⁻¹',
		keys: [
			'v',
			'equals',
			'number-unit',
			'digit-1',
			'digit-2',
			'decimal-comma',
			'digit-5',
			'next',
			'u-m',
			'u-cdot',
			'u-s',
			'u-inv'
		],
		expected: 'v = 12{,}5\\,\\mathrm{m\\cdot s^{-1}}'
	},
	{
		n: 14,
		formula: 'c ≐ 3 · 10⁸ m·s⁻¹',
		keys: [
			'c',
			'f-doteq',
			'sci-notation',
			'digit-3',
			'next',
			'digit-8',
			'number-unit',
			'next',
			'u-m',
			'u-cdot',
			'u-s',
			'u-inv'
		],
		expected: 'c \\doteq 3 \\cdot 10^{8}\\,\\mathrm{m\\cdot s^{-1}}'
	},
	{
		n: 15,
		formula: 'ΔT = 20 °C',
		keys: ['delta', 'T', 'equals', 'digit-2', 'digit-0', 'u-degC'],
		expected: '\\Delta T = 20\\,{}^{\\circ}\\mathrm{C}'
	},
	{
		n: 16,
		formula: '²³⁵₉₂U + n → … (chem mode: keys type the mhchem source)',
		keys: ['^{235}_{92}U + n ', 'ce-arrow', ' \\dots'],
		expected: '\\ce{^{235}_{92}U + n -> \\dots}'
	},
	{
		n: 17,
		formula: '2 H₂ + O₂ → 2 H₂O',
		keys: ['digit-2', ' H2 + O2 ', 'ce-arrow', ' digit-2 H2O'],
		expected: '\\ce{2 H2 + O2 -> 2 H2O}'
	},
	{
		n: 18,
		formula: 'N₂ + 3 H₂ ⇌ 2 NH₃',
		keys: ['N2 + 3 H2 ', 'ce-equilibrium', ' 2 NH3'],
		expected: '\\ce{N2 + 3 H2 <=> 2 NH3}'
	},
	{
		n: 19,
		formula: 'SO₄²⁻, Fe^III',
		keys: ['SO4', 'ce-charge-2minus', ', Fe', 'ce-ox-III'],
		expected: '\\ce{SO4^{2-}}, \\ce{Fe^{III}}'
	},
	{
		n: 20,
		formula: 'CaCO₃ →(t) CaO + CO₂↑',
		keys: ['CaCO3 ', '->[t]', ' CaO + CO2 ', 'ce-gas'],
		expected: '\\ce{CaCO3 ->[t] CaO + CO2 ^}'
	},
	{
		n: 21,
		formula: 'CuSO₄·5 H₂O',
		keys: ['CuSO4 ', 'ce-hydrate', ' 5 H2O'],
		expected: '\\ce{CuSO4 * 5 H2O}'
	},
	{
		n: 22,
		formula: 'lim x→0 sin x / x = 1',
		keys: [
			'limit',
			'x',
			'\\to',
			'digit-0',
			'next',
			'frac',
			'sin',
			'x',
			'next',
			'x',
			'equals',
			'digit-1'
		],
		expected: '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'
	},
	{
		n: 23,
		formula: '∫₀¹ x² dx',
		keys: ['integral-def', 'digit-0', 'next', 'digit-1', 'next', 'x', 'power', 'digit-2', 'dx'],
		expected: '\\int_{0}^{1} x^{2}\\,\\mathrm{d}x'
	},
	{
		n: 24,
		formula: 'p ∧ q ⇒ ¬r',
		keys: ['p', 'wedge', 'q', 'Rightarrow', 'neg', 'r'],
		expected: 'p \\wedge q \\Rightarrow \\neg r'
	},
	{
		n: 25,
		formula: 'soustava: x + y = 3, x − y = 1',
		keys: ['cases', 'x + y = 3', 'next', 'x - y = 1'],
		expected: '\\begin{cases} x + y = 3 \\\\ x - y = 1 \\end{cases}'
	}
];
