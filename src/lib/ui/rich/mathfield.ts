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
			if (window.mathVirtualKeyboard?.visible) window.mathVirtualKeyboard.hide();
			field?.remove();
		}
	};
}

/** Show or hide the on-screen keyboard for the field in `host`. */
export function toggleMathKeyboard(host: HTMLElement | null) {
	const keyboard = window.mathVirtualKeyboard;
	if (!keyboard) return;
	if (keyboard.visible) keyboard.hide();
	else {
		host?.querySelector<MathfieldElement>('math-field')?.focus();
		// The keyboard lies over the bottom of the page: keep the formula's row above it.
		const row = host?.closest<HTMLElement>('[role="group"]') ?? host;
		(keyboard as unknown as EventTarget).addEventListener(
			'geometrychange',
			() => {
				if (!row) return;
				row.style.scrollMarginBottom = `${keyboard.boundingRect.height + 16}px`;
				row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			},
			{ once: true }
		);
		keyboard.show({ animate: true });
	}
}
