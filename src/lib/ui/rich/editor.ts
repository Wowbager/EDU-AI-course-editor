/**
 * The visual editor for a Markdown + LaTeX field: Tiptap, configured to hold exactly
 * what the app can show, with the Markdown conversion left to `$lib/domain/markdown`.
 *
 * The contract is `codemirror.ts`'s: a value goes in, `onchange` reports what the
 * teacher typed, `onbeginedit`/`onendedit` bracket a run of typing for the store's
 * undo, and a value pushed in from outside (undo, import) is never echoed back. The
 * editor keeps no history of its own — Ctrl+Z belongs to the store.
 */
import { Editor, type JSONContent, type KeyboardShortcutCommand } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import { Bold } from '@tiptap/extension-bold';
import { Italic } from '@tiptap/extension-italic';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Heading } from '@tiptap/extension-heading';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Image } from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Slice, type Node as PMNode } from '@tiptap/pm/model';
import {
	parseMarkdown,
	serializeMarkdown,
	type DocNode,
	type MarkdownDialect
} from '$lib/domain/markdown';
import { parsePlainText } from '$lib/domain/markdown/parse';
import { MathNode } from './math';
import { IMAGE_URL, cleanPastedHtml, pastedTextIsMarkdown } from './paste';

export interface RichEditorOptions {
	element: HTMLElement;
	value: string;
	dialect: MarkdownDialect;
	label: string;
	placeholder: string;
	describedby?: string;
	editable: boolean;
	onchange: (value: string) => void;
	onbeginedit: () => void;
	onendedit: () => void;
	/** A formula was clicked or inserted. */
	onmath: (pos: number) => void;
	/** Something the field cannot take was pasted or dropped, such as an image file. */
	onrefused: (message: string) => void;
	/** Selection or formatting changed: the toolbar redraws. */
	onstate: () => void;
	/** Ctrl+Z / Ctrl+Y: the store undoes, after the run of typing is closed. */
	onundo: (redo: boolean) => void;
	/** Escape: whether the field took it (to revert the run of typing). */
	onescape: () => boolean;
	/** Enter in a one-line field. */
	onenter?: () => void;
}

const EXTERNAL = 'external-value';

export const IMAGE_FILE_REFUSED =
	'Obrázek vlož jako adresu z webu: na obrázku klikni pravým tlačítkem, zvol „Kopírovat adresu obrázku“ a vlož ji sem.';

export function createRichEditor(options: RichEditorOptions) {
	const { dialect } = options;
	let lastEmitted = options.value;
	let editing = false;

	const end = () => {
		if (!editing) return;
		editing = false;
		options.onendedit();
	};

	const toDoc = (markdown: string): JSONContent =>
		parseMarkdown(markdown, dialect).doc as JSONContent;

	const editor: Editor = new Editor({
		element: options.element,
		editable: options.editable,
		content: toDoc(options.value),
		extensions: extensions(options),
		editorProps: {
			attributes: {
				role: 'textbox',
				'aria-multiline': String(!dialect.inline),
				'aria-label': options.label,
				...(options.describedby ? { 'aria-describedby': options.describedby } : {}),
				class: 'rich-content',
				'data-rich': dialect.inline ? 'inline' : 'block'
			},
			transformPastedHTML: cleanPastedHtml,
			clipboardTextParser: (text, $context, plain) => textToSlice(editor, text, plain, dialect),
			clipboardTextSerializer: (slice) =>
				serializeMarkdown(
					{ type: 'doc', content: sliceBlocks(slice) as DocNode[] },
					{ sniffed: true }
				),
			handlePaste: (_view, event) => refuseFiles(event.clipboardData, options),
			handleDrop: (_view, event) => refuseFiles((event as DragEvent).dataTransfer, options),
			handleKeyDown: (_view, event) => {
				if (event.isComposing) return false;
				const key = event.key.toLowerCase();
				const meta = event.ctrlKey || event.metaKey;
				if (meta && !event.altKey && (key === 'z' || key === 'y')) {
					end();
					options.onundo(key === 'y' || event.shiftKey);
					return true;
				}
				// Escape takes back the run of typing, as in every other field; when there
				// is nothing to take back it is the page's (closing a dialog).
				if (event.key === 'Escape') return options.onescape();
				if (event.key === 'Enter' && dialect.inline) {
					options.onenter?.();
					return true;
				}
				return false;
			}
		},
		onTransaction: ({ transaction }) => {
			options.onstate();
			if (!transaction.docChanged || transaction.getMeta(EXTERNAL)) return;
			// Only what the teacher did: typing, a toolbar button, a paste or a drop.
			// A schema fix-up while loading is not an edit, and a text is never rewritten
			// just because it was opened.
			if (!editor.isFocused && !transaction.getMeta('uiEvent') && !transaction.getMeta('teacher'))
				return;
			const markdown = serializeMarkdown(editor.getJSON() as DocNode, dialect);
			if (markdown === lastEmitted) return;
			if (!editing) {
				editing = true;
				options.onbeginedit();
			}
			lastEmitted = markdown;
			options.onchange(markdown);
		},
		onBlur: ({ event }) => {
			// Focus moving to the field's own toolbar is not leaving the field.
			const next = (event as FocusEvent).relatedTarget as Node | null;
			if (next && options.element.closest('.rich-field')?.contains(next)) return;
			end();
		}
	});

	return {
		editor,
		/** A value from outside: undo, redo, import, another field. */
		setValue(value: string) {
			if (value === lastEmitted) return;
			lastEmitted = value;
			editing = false;
			const next = editor.schema.nodeFromJSON(toDoc(value));
			const current = editor.state.doc;
			const start = current.content.findDiffStart(next.content);
			if (start === null) return;
			const ends = current.content.findDiffEnd(next.content)!;
			let endA = ends.a;
			let endB = ends.b;
			// The diff can overlap where both sides repeat; widen so neither end crosses.
			const overlap = start - Math.min(endA, endB);
			if (overlap > 0) {
				endA += overlap;
				endB += overlap;
			}
			const tr = editor.state.tr
				.replace(start, endA, next.slice(start, endB))
				.setMeta(EXTERNAL, true)
				.setMeta('addToHistory', false);
			editor.view.dispatch(tr);
		},
		/** The teacher left the field. */
		end,
		setEditable(editable: boolean) {
			editor.setEditable(editable, false);
		},
		destroy() {
			end();
			editor.destroy();
		}
	};
}

export type RichEditor = ReturnType<typeof createRichEditor>;

/** An extension's own shortcuts, less the ones named. */
function without(
	parent: (() => Record<string, KeyboardShortcutCommand>) | undefined,
	...keys: string[]
): Record<string, KeyboardShortcutCommand> {
	const all = { ...(parent?.() ?? {}) };
	for (const key of keys) delete all[key];
	return all;
}

function extensions(options: RichEditorOptions) {
	const inline = options.dialect.inline === true;
	const blocks = inline
		? []
		: [
				// Tiptap binds Ctrl+Shift+B to the quote, and the page uses it to hide the
				// preview. Ctrl+Alt+digit and Ctrl+Alt+C are AltGr on a Czech keyboard
				// (~ ˇ ^ &), so they are characters, never a heading or a code block.
				Blockquote.extend({
					addKeyboardShortcuts() {
						return without(this.parent, 'Mod-Shift-b');
					}
				}),
				Heading.extend({
					addKeyboardShortcuts() {
						return without(this.parent, 'Mod-Alt-1', 'Mod-Alt-2', 'Mod-Alt-3');
					},
					// A heading in a step's text sits under the card's own <h1> and the
					// step: drawn two levels down, so the page's outline stays the page's.
					// The level the app reads travels with it, for copy and paste.
					renderHTML({ node, HTMLAttributes }) {
						const level = Math.min(Math.max(Number(node.attrs.level) || 1, 1), 3);
						return [`h${level + 2}`, { ...HTMLAttributes, 'data-level': level }, 0];
					},
					parseHTML() {
						return [
							...[1, 2, 3].map((level) => ({
								tag: `h${level + 2}[data-level="${level}"]`,
								priority: 60,
								attrs: { level }
							})),
							...[1, 2, 3].map((level) => ({ tag: `h${level}`, attrs: { level } }))
						];
					}
				}).configure({ levels: [1, 2, 3] }),
				CodeBlock.extend({
					addKeyboardShortcuts() {
						return without(this.parent, 'Mod-Alt-c');
					}
				}),
				Table.configure({ resizable: false }),
				TableRow,
				TableHeader,
				TableCell
			];
	return [
		StarterKit.configure({
			// The store owns undo.
			undoRedo: false,
			// The app has no underline, and a trailing paragraph after a list or table
			// would be a change the teacher did not make.
			underline: false,
			trailingNode: false,
			document: false,
			bold: false,
			italic: false,
			blockquote: false,
			heading: false,
			codeBlock: false,
			link: { openOnClick: false, autolink: false, linkOnPaste: false },
			bulletList: inline ? false : {},
			orderedList: inline ? false : {},
			listItem: inline ? false : {},
			listKeymap: inline ? false : {},
			horizontalRule: inline ? false : {},
			hardBreak: inline ? false : {}
		}),
		// An answer is one line of text.
		Document.extend({ content: inline ? 'paragraph' : 'block+' }),
		// Ctrl+B and Ctrl+I only: Tiptap also binds them with Shift, and Ctrl+Shift+B is
		// the page's.
		Bold.extend({
			addKeyboardShortcuts() {
				return { 'Mod-b': () => this.editor.commands.toggleBold() };
			}
		}),
		Italic.extend({
			addKeyboardShortcuts() {
				return { 'Mod-i': () => this.editor.commands.toggleItalic() };
			}
		}),
		...blocks,
		Image.configure({ inline: true, allowBase64: false }),
		MathNode.configure({ onEdit: options.onmath }),
		Placeholder.configure({ placeholder: options.placeholder })
	];
}

/** Inline content of a slice, wrapped in blocks so the serializer can read it. */
function sliceBlocks(slice: Slice): JSONContent[] {
	const nodes: JSONContent[] = [];
	let inlineRun: JSONContent[] = [];
	slice.content.forEach((node: PMNode) => {
		if (node.isInline) inlineRun.push(node.toJSON());
		else {
			if (inlineRun.length) nodes.push({ type: 'paragraph', content: inlineRun });
			inlineRun = [];
			nodes.push(node.toJSON());
		}
	});
	if (inlineRun.length) nodes.push({ type: 'paragraph', content: inlineRun });
	return nodes;
}

/** Pasted plain text: Markdown when it reads as Markdown, words and line breaks when not. */
function textToSlice(
	editor: Editor,
	text: string,
	plain: boolean,
	dialect: MarkdownDialect
): Slice {
	const trimmed = text.trim();
	let docJson: DocNode;
	if (!plain && IMAGE_URL.test(trimmed)) {
		docJson = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'image', attrs: { src: trimmed, alt: '' } }] }
			]
		};
	} else if (!plain && pastedTextIsMarkdown(text)) {
		docJson = parseMarkdown(text, { sniffed: false }).doc;
	} else {
		docJson = parsePlainText(text);
	}
	if (dialect.inline) docJson = flattenToOneLine(docJson);
	const node = editor.schema.nodeFromJSON(docJson);
	// Open on both sides, so a single paragraph flows into the one being typed in.
	return Slice.maxOpen(node.content);
}

function flattenToOneLine(root: DocNode): DocNode {
	const inline: DocNode[] = [];
	const walk = (node: DocNode) => {
		if (node.type === 'text' || node.type === 'math' || node.type === 'image') {
			if (inline.length && node.type === 'text' && inline[inline.length - 1].type === 'text')
				inline.push({ type: 'text', text: ' ' });
			inline.push(
				node.type === 'math' ? { ...node, attrs: { ...node.attrs, display: false } } : node
			);
		} else if (node.type === 'hardBreak') inline.push({ type: 'text', text: ' ' });
		else node.content?.forEach(walk);
	};
	walk(root);
	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: inline.length ? inline : undefined }]
	};
}

/** Image files: the app shows images from the web only, so say how to bring one. */
function refuseFiles(data: DataTransfer | null, options: RichEditorOptions): boolean {
	if (!data) return false;
	const files = [...data.files];
	if (files.length === 0) return false;
	// A drag from another tab carries the image's address along with the file.
	if (data.getData('text/html') || data.getData('text/uri-list')) return false;
	options.onrefused(
		files.some((f) => f.type.startsWith('image/'))
			? IMAGE_FILE_REFUSED
			: 'Soubor sem vložit nejde — do textu patří text, vzorce a obrázky z webu.'
	);
	return true;
}
