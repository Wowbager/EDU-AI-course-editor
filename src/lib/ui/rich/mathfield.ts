/**
 * The formula row's visual editor: MathLive, where `1/2` becomes a fraction as it is
 * typed and an on-screen keyboard holds what a keyboard lacks. Loaded the first time a
 * formula is opened, so a course without any never fetches it.
 *
 * Its fonts are KaTeX's, which `katex.min.css` already brings in for the formulas in
 * the text, so MathLive loads none of its own and nothing comes from its CDN.
 */
import type { MathfieldElement } from 'mathlive';
import { toAppLatex } from '$lib/domain/app-latex';

type MathLive = typeof import('mathlive');
let mathlive: Promise<MathLive> | null = null;
function loadMathLive(): Promise<MathLive> {
	mathlive ??= Promise.all([import('mathlive'), import('katex/dist/katex.min.css')]).then(
		([module]) => {
			const { MathfieldElement } = module;
			MathfieldElement.fontsDirectory = null;
			MathfieldElement.soundsDirectory = null;
			MathfieldElement.keypressSound = null;
			MathfieldElement.plonkSound = null;
			MathfieldElement.locale = 'cs';
			MathfieldElement.strings = {
				cs: { 'tooltip.undo': 'Zpět', 'tooltip.redo': 'Znovu', 'tooltip.menu': 'Nabídka' }
			};
			return module;
		},
		(error) => {
			// A dropped connection: the next formula tries again.
			mathlive = null;
			throw error;
		}
	);
	return mathlive;
}

export interface MathFieldParams {
	latex: string;
	label: string;
	/** The formula as the app should store it, on every change in the field. */
	oninput: (latex: string) => void;
	/** Enter: the formula is done. */
	ondone: () => void;
	/** The field could not read the formula it was given. */
	onunreadable: () => void;
}

/** Ctrl+Z and Ctrl+Y belong to the store, as in every other field. */
const UNDO = new Set(['undo', 'redo']);

/** Mount a MathLive field in `host` and keep it showing `latex`. */
export function mathField(host: HTMLElement, initial: MathFieldParams) {
	let params = initial;
	let field: MathfieldElement | null = null;
	let destroyed = false;

	const written = () => (field ? toAppLatex(field.getValue('latex-expanded')) : params.latex);
	/** What the row last heard from the field, or set in it: only a change is written. */
	let seen = params.latex;
	const send = () => {
		const now = written();
		if (now === seen) return;
		seen = now;
		params.oninput(now);
	};

	loadMathLive().then(
		({ MathfieldElement }) => {
			if (destroyed) return;
			const mf = new MathfieldElement();
			mf.setAttribute('aria-label', params.label);
			mf.dataset.undo = 'course';
			mf.mathVirtualKeyboardPolicy = 'manual';
			// Options read the field's state, so they are set once it is in the page.
			host.append(mf);
			mf.menuItems = [];
			mf.keybindings = mf.keybindings.filter((binding) => {
				const command = Array.isArray(binding.command) ? binding.command[0] : binding.command;
				return !UNDO.has(String(command));
			});
			mf.value = params.latex;
			mf.addEventListener('input', send);
			// On blur, as Hotovo is pressed: the keys it still held arrive with it.
			mf.addEventListener('change', send);
			mf.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					// MathLive holds typed keys a moment (for shortcuts like `sqrt`) before its
					// `input`; a quick Enter would close the row on the formula before them.
					send();
					params.ondone();
				}
			});
			field = mf;
			seen = written();
			if (mf.errors.length > 0) params.onunreadable();
			mf.focus();
		},
		() => {
			// No visual editor: the LaTeX box still edits the formula.
			if (!destroyed) params.onunreadable();
		}
	);

	return {
		update(next: MathFieldParams) {
			params = next;
			// A change from the LaTeX box; the field's own typing is already there.
			if (field && next.latex !== written()) {
				field.value = next.latex;
				seen = written();
			}
		},
		destroy() {
			destroyed = true;
			field?.remove();
		}
	};
}

/**
 * The keys a school formula needs, in two tabs. Each writes LaTeX the app draws
 * (`toAppLatex` still runs on what the field holds).
 */
/** An operator drawn in the editor's font: MathLive's maths font draws it hairline-thin. */
const op = (label: string, latex: string) => ({ label, latex });

const LAYOUTS = [
	{
		label: 'Čísla',
		tooltip: 'Čísla a početní operace',
		rows: [
			[
				'[7]',
				'[8]',
				'[9]',
				op('·', '\\cdot'),
				'[separator]',
				'\\frac{#@}{#?}',
				'#@^{#?}',
				'\\sqrt{#0}'
			],
			['[4]', '[5]', '[6]', op('÷', '\\div'), '[separator]', '(', ')', '\\pi'],
			['[1]', '[2]', '[3]', op('−', '-'), '[separator]', 'x', 'y', '[backspace]'],
			['[0]', '[.]', op('=', '='), op('+', '+'), '[separator]', '[left]', '[right]', '[return]']
		]
	},
	{
		label: 'Značky',
		tooltip: 'Porovnání, jednotky a další značky',
		rows: [
			[
				op('<', '<'),
				op('>', '>'),
				op('≤', '\\le'),
				op('≥', '\\ge'),
				op('≠', '\\ne'),
				op('≈', '\\approx')
			],
			[
				op('±', '\\pm'),
				op('×', '\\times'),
				op('°', '^{\\circ}'),
				op('%', '\\%'),
				'|#0|',
				'\\sqrt[#0]{#?}'
			],
			['#@_{#?}', '\\alpha', '\\beta', '\\gamma', '[left]', '[right]'],
			['a', 'b', 'c', 'n', '[backspace]', '[return]']
		]
	}
];

let fit: ResizeObserver | null = null;

/** Hide the on-screen keyboard, folding the place it took in the row. */
export function hideMathKeyboard(dock: HTMLElement | null) {
	const keyboard = window.mathVirtualKeyboard;
	if (dock) dock.style.height = '0';
	// The keyboard is one for the page: a row hides it only while it is that row's.
	if (!dock || !keyboard || keyboard.container !== dock) return;
	fit?.disconnect();
	fit = null;
	if (keyboard.visible) keyboard.hide();
}

/**
 * Show or hide the on-screen keyboard for the field in `host`. It opens inside `dock`,
 * under the formula and as wide as the field, not over the page: MathLive lays it out
 * in place in a container, which takes its height.
 */
export function toggleMathKeyboard(host: HTMLElement | null, dock: HTMLElement | null): boolean {
	const keyboard = window.mathVirtualKeyboard;
	if (!keyboard || !dock) return false;
	if (keyboard.visible && keyboard.container === dock) {
		hideMathKeyboard(dock);
		return false;
	}
	// Each of these rebuilds the keyboard, which then forgets the field it types into.
	if (keyboard.layouts !== LAYOUTS) keyboard.layouts = LAYOUTS;
	if (keyboard.editToolbar !== 'none') keyboard.editToolbar = 'none';
	if (keyboard.container !== dock) keyboard.container = dock;
	host?.querySelector<MathfieldElement>('math-field')?.focus();
	keyboard.connect();
	keyboard.show({ animate: false });
	const plate = dock.querySelector<HTMLElement>('.MLK__plate');
	if (plate) {
		let shown = false;
		fit = new ResizeObserver(() => {
			dock.style.height = `${plate.offsetTop + plate.offsetHeight}px`;
			// Once, as it opens, and at once: a key moving under the pointer loses its press.
			if (shown) return;
			shown = true;
			dock.scrollIntoView({ block: 'nearest' });
		});
		fit.observe(plate);
	}
	return true;
}
