/**
 * Dragging a card between the open lesson, the other lessons and the backpack.
 *
 * Three kinds of drag zones hold cards, all of the library's type `bindings`, so a card
 * can be carried from any of them into any other: the open lesson's list (`Sidebar`),
 * and the backpack's two parts, „Z tohoto kurzu“ and „Moje karty“ (`Backpack.svelte`).
 * Each item says where it came from, and the zone it is dropped into does the one
 * command that means:
 *
 * | from ↓ into →  | a lesson                   | Z tohoto kurzu      | Moje karty        |
 * |----------------|----------------------------|---------------------|-------------------|
 * | a lesson       | moved there                | taken out of lesson | a copy is saved   |
 * | Z tohoto kurzu | put into the lesson        | —                   | a copy is saved   |
 * | Moje karty     | a copy is put in           | a copy, in no lesson| —                 |
 *
 * A closed lesson has no zone. Its name in the tree (or its circle on the rail) is a
 * target of its own: the pointer is followed while a card is carried (`track`), and a
 * card let go over a lesson name goes to the end of that lesson. The closed backpack's
 * button is a target the same way: held over it, the backpack opens.
 */
import { TRIGGERS, type DndEvent } from 'svelte-dnd-action';
import type { DocStore } from '$lib/state/doc-store.svelte';
import type { BlockV2, LessonBlockBinding } from '$lib/domain/schema';
import { bindBlock, moveBlockToLesson, pasteBlock } from '$lib/domain/commands';
import { backpack } from '$lib/state/backpack.svelte';

export type CardItem = {
	id: string;
	binding: LessonBlockBinding;
	/** The lesson it is in; absent for a card from the backpack. */
	lessonId?: string;
	/** Which part of the backpack it came from. */
	from?: 'loose' | 'saved';
	/** For „Moje karty“: the saved entry. */
	savedId?: string;
};

/** How long a card held over the closed backpack waits before it opens. */
const OPEN_BACKPACK_MS = 400;

export type DropHover = { kind: 'lesson'; lessonId: string } | { kind: 'backpack' } | null;

export class CardDrag {
	/** What the carried card is over, outside every zone: shown as a drop target. */
	hover = $state<DropHover>(null);
	/** The lesson the landed glow is on, for a moment after a drop on its name. */
	landed = $state<string | null>(null);
	#untrack: (() => void) | undefined;
	#openTimer: ReturnType<typeof setTimeout> | undefined;
	#landedTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * `removeFromLesson` is the card actions' „Odebrat z lekce“, so a card dragged out of
	 * its lesson says what happened and can be undone exactly as when that is pressed.
	 */
	constructor(
		private store: DocStore,
		private removeFromLesson: (lessonId: string, blockId: string) => void
	) {}

	/** A card of a lesson into „Z tohoto kurzu“: only that lesson lets it go. */
	takeOut(item: CardItem) {
		if (item.lessonId !== undefined) this.removeFromLesson(item.lessonId, item.binding.block_id);
	}

	/** The card behind an item: the course's, or the saved copy for „Moje karty“. */
	blockOf(item: CardItem): BlockV2 | undefined {
		if (item.from === 'saved') return backpack.find(item.savedId ?? '')?.block;
		return this.store.doc.blocks.find((b) => b.block_id === item.binding.block_id);
	}

	/** Every zone's `consider`: a drag that starts begins following the pointer. */
	considered(event: CustomEvent<DndEvent<CardItem>>, ownLessonId?: string) {
		if (event.detail.info.trigger === TRIGGERS.DRAG_STARTED) this.#track(ownLessonId);
	}

	/**
	 * Every zone's `finalize`. Returns the lesson whose name the card was let go over,
	 * when it was let go outside every zone; the zone it came from then moves it there.
	 */
	finalized(event: CustomEvent<DndEvent<CardItem>>): string | undefined {
		const hover = this.hover;
		this.#stop();
		if (event.detail.info.trigger !== TRIGGERS.DROPPED_OUTSIDE_OF_ANY) return undefined;
		return hover?.kind === 'lesson' ? hover.lessonId : undefined;
	}

	/** The item that came in from another zone, and where it now is; undefined for a reorder. */
	arrived(
		event: CustomEvent<DndEvent<CardItem>>,
		isOwn: (item: CardItem) => boolean
	): { item: CardItem; index: number } | undefined {
		if (event.detail.info.trigger !== TRIGGERS.DROPPED_INTO_ZONE) return undefined;
		const index = event.detail.items.findIndex(
			(item) => item.id === event.detail.info.id && !isOwn(item)
		);
		return index < 0 ? undefined : { item: event.detail.items[index], index };
	}

	/**
	 * Put the card into `lessonId` at `index` (its end when absent). The selection stays
	 * where the teacher is, unless the card moved was the one open.
	 */
	toLesson(item: CardItem, lessonId: string, index?: number) {
		const blockId = item.binding.block_id;
		if (item.from === 'saved') {
			const saved = backpack.find(item.savedId ?? '');
			if (saved === undefined) return;
			this.store.apply((d, r) => {
				const pasted = pasteBlock(d, saved.block, undefined, undefined, r, saved.from);
				const copyId = pasted.ref!.blockId!;
				return { ...bindBlock(pasted.doc, lessonId, copyId, index), ref: undefined };
			});
		} else if (item.from === 'loose') {
			const follow = this.store.selection?.blockId === blockId;
			this.store.apply((d) => {
				const result = bindBlock(d, lessonId, blockId, index);
				return follow ? result : { ...result, ref: undefined };
			});
		} else if (item.lessonId !== undefined && item.lessonId !== lessonId) {
			const from = item.lessonId;
			const follow = this.store.selection?.blockId === blockId;
			this.store.apply((d) => {
				const result = moveBlockToLesson(d, blockId, from, lessonId, index);
				return follow ? result : { ...result, ref: undefined };
			});
		}
	}

	/** A copy of a saved card, into the course but no lesson („Z tohoto kurzu“). */
	pasteLoose(item: CardItem) {
		const saved = backpack.find(item.savedId ?? '');
		if (saved === undefined) return;
		this.store.apply((d, r) => ({
			...pasteBlock(d, saved.block, undefined, undefined, r, saved.from),
			ref: undefined
		}));
	}

	/** A copy into „Moje karty“; the course does not change. */
	save(item: CardItem) {
		const block = this.blockOf(item);
		if (block === undefined) return;
		const doc = this.store.doc;
		backpack.save(block, { courseId: doc.course_id, blockId: block.block_id }, doc.name);
	}

	/** The short glow on a lesson's name after a card went into it from outside. */
	glow(lessonId: string) {
		clearTimeout(this.#landedTimer);
		this.landed = lessonId;
		this.#landedTimer = setTimeout(() => (this.landed = null), 1600);
	}

	#track(ownLessonId: string | undefined) {
		this.#stop();
		const follow = (x: number, y: number) => {
			let next: DropHover = null;
			for (const el of document.elementsFromPoint(x, y)) {
				const lesson = el.closest<HTMLElement>('[data-drop-lesson]');
				if (lesson !== null) {
					const id = lesson.dataset.dropLesson!;
					if (id !== ownLessonId) next = { kind: 'lesson', lessonId: id };
					break;
				}
				if (el.closest('[data-drop-backpack]') !== null) {
					next = { kind: 'backpack' };
					break;
				}
			}
			this.#hoverOn(next);
		};
		const mouse = (e: MouseEvent) => follow(e.clientX, e.clientY);
		const touch = (e: TouchEvent) => {
			const t = e.touches[0];
			if (t !== undefined) follow(t.clientX, t.clientY);
		};
		window.addEventListener('mousemove', mouse, true);
		window.addEventListener('touchmove', touch, { capture: true, passive: true });
		this.#untrack = () => {
			window.removeEventListener('mousemove', mouse, true);
			window.removeEventListener('touchmove', touch, true);
		};
	}

	#hoverOn(next: DropHover) {
		const same =
			next?.kind === this.hover?.kind &&
			(next?.kind !== 'lesson' ||
				(this.hover?.kind === 'lesson' && next.lessonId === this.hover.lessonId));
		if (same) return;
		this.hover = next;
		clearTimeout(this.#openTimer);
		if (next?.kind === 'backpack' && !backpack.open)
			this.#openTimer = setTimeout(() => (backpack.open = true), OPEN_BACKPACK_MS);
	}

	#stop() {
		this.#untrack?.();
		this.#untrack = undefined;
		clearTimeout(this.#openTimer);
		this.hover = null;
	}
}
