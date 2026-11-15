import { test, expect, openEditor, cardAction, cardActionCount, type Page } from './fixtures';

/**
 * „Dopsat kartu“: AI writes the empty parts of a card and never a filled one.
 *
 * The server these suites start runs the `fake` provider (`playwright.config.ts`),
 * which answers from the request alone: its texts start with „Ukázk…“ and carry the
 * card's name. A server that was already running and has no provider offers no AI,
 * and then the first test here says so.
 */

const write = (page: Page) => page.getByRole('button', { name: 'Dopsat kartu', exact: true });
const name = (page: Page) => page.getByRole('textbox', { name: 'Název karty', exact: true });
const brief = (page: Page) => page.getByRole('textbox', { name: 'O čem karta je', exact: true });
const firstText = (page: Page) => page.locator('.step .rich-content').first();

test('an empty card offers to be written, once it says what it is about', async ({ page }) => {
	await openEditor(page);
	await expect(write(page), 'the server has no AI provider').toBeVisible();
	await expect(write(page)).toBeDisabled();
	await expect(brief(page)).toBeVisible();

	await name(page).fill('Co je polovina');
	await expect(write(page)).toBeEnabled();
	await write(page).click();

	await expect(firstText(page)).toHaveText('Ukázkový text: Co je polovina.');
	await expect(page.getByText('Karta dopsána.')).toBeVisible();
	// A written card shows nothing of the offer.
	await expect(write(page)).toHaveCount(0);
	await expect(brief(page)).toHaveCount(0);
	expect(await cardActionCount(page, 'Dopsat, co chybí')).toBe(0);
});

test('one undo takes the written text back, and the offer returns', async ({ page }) => {
	await openEditor(page);
	await brief(page).fill('Zavede polovinu jako jednu ze dvou stejných částí');
	await write(page).click();
	await expect(firstText(page)).toHaveText(/^Ukázkový text/);

	await page.getByRole('button', { name: 'Vrátit zpět' }).click();
	await expect(write(page)).toBeVisible();
	await expect(firstText(page)).toHaveText('');
	// The line the teacher wrote is theirs and stays.
	await expect(brief(page)).toHaveValue('Zavede polovinu jako jednu ze dvou stejných částí');
});

for (const type of ['Otázka', 'Cvičení'] as const) {
	test(`a ${type} card is written whole: task, answers, hint and solution`, async ({ page }) => {
		await openEditor(page);
		await page.locator('.tree-add').getByRole('button', { name: type, exact: true }).click();
		await name(page).fill('Kolik je polovina z osmi');
		await write(page).click();

		const step = page.locator('.step').first();
		await expect(step.locator('.rich-content').first()).toHaveText(
			'Ukázkový text: Kolik je polovina z osmi.'
		);
		await expect(step.getByText('Ukázková odpověď 1')).toBeVisible();
		await expect(step.getByText('Ukázková odpověď 3')).toBeVisible();
		await expect(step.getByText('Ukázkové vysvětlení řešení.')).toBeVisible();
		await expect(write(page)).toHaveCount(0);
	});
}

test('a card the teacher started gets only what is missing, from the ⋯ menu', async ({ page }) => {
	await openEditor(page);
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	const step = page.locator('.step').first();
	await step.locator('.rich-content').first().click();
	await page.keyboard.type('Moje vlastní zadání');
	// Something is written, so the card no longer offers itself; the menu does.
	await expect(write(page)).toHaveCount(0);

	await cardAction(page, 'Dopsat, co chybí');
	await expect(step.getByText('Ukázková odpověď 1')).toBeVisible();
	await expect(step.locator('.rich-content').first()).toHaveText('Moje vlastní zadání');
	expect(await cardActionCount(page, 'Dopsat, co chybí')).toBe(0);
});

test('without a provider on the server nothing about AI is shown', async ({ page }) => {
	await page.route('**/ai/block', (route) => route.fulfill({ json: { configured: false } }));
	await openEditor(page);
	await expect(name(page)).toBeVisible();
	await expect(write(page)).toHaveCount(0);
	await expect(brief(page)).toHaveCount(0);
});

test('a failed request says so and leaves the card as it was', async ({ page }) => {
	await openEditor(page);
	await expect(write(page)).toBeVisible();
	await page.route('**/ai/block', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({ json: { status: 'failed', block: {} } })
			: route.fallback()
	);
	await name(page).fill('Co je polovina');
	await write(page).click();
	await expect(page.getByText('Kartu se nepodařilo dopsat. Zkus to znovu.')).toBeVisible();
	await expect(write(page)).toBeEnabled();
	await expect(firstText(page)).toHaveText('');
});

test('who the course is for is set once, in the course settings', async ({ page }) => {
	await openEditor(page);
	await page.getByRole('button', { name: /Nastavení kurzu/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Nastavení kurzu' });
	const fold = dialog.getByRole('button', { name: 'Pro koho kurz je' });
	await fold.click();
	await dialog.getByRole('combobox', { name: 'Ročník' }).selectOption('4');
	await dialog.getByRole('textbox', { name: 'Co už žáci umí' }).fill('dělení do 20');
	await dialog.getByRole('button', { name: 'Hotovo' }).click();

	const sent = page.waitForRequest((r) => r.url().endsWith('/ai/block') && r.method() === 'POST');
	await name(page).fill('Co je polovina');
	await write(page).click();
	expect((await sent).postDataJSON().course.audience).toEqual({
		grade: 4,
		prior_knowledge: 'dělení do 20'
	});
});
