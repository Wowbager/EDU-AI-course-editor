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
