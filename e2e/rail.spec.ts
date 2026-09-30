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
const order = (page: Page) =>
	tiles(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
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

test('a lesson circle’s panel says what is in the lesson, and opens its settings', async ({
	page
}) => {
	const circle = circles(page).first();
	// No native tooltip and no gear on the circle: the panel beside it carries both.
	await expect(circle).not.toHaveAttribute('title', /.*/);
	await circle.hover();
	const panel = page.getByRole('group', { name: 'Lekce 1' });
	await expect(panel).toContainText(/karty · \d+ min · \d+ XP/);
	await panel.getByRole('button', { name: /^Nastavení lekce / }).click();
	await expect(page.getByRole('dialog', { name: 'Nastavení lekce' })).toBeVisible();
	await expect(panel).toBeHidden();
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
		expect(
			`${await tile.getAttribute('aria-label')} ${await tile.getAttribute('title')}`
		).not.toMatch(/L1_|_B\d/);
	}
});

test('a tile is dragged by any part of it, Zpět puts it back, and a drop in place is not an edit', async ({
	page
}) => {
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
				.evaluateAll((items) =>
					items.findIndex((li) => li.hasAttribute('data-is-dnd-shadow-item-internal'))
				);
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
	await expect(tiles(page).last()).toHaveAttribute(
		'aria-label',
		new RegExp(`^${count + 1}\\. Cvičení: `)
	);
});

test('a tile is only an icon, and its actions come out beside it on hover', async ({ page }) => {
	const tile = tiles(page).nth(1);
	// Nothing on the tile or its row but the icon: no number, no gear, no native tooltip.
	await expect(tile).not.toHaveAttribute('title', /.*/);
	await expect(tile).toHaveText('');
	await expect(page.getByRole('button', { name: /^Nastavení \d+\. karty$/ })).toHaveCount(0);
	await tile.hover();
	const panel = page.getByRole('group', { name: 'Karta 2' });
	await expect(panel).toBeVisible();
	await expect(panel).toContainText('2 · ');
	for (const name of [
		'Nastavení 2. karty',
		'Duplikovat 2. kartu',
		'Odebrat 2. kartu z lekce',
		'Smazat 2. kartu'
	]) {
		await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
	}
	// The panel names the button under the pointer, and rests on the card's place.
	await expect(panel.getByText(/^2\. karta z \d+$/)).toBeVisible();
	await panel.getByRole('button', { name: 'Duplikovat 2. kartu' }).hover();
	await expect(panel.locator('.caption')).toHaveText('Duplikovat');
	// Away from the tile and the panel, it goes.
	await page.mouse.move(700, 400);
	await expect(panel).toBeHidden();
});

test('Nastavení in the panel opens that card’s settings, not the selected card’s', async ({
	page
}) => {
	await tiles(page).nth(1).hover();
	await page.getByRole('button', { name: 'Nastavení 2. karty', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Nastavení karty' })).toBeVisible();
	// It was the second card that was opened, not the one that was selected before.
	await expect(tiles(page).nth(1)).toHaveAttribute('aria-current', 'true');
});

test('Duplikovat adds a tile after the card, and the copy is selected', async ({ page }) => {
	const count = await tiles(page).count();
	await tiles(page).first().hover();
	await page.getByRole('button', { name: 'Duplikovat 1. kartu' }).click();
	await expect(tiles(page)).toHaveCount(count + 1);
	await expect(tiles(page).nth(1)).toHaveAttribute('aria-current', 'true');
	await expect(page.getByRole('group', { name: /^Karta \d+$/ })).toBeHidden();
});

test('Odebrat z lekce takes a tile away, the editor keeps the selection, and Vrátit zpět brings it back', async ({
	page
}) => {
	const before = await order(page);
	await tiles(page).nth(2).hover();
	await page.getByRole('button', { name: 'Odebrat 3. kartu z lekce' }).click();
	await expect(tiles(page)).toHaveCount(before.length - 1);
	// The card that was selected still is.
	await expect(tiles(page).first()).toHaveAttribute('aria-current', 'true');
	await expect(page.locator('.toast')).toContainText('Karta odebrána z lekce');
	await page.getByRole('button', { name: 'Vrátit zpět', exact: true }).click();
	await expect.poll(() => order(page)).toEqual(before);
});

test('Smazat needs two clicks: the first arms it, moving away disarms it, the second deletes', async ({
	page
}) => {
	const before = await order(page);
	await tiles(page).nth(2).click();
	await tiles(page).nth(2).hover();
	const panel = page.getByRole('group', { name: 'Karta 3' });
	const erase = panel.getByRole('button', { name: 'Smazat 3. kartu', exact: true });
	await erase.click();
	// Armed: the card is still there, the button says what a second click does.
	await expect(tiles(page)).toHaveCount(before.length);
	const armed = panel.getByRole('button', { name: 'Opravdu smazat 3. kartu? Klikni znovu' });
	await expect(armed).toBeVisible();
	await expect(panel.locator('.caption')).toHaveText('Klikni znovu pro smazání');
	// The pointer leaves the row for the tile, and the panel stays: disarmed.
	await tiles(page).nth(2).hover();
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Smazat 3. kartu', exact: true })).toBeVisible();
	await expect(panel.locator('.caption')).toHaveText(/^3\. karta z \d+$/);
	// Arm again and delete: the card it was, and the neighbour before it is selected.
	await panel.getByRole('button', { name: 'Smazat 3. kartu', exact: true }).click();
	await panel.getByRole('button', { name: 'Opravdu smazat 3. kartu? Klikni znovu' }).click();
	await expect(tiles(page)).toHaveCount(before.length - 1);
	await expect(tiles(page).nth(1)).toHaveAttribute('aria-current', 'true');
	await expect(page.locator('.toast')).toContainText('Karta smazána');
	await page.getByRole('button', { name: 'Vrátit zpět', exact: true }).click();
	await expect.poll(() => order(page)).toEqual(before);
	await expect(tiles(page).nth(2)).toHaveAttribute('aria-current', 'true');
});

test('Escape disarms Smazat and takes the focus back to the tile', async ({ page }) => {
	await tiles(page).nth(1).focus();
	await page.keyboard.press('ArrowRight');
	const panel = page.getByRole('group', { name: 'Karta 2' });
	await expect(panel.getByRole('button', { name: 'Nastavení 2. karty' })).toBeFocused();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect(panel.getByRole('button', { name: /^Opravdu smazat 2\. kartu/ })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(tiles(page).nth(1)).toBeFocused();
	await expect(panel.getByRole('button', { name: 'Smazat 2. kartu', exact: true })).toBeVisible();
	// A second Escape, on the tile, closes the panel.
	await page.keyboard.press('Escape');
	await expect(panel).toBeHidden();
});

test('Smazat on a card another card branches to asks where the pointers go', async ({ page }) => {
	const before = await order(page);
	// The second card is the target of a branch and of a prerequisite.
	await tiles(page).nth(1).hover();
	const panel = page.getByRole('group', { name: 'Karta 2' });
	await panel.getByRole('button', { name: 'Smazat 2. kartu', exact: true }).click();
	await panel.getByRole('button', { name: /^Opravdu smazat/ }).click();
	const dialog = page.getByRole('dialog', { name: /Smazat kartu/ });
	await expect(dialog).toBeVisible();
	await expect(tiles(page)).toHaveCount(before.length);
	await dialog.getByRole('button', { name: 'Zpět', exact: true }).click();
	await expect(tiles(page)).toHaveCount(before.length);
});

test('keyboard: a focused tile shows its panel, → goes into the actions and Enter opens the settings', async ({
	page
}) => {
	await tiles(page).nth(1).focus();
	// Focus by keyboard (not the mouse) shows the panel at once.
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('button', { name: 'Nastavení 2. karty', exact: true })).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('button', { name: 'Duplikovat 2. kartu' })).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Nastavení karty' })).toBeVisible();
	await expect(tiles(page).nth(1)).toHaveAttribute('aria-current', 'true');
});

test('Shift+F10 on a tile opens its panel, and it stays until Escape', async ({ page }) => {
	await tiles(page).nth(1).focus();
	await page.keyboard.press('Shift+F10');
	const panel = page.getByRole('group', { name: 'Karta 2' });
	await expect(panel).toBeVisible();
	await page.mouse.move(700, 400);
	await expect(panel).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(tiles(page).nth(1)).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(panel).toBeHidden();
});

test('running down the tiles moves one panel from tile to tile, and a drag opens none', async ({
	page
}) => {
	await tiles(page).first().hover();
	await expect(page.getByRole('group', { name: 'Karta 1' })).toBeVisible();
	await tiles(page).nth(1).hover();
	await expect(page.getByRole('group', { name: 'Karta 2' })).toBeVisible();
	// Only ever one panel.
	await expect(page.getByRole('group', { name: /^Karta \d+$/ })).toHaveCount(1);
	await page.mouse.move(700, 400);
	await expect(page.getByRole('group', { name: /^Karta \d+$/ })).toHaveCount(0);

	const box = (await tiles(page).nth(0).boundingBox())!;
	await page.mouse.move(box.x + 3, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 3, box.y + box.height / 2 + 30, { steps: 6 });
	await expect(page.getByRole('group', { name: /^Karta \d+$/ })).toHaveCount(0);
	await page.mouse.up();
});

test('an error on a card is in its tile’s name, and a card without one says nothing', async ({
	page
}) => {
	await expect(tiles(page).first()).not.toHaveAttribute('aria-label', /chyb/);
	// A new question has nothing to choose from yet. Its errors stay quiet while it is
	// being written, so leave it: that is when they are shown.
	await page.getByRole('button', { name: 'Přidat kartu' }).click();
	await page.getByRole('menuitem', { name: 'Otázka' }).click();
	const added = tiles(page).last();
	await expect(added).toHaveAttribute('aria-current', 'true');
	await tiles(page).first().click();
	await expect(added).toHaveAttribute('aria-label', /, \d+ (chyba|chyby|chyb)$/);
	await expect(added.locator('xpath=following-sibling::span[contains(@class,"dot")]')).toHaveCount(
		1
	);
});

test('Alt+ArrowDown moves the focused tile and keeps it focused', async ({ page }) => {
	const before = await order(page);
	const name = (label: string | null) => label!.replace(/^\d+\. /, '');
	await tiles(page).first().focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect
		.poll(async () => (await order(page)).map(name))
		.toEqual([name(before[1]), name(before[0]), ...before.slice(2).map(name)]);
	await expect(tiles(page).nth(1)).toBeFocused();
	// Enter still only selects.
	await page.keyboard.press('Enter');
	await expect(tiles(page).nth(1)).toHaveAttribute('aria-current', 'true');
});
