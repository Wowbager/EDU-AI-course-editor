/**
 * CodeMirror 6 as a Svelte action, for the Markdown + LaTeX fields.
 *
 * It is framework-agnostic and owns its own DOM, so it is mounted rather than
 * rendered — which also keeps the editor from re-creating it on every keystroke.
 */
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';

export interface MarkdownEditorOptions {
	value: string;
	placeholder?: string;
	/** The field's name for assistive tech: the editable element is otherwise unnamed. */
	label?: string;
	/** Id of the line that describes the field (its hint, its error). */
	describedby?: string;
	onchange: (value: string) => void;
	/**
	 * A run of typing starts, just before its first change is reported. The store
	 * groups the run into one undo entry (`DocStore.beginEdit`).
	 */
	onbeginedit?: () => void;
	/** The run ends: the editor lost focus or is going away. */
	onendedit?: () => void;
}

const theme = EditorView.theme({
	'&': {
		fontFamily: 'var(--font-code)',
		fontSize: 'var(--text-s)',
		color: 'var(--e-text)',
		background: 'transparent'
	},
	'.cm-content': { padding: '8px 0', lineHeight: '1.55' },
	'.cm-line': { padding: '0' },
	'&.cm-focused': { outline: 'none' },
	'.cm-placeholder': { color: 'var(--e-text-faint)', fontStyle: 'italic' }
});

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

export function markdownEditor(node: HTMLElement, options: MarkdownEditorOptions) {
	let current = options;
	/**
	 * True while we are pushing a value *into* the editor rather than reading one
	 * out of it. CodeMirror cannot tell the two apart — a programmatic dispatch
	 * raises `docChanged` exactly like typing — so without this the editor reports
	 * every externally-set value straight back as an edit. On import that meant one
	 * spurious write per visible step: undo entries for changes nobody made, and a
	 * selection dragged to the last step the importer happened to render.
	 */
	let pushing = false;
	/**
	 * Whether a run of typing is open. The editor has no undo of its own: the
	 * store owns it, so Ctrl+Z is left to the page, which undoes one whole run per
	 * press. A value pushed in from outside (that undo, a redo, an import) closes the
	 * run, because the store has closed it too; the next keystroke opens a new one.
	 */
	let editing = false;
	const end = () => {
		if (!editing) return;
		editing = false;
		current.onendedit?.();
	};

	const extensions: Extension[] = [
		keymap.of(defaultKeymap),
		markdown(),
		EditorView.lineWrapping,
		theme,
		placeholderExtension(current.placeholder ?? ''),
		EditorView.contentAttributes.of({
			...(current.label ? { 'aria-label': current.label } : {}),
			...(current.describedby ? { 'aria-describedby': current.describedby } : {})
		}),
		EditorView.updateListener.of((update) => {
			if (!update.docChanged || pushing) return;
			if (!editing) {
				editing = true;
				current.onbeginedit?.();
			}
			current.onchange(update.state.doc.toString());
		}),
		EditorView.domEventHandlers({
			blur: () => {
				end();
			}
		})
	];

	const view = new EditorView({
		state: EditorState.create({ doc: current.value, extensions }),
		parent: node
	});

	return {
		update(next: MarkdownEditorOptions) {
			current = next;
			// Only push a value the author did not just type, or the cursor jumps.
			const existing = view.state.doc.toString();
			if (next.value !== existing) {
				editing = false;
				// Replace only what differs, so the cursor of an undone edit stays where
				// the edit was instead of falling back to the start of the text.
				let from = 0;
				const shared = Math.min(existing.length, next.value.length);
				while (from < shared && existing.charCodeAt(from) === next.value.charCodeAt(from)) from++;
				// Never cut between the halves of an emoji or another astral character.
				if (from > 0 && isHighSurrogate(existing.charCodeAt(from - 1))) from--;
				let tail = 0;
				while (
					tail < shared - from &&
					existing.charCodeAt(existing.length - 1 - tail) ===
						next.value.charCodeAt(next.value.length - 1 - tail)
				)
					tail++;
				if (tail > 0 && isLowSurrogate(existing.charCodeAt(existing.length - tail))) tail--;
				pushing = true;
				try {
					view.dispatch({
						changes: {
							from,
							to: existing.length - tail,
							insert: next.value.slice(from, next.value.length - tail)
						}
					});
				} finally {
					pushing = false;
				}
			}
		},
		destroy() {
			end();
			view.destroy();
		}
	};
}
