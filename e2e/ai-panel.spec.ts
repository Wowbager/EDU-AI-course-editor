import { test, expect, openEditor, type Page } from './fixtures';

/**
 * The AI tab: a proposal is asked for, shaped, and only then put into the course, where
 * the cards are written one by one.
 *
 * Runs against the `fake` provider (`playwright.config.ts`): a prompt about „karty“ with a
 * lesson selected gets cards, any other a course of two lessons; a change keeps the
 * proposal and adds a card called „Změna: …“.
 */

const aiTab = (page: Page) => page.getByRole('button', { name: 'AI', exact: true });
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

test('the AI tab replaces Náhled in the column and the player stays mounted', async ({ page }) => {
	await expect(panel(page)).toBeVisible();
	await expect(panel(page).getByText('Napiš, co chceš vytvořit.')).toBeVisible();
	// Empty: nothing to create, no history.
	await expect(create(page)).toHaveCount(0);
	// The player is still in the page, untouched, only covered and inert.
	await expect(page.locator('iframe[title="Náhled kurzu očima žáka"]')).toHaveCount(1);
	await expect(page.locator('.player')).toHaveAttribute('inert', '');

	await page.getByRole('radio', { name: 'Náhled', exact: true }).click();
	await expect(panel(page)).toHaveCount(0);
	await expect(page.locator('.player')).not.toHaveAttribute('inert', '');
	await expect(page.locator('iframe[title="Náhled kurzu očima žáka"]')).toHaveCount(1);
});

test('the AI button is its own, between the fold button and the switch, and presses back to the preview', async ({
	page
}) => {
	const header = page.locator('aside.preview header');
	const buttons = header.getByRole('button');
	await expect(buttons.nth(0)).toHaveAccessibleName('Skrýt náhled');
	await expect(buttons.nth(1)).toHaveAccessibleName('AI');
	// The switch has two choices only, and none is chosen while AI is on.
	const group = page.getByRole('radiogroup', { name: 'Co je v náhledu' });
	await expect(group.getByRole('radio')).toHaveCount(2);
	await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);

	await aiTab(page).click();
	await expect(panel(page)).toHaveCount(0);
	await expect(group.getByRole('radio', { name: 'Náhled' })).toBeChecked();
	await aiTab(page).click();
	await expect(panel(page)).toBeVisible();
	await page.getByRole('radio', { name: 'Vyzkoušet', exact: true }).click();
	await expect(panel(page)).toHaveCount(0);
	await expect(group.getByRole('radio', { name: 'Vyzkoušet' })).toBeChecked();
});

test('folding the column on the AI tab leaves nothing of the panel, and the strip opens straight into AI', async ({
	page
}) => {
	await page.getByRole('button', { name: 'Skrýt náhled' }).click();
	await expect(panel(page)).toBeHidden();
	await expect(box(page)).toBeHidden();
	await expect(page.locator('.ai-slot')).toHaveCSS('visibility', 'hidden');
	await expect(page.locator('.ai-slot')).toHaveAttribute('inert', '');
	await expect(page.getByRole('button', { name: 'Ukázat náhled' })).toBeVisible();

	await page.getByRole('button', { name: 'Otevřít AI' }).click();
	await expect(panel(page)).toBeVisible();
	await expect(box(page)).toBeVisible();
	await expect(aiTab(page)).toHaveAttribute('aria-pressed', 'true');

	// From Náhled: fold, then the strip's AI button opens AI, not Náhled.
	await aiTab(page).click();
	await page.getByRole('button', { name: 'Skrýt náhled' }).click();
	await page.getByRole('button', { name: 'Otevřít AI' }).click();
	await expect(panel(page)).toBeVisible();
	// The strip's other button opens the column as it was left.
	await page.getByRole('button', { name: 'Skrýt náhled' }).click();
	await page.getByRole('button', { name: 'Ukázat náhled' }).click();
	await expect(panel(page)).toBeVisible();
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

test('the choice is remembered after a reload', async ({ page }) => {
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(aiTab(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(panel(page)).toBeVisible();
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
