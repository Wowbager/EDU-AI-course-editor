import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DocStore } from '$lib/state/doc-store.svelte';
import { notices } from '$lib/state/notice.svelte';
import { parseCourse } from '$lib/domain/document';
import { cardActions } from './card-actions';

const course = () =>
	parseCourse(
		JSON.parse(
			readFileSync(new URL('../domain/__tests__/fixtures/spec-16-course.json', import.meta.url), 'utf8')
		)
	);

function open() {
	const store = new DocStore();
	store.load(course());
	const lessonId = store.doc.lessons[0].lesson_id;
	const ids = store.doc.lessons[0].blocks.map((b) => b.block_id);
	const onsettings = vi.fn();
	const onrepair = vi.fn();
	return { store, lessonId, ids, onsettings, onrepair, actions: cardActions(store, { onsettings, onrepair }) };
}

describe('the card actions the rail, the tree and the ⋯ menu share', () => {
	beforeEach(() => notices.dismiss());

	it('deletes a card only its lesson holds, selects the next one, and undo puts the card back and selected', () => {
		const { store, lessonId, ids, actions, onrepair } = open();
		store.selection = { lessonId, blockId: ids[0] };
		actions.remove(ids[0], lessonId);
		expect(onrepair).not.toHaveBeenCalled();
		expect(store.doc.blocks.map((b) => b.block_id)).not.toContain(ids[0]);
		expect(store.selection?.blockId).toBe(ids[1]);
		expect(notices.current?.text).toBe('Karta smazána.');
		expect(notices.current?.entry).toBe(store.undoStack.at(-1));

		store.undo();
		store.selection = notices.current!.ref!;
		expect(store.doc.blocks.map((b) => b.block_id)).toContain(ids[0]);
		expect(store.selection?.blockId).toBe(ids[0]);
	});

	it('deleting a card that is not selected leaves the selection alone', () => {
		const { store, lessonId, ids, actions } = open();
		store.selection = { lessonId, blockId: ids[0] };
		actions.remove(ids[2], lessonId);
		expect(store.selection?.blockId).toBe(ids[0]);
		expect(notices.current?.ref).toBeUndefined();
	});

	it('asks the repair dialog instead when another card points at the card', () => {
		const { store, ids, lessonId, actions, onrepair } = open();
		const before = store.source;
		actions.remove(ids[1], lessonId);
		expect(onrepair).toHaveBeenCalledWith(ids[1]);
		expect(store.source).toBe(before);
		expect(notices.current).toBeNull();
	});

	it('removing from the lesson keeps the card and says where it is; the selection follows only the selected card', () => {
		const { store, lessonId, ids, actions } = open();
		store.selection = { lessonId, blockId: ids[0] };
		actions.removeFromLesson(lessonId, ids[2], { follow: false });
		expect(store.selection?.blockId).toBe(ids[0]);
		expect(store.doc.blocks.map((b) => b.block_id)).toContain(ids[2]);
		expect(store.doc.lessons[0].blocks.map((b) => b.block_id)).not.toContain(ids[2]);
		expect(notices.current?.text).toContain('Karta je nyní v části Karty mimo lekci.');

		actions.removeFromLesson(lessonId, ids[0], { follow: false });
		expect(store.selection?.blockId).toBe(ids[0]);
		expect(notices.current?.ref).toEqual({ lessonId, blockId: ids[0] });
	});

	it('names a lesson without a name by its number, never by its id', () => {
		const { store, lessonId, ids, actions } = open();
		store.apply((d) => ({
			doc: { ...d, lessons: d.lessons.map((l, i) => (i === 0 ? { ...l, name: undefined } : l)) },
			description: 'x'
		}));
		actions.removeFromLesson(lessonId, ids[0], { follow: false });
		expect(notices.current?.text).toContain('„Lekce 1“');
		expect(notices.current?.text).not.toContain(lessonId);
	});

	it('duplicating selects the copy right after the card', () => {
		const { store, lessonId, ids, actions } = open();
		actions.duplicate(ids[0], lessonId);
		const bound = store.doc.lessons[0].blocks.map((b) => b.block_id);
		expect(bound).toHaveLength(ids.length + 1);
		expect(store.selection?.blockId).toBe(bound[1]);
		expect(bound[1]).not.toBe(ids[0]);
	});

	it('settings selects the card first, then opens the dialog', () => {
		const { store, lessonId, ids, actions, onsettings } = open();
		actions.settings(lessonId, ids[2]);
		expect(store.selection).toEqual({ lessonId, blockId: ids[2] });
		expect(onsettings).toHaveBeenCalledWith(ids[2]);
	});
});
