import { addStep, expect, openEditor, test, type Page } from './fixtures';

/**
 * One focus convention for every add and every delete (OPEN-PROBLEMS #31): an added
 * item's first field gets focus; a deleted item's neighbour does (the next one, else
 * the previous one, else the add button), so a keyboard author is never dropped onto
 * the page.
 */
test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

const focusedIn = (page: Page, selector: string) => page.locator(`${selector}:has(:focus)`);

async function exerciseCard(page: Page) {
	await page.locator('.tree-add').getByRole('button', { name: 'Cvičení', exact: true }).click();
	await expect(page.locator('.tree-card')).toHaveCount(2);
}

test('a step added from the menu gets focus in its first field', async ({ page }) => {
	await exerciseCard(page);
	await addStep(page, 'Text');
	await expect(focusedIn(page, 'main .step-wrap').last()).toHaveCount(1);
	await addStep(page, 'Otázka');
	await expect(focusedIn(page, 'main .step-wrap').last()).toHaveCount(1);
});

test('deleting a step focuses its neighbour, and the add button after the last one', async ({
	page
}) => {
	await exerciseCard(page);
	await addStep(page, 'Text');
	const steps = page.locator('main .step-wrap');
	const before = await steps.count();
	await steps.last().getByRole('button', { name: 'Smazat krok' }).click();
	await expect(steps).toHaveCount(before - 1);
	await expect(focusedIn(page, 'main .step-wrap').last()).toHaveCount(1);

	while ((await steps.count()) > 0) {
		await steps.first().getByRole('button', { name: 'Smazat krok' }).click();
		await expect(
			page.locator('main .step-wrap, main .add-step button:focus').first()
		).toBeVisible();
	}
	await expect(page.locator('main .add-step').getByRole('button')).toBeFocused();
});

test('Enter in the last answer adds the next one and focuses it; deleting focuses a neighbour', async ({
	page
}) => {
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	const rows = page.locator('main .answers .rows > .row');
	const count = await rows.count();
	const last = rows.last().getByRole('textbox', { name: 'Text odpovědi' });
	await last.click();
	await page.keyboard.type('Poslední');
	await page.keyboard.press('Enter');
	await expect(rows).toHaveCount(count + 1);
	await expect(focusedIn(page, 'main .answers .rows > .row').last()).toHaveCount(1);

	// An empty last answer does not breed another.
	await page.keyboard.press('Enter');
	await expect(rows).toHaveCount(count + 1);

	await rows
		.last()
		.getByRole('button', { name: /^Smazat odpověď/ })
		.click();
	await expect(rows).toHaveCount(count);
	await expect(focusedIn(page, 'main .answers .rows > .row').last()).toHaveCount(1);
});

test('the answer button focuses the new answer', async ({ page }) => {
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	const rows = page.locator('main .answers .rows > .row');
	const count = await rows.count();
	await page.getByRole('button', { name: 'Další odpověď' }).click();
	await expect(rows).toHaveCount(count + 1);
	await expect(focusedIn(page, 'main .answers .rows > .row').last()).toHaveCount(1);
});

test('an added card is focused in the list, and a deleted one hands focus to its neighbour', async ({
	page
}) => {
	await exerciseCard(page);
	await expect(page.locator('.tree-card.selected')).toBeFocused();

	const del = page.locator('.tree-row').nth(1).locator('.action.danger');
	await del.click();
	await del.click();
	await expect(page.locator('.tree-card')).toHaveCount(1);
	await expect(page.locator('.tree-card')).toBeFocused();
});
