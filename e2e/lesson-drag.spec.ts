import { expect, test, type Page, openEditor } from './fixtures';
import { readFileSync } from 'node:fs';

/**
 * Dragging a lesson in the tree: while it is held every lesson shows only its header
 * (the open one's cards and „Přidat kartu“ row fold away, as steps do), so the dragged
 * copy is one row tall; the open lesson comes back whole on a drop or a plain click.
 */
const fixture = readFileSync(
	new URL('../src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json', import.meta.url),
	'utf8'
);

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'zlomky.json',
		mimeType: 'application/json',
		buffer: Buffer.from(fixture)
	});
	await expect(page.locator('.cards .tree-card').nth(2)).toBeVisible();
});

const names = (page: Page) => page.locator('.tree-lesson > button.lesson .name');
const cards = (page: Page) => page.locator('.cards .tree-card');

test('a lesson held for dragging folds the open lesson, and a drop brings it back', async ({
	page
}) => {
	const before = await names(page).allTextContents();
	expect(before.length).toBeGreaterThanOrEqual(3);
	await expect(page.getByText('Přidat kartu:')).toBeVisible();

	const head = (await names(page).nth(0).boundingBox())!;
	const from = { x: head.x + 20, y: head.y + head.height / 2 };
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await expect(cards(page)).toHaveCount(0);
	await expect(page.getByText('Přidat kartu:')).toHaveCount(0);
	await page.mouse.move(from.x, from.y + 10, { steps: 4 });

	// Folded, the lessons are rows one after another: the third is at a known place.
	const third = (await names(page).nth(2).boundingBox())!;
	const to = third.y + third.height + 4;
	await page.mouse.move(from.x, to, { steps: 12 });
	await expect
		.poll(async () => {
			await page.mouse.move(from.x, to);
			return page
				.locator('ul:not(.cards) > li.tree-lesson')
				.evaluateAll((items) =>
					items.findIndex((li) => li.hasAttribute('data-is-dnd-shadow-item-internal'))
				);
		})
		.toBe(2);
	await expect(cards(page)).toHaveCount(0);
	await page.mouse.up();

	await expect
		.poll(() => names(page).allTextContents())
		.toEqual([before[1], before[2], before[0], ...before.slice(3)]);
	// The lesson that was open is still open, with its cards.
	await expect(cards(page)).toHaveCount(5);
	await expect(page.getByText('Přidat kartu:')).toBeVisible();
});

test('a press on a lesson that never moves leaves the cards where they were', async ({ page }) => {
	const before = await names(page).allTextContents();
	const head = (await names(page).nth(1).boundingBox())!;
	await page.mouse.move(head.x + 20, head.y + head.height / 2);
	await page.mouse.down();
	await expect(cards(page)).toHaveCount(0);
	await page.mouse.up();
	await expect(cards(page).first()).toBeVisible();
	await expect(page.getByText('Přidat kartu:')).toBeVisible();
	expect(await names(page).allTextContents()).toEqual(before);
});

test('a press on a card does not fold the lessons', async ({ page }) => {
	const box = (await cards(page).nth(1).boundingBox())!;
	await page.mouse.move(box.x + 3, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 3, box.y + box.height / 2 + 12, { steps: 4 });
	await expect(cards(page).first()).toBeVisible();
	await expect(page.getByText('Přidat kartu:')).toBeVisible();
	await page.mouse.up();
});
