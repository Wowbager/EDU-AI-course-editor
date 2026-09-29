import { expect, test, openEditor } from './fixtures';

/**
 * Which side panels are folded is remembered in the browser (`state/layout-prefs.ts`)
 * and can be toggled from the keyboard. Folding is not an edit, so it must never
 * look like one to another tab.
 */
const fold = (page: import('./fixtures').Page) => page.getByRole('button', { name: 'Sbalit panel lekcí' });
const unfold = (page: import('./fixtures').Page) => page.getByRole('button', { name: 'Rozbalit panel lekcí' });

test('Ctrl+B folds the lesson panel and the choice survives a reload', async ({ page }) => {
	await openEditor(page);
	await expect(fold(page)).toBeVisible();
	await page.keyboard.press('Control+b');
	await expect(unfold(page)).toBeVisible();

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(unfold(page)).toBeVisible();

	await unfold(page).click();
	await expect(fold(page)).toBeVisible();
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(fold(page)).toBeVisible();
});

test('a page that opens with the panel remembered as folded starts folded', async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'edu-editor:ui:v1',
			JSON.stringify({ format: 1, sidebarCollapsed: true, previewCollapsed: false })
		)
	);
	await openEditor(page);
	await expect(unfold(page)).toBeVisible();
	// The transition is back on once the page has settled, for the teacher's own clicks.
	await expect(page.locator('.columns.settled')).toHaveCount(1);
	const width = await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
	expect(width).toBeLessThan(80);
});

test('AltGr+B (Ctrl+Alt+B) does not fold the panel', async ({ page }) => {
	await openEditor(page);
	await page.keyboard.press('Control+Alt+b');
	await expect(fold(page)).toBeVisible();
});

test('another tab does not see a layout change as a conflicting edit', async ({ page, context }) => {
	await openEditor(page);
	const other = await context.newPage();
	await openEditor(other);
	const heard = other.evaluate(
		() => new Promise<string | null>((resolve) => addEventListener('storage', (e) => resolve(e.key), { once: true }))
	);
	await page.keyboard.press('Control+b');
	expect(await heard).toBe('edu-editor:ui:v1');
	await expect(other.getByText(/změnil v jiné kartě/)).toHaveCount(0);
	await expect(other.locator('.save-state')).not.toHaveText('Ukládání pozastaveno');

	// Control: the draft's own key still is a conflict for the second tab.
	await page.evaluate(() => localStorage.setItem('edu-editor:draft:v1', '{}'));
	await expect(other.getByText(/změnil v jiné kartě/)).toBeVisible();
	await expect(other.locator('.save-state')).toHaveText('Ukládání pozastaveno');
});
