/**
 * Deleting a lesson from its settings dialog, and what the editor says about it.
 *
 * The lesson goes with its bindings and the cards stay in the course, so what is lost
 * is the lesson's own settings, its order, and — for a card no other lesson holds —
 * where the card was. The notice one line says both, and the undo entry the store
 * recorded is handed to it, so "Vrátit zpět" stands there for as long as this edit is
 * the last one. There is no confirm dialog: it would ask the same question every time,
 * and `deleteLesson` is a command the undo can take back whole.
 */
import type { DocStore } from '$lib/state/doc-store.svelte';
import { deleteLesson } from '$lib/domain/commands';
import { notices } from '$lib/state/notice.svelte';

/** One wording, whatever the lesson left behind: the counting is the dialog's business. */
const MESSAGE = 'Lekce smazána. Její karty jsou v Kartách mimo lekci.';

/**
 * Delete the lesson and offer to put it back. The selection moves to the neighbouring
 * lesson (the next, else the previous) only if the editor was on the deleted one, so a
 * delete from the tree does not take a teacher away from the card they had open.
 */
export function removeLesson(store: DocStore, lessonId: string) {
	const doc = store.doc;
	const lesson = doc.lessons.find((l) => l.lesson_id === lessonId);
	if (lesson === undefined) return;
	// What is open decides, not the ref: a card opened from "Karty mimo lekce" has no
	// lesson in it, and a card in this lesson belongs to it.
	const wasOpen = store.open.lesson?.lesson_id === lessonId;
	const before = store.undoStack.at(-1);
	store.apply((d) => {
		const deleted = deleteLesson(d, lessonId);
		// The command's ref is for an editor that was standing in the deleted lesson.
		return wasOpen ? deleted : { ...deleted, ref: undefined };
	});
	const entry = store.undoStack.at(-1);
	notices.show({
		text: MESSAGE,
		entry: entry === before ? undefined : entry,
		// Undoing puts the lesson back, so the editor goes back into it with the undo.
		ref: wasOpen ? { lessonId } : undefined
	});
}
