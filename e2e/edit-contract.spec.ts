import { expect, openEditor, test, type Locator, type Page } from './fixtures';

/**
 * Every place a teacher types into keeps one contract with the course's undo:
 *
 * - a run of typing is one undo entry, and Ctrl+Z inside the field undoes the course;
 * - Escape takes the run back and leaves nothing to undo;
 * - leaving the field ends the run.
 *
 * Held against each surface the same way, so a surface added later — or a view a field
 * switches into — cannot quietly keep its own rules.
 */

interface Surface {
	name: string;
	/** Open the page on this surface and give the editable element. */
	open(page: Page): Promise<Locator>;
}

const undoButton = (page: Page) => page.getByRole('button', { name: 'Zpět', exact: true });

async function sourceView(page: Page): Promise<Locator> {
	await page.locator('.rich-content').first().click();
	await page.getByRole('button', { name: 'Další formátování' }).first().click();
	await page.getByRole('menuitem', { name: 'Upravit jako text (Markdown)' }).click();
	const source = page.locator('[data-source] .cm-content').first();
	await expect(source).toBeVisible();
	return source;
}

const surfaces: Surface[] = [
	{ name: 'a text step, visually', open: async (page) => page.locator('.rich-content').first() },
	{
		name: 'an answer, visually',
		open: async (page) => {
			await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
			return page.locator('.answers').getByRole('textbox', { name: 'Text odpovědi' }).first();
		}
	},
	{ name: 'a text step, as Markdown', open: sourceView }
];

async function typeAtEnd(page: Page, field: Locator, text: string) {
	await field.click();
	await page.keyboard.press('Control+End');
	await page.keyboard.type(text);
	await expect(field).toContainText(text.trim());
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

for (const surface of surfaces) {
	test.describe(surface.name, () => {
		test('a run of typing is one undo entry, and Ctrl+Z in the field undoes the course', async ({
			page
		}) => {
			const field = await surface.open(page);
			await typeAtEnd(page, field, ' Ahoj světe');
			await page.keyboard.press('Control+z');
			await expect(field).not.toContainText('Ahoj');
			await page.keyboard.press('Control+Shift+z');
			await expect(field).toContainText('Ahoj světe');
		});

		test('Escape takes the run back and leaves nothing to undo', async ({ page }) => {
			const field = await surface.open(page);
			const undoable = await undoButton(page).isEnabled();
			await typeAtEnd(page, field, ' Zrušit tohle');
			await page.keyboard.press('Escape');
			await expect(field).not.toContainText('Zrušit');
			await expect(undoButton(page)).toBeEnabled({ enabled: undoable });
		});

		test('leaving the field ends the run', async ({ page }) => {
			const field = await surface.open(page);
			await typeAtEnd(page, field, ' První');
			await page.getByRole('heading', { level: 1 }).click();
			await typeAtEnd(page, field, ' Druhá');
			await page.keyboard.press('Control+z');
			await expect(field).not.toContainText('Druhá');
			await expect(field).toContainText('První');
		});
	});
}

test('switching to Markdown mid-run ends the run, and the source view keeps its own', async ({
	page
}) => {
	// Copilot, PR #3: the switch closed the store's session but not the field's, so
	// every keystroke in the source view became an undo entry of its own.
	const visual = page.locator('.rich-content').first();
	await typeAtEnd(page, visual, ' Vizuálně');
	const source = await sourceView(page);
	await typeAtEnd(page, source, ' Zdrojově');
	await page.keyboard.press('Control+z');
	await expect(source).not.toContainText('Zdrojově');
	await expect(source).toContainText('Vizuálně');
	await page.keyboard.press('Control+z');
	await expect(source).not.toContainText('Vizuálně');
});
