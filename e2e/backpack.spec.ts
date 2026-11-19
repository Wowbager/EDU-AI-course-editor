import { expect, test, type Locator, type Page, openEditor, cardMenu } from './fixtures';
import { readFileSync } from 'node:fs';

/**
 * Moving cards around: onto another lesson's name, into the backpack's two parts and
 * back out (`card-drag.svelte.ts`), and through the card's ⋯ menu.
 */
const fixture = readFileSync(
	new URL('../src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json', import.meta.url),
	'utf8'
);

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await page.evaluate(() => localStorage.removeItem('edu-editor:backpack:v1'));
	await page.setInputFiles('input[type=file]', {
		name: 'zlomky.json',
		mimeType: 'application/json',
		buffer: Buffer.from(fixture)
	});
	await expect(rows(page).nth(3)).toBeVisible();
});

const rows = (page: Page) => page.locator('.tree-lesson.open .cards .tree-card');
const titles = (page: Page) => rows(page).locator('.snippet').allTextContents();
const lessonButton = (page: Page, name: string) =>
	page.locator('.tree-lesson .lesson').filter({ hasText: name });
const lessonMeta = (page: Page, name: string) => lessonButton(page, name).locator('.meta');
const backpackButton = (page: Page) => page.getByRole('button', { name: 'Batoh', exact: true });
const loose = (page: Page) => page.getByRole('list', { name: 'Karty z tohoto kurzu mimo lekce' });
const saved = (page: Page) => page.getByRole('list', { name: 'Moje karty' });
const undo = (page: Page) => page.getByRole('button', { name: 'Vrátit', exact: true });

async function openBackpack(page: Page) {
	if ((await backpackButton(page).getAttribute('aria-expanded')) !== 'true')
		await backpackButton(page).click();
	await expect(saved(page)).toBeVisible();
}

/**
 * Press on `from`, carry it to `to` and let go once `ready` holds: the zones slide for
 * 150 ms while they make room, and a release before that lands somewhere else.
 */
async function drag(page: Page, from: Locator, to: Locator, ready: () => Promise<boolean>) {
	const a = (await from.boundingBox())!;
	const start = { x: a.x + 12, y: a.y + a.height / 2 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x, start.y + 10, { steps: 4 });
	const b = (await to.boundingBox())!;
	const end = { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 20) };
	await page.mouse.move(end.x, end.y, { steps: 14 });
	await expect
		.poll(async () => {
			await page.mouse.move(end.x + 1, end.y);
			await page.mouse.move(end.x, end.y);
			return ready();
		})
		.toBe(true);
	await page.mouse.up();
}

const hasShadow = (zone: Locator) => async () =>
	(await zone.locator('[data-is-dnd-shadow-item-internal]').count()) > 0;

test('a card dropped on another lesson’s name goes to its end, and Vrátit brings it back', async ({
	page
}) => {
	const before = await titles(page);
	await expect(lessonMeta(page, 'Porovnávání zlomků')).toContainText('5 karet');
	const target = lessonButton(page, 'Porovnávání zlomků');

	await drag(page, rows(page).nth(1), target, async () =>
		(await target.getAttribute('class'))!.includes('drop-target')
	);

	await expect(rows(page)).toHaveCount(before.length - 1);
	expect(await titles(page)).toEqual([before[0], ...before.slice(2)]);
	await expect(lessonMeta(page, 'Porovnávání zlomků')).toContainText('6 karet');
	// The teacher stays where they were.
	await expect(page.locator('.tree-lesson.open .lesson .name')).toHaveText('Co je zlomek?');

	await target.click();
	await expect(rows(page).last()).toContainText(before[1].slice(0, 20));

	await undo(page).click();
	await expect(lessonMeta(page, 'Co je zlomek?')).toContainText(`${before.length} kar`);
	await expect(lessonMeta(page, 'Porovnávání zlomků')).toContainText('5 karet');
});

test('Moje karty keeps a copy: the lesson keeps its card, and a copy goes back in where dropped', async ({
	page
}) => {
	const before = await titles(page);
	await openBackpack(page);
	await expect(saved(page).getByRole('button')).toHaveCount(0);

	await drag(page, rows(page).nth(2), saved(page), hasShadow(saved(page)));

	await expect(saved(page).locator('.row')).toHaveCount(1);
	// Saved from this course, so it does not say where from.
	await expect(saved(page).locator('.row')).not.toContainText('z kurzu');
	await expect.poll(() => titles(page)).toEqual(before);

	// Kept across a reload, in this browser.
	await page.reload();
	await expect(rows(page).nth(3)).toBeVisible();
	await openBackpack(page);
	await expect(saved(page).locator('.row')).toHaveCount(1);

	// Out again, between the first and second card: a new card, and the backpack keeps its copy.
	const list = page.locator('.tree-lesson.open .cards');
	await drag(page, saved(page).locator('.row').first(), rows(page).nth(1), () =>
		list.evaluate(
			(ul) =>
				[...ul.children].findIndex((li) => li.hasAttribute('data-is-dnd-shadow-item-internal')) ===
				1
		)
	);
	await expect(rows(page)).toHaveCount(before.length + 1);
	const after = await titles(page);
	expect(after[0]).toBe(before[0]);
	expect(after.slice(2)).toEqual(before.slice(1));
	await expect(saved(page).locator('.row')).toHaveCount(1);

	await saved(page).locator('.row').hover();
	await page.getByRole('button', { name: /^Vyndat z batohu/ }).click();
	await expect(saved(page).locator('.row')).toHaveCount(0);
});

test('Z tohoto kurzu: a card dragged in leaves its lesson, and dragged out goes back in', async ({
	page
}) => {
	const before = await titles(page);
	await openBackpack(page);

	await drag(page, rows(page).nth(1), loose(page), hasShadow(loose(page)));
	await expect(loose(page).getByRole('button')).toHaveCount(1);
	expect(await titles(page)).toEqual([before[0], ...before.slice(2)]);
	await expect(page.locator('.toast')).toContainText('Z tohoto kurzu');

	// Onto the open lesson's own name (the backpack covers the lessons below it): to its end.
	await drag(
		page,
		loose(page).getByRole('button').first(),
		lessonButton(page, 'Co je zlomek?'),
		async () =>
			(await lessonButton(page, 'Co je zlomek?').getAttribute('class'))!.includes('drop-target')
	);
	await expect(loose(page).getByRole('button')).toHaveCount(0);
	await expect.poll(() => titles(page)).toEqual([before[0], ...before.slice(2), before[1]]);
});

test('the backpack opens once for a card taken out of its lesson, and stays closed while it is written', async ({
	page
}) => {
	await rows(page).nth(1).click();
	await cardMenu(page);
	await page.getByRole('menuitem', { name: 'Odebrat z lekce' }).click();
	await expect(loose(page).getByRole('button')).toHaveCount(1);

	await backpackButton(page).click();
	await expect(saved(page)).toHaveCount(0);
	await page.locator('.rich-content').first().click();
	await page.keyboard.type(' a dál');
	await expect(page.locator('.rich-content').first()).toContainText('a dál');
	await expect(saved(page)).toHaveCount(0);
});

test('a card held over the closed backpack opens it', async ({ page }) => {
	await expect(saved(page)).toHaveCount(0);
	const row = rows(page).nth(1);
	const a = (await row.boundingBox())!;
	await page.mouse.move(a.x + 12, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(a.x + 12, a.y + a.height / 2 + 10, { steps: 4 });
	const b = (await backpackButton(page).boundingBox())!;
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
	await expect(saved(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await page.mouse.up();
});

test('⋯ Přesunout do lekce moves the open card; Uložit kopii do batohu keeps a copy', async ({
	page
}) => {
	const before = await titles(page);
	await rows(page).nth(1).click();

	await cardMenu(page);
	await page.getByRole('menuitem', { name: 'Uložit kopii do batohu' }).click();
	await expect(page.locator('.toast')).toContainText('Moje karty');
	expect(await titles(page)).toEqual(before);

	await cardMenu(page);
	await page.getByRole('menuitem', { name: 'Přesunout do lekce…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Přesunout do lekce' });
	await dialog.getByRole('combobox', { name: 'Lekce' }).selectOption({ label: 'Zlomky v praxi' });
	await dialog.getByRole('button', { name: 'Přesunout', exact: true }).click();

	await expect(lessonMeta(page, 'Zlomky v praxi')).toContainText('6 karet');
	// The open card went with it, so the editor follows it there.
	await expect(page.locator('.tree-lesson.open .lesson .name')).toHaveText('Zlomky v praxi');

	await openBackpack(page);
	await expect(saved(page).locator('.row')).toHaveCount(1);
});
