/**
 * What a card can be told to do, in one place. The ⋯ menu in the card's header, the
 * rail's peek panel and the tree's rows all call these, so "Odebrat z lekce" says the
 * same thing and can be undone the same way wherever it was pressed.
 *
 * Every id here is the *view's* card id, as in the rest of the editor: in Učitel and
 * Metodik one card may stand for several exported blocks, and the commands run on the
 * view (`store.apply` expands them, `domain/groups.ts`).
 */
import type { DocStore, UndoEntry } from '$lib/state/doc-store.svelte';
import type { Ref } from '$lib/domain/ref';
import { deleteBlock, duplicateBlock, unbindBlock } from '$lib/domain/commands';
import { quickDelete } from '$lib/domain/card-delete';
import { lessonLabel } from '$lib/domain/naming';
import { notices } from '$lib/state/notice.svelte';

export interface CardActionHandlers {
	/** Open the card's settings dialog; the card is already selected. */
	onsettings: (blockId: string) => void;
	/** Open the repair dialog: something else points at the card. */
	onrepair: (blockId: string) => void;
}

/** The undo entry the change recorded, if it recorded one. */
function recorded(store: DocStore, change: () => void): UndoEntry | undefined {
	const before = store.undoStack.at(-1);
	change();
	const after = store.undoStack.at(-1);
	return after === before ? undefined : after;
}

export function cardActions(store: DocStore, handlers: CardActionHandlers) {
	return {
		/** The copy goes right after the card and is selected. */
		duplicate(blockId: string, lessonId: string | undefined) {
			store.apply((d, r) => duplicateBlock(d, blockId, lessonId, r));
		},

		/**
		 * Only this lesson's binding goes; the card, its content and its other lessons
		 * stay. `follow` is the ⋯ menu's way: it is the open card, so the editor stays on
		 * it. From the rail or the tree the selection moves only if this card was the
		 * selected one, so a click on another card's tile does not take the editor away.
		 */
		removeFromLesson(lessonId: string, blockId: string, options: { follow: boolean }) {
			const doc = store.doc;
			const lesson = doc.lessons.find((l) => l.lesson_id === lessonId);
			if (lesson === undefined) return;
			const name = lessonLabel(doc, lesson);
			const follow = options.follow || store.open.card?.block_id === blockId;
			const entry = recorded(store, () => {
				store.apply((d) => {
					const result = unbindBlock(d, lessonId, blockId);
					return follow ? { ...result, ref: { blockId } } : result;
				});
			});
			const remaining = store.doc.lessons.filter((l) =>
				l.blocks.some((b) => b.block_id === blockId)
			);
			const where =
				remaining.length === 0
					? 'Karta je nyní v části Karty mimo lekci.'
					: `Karta zůstává v lekcích (${remaining.length}): ${remaining
							.map((l) => `„${lessonLabel(store.doc, l)}“`)
							.join(', ')}.`;
			notices.show({
				text: `Karta odebrána z lekce „${name}“. ${where} Obsah ani odkazy se nesmazaly.`,
				entry,
				ref: follow ? { lessonId, blockId } : undefined
			});
		},

		/**
		 * Delete the card. When nothing but its own lesson points at it, it goes at once
		 * with an undo toast; otherwise the repair dialog asks where those pointers
		 * should go (`domain/card-delete.ts`).
		 */
		remove(blockId: string, lessonId: string | undefined) {
			const plan = quickDelete(store.doc, lessonId, blockId);
			if (plan === null) {
				handlers.onrepair(blockId);
				return;
			}
			const wasSelected = store.open.card?.block_id === blockId;
			const entry = recorded(store, () => {
				store.apply((d) => {
					const result = deleteBlock(d, blockId, plan.repairs);
					if (!wasSelected) return result;
					const ref: Ref =
						plan.neighbour !== undefined ? { lessonId, blockId: plan.neighbour } : { lessonId };
					return { ...result, ref };
				});
			});
			notices.show({
				text: 'Karta smazána.',
				entry,
				ref: wasSelected ? { lessonId, blockId } : undefined
			});
		},

		/** Settings are per card, so the card is selected first. */
		settings(lessonId: string | undefined, blockId: string) {
			store.selection = { lessonId, blockId };
			handlers.onsettings(blockId);
		}
	};
}
