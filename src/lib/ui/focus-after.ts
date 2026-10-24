/**
 * Where focus goes when a list gains or loses an item: one convention for every "add"
 * and every "delete" in the editor (OPEN-PROBLEMS #31).
 *
 * - **Add:** the new item's first field. A keyboard author who presses "Přidat"
 *   carries on typing in what they added.
 * - **Delete:** the neighbour, the next item, else the previous one, else the list's
 *   add button. Focus never falls to the page.
 *
 * Both wait for the DOM to catch up with the change they follow, so call them right
 * after the edit. They look at the list's items by selector, in document order.
 */
import { tick } from 'svelte';

const FIELD = [
	'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not(:disabled)',
	'textarea:not(:disabled)',
	'select:not(:disabled)',
	'[contenteditable="true"]'
].join(', ');

/** The first thing to type into in `item`, else its first button; the item itself if it is one. */
export function firstField(item: Element | null | undefined): HTMLElement | null {
	if (item == null) return null;
	const found =
		item.querySelector<HTMLElement>(FIELD) ??
		item.querySelector<HTMLElement>(
			'button:not(:disabled):not([tabindex="-1"]), [role="button"][tabindex="0"]'
		);
	if (found !== null) return found;
	return item instanceof HTMLElement && item.tabIndex >= 0 ? item : null;
}

const itemsOf = (list: ParentNode | null | undefined, selector: string) =>
	list == null ? [] : [...list.querySelectorAll(selector)];

/**
 * Focus `field` and make sure it is not hugging an edge: a field the browser scrolled
 * just into view sits clipped under the bottom of the column, so one within a margin of
 * the window's edge is centred instead.
 */
function focusAndReveal(field: HTMLElement | null) {
	if (field === null) return;
	field.focus();
	const box = field.getBoundingClientRect();
	const margin = 72;
	if (box.top < margin || box.bottom > window.innerHeight - margin)
		field.scrollIntoView({ block: 'center' });
}

/** The item now at `index` (counted from the end when negative) gets focus. */
export async function focusAdded(
	list: ParentNode | null | undefined,
	itemSelector: string,
	index: number
) {
	await tick();
	const items = itemsOf(list, itemSelector);
	focusAndReveal(firstField(items.at(index < 0 ? index : Math.min(index, items.length - 1))));
}

/**
 * An item at `index` is gone: focus the one that took its place, else the one before,
 * else `addButton()`. Does nothing when the list did not shrink (a refused delete).
 */
export async function focusAfterDelete(
	list: ParentNode | null | undefined,
	itemSelector: string,
	index: number,
	countBefore: number,
	addButton?: () => HTMLElement | null | undefined
) {
	await tick();
	const items = itemsOf(list, itemSelector);
	if (items.length >= countBefore) return;
	const neighbour = items[index] ?? items[index - 1];
	(neighbour === undefined ? addButton?.() : firstField(neighbour))?.focus();
}

/** The count to hand to `focusAfterDelete`, taken before the edit. */
export const countOf = (list: ParentNode | null | undefined, itemSelector: string) =>
	itemsOf(list, itemSelector).length;

/**
 * A card was added, duplicated or deleted from the editor column, and the editor now
 * shows the one that was selected instead: its row in the lesson list (or its tile in
 * the rail) is the card's first field there.
 */
export async function focusSelectedCard() {
	await tick();
	(
		document.querySelector<HTMLElement>('.tree-card.selected') ??
		document.querySelector<HTMLElement>('.rail-tile[aria-current="true"]')
	)?.focus();
}
