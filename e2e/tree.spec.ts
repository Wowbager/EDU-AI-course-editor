import { expect, test, type Page, openEditor } from './fixtures';
import { readFileSync } from 'node:fs';

/**
 * The card list in the lesson tree: a card is dragged by any part of its row, and
 * is one tab stop that Enter selects.
 *
 * The rows used to be `<button>`s, and svelte-dnd-action refuses to start a drag
 * from an element that has a `value` — so only a press that landed on the text
 * inside the button grabbed the card, and one on its padding did nothing.
 */
const fixture = readFileSync(
	new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
	'utf8'
);

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'spec-16-course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(fixture)
	});
	await expect(page.locator('.cards .tree-card').nth(2)).toBeVisible();
});

const cards = (page: Page) => page.locator('.cards .tree-card');
const order = (page: Page) => cards(page).locator('.snippet').allTextContents();

test('a card is grabbed by its padding, and Zpět puts it back', async ({ page }) => {
	const before = await order(page);
	expect(before.length).toBeGreaterThanOrEqual(3);
	expect(new Set(before).size).toBe(before.length);
	const undo = page.getByRole('button', { name: 'Zpět', exact: true });
	await expect(undo).toBeDisabled();

	// The left edge of the row: the padding of the card, not its text.
	const first = (await cards(page).nth(0).boundingBox())!;
	const third = (await cards(page).nth(2).boundingBox())!;
	const from = { x: first.x + 3, y: first.y + first.height / 2 };
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x, from.y + 10, { steps: 4 });
	const to = third.y + third.height - 3;
	await page.mouse.move(from.x, to, { steps: 12 });
	// Drop only once the gap has reached the third row: the rows slide for 150 ms
	// while they make room, and a release in the middle of that lands one row short.
	await expect
		.poll(async () => {
			await page.mouse.move(from.x, to);
			return page
				.locator('.cards > li')
				.evaluateAll((items) => items.findIndex((li) => li.hasAttribute('data-is-dnd-shadow-item-internal')));
		})
		.toBe(2);
	await page.mouse.up();

	await expect.poll(() => order(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
	await expect(undo).toBeEnabled();

	await undo.click();
	await expect.poll(() => order(page)).toEqual(before);
});

test('Enter on a focused card opens it and does not start a drag', async ({ page }) => {
	const before = await order(page);
	const third = cards(page).nth(2);
	await third.focus();
	await page.keyboard.press('Enter');
	await expect(third).toHaveClass(/selected/);
	// The library's keyboard drag would now be carrying it; an arrow would move it.
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => order(page)).toEqual(before);

	await cards(page).nth(0).focus();
	await page.keyboard.press(' ');
	await expect(cards(page).nth(0)).toHaveClass(/selected/);
	expect(await order(page)).toEqual(before);
});

test('each card is one tab stop', async ({ page }) => {
	const count = await cards(page).count();
	await cards(page).nth(0).focus();
	for (let i = 1; i < count; i++) {
		await page.keyboard.press('Tab');
		await expect(cards(page).nth(i)).toBeFocused();
	}
});

test('Alt+ArrowDown moves the focused card down and keeps it focused', async ({ page }) => {
	const before = await order(page);
	await cards(page).nth(0).focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect.poll(() => order(page)).toEqual([before[1], before[0], ...before.slice(2)]);
	await expect(cards(page).nth(1)).toBeFocused();
	// Again, then back up: the card is still the one being moved.
	await page.keyboard.press('Alt+ArrowDown');
	await expect.poll(() => order(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
	await expect(cards(page).nth(2)).toBeFocused();
	await page.keyboard.press('Alt+ArrowUp');
	await expect.poll(() => order(page)).toEqual([before[1], before[0], ...before.slice(2)]);
	await expect(cards(page).nth(1)).toBeFocused();
});

test('Alt+ArrowUp on the first card changes nothing and is not an edit', async ({ page }) => {
	const before = await order(page);
	const undo = page.getByRole('button', { name: 'Zpět', exact: true });
	await expect(undo).toBeDisabled();
	await cards(page).nth(0).focus();
	await page.keyboard.press('Alt+ArrowUp');
	await expect(cards(page).nth(0)).toBeFocused();
	expect(await order(page)).toEqual(before);
	await expect(undo).toBeDisabled();
});

/** A row's four actions are its own siblings, faded in on hover and on the selected row. */
const actionsOf = (page: Page, position: number) => page.locator('.cards > li').nth(position - 1).locator('.tree-actions');

test('a row shows its four actions on hover and on the selected row, and only there', async ({ page }) => {
	await expect(actionsOf(page, 1)).toHaveCSS('opacity', '1');
	await expect(actionsOf(page, 2)).toHaveCSS('opacity', '0');
	await cards(page).nth(1).hover();
	await expect(actionsOf(page, 2)).toHaveCSS('opacity', '1');
	const row = actionsOf(page, 2);
	for (const name of ['Nastavení 2. karty', 'Duplikovat 2. kartu', 'Odebrat 2. kartu z lekce', 'Smazat 2. kartu']) {
		await expect(row.getByRole('button', { name, exact: true })).toBeVisible();
	}
	// Not inside the row that is a button, so a press on one cannot grab the card.
	await expect(cards(page).nth(1).getByRole('button')).toHaveCount(0);
	await page.mouse.move(700, 400);
	await expect(actionsOf(page, 2)).toHaveCSS('opacity', '0');
});

test('a row’s Duplikovat selects the copy, and its Smazat takes two clicks', async ({ page }) => {
	const before = await order(page);
	await cards(page).nth(2).hover();
	await actionsOf(page, 3).getByRole('button', { name: 'Duplikovat 3. kartu' }).click();
	await expect(cards(page)).toHaveCount(before.length + 1);
	await expect(cards(page).nth(3)).toHaveClass(/selected/);

	// The copy is the selected row: delete it, two clicks.
	const row = actionsOf(page, 4);
	await row.getByRole('button', { name: 'Smazat 4. kartu', exact: true }).click();
	await expect(cards(page)).toHaveCount(before.length + 1);
	await row.getByRole('button', { name: 'Opravdu smazat 4. kartu? Klikni znovu' }).click();
	await expect(cards(page)).toHaveCount(before.length);
	// The card before it is selected, and Vrátit zpět brings the copy back.
	await expect(cards(page).nth(2)).toHaveClass(/selected/);
	await page.getByRole('button', { name: 'Vrátit zpět', exact: true }).click();
	await expect(cards(page)).toHaveCount(before.length + 1);
	await expect(cards(page).nth(3)).toHaveClass(/selected/);
});

test('keyboard: → on a row goes into its actions, Enter on Nastavení opens the dialog, Escape comes back', async ({ page }) => {
	await cards(page).nth(1).focus();
	await page.keyboard.press('ArrowRight');
	const settings = page.getByRole('button', { name: 'Nastavení 2. karty', exact: true });
	await expect(settings).toBeFocused();
	await expect(actionsOf(page, 2)).toHaveCSS('opacity', '1');
	await page.keyboard.press('Escape');
	await expect(cards(page).nth(1)).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Nastavení karty' })).toBeVisible();
	await expect(cards(page).nth(1)).toHaveClass(/selected/);
});

test('a card is still grabbed by its padding while the pointer is on its row', async ({ page }) => {
	const before = await order(page);
	// Hovering the row fades the actions in over its right end; the left edge is still the card.
	const box = (await cards(page).nth(1).boundingBox())!;
	await page.mouse.move(box.x + 3, box.y + box.height / 2);
	await expect(actionsOf(page, 2)).toHaveCSS('opacity', '1');
	await page.mouse.down();
	await page.mouse.move(box.x + 3, box.y + box.height / 2 + 12, { steps: 4 });
	await page.mouse.move(box.x + 3, box.y - 4, { steps: 8 });
	await expect
		.poll(async () => {
			await page.mouse.move(box.x + 3, box.y - 4);
			return page
				.locator('.cards > li')
				.evaluateAll((items) => items.findIndex((li) => li.hasAttribute('data-is-dnd-shadow-item-internal')));
		})
		.toBe(0);
	await page.mouse.up();
	await expect.poll(() => order(page)).toEqual([before[1], before[0], ...before.slice(2)]);
});
