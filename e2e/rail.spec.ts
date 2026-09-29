import { expect, test, type Page, openEditor } from './fixtures';
import { readFileSync } from 'node:fs';

/**
 * The lesson panel folded to a rail: a circle per lesson, and under the open one a
 * tile per card. A tile has no text, so it is found by its accessible name — the
 * position, the card's type and the start of its text.
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
	await page.getByRole('button', { name: 'Sbalit panel lekcí' }).click();
	await expect(page.locator('.rail-item')).not.toHaveCount(0);
});

const circles = (page: Page) => page.locator('.rail-item');
const tiles = (page: Page) => page.locator('.rail-tile');
const undo = (page: Page) => page.getByRole('button', { name: 'Zpět', exact: true });
/** What each tile is called, in order: the whole order of the lesson in one read. */
const order = (page: Page) => tiles(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
/** What the editor column is showing: the card's name field, empty or not. */
const heading = (page: Page) => page.getByRole('heading', { level: 1 }).getByRole('textbox');

test('there is a circle per lesson, and Nová lekce adds one', async ({ page }) => {
	const before = await circles(page).count();
	expect(before).toBeGreaterThanOrEqual(1);
	await page.getByRole('button', { name: 'Nová lekce' }).click();
	await expect(circles(page)).toHaveCount(before + 1);
	// The new lesson is the open one.
	await expect(circles(page).last()).toHaveAttribute('aria-current', 'true');
});

test('a lesson circle says what is in the lesson, and its gear opens the lesson', async ({ page }) => {
	const circle = circles(page).first();
	await expect(circle).toHaveAttribute('title', /karty · \d+ min · \d+ XP/);
	await circle.hover();
	await page.getByRole('button', { name: /^Nastavení lekce / }).first().click();
	await expect(page.getByRole('dialog', { name: 'Nastavení lekce' })).toBeVisible();
});

test('clicking a tile selects its card', async ({ page }) => {
	await expect(tiles(page).first()).toHaveAttribute('aria-current', 'true');
	const first = await heading(page).getAttribute('placeholder');
	await tiles(page).nth(2).click();
	await expect(tiles(page).nth(2)).toHaveAttribute('aria-current', 'true');
	await expect(tiles(page).nth(2)).toBeFocused();
	await expect(tiles(page).first()).not.toHaveAttribute('aria-current', 'true');
	await expect.poll(() => heading(page).getAttribute('placeholder')).not.toBe(first);
	// A teacher is never shown an id, by name or by tooltip.
	for (const tile of await tiles(page).all()) {
		expect(`${await tile.getAttribute('aria-label')} ${await tile.getAttribute('title')}`).not.toMatch(/L1_|_B\d/);
	}
});

test('a tile is dragged by any part of it, Zpět puts it back, and a drop in place is not an edit', async ({ page }) => {
	const before = await order(page);
	expect(before.length).toBeGreaterThanOrEqual(3);
	await expect(undo(page)).toBeDisabled();

	// Dropped where it started.
	const box = (await tiles(page).nth(1).boundingBox())!;
	const at = { x: box.x + 3, y: box.y + box.height / 2 };
	await page.mouse.move(at.x, at.y);
	await page.mouse.down();
	await page.mouse.move(at.x, at.y + 12, { steps: 4 });
	await page.mouse.move(at.x, at.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(() => order(page)).toEqual(before);
	await expect(undo(page)).toBeDisabled();

	// First tile to below the third.
	const first = (await tiles(page).nth(0).boundingBox())!;
	const third = (await tiles(page).nth(2).boundingBox())!;
	const from = { x: first.x + 3, y: first.y + first.height / 2 };
	const to = third.y + third.height - 3;
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x, from.y + 10, { steps: 4 });
	await page.mouse.move(from.x, to, { steps: 12 });
	// Let the rows finish sliding aside before letting go.
	await expect
		.poll(async () => {
			await page.mouse.move(from.x, to);
			return page
				.locator('.tiles > li')
				.evaluateAll((items) => items.findIndex((li) => li.hasAttribute('data-is-dnd-shadow-item-internal')));
		})
		.toBe(2);
	await page.mouse.up();

	// The names carry the position, so compare by what each card is.
	const text = (labels: (string | null)[]) => labels.map((l) => l!.replace(/^\d+\. /, ''));
	await expect
		.poll(async () => text(await order(page)))
		.toEqual([...text(before).slice(1, 3), text(before)[0], ...text(before).slice(3)]);
	await expect(undo(page)).toBeEnabled();
	await undo(page).click();
	await expect.poll(() => order(page)).toEqual(before);
});

test('Přidat kartu offers the three types and adds a selected card', async ({ page }) => {
	const count = await tiles(page).count();
	await page.getByRole('button', { name: 'Přidat kartu' }).click();
	await expect(page.getByRole('menuitem')).toHaveCount(3);
	await page.getByRole('menuitem', { name: 'Cvičení' }).click();
	await expect(tiles(page)).toHaveCount(count + 1);
	await expect(tiles(page).last()).toHaveAttribute('aria-current', 'true');
	await expect(tiles(page).last()).toHaveAttribute('aria-label', new RegExp(`^${count + 1}\\. Cvičení: `));
});

test('the gear on a tile opens that card’s settings, and is there on the selected tile without hovering', async ({ page }) => {
	const gears = page.getByRole('button', { name: /^Nastavení \d+\. karty$/ });
	// Selected: visible and reachable by Tab. Others: out of the tab order.
	await expect(gears.first()).toHaveCSS('opacity', '1');
	await expect(gears.nth(1)).toHaveAttribute('tabindex', '-1');
	await tiles(page).nth(1).hover();
	await gears.nth(1).click();
	await expect(page.getByRole('dialog', { name: 'Nastavení karty' })).toBeVisible();
	// It was the second card that was opened, not the one that was selected before.
	await expect(tiles(page).nth(1)).toHaveAttribute('aria-current', 'true');
});

test('an error on a card is in its tile’s name, and a card without one says nothing', async ({ page }) => {
	await expect(tiles(page).first()).not.toHaveAttribute('aria-label', /chyb/);
	// A new question has nothing to choose from yet. Its errors stay quiet while it is
	// being written, so leave it: that is when they are shown.
	await page.getByRole('button', { name: 'Přidat kartu' }).click();
	await page.getByRole('menuitem', { name: 'Otázka' }).click();
	const added = tiles(page).last();
	await expect(added).toHaveAttribute('aria-current', 'true');
	await tiles(page).first().click();
	await expect(added).toHaveAttribute('aria-label', /, \d+ (chyba|chyby|chyb)$/);
	await expect(added.locator('xpath=following-sibling::span[contains(@class,"dot")]')).toHaveCount(1);
});

test('Alt+ArrowDown moves the focused tile and keeps it focused', async ({ page }) => {
	const before = await order(page);
	const name = (label: string | null) => label!.replace(/^\d+\. /, '');
	await tiles(page).first().focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect.poll(async () => (await order(page)).map(name)).toEqual([
		name(before[1]),
		name(before[0]),
		...before.slice(2).map(name)
	]);
	await expect(tiles(page).nth(1)).toBeFocused();
	// Enter still only selects.
	await page.keyboard.press('Enter');
	await expect(tiles(page).nth(1)).toHaveAttribute('aria-current', 'true');
});
