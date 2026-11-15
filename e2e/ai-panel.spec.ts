import { test, expect, openEditor, type Page } from './fixtures';

/**
 * AI pomocník: a proposal is asked for, shaped, and only then put into the course, where
 * the cards are written one by one.
 *
 * Runs against the `fake` provider (`playwright.config.ts`): a prompt about „karty“ with a
 * lesson selected gets cards, any other a course of two lessons; a change keeps the
 * proposal and adds a card called „Změna: …“.
 */

/** The tiles on the right side's edge, one per panel. */
const aiTab = (page: Page) => page.getByRole('button', { name: 'AI pomocník', exact: true });
const previewTab = (page: Page) => page.getByRole('button', { name: 'Náhled', exact: true });
const foldAi = (page: Page) => page.getByRole('button', { name: 'Skrýt AI pomocníka' });
const folded = (page: Page) => page.locator('aside.preview.collapsed');
const box = (page: Page) => page.getByRole('textbox', { name: /^Co (mám vytvořit|změnit)\?$/ });
const send = (page: Page) => page.getByRole('button', { name: 'Odeslat', exact: true });
const create = (page: Page) => page.getByRole('button', { name: 'Vytvořit vybrané', exact: true });
const panel = (page: Page) => page.getByRole('region', { name: 'AI', exact: true });
const lessons = (page: Page) => page.locator('.tree-lesson');

async function ask(page: Page, text: string) {
	await box(page).fill(text);
	await send(page).click();
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await aiTab(page).click();
});

test('AI pomocník takes the preview’s place, and the player stays mounted', async ({ page }) => {
	await expect(panel(page)).toBeVisible();
	await expect(panel(page).getByText('Napiš, co chceš vytvořit.')).toBeVisible();
	// Empty: nothing to create, no history.
	await expect(create(page)).toHaveCount(0);
	// The player is still in the page, untouched, only covered and inert.
	await expect(page.locator('iframe[title="Náhled kurzu očima žáka"]')).toHaveCount(1);
	await expect(page.locator('.preview-pane')).toHaveAttribute('inert', '');

	await previewTab(page).click();
	await expect(panel(page)).toHaveCount(0);
	await expect(page.locator('.preview-pane')).not.toHaveAttribute('inert', '');
	await expect(page.locator('iframe[title="Náhled kurzu očima žáka"]')).toHaveCount(1);
	await expect(page.getByRole('radio', { name: 'Náhled', exact: true })).toBeChecked();
});

test('AI pomocník has its own header, and the preview’s header has nothing of AI', async ({
	page
}) => {
	const pane = page.locator('.ai-pane');
	await expect(pane.getByRole('heading', { name: 'AI pomocník' })).toBeVisible();
	await expect(pane.locator('header').getByRole('button')).toHaveCount(1);
	await expect(foldAi(page)).toBeVisible();
	// Nothing of the preview above it: no switch, no player controls.
	await expect(pane.getByRole('radiogroup')).toHaveCount(0);
	// Nothing overflows the side: the player taking focus would scroll the header away.
	expect(
		await page.locator('aside.preview').evaluate((el) => el.scrollHeight - el.clientHeight)
	).toBe(0);

	await previewTab(page).click();
	const header = page.locator('.preview-pane header');
	await expect(header.getByRole('button')).toHaveCount(1);
	await expect(header.getByRole('button')).toHaveAccessibleName('Skrýt náhled');
	await expect(
		page.getByRole('radiogroup', { name: 'Co je v náhledu' }).getByRole('radio')
	).toHaveCount(2);
	await expect(page.locator('.ai-pane')).toHaveCount(0);
});

test('the tiles switch between the two panels, one at a time, and the open one is pressed', async ({
	page
}) => {
	await expect(aiTab(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(previewTab(page)).toHaveAttribute('aria-pressed', 'false');

	await previewTab(page).click();
	await expect(panel(page)).toHaveCount(0);
	await expect(previewTab(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(aiTab(page)).toHaveAttribute('aria-pressed', 'false');

	// A run in Vyzkoušet is left behind for AI, as switching to Náhled leaves it.
	await page.getByRole('radio', { name: 'Vyzkoušet', exact: true }).click();
	await aiTab(page).click();
	await expect(panel(page)).toBeVisible();
	await previewTab(page).click();
	await expect(page.getByRole('radio', { name: 'Náhled', exact: true })).toBeChecked();
	await expect(folded(page)).toHaveCount(0);
});

test('the AI header’s button folds the side; the edge keeps both tiles, and each opens its panel', async ({
	page
}) => {
	await foldAi(page).click();
	await expect(folded(page)).toHaveCount(1);
	await expect(panel(page)).toBeHidden();
	await expect(box(page)).toBeHidden();
	await expect(page.locator('.ai-pane')).toHaveCSS('visibility', 'hidden');
	await expect(page.locator('.inner')).toHaveAttribute('inert', '');
	// Folding from a button inside the panel hands focus to its tile.
	await expect(aiTab(page)).toBeFocused();
	await expect(aiTab(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(previewTab(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(previewTab(page)).toBeVisible();
	await expect(page.locator('.tiles .divider')).toHaveCount(1);
	// Narrow: only the edge is left.
	expect((await page.locator('aside.preview').boundingBox())!.width).toBeLessThan(60);

	await previewTab(page).click();
	await expect(folded(page)).toHaveCount(0);
	await expect(panel(page)).toHaveCount(0);
	await expect(previewTab(page)).toHaveAttribute('aria-pressed', 'true');

	// Pressing the open panel's tile folds the side; the other tile opens straight into AI.
	await previewTab(page).click();
	await expect(folded(page)).toHaveCount(1);
	await aiTab(page).click();
	await expect(folded(page)).toHaveCount(0);
	await expect(panel(page)).toBeVisible();
	await expect(box(page)).toBeVisible();
	await aiTab(page).click();
	await expect(folded(page)).toHaveCount(1);

	// Ctrl+Shift+B opens the side as it was left.
	await page.keyboard.press('Control+Shift+B');
	await expect(panel(page)).toBeVisible();
});

test('a side remembered as folded on AI pomocník boots no player until Náhled is opened', async ({
	page
}) => {
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await foldAi(page).click();
	await expect(folded(page)).toHaveCount(1);
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(folded(page)).toHaveCount(1);
	await expect(page.locator('iframe[title="Náhled kurzu očima žáka"]')).toHaveCount(0);

	await aiTab(page).click();
	await expect(panel(page)).toBeVisible();
	await expect(page.locator('iframe[title="Náhled kurzu očima žáka"]')).toHaveCount(0);
	await previewTab(page).click();
	await expect(page.locator('iframe[title="Náhled kurzu očima žáka"]')).toHaveCount(1);
	await expect(page.locator('aside.preview')).toHaveAttribute('data-player', 'ready');
});

test('a proposal appears lesson by lesson, and can be created when it is complete', async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích');
	await expect(page.getByRole('checkbox', { name: 'Vytvořit lekci: První lekce' })).toBeVisible();
	// The second lesson has not arrived: the model is still writing.
	await expect(panel(page).getByText('Píšu…')).toBeVisible();
	await expect(create(page)).toBeDisabled();
	await expect(page.getByRole('checkbox', { name: 'Vytvořit lekci: Druhá lekce' })).toBeVisible();
	await expect(panel(page).getByText('Píšu…')).toHaveCount(0);
	await expect(create(page)).toBeEnabled();
});

test('a card still waiting for AI shows no errors, however often it is opened', async ({
	page
}) => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/ai/block', async (route) => {
		if (route.request().method() === 'POST') await gate;
		await route.continue();
	});
	await page.locator('.tree-card').first().click();
	await ask(page, 'Dej mi karty na procvičení');
	await expect(create(page)).toBeEnabled();
	await create(page).click();
	const waiting = page.locator('.tree-card').filter({ hasText: 'Kvíz na závěr' });
	await expect(waiting).toBeVisible();
	await waiting.click();
	await expect(page.locator('.step').first()).toBeVisible();
	// Leave it and come back: it was seen, and it is still not an error.
	await page.locator('.tree-card').first().click();
	await waiting.click();
	await expect(page.locator('.step.invalid')).toHaveCount(0);
	// Nor does it offer its own write: the queue is writing it.
	await expect(page.getByRole('button', { name: 'Dopsat kartu' })).toHaveCount(0);
	await expect(page.getByRole('textbox', { name: 'O čem karta je' })).toHaveCount(0);
	// (The empty first card the teacher left is theirs, and does show its own.)
	await expect(waiting.locator('.chip.error')).toHaveCount(0);
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(0);

	release();
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(3);
	await expect(page.locator('.step.invalid')).toHaveCount(0);
	await expect(waiting.locator('.chip.error')).toHaveCount(0);
});

test('the open panel is remembered after a reload', async ({ page }) => {
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(aiTab(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(panel(page)).toBeVisible();

	await previewTab(page).click();
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(previewTab(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(panel(page)).toHaveCount(0);
});

test('a proposal is shaped, created as cards that are then written, and undone', async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích pro 5. třídu');

	// A course structure: a short one shows every lesson open, and they fold by hand.
	await expect(page.getByRole('checkbox', { name: 'Vytvořit lekci: První lekce' })).toBeChecked();
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Co to je' })).toBeVisible();
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Jak se to používá' })).toBeVisible();
	await page.getByRole('button', { name: /Sbalit lekci: Druhá lekce/ }).click();
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Jak se to používá' })).toHaveCount(0);
	await page.getByRole('button', { name: /Rozbalit lekci: Druhá lekce/ }).click();
	// The box is now for changes.
	await expect(box(page)).toHaveAttribute('placeholder', 'Co změnit?');
	// Nothing is in the course yet.
	await expect(lessons(page)).toHaveCount(1);

	// Untick one card, rename another.
	await page.getByRole('checkbox', { name: 'Vytvořit: Procvičení' }).uncheck();
	await page.getByRole('button', { name: 'Ověření', exact: true }).click();
	await panel(page).getByRole('textbox', { name: 'Název karty' }).fill('Kontrola');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Kontrola', exact: true })).toBeVisible();
	// A lesson with some of its cards ticked is neither ticked nor unticked.
	await expect(
		page.getByRole('checkbox', { name: 'Vytvořit lekci: První lekce' })
	).not.toBeChecked();

	await create(page).click();

	// The lessons and the ticked cards are in the left tree at once...
	await expect(lessons(page)).toHaveCount(3);
	// (The course's own first lesson has the same name as the proposed one.)
	await expect(lessons(page).filter({ hasText: 'První lekce' })).toHaveCount(2);
	await expect(lessons(page).filter({ hasText: 'Druhá lekce' })).toHaveCount(1);
	// ...and written one after another: the panel lists every card, each done in the end.
	const rows = panel(page).locator('.queue-row');
	await expect(rows).toHaveCount(4);
	await expect(rows.filter({ hasText: 'Kontrola' })).toHaveCount(1);
	await expect(rows.filter({ hasText: 'Procvičení' })).toHaveCount(0);
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(4);
	await expect(page.getByRole('button', { name: 'Zastavit' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Dopsat zbytek' })).toHaveCount(0);

	// A row opens its card, written.
	await rows.filter({ hasText: 'Co to je' }).click();
	await expect(page.locator('.step .rich-content').first()).toHaveText('Ukázkový text: Co to je.');

	// Four cards written (four undo steps), then the insert: one more takes the lessons away.
	const undo = page.getByRole('button', { name: 'Vrátit', exact: true });
	for (let i = 0; i < 4; i++) await undo.click();
	await expect(lessons(page)).toHaveCount(3);
	await undo.click();
	await expect(lessons(page)).toHaveCount(1);
});

test('cards for the selected lesson go after the selected card', async ({ page }) => {
	await page.locator('.tree-card').first().click();
	await ask(page, 'Dej mi karty na procvičení');
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Kvíz na závěr' })).toBeVisible();
	// No lessons in a cards proposal.
	await expect(page.getByRole('checkbox', { name: /^Vytvořit lekci/ })).toHaveCount(0);
	await create(page).click();
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(3);
	await expect(lessons(page)).toHaveCount(1);
	await expect(page.locator('.tree-card')).toHaveCount(4);
	await expect(page.locator('.tree-card').nth(1)).toContainText('Příklady k procvičení');
});

test('„Co změnit?“ replaces the proposal and keeps what the teacher unticked', async ({ page }) => {
	await ask(page, 'Kurz o zlomcích');
	await page.getByRole('checkbox', { name: 'Vytvořit: Procvičení' }).uncheck();

	await ask(page, 'přidej kvíz na konec');
	// The model changed the proposal: a new card.
	await expect(page.getByRole('button', { name: 'Změna: přidej kvíz na konec' })).toHaveCount(0);
	await expect(
		page.getByRole('checkbox', { name: 'Vytvořit: Změna: přidej kvíz na konec' })
	).toBeChecked();
	// The card the teacher unticked is still unticked.
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Procvičení' })).not.toBeChecked();
	await expect(lessons(page)).toHaveCount(1);
});

test('„Zahodit návrh“ clears the proposal and changes nothing in the course', async ({ page }) => {
	await ask(page, 'Kurz o zlomcích');
	await expect(create(page)).toBeVisible();
	await page.getByRole('button', { name: 'Zahodit návrh', exact: true }).click();
	await page.getByRole('button', { name: 'Opravdu zahodit? Klikni znovu' }).click();
	await expect(create(page)).toHaveCount(0);
	await expect(panel(page).getByText('Napiš, co chceš vytvořit.')).toBeVisible();
	await expect(lessons(page)).toHaveCount(1);
});

test('a card is removed from the proposal and reordered with the keyboard', async ({ page }) => {
	await ask(page, 'Kurz o zlomcích');
	const names = () =>
		page.locator('.lessons > li').first().locator('.cards .name').allTextContents();
	expect(await names()).toEqual(['Co to je', 'Procvičení', 'Ověření']);

	await page.getByRole('button', { name: 'Přesunout: Ověření' }).focus();
	await page.keyboard.press('ArrowUp');
	await expect.poll(names).toEqual(['Co to je', 'Ověření', 'Procvičení']);

	await page.getByRole('button', { name: 'Odebrat z návrhu: Procvičení' }).click({ force: true });
	await expect.poll(names).toEqual(['Co to je', 'Ověření']);
});

test('a card is dragged by its handle to another place in its lesson', async ({ page }) => {
	await ask(page, 'Kurz o zlomcích');
	const names = () =>
		page.locator('.lessons > li').first().locator('.cards .name').allTextContents();
	const grip = page.getByRole('button', { name: 'Přesunout: Ověření' });
	const target = page.locator('.lessons > li').first().locator('.cards > li').first();
	await target.hover();
	const from = (await grip.boundingBox())!;
	const to = (await target.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + 2, to.y + 4, { steps: 8 });
	await page.mouse.up();
	await expect.poll(names).toEqual(['Ověření', 'Co to je', 'Procvičení']);
});

test.describe('without AI', () => {
	test.beforeEach(async ({ page }) => {
		await page.route('**/ai/block', (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { configured: false } })
				: route.continue()
		);
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	});

	test('nothing of AI shows, even when it was the open panel, and the preview folds as before', async ({
		page
	}) => {
		// Remembered as open on AI (the suite's beforeEach), it is the preview that shows.
		await expect(page.locator('aside.preview')).toHaveAttribute('data-player', 'ready');
		await expect(aiTab(page)).toHaveCount(0);
		await expect(previewTab(page)).toHaveCount(0);
		await expect(page.locator('.tiles')).toHaveCount(0);
		await expect(panel(page)).toHaveCount(0);

		await page.getByRole('button', { name: 'Skrýt náhled' }).click();
		await expect(folded(page)).toHaveCount(1);
		await expect(page.getByRole('button', { name: 'Ukázat náhled' })).toBeFocused();
		await expect(aiTab(page)).toHaveCount(0);
		await page.getByRole('button', { name: 'Ukázat náhled' }).click();
		await expect(folded(page)).toHaveCount(0);
		await expect(panel(page)).toHaveCount(0);
	});
});
