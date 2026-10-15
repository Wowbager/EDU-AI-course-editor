import { expect, openEditor, test, type Page } from './fixtures';

/**
 * CodeMirror, the Markdown source view, is a chunk of its own (`ui/codemirror.ts`): a
 * page whose fields all show visually never fetches it, and the first source view
 * does, then takes focus once the editor is really there.
 */

const scripts = (page: Page) =>
	page.evaluate(() =>
		performance
			.getEntriesByType('resource')
			.map((entry) => new URL(entry.name).pathname)
			.filter((path) => path.startsWith('/_app/') && path.endsWith('.js'))
	);

/** Which of these scripts carry CodeMirror: its view's own class name is in them. */
const withCodeMirror = (page: Page, paths: string[]) =>
	page.evaluate(async (list) => {
		const found: string[] = [];
		for (const path of list) {
			if ((await (await fetch(path)).text()).includes('cm-scroller')) found.push(path);
		}
		return found;
	}, paths);

test('the source view loads its editor when it is first opened, and focuses it', async ({
	page
}) => {
	await openEditor(page);
	await page.locator('.tree-add').getByRole('button', { name: 'Výklad', exact: true }).click();
	const text = page.locator('.rich-content').first();
	await expect(text).toBeVisible();
	await page.waitForLoadState('networkidle');
	const before = new Set(await scripts(page));
	expect(await withCodeMirror(page, [...before])).toEqual([]);
	await expect(page.locator('.cm-content')).toHaveCount(0);

	await text.click();
	await page
		.getByRole('toolbar', { name: 'Formátování textu' })
		.getByRole('button', { name: 'Další formátování' })
		.click();
	await page.getByRole('menuitem', { name: 'Upravit jako text (Markdown)' }).click();

	const source = page.locator('[data-source] .cm-content').first();
	await expect(source).toBeFocused();
	const fetched = (await scripts(page)).filter((path) => !before.has(path));
	expect(await withCodeMirror(page, fetched)).toHaveLength(1);

	// And it takes typing like the editor it stands in for.
	await page.keyboard.type('Ahoj');
	await expect(source).toContainText('Ahoj');
});
