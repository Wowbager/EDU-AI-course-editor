/**
 * A formula in the visual editor: `$…$` inline, `$$…$$` on a line of its own. It is
 * one atom — the teacher clicks it to change the LaTeX in the field's formula row,
 * and never edits the dollars. KaTeX draws it; it is loaded the first time a formula
 * is shown, so a course without any never fetches it.
 */
import { InputRule, Node, mergeAttributes } from '@tiptap/core';

export interface MathOptions {
	/** The teacher clicked a formula: open it for editing. */
	onEdit: (pos: number) => void;
}

type Katex = typeof import('katex').default;
let katex: Promise<Katex> | null = null;
function loadKatex(): Promise<Katex> {
	katex ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
		([module]) => module.default
	);
	return katex;
}

/** Draw `latex` into `into`; a formula KaTeX cannot read stays as its source, quietly marked. */
export function renderMath(into: HTMLElement, latex: string, display: boolean): void {
	into.textContent = latex.trim() === '' ? '…' : latex;
	into.classList.toggle('math-empty', latex.trim() === '');
	if (latex.trim() === '') return;
	void loadKatex().then((k) => {
		if (into.textContent !== latex) return;
		try {
			k.render(latex, into, { displayMode: display, throwOnError: true });
			into.classList.remove('math-error');
		} catch {
			into.textContent = latex;
			into.classList.add('math-error');
		}
	});
}

export const MathNode = Node.create<MathOptions>({
	name: 'math',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,

	addOptions() {
		return { onEdit: () => {} };
	},

	addAttributes() {
		return {
			// Written out by `renderHTML` as data- attributes, not as bare ones.
			latex: { default: '', rendered: false },
			display: { default: false, rendered: false }
		};
	},

	parseHTML() {
		return [
			{
				tag: 'span[data-math]',
				getAttrs: (el) => ({
					latex: (el as HTMLElement).getAttribute('data-latex') ?? '',
					display: (el as HTMLElement).getAttribute('data-display') === 'true'
				})
			}
		];
	},

	renderHTML({ node, HTMLAttributes }) {
		// What the clipboard carries to another field or app: the source, in dollars.
		const dollars = node.attrs.display ? '$$' : '$';
		return [
			'span',
			mergeAttributes(HTMLAttributes, {
				'data-math': '',
				'data-latex': node.attrs.latex,
				'data-display': String(node.attrs.display)
			}),
			`${dollars}${node.attrs.latex}${dollars}`
		];
	},

	renderText({ node }) {
		const dollars = node.attrs.display ? '$$' : '$';
		return `${dollars}${node.attrs.latex}${dollars}`;
	},

	addNodeView() {
		return ({ node, getPos }) => {
			const dom = document.createElement('span');
			dom.className = 'math';
			dom.setAttribute('role', 'button');
			dom.setAttribute('aria-label', `Vzorec ${node.attrs.latex}`);
			dom.title = 'Upravit vzorec';
			let current = node;
			const draw = () => {
				dom.classList.toggle('math-display', current.attrs.display === true);
				renderMath(dom, current.attrs.latex, current.attrs.display === true);
				dom.setAttribute('aria-label', `Vzorec ${current.attrs.latex}`);
			};
			draw();
			dom.addEventListener('click', () => {
				const pos = getPos();
				if (typeof pos === 'number') this.options.onEdit(pos);
			});
			return {
				dom,
				update: (next) => {
					if (next.type !== current.type) return false;
					if (
						next.attrs.latex !== current.attrs.latex ||
						next.attrs.display !== current.attrs.display
					) {
						current = next;
						draw();
					} else current = next;
					return true;
				},
				ignoreMutation: () => true
			};
		};
	},

	addInputRules() {
		const type = this.type;
		const rule = (find: RegExp, display: boolean) =>
			new InputRule({
				find,
				handler: ({ state, range, match }) => {
					state.tr.replaceWith(range.from, range.to, type.create({ latex: match[1], display }));
				}
			});
		return [
			// `$$x^2$$` — a formula on a line of its own.
			rule(/\$\$([^$]+)\$\$$/, true),
			// `$x^2$`. Not `$5 a $`: a space inside either dollar is a price, not a formula.
			rule(/(?<!\$)\$([^\s$](?:[^$\n]*[^\s$])?)\$$/, false)
		];
	}
});
