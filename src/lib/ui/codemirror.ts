/**
 * The Markdown source field, loaded when it is first shown.
 *
 * CodeMirror is about a quarter of the page's script, and a teacher meets it only in
 * „Upravit jako text (Markdown)“ or in a field whose text the visual editor cannot
 * show. So it is a chunk of its own (`codemirror-editor.ts`), fetched the first time
 * a source field mounts and shared by every field after that. Until it is there, the
 * field shows its text in the editor's own type, so nothing jumps when it mounts.
 *
 * The contract is the editor's: the same options, the same `update` and `destroy`.
 * `onready` says when the editor is really there, for a caller that wants to focus
 * it or mark it.
 */
import type { MarkdownEditorOptions } from './codemirror-editor';

export type { MarkdownEditorOptions };

let loading: Promise<typeof import('./codemirror-editor')> | undefined;
const load = () => (loading ??= import('./codemirror-editor'));

interface LazyEditorOptions extends MarkdownEditorOptions {
	/** The editor has mounted: `.cm-content` exists and can be focused. */
	onready?: () => void;
}

export function markdownEditor(node: HTMLElement, options: LazyEditorOptions) {
	let current = options;
	let editor: ReturnType<(typeof import('./codemirror-editor'))['mountMarkdownEditor']> | undefined;
	let destroyed = false;

	// The same box, type and spacing as the editor's theme (`codemirror-editor.ts`).
	const waiting = document.createElement('div');
	waiting.setAttribute('aria-hidden', 'true');
	Object.assign(waiting.style, {
		padding: '8px 0',
		fontFamily: 'var(--font-code)',
		fontSize: 'var(--text-s)',
		lineHeight: '1.55',
		whiteSpace: 'pre-wrap',
		overflowWrap: 'anywhere',
		color: 'var(--e-text)'
	});
	const show = (o: MarkdownEditorOptions) => (waiting.textContent = o.value || '\u00a0');
	show(current);
	node.append(waiting);

	load().then(({ mountMarkdownEditor }) => {
		if (destroyed) return;
		waiting.remove();
		editor = mountMarkdownEditor(node, current);
		current.onready?.();
	});

	return {
		update(next: LazyEditorOptions) {
			current = next;
			if (editor) editor.update(next);
			else show(next);
		},
		destroy() {
			destroyed = true;
			editor?.destroy();
		}
	};
}
