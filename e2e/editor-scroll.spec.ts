import { expect, openEditor, test } from './fixtures';

/**
 * The editor column keeps its scrollbar's room (`scrollbar-gutter`), so a card does not
 * move sideways when an edit makes the column scroll, or stop scrolling. Headless
 * Chromium hides scrollbars unless told not to, and then nothing could move.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('the card does not shift sideways when its column starts to scroll', async ({ page }) => {
	await openEditor(page);
	await page.locator('.tree-add').getByRole('button', { name: 'Cvičení', exact: true }).click();
	const column = page.locator('main.editor');
	const card = page.locator('main .step').first();
	const scrolls = () => column.evaluate((el) => el.scrollHeight > el.clientHeight);
	// Tall enough for the whole card, then short enough that the column scrolls.
	await page.setViewportSize({ width: 1440, height: 2400 });
	await expect.poll(scrolls).toBe(false);
	const before = await card.boundingBox();
	await page.setViewportSize({ width: 1440, height: 500 });
	await expect.poll(scrolls).toBe(true);
	const after = await card.boundingBox();
	expect([after!.x, after!.width]).toEqual([before!.x, before!.width]);
});
