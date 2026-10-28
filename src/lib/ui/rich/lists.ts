/**
 * Typing a list where Tiptap's own rules do not look: `1. ` after a space (its bullet rule
 * allows one, its numbered rule does not), and `1. ` or `- ` at the start of a line made
 * with Shift+Enter, which is still the same paragraph. The line becomes a paragraph of its
 * own, and that paragraph a list.
 */
import { Extension, InputRule, wrappingInputRule } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import { findWrapping } from '@tiptap/pm/transform';

/** After a hard break: split the paragraph there, then wrap the new one. */
function afterBreak(find: RegExp, type: NodeType, attrs: (match: RegExpMatchArray) => object) {
	return new InputRule({
		find,
		handler: ({ state, range, match }) => {
			const { tr } = state;
			const $start = tr.doc.resolve(range.from);
			if ($start.parent.type.name !== 'paragraph') return null;
			if ($start.nodeBefore?.type.name !== 'hardBreak') return null;
			const br = range.from - 1;
			tr.delete(br, range.to);
			tr.split(br);
			const block = tr.doc.resolve(br + 2).blockRange();
			const wrapping = block && findWrapping(block, type, attrs(match));
			if (!wrapping) return null;
			tr.wrap(block, wrapping);
		}
	});
}

export const ListInputRules = Extension.create({
	name: 'listInputRules',

	addInputRules() {
		const { bulletList, orderedList } = this.editor.schema.nodes;
		if (!bulletList || !orderedList) return [];
		const start = (match: RegExpMatchArray) => ({ start: Number(match[1]) });
		return [
			afterBreak(/[^\S\n]*(\d+)\.\s$/, orderedList, start),
			afterBreak(/[^\S\n]*[-+*]\s$/, bulletList, () => ({})),
			wrappingInputRule({
				find: /^\s+(\d+)\.\s$/,
				type: orderedList,
				getAttributes: start,
				joinPredicate: (match, node) => node.childCount + node.attrs.start === Number(match[1])
			})
		];
	}
});
