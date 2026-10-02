import { cardMenu, expect, test, openEditor, openMenu } from './fixtures';

const COURSE = 'src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json';

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', COURSE);
	await expect(page.locator('.tree-card').first()).toBeVisible();
});

test('removing a step or an answer offers "Vrátit zpět", like removing a card', async ({
	page
}) => {
	await page.locator('.tree-card').nth(1).click();
	const del = page.getByRole('button', { name: 'Smazat krok' });
	await expect(del).toHaveCount(3);
	await del.last().click();
	const toast = page.locator('.toast');
	await expect(toast).toContainText('Krok smazán.');
	await expect(del).toHaveCount(2);
	await toast.getByRole('button', { name: 'Vrátit zpět' }).click();
	await expect(del).toHaveCount(3);

	await page.locator('.tree-card').nth(2).click();
	const answer = page.getByRole('button', { name: /^Smazat odpověď/ });
	const before = await answer.count();
	await answer.first().click();
	await expect(toast).toContainText('Odpověď smazána.');
	await expect(answer).toHaveCount(before - 1);
	await toast.getByRole('button', { name: 'Vrátit zpět' }).click();
	await expect(answer).toHaveCount(before);
});

test('a card, a step and a lesson move without dragging', async ({ page }) => {
	const snippets = page.locator('.tree-card .snippet');
	await page.locator('.tree-card').nth(1).click();
	const second = await snippets.nth(1).innerText();
	let menu = await cardMenu(page);
	await menu.getByRole('menuitem', { name: 'Posunout nahoru' }).click();
	await expect(snippets.nth(0)).toHaveText(second);
	// At the top it cannot go further up.
	menu = await cardMenu(page);
	await expect(menu.getByRole('menuitem', { name: 'Posunout nahoru' })).toBeDisabled();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();

	// A step: the handle answers the arrow keys, the menu has the same two actions.
	const grips = page.getByRole('button', { name: /^Přesunout krok/ });
	// Compared by content: the header's "Krok N" follows the position, as it should.
	const content = (i: number) =>
		page
			.getByRole('group', { name: /^Obsah kroku/ })
			.nth(i)
			.getByRole('textbox')
			.first();
	const firstText = (await content(0).textContent()) ?? '';
	await grips.first().focus();
	await page.keyboard.press('ArrowDown');
	await expect(content(1)).toHaveText(firstText);
	const stepMenu = page.getByRole('menu', { name: 'Další akce s krokem', exact: true });
	await openMenu(
		page,
		page.getByRole('button', { name: 'Další akce s krokem' }).first(),
		'Další akce s krokem',
		stepMenu.getByRole('menuitem', { name: 'Posunout nahoru' })
	);
	await expect(stepMenu.getByRole('menuitem', { name: 'Posunout nahoru' })).toBeDisabled();
	await page.keyboard.press('Escape');

	// A lesson, from its settings.
	const names = page.locator('.tree-lesson > button.lesson .name');
	const firstLesson = await names.nth(0).innerText();
	await page
		.getByRole('button', { name: /^Nastavení lekce/ })
		.first()
		.click();
	await expect(page.getByRole('button', { name: 'Posunout nahoru' })).toBeDisabled();
	await page.getByRole('button', { name: 'Posunout dolů' }).click();
	await page.getByRole('button', { name: 'Hotovo' }).click();
	await expect(names.nth(1)).toHaveText(firstLesson);
});

test('a new lesson opens with its name selected, so typing renames it', async ({ page }) => {
	await page.getByRole('button', { name: 'Nová lekce' }).click();
	const dialog = page.getByRole('dialog', { name: 'Nastavení lekce' });
	await expect(dialog.getByRole('textbox').first()).toBeFocused();
	await page.keyboard.type('Moje lekce');
	await dialog.getByRole('button', { name: 'Hotovo' }).click();
	await expect(page.locator('.tree-lesson > button.lesson .name').last()).toHaveText('Moje lekce');
});

test('Pokročilý says what "Více otázek v jedné kartě" will do before it is switched', async ({
	page
}) => {
	await page.getByRole('radiogroup', { name: 'Režim editoru' }).getByText('Pokročilý').click();
	await page.locator('.tree-card').filter({ hasText: 'Na talíři' }).click();
	await page.getByRole('button', { name: 'Nastavení karty' }).click();
	const dialog = page.getByRole('dialog', { name: 'Nastavení karty' });
	await dialog.getByText('Údaje o kartě').first().click();
	await expect(dialog.getByText('Spojí 2 otázky této karty do jedné.')).toBeVisible();
});
