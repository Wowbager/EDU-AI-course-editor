/**
 * Removing something small (a step, an answer, a skill) shows the same notice a
 * removed card does: what went, and "Vrátit zpět" for as long as that removal is
 * the last edit. One helper so every such removal says it the same way.
 */
import type { DocStore } from '$lib/state/doc-store.svelte';
import type { Ref } from '$lib/domain/ref';
import { notices } from '$lib/state/notice.svelte';

/**
 * Run `change` (normally a `store.apply`) and, if it recorded an undo entry, show
 * `text` with an undo. `ref` is selected after the undo so the teacher lands where
 * the removal happened. A change that did nothing shows nothing.
 */
export function withUndoNotice(store: DocStore, text: string, change: () => void, ref?: Ref) {
	const before = store.undoStack.at(-1);
	change();
	const entry = store.undoStack.at(-1);
	if (entry === undefined || entry === before) return;
	notices.show({ text, entry, ref });
}
