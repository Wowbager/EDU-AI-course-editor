import { test, expect, openEditor, cardAction, cardActionCount, type Page } from './fixtures';

/**
 * „Dopsat kartu“: AI writes a whole card, several steps, and never changes a part
 * the teacher filled.
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
const steps = (page: Page) => page.locator('.step');

test('an empty card offers to be written, once it says what it is about', async ({ page }) => {
	await openEditor(page);
	await expect(write(page), 'the server has no AI provider').toBeVisible();
	await expect(write(page)).toBeDisabled();
	await expect(brief(page)).toBeVisible();

	await name(page).fill('Co je polovina');
	await expect(write(page)).toBeEnabled();
	await write(page).click();

	// The empty step is filled, and two more screens follow it.
	await expect(firstText(page)).toHaveText('Ukázkový text: Co je polovina.');
	await expect(steps(page)).toHaveCount(3);
	await expect(steps(page).nth(1).locator('.rich-content').first()).toHaveText(
		'Ukázkový text 2: Co je polovina.'
	);
	await expect(page.getByText('Dopsáno: 3 kroky.')).toBeVisible();
	// A written card shows nothing of the offer.
	await expect(write(page)).toHaveCount(0);
	await expect(brief(page)).toHaveCount(0);
	expect(await cardActionCount(page, 'Dopsat, co chybí')).toBe(0);
});

test('one undo takes all the written steps back, and the offer returns', async ({ page }) => {
	await openEditor(page);
	await brief(page).fill('Zavede polovinu jako jednu ze dvou stejných částí');
	await write(page).click();
	await expect(firstText(page)).toHaveText(/^Ukázkový text/);
	await expect(steps(page)).toHaveCount(3);

	await page.getByRole('button', { name: 'Vrátit zpět' }).click();
	await expect(write(page)).toBeVisible();
	await expect(steps(page)).toHaveCount(1);
	await expect(firstText(page)).toHaveText('');
	// The line the teacher wrote is theirs and stays.
	await expect(brief(page)).toHaveValue('Zavede polovinu jako jednu ze dvou stejných částí');
});

for (const type of ['Otázka', 'Cvičení'] as const) {
	test(`a ${type} card is written whole: several questions, each with task, answers, hint and solution`, async ({
		page
	}) => {
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
		// A second question follows, and it is still one card.
		await expect(steps(page)).toHaveCount(2);
		await expect(
			steps(page).nth(1).getByText('Ukázkové zadání 2: Kolik je polovina z osmi.')
		).toBeVisible();
		await expect(page.getByText('Dopsáno: 2 kroky, 2 otázky.')).toBeVisible();
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
	await expect(steps(page)).toHaveCount(2);
	expect(await cardActionCount(page, 'Dopsat, co chybí')).toBe(0);

	// One undo takes back the fill and the new step together.
	await page.getByRole('button', { name: 'Vrátit zpět' }).click();
	await expect(steps(page)).toHaveCount(1);
	await expect(step.locator('.rich-content').first()).toHaveText('Moje vlastní zadání');
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
			? route.fulfill({ json: { status: 'failed' } })
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
	const body = (await sent).postDataJSON();
	expect(body.course.audience).toEqual({ grade: 4, prior_knowledge: 'dělení do 20' });
	// The card's steps travel by id, and the course's text with them.
	expect(body.card.steps).toHaveLength(1);
	expect(typeof body.context).toBe('string');
});

test('a busy provider and a dropped connection leave the offer where it was', async ({ page }) => {
	await openEditor(page);
	await expect(write(page)).toBeVisible();
	// From here on the provider is busy, and asking the server about AI gets no answer.
	await page.route('**/ai/block', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({ status: 503, body: 'busy' })
			: route.abort()
	);
	await name(page).fill('Co je polovina');
	await write(page).click();
	await expect(page.getByText('AI je teď přetížená. Zkus to za chvíli.')).toBeVisible();
	await expect(write(page)).toBeEnabled();
});

test('a server that has lost its provider takes the offer away', async ({ page }) => {
	await openEditor(page);
	await expect(write(page)).toBeVisible();
	await page.route('**/ai/block', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({ status: 503, body: 'AI není nastavena.' })
			: route.fulfill({ json: { configured: false } })
	);
	await name(page).fill('Co je polovina');
	await write(page).click();
	await expect(page.getByText('Kartu se nepodařilo dopsat. Zkus to znovu.')).toBeVisible();
	await expect(write(page)).toHaveCount(0);
});
