import { expect, test, openEditor } from './fixtures';

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('a freshly imported course is not "upraveno" before the teacher has edited anything', async ({
	page
}) => {
	await page.setInputFiles(
		'input[type=file]',
		'src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json'
	);
	const version = page.locator('header .version');
	// The file has a card with several questions, so the import splits it (OPEN-PROBLEMS
	// #22: recorded before that split, the new version read "upraveno" at once).
	await expect(page.getByText('každá otázka se teď žákovi hodnotí zvlášť')).toBeVisible();
	// The import is recorded as a version in the background: wait until it has landed
	// (the title stops saying nothing is saved), then check the reading.
	await expect(version).not.toHaveAttribute('title', /Zatím není uložená žádná verze/);
	await expect(version).toHaveText(/^\s*v1\s*$/);
	await expect(version).not.toContainText('upraveno');
	await expect(page.locator('.tree-card').first()).toBeVisible();
	await page.locator('.tree-card').first().click();
	await expect(version).not.toContainText('upraveno');
	await page.locator('.tree-card').nth(1).click();
	await expect(version).not.toContainText('upraveno');
});
