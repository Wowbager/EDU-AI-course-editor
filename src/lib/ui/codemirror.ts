/**
 * CodeMirror 6 as a Svelte action, for the Markdown + LaTeX fields.
 *
 * It is framework-agnostic and owns its own DOM, so it is mounted rather than
 * rendered — which also keeps the editor from re-creating it on every keystroke.
 */
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';

export interface MarkdownEditorOptions {
	value: string;
	placeholder?: string;
	onchange: (value: string) => void;
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

	const extensions: Extension[] = [
		history(),
		keymap.of([...defaultKeymap, ...historyKeymap]),
		markdown(),
		EditorView.lineWrapping,
		theme,
		placeholderExtension(current.placeholder ?? ''),
		EditorView.updateListener.of((update) => {
			if (!update.docChanged || pushing) return;
			current.onchange(update.state.doc.toString());
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
				pushing = true;
				try {
					view.dispatch({ changes: { from: 0, to: existing.length, insert: next.value } });
				} finally {
					pushing = false;
				}
			}
		},
		destroy() {
			view.destroy();
		}
	};
}
