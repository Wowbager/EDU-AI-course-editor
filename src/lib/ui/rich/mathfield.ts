/**
 * The formula row's visual editor: MathLive, where `1/2` becomes a fraction as it is
 * typed. Loaded the first time a formula is opened, so a course without any never
 * fetches it.
 *
 * Its fonts are KaTeX's, which `katex.min.css` already brings in for the formulas in
 * the text, so MathLive loads none of its own and nothing comes from its CDN.
 *
 * The on-screen keyboard is ours (`MathKeypad.svelte`), not MathLive's: this module
 * only exposes what it needs to type into the field — `insert` LaTeX at the caret and
 * `executeCommand` an editing command.
 */
import type { MathfieldElement, Selector } from 'mathlive';
import { toAppLatex } from '$lib/domain/app-latex';
import { decimalLatex, type MathSettings } from '$lib/domain/math-settings';

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

/** What the row's keypad drives: the field behind it. */
export interface MathFieldApi {
	/**
	 * Insert LaTeX at the caret. The keyboard's placeholder syntax works: `#@`/`#?` are
	 * placeholders the caret jumps to, `#0` the selection.
	 */
	insert: (latex: string) => void;
	/** An editing command, as MathLive's own keyboard sends it: `deleteBackward`, … */
	command: (name: string) => void;
	/** Write out what the field still holds back (typed keys before its `input`). */
	flush: () => void;
	/** Whether the formula still has an empty placeholder to jump to (§5.1 Enter). */
	hasPlaceholders: () => boolean;
	/**
	 * Enter: the next placeholder, and the formula is done only when the caret cannot
	 * advance to another one (§5.1 — an empty placeholder stays in the LaTeX, so "are
	 * there placeholders" alone is never the test).
	 */
	done: () => void;
	/** Whether the caret sits inside a `\ce{…}` group (the chemistry mode, §4.3 tab 8). */
	insideChem: () => boolean;
	/**
	 * Chem mode (§4.3 tab 8): MathLive treats a `\ce{…}` atom as opaque — nothing can be
	 * typed into it — so the mode keeps the mhchem source here and rewrites the whole
	 * node per key. `start` remembers what is before the caret; `type` appends a token
	 * (keypad key or physical key); `backspace` removes the last character; `stop` leaves
	 * the finished `\ce{…}` in the formula.
	 */
	chem: {
		active: () => boolean;
		start: () => void;
		type: (token: string) => void;
		backspace: () => void;
		stop: () => void;
	};
}

export interface MathFieldParams {
	latex: string;
	label: string;
	/** The formula as the app should store it, on every change in the field. */
	oninput: (latex: string) => void;
	/** Enter after the last placeholder: the formula is done. */
	ondone: () => void;
	/** The field could not read the formula it was given. */
	onunreadable: () => void;
	/** Called with the keypad's API once the field is in the page, `null` when it is gone. */
	onbind?: (api: MathFieldApi | null) => void;
	/** Per-course math conventions (§3): decimal separator, … Default: decimal comma. */
	math?: MathSettings;
	/** The `\` key: open the keypad's search palette (§5.3). */
	onsearch?: () => void;
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
			// The keyboard is the row's own (MathKeypad); MathLive's never opens by itself.
			mf.mathVirtualKeyboardPolicy = 'manual';
			// Options read the field's state, so they are set once it is in the page.
			host.append(mf);
			mf.menuItems = [];
			mf.keybindings = mf.keybindings.filter((binding) => {
				const command = Array.isArray(binding.command) ? binding.command[0] : binding.command;
				return !UNDO.has(String(command));
			});
			mf.value = params.latex;
			// Czech division is a plain `:` (ratio), not MathLive's `\colon` (§3).
			mf.keybindings = [...mf.keybindings, { key: ':', ifMode: 'math', command: ['insert', ':'] }];
			// Physical `,` and `.` between digits both produce the course's decimal
			// separator (§3): `3,14` is stored `3{,}14`, so LaTeX adds no space after it.
			// Capture phase: MathLive's own keystroke buffer must never see the key.
			mf.addEventListener(
				'keydown',
				(event) => {
					if (event.key !== ',' && event.key !== '.') return;
					if (event.ctrlKey || event.metaKey || event.altKey) return;
					const caret = field?.selection.ranges[0]?.[1];
					if (caret === undefined) return;
					const before = field?.getValue(0, caret, 'latex') ?? '';
					if (!/[0-9]$/.test(before)) return;
					event.preventDefault();
					event.stopPropagation();
					field?.insert(decimalLatex(params.math), { format: 'latex' });
					send();
				},
				true
			);
			// Chem mode: while it is on, every printable key and Backspace is mhchem source
			// for the `\ce{…}` node being built, not a MathLive keystroke.
			mf.addEventListener(
				'keydown',
				(event) => {
					if (!chemOn || !field) return;
					if (event.key === 'Backspace') {
						event.preventDefault();
						event.stopPropagation();
						chemBackspace();
						return;
					}
					if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
						event.preventDefault();
						event.stopPropagation();
						chemType(event.key);
					}
				},
				true
			);
			// `\` opens the keypad's search palette instead of MathLive's LaTeX mode (§5.3).
			mf.addEventListener(
				'keydown',
				(event) => {
					if (event.key !== '\\' || event.ctrlKey || event.metaKey || event.altKey) return;
					event.preventDefault();
					event.stopPropagation();
					params.onsearch?.();
				},
				true
			);
			// The `=.` and `~=` shortcuts (§5.1): „rovná se přibližně“ is ≐ (`\doteq`), not
			// MathLive's literal `=.` / `\cong`. Handled here at keydown, before MathLive's
			// keystroke buffer sees the second key — a command flushes that buffer first,
			// so `deleteBackward` reliably removes the first character of the pair.
			let prevKey = '';
			mf.addEventListener(
				'keydown',
				(event) => {
					if (event.ctrlKey || event.metaKey || event.altKey) {
						prevKey = '';
						return;
					}
					if (event.key.length !== 1) {
						prevKey = '';
						return;
					}
					const pair = prevKey + event.key;
					prevKey = event.key;
					if ((pair === '=.' || pair === '~=') && field) {
						event.preventDefault();
						event.stopPropagation();
						field.executeCommand('deleteBackward');
						field.insert('\\doteq', { format: 'latex', selectionMode: 'after' });
						send();
					}
				},
				true
			);
			mf.addEventListener('input', send);
			// On blur, as Hotovo is pressed: the keys it still held arrive with it.
			mf.addEventListener('change', send);
			/**
			 * Enter: the next placeholder first, done after the last one (§5.1). The test is
			 * whether the caret can still advance — an empty placeholder stays in the LaTeX.
			 */
			const done = () => {
				if (!field) {
					params.ondone();
					return;
				}
				if (field.getValue('latex').includes('\\placeholder')) {
					const before = JSON.stringify(field.selection);
					field.executeCommand('moveToNextPlaceholder');
					send();
					if (JSON.stringify(field.selection) === before) params.ondone();
				} else params.ondone();
			};
			mf.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					// MathLive holds typed keys a moment (for shortcuts like `sqrt`) before its
					// `input`; a quick Enter would close the row on the formula before them.
					send();
					done();
				}
			});
			/** Chem mode state: what is before the `\ce{…}` node, and the node's mhchem source. */
			let chemOn = false;
			let chemPrefix = '';
			let chemSource = '';
			const chemWrite = () => {
				if (!field) return;
				field.setValue(chemPrefix + (chemSource === '' ? '' : `\\ce{${chemSource}}`));
				send();
			};
			const chemStart = () => {
				if (chemOn || !field) return;
				chemOn = true;
				const caret = field.selection.ranges[0]?.[1] ?? 0;
				chemPrefix = field.getValue(0, caret, 'latex');
				chemSource = '';
			};
			const chemType = (token: string) => {
				if (!chemOn) return;
				chemSource += token;
				chemWrite();
			};
			const chemBackspace = () => {
				if (!chemOn) return;
				chemSource = chemSource.slice(0, -1);
				chemWrite();
			};
			field = mf;
			seen = written();
			if (mf.errors.length > 0) params.onunreadable();
			params.onbind?.({
				insert: (latex) => {
					field?.insert(latex, { format: 'latex', selectionMode: 'placeholder' });
					send();
				},
				command: (name) => {
					field?.executeCommand(name as Selector);
					send();
				},
				flush: send,
				hasPlaceholders: () => (field ? field.getValue('latex').includes('\\placeholder') : false),
				done,
				chem: {
					active: () => chemOn,
					start: chemStart,
					type: chemType,
					backspace: chemBackspace,
					stop: () => {
						chemOn = false;
					}
				},
				insideChem: () => {
					if (!field) return false;
					const caret = field.selection.ranges[0]?.[1] ?? 0;
					const before = field.getValue(0, caret, 'latex');
					// Inside `\ce{` when the last unclosed brace of a `\ce{` is still open.
					const idx = before.lastIndexOf('\\ce{');
					if (idx < 0) return false;
					let depth = 0;
					for (const ch of before.slice(idx + 4)) {
						if (ch === '{') depth++;
						else if (ch === '}') depth--;
					}
					return depth > 0;
				}
			});
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
			params.onbind?.(null);
			field?.remove();
		}
	};
}
