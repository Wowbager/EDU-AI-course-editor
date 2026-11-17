import {
	test,
	expect,
	openEditor,
	cardsIntoFirstLesson,
	OPEN_COURSE_KEY,
	DRAFT_PREFIX,
	type Page
} from './fixtures';

/**
 * The outline in the AI tab, shaped by hand: started without the AI, typed row by row,
 * a card's kind changed, cards carried between lessons, every change undone and redone,
 * and „Zahodit návrh“ asking twice.
 *
 * Runs against the `fake` provider (`playwright.config.ts`): „Kurz o zlomcích“ gets two
 * lessons, První lekce (Co to je, Procvičení, Ověření) and Druhá lekce (Jak se to
 * používá, Úlohy); a change adds „Změna: …“ to the last lesson and a card to an empty one.
 */

const aiTab = (page: Page) => page.getByRole('button', { name: 'AI pomocník', exact: true });
const panel = (page: Page) => page.getByRole('region', { name: 'AI', exact: true });
const box = (page: Page) => page.getByRole('textbox', { name: /^Co (mám vytvořit|změnit)\?$/ });
const create = (page: Page) => page.getByRole('button', { name: 'Vytvořit vybrané', exact: true });
const lessonField = (page: Page) => panel(page).getByRole('textbox', { name: 'Název lekce' });
const cardField = (page: Page) => panel(page).getByRole('textbox', { name: 'Název karty' });
const lessonsInCourse = (page: Page) => page.locator('.tree-lesson');
/** The names of the cards under the proposal's lesson `i`. */
const names = (page: Page, i: number) => () =>
	page.locator('.lessons > li').nth(i).locator('.cards .name').allTextContents();
const lessonNames = (page: Page) => () =>
	page.locator('.lessons > li .head .name').allTextContents();

async function ask(page: Page, text: string) {
	await box(page).fill(text);
	await page.getByRole('button', { name: 'Odeslat', exact: true }).click();
	await expect(create(page)).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await aiTab(page).click();
});

test('an outline is started without the AI and typed lesson by lesson, card by card', async ({
	page
}) => {
	await expect(panel(page).getByText('Napiš, co chceš vytvořit.')).toBeVisible();
	await panel(page).getByRole('button', { name: 'Nová lekce' }).click();
	// The new lesson's name is a field, empty and ready to type.
	await expect(lessonField(page)).toBeFocused();
	await expect(lessonField(page)).toHaveValue('');
	await page.keyboard.type('Sčítání zlomků');
	// Enter after a new lesson's name starts its first card.
	await page.keyboard.press('Enter');
	await expect(cardField(page)).toBeFocused();
	await expect(cardField(page)).toHaveValue('');
	await page.keyboard.type('Stejný jmenovatel');
	await page.keyboard.press('Enter');
	// Enter after a card's name starts the next one, right below.
	await expect(cardField(page)).toBeFocused();
	await page.keyboard.type('Různé jmenovatele');
	await page.keyboard.press('Enter');
	// Enter on the empty new row ends, and the row goes.
	await page.keyboard.press('Enter');
	await expect(cardField(page)).toHaveCount(0);
	await expect.poll(names(page, 0)).toEqual(['Stejný jmenovatel', 'Různé jmenovatele']);
	await expect(
		page.getByRole('checkbox', { name: 'Vytvořit lekci: Sčítání zlomků' })
	).toBeChecked();

	// A row Enter started and left alone goes when the teacher clicks away.
	await panel(page).getByRole('button', { name: 'Různé jmenovatele', exact: true }).click();
	await page.keyboard.press('Enter');
	await expect(cardField(page)).toBeFocused();
	await cardField(page).blur();
	await expect.poll(names(page, 0)).toEqual(['Stejný jmenovatel', 'Různé jmenovatele']);
	// One whose kind is changed is kept, unnamed.
	await panel(page).getByRole('button', { name: 'Různé jmenovatele', exact: true }).click();
	await page.keyboard.press('Enter');
	await expect(cardField(page)).toBeFocused();
	await page
		.locator('.lessons > li')
		.first()
		.locator('.cards > li')
		.last()
		.getByRole('button', { name: /^Typ karty/ })
		.click();
	await page.getByRole('menuitemradio', { name: 'Cvičení' }).click();
	await expect
		.poll(names(page, 0))
		.toEqual(['Stejný jmenovatel', 'Různé jmenovatele', 'bez názvu']);
	await page.getByRole('button', { name: 'Odebrat z návrhu: bez názvu' }).click();
	await expect.poll(names(page, 0)).toEqual(['Stejný jmenovatel', 'Různé jmenovatele']);

	// A second lesson, left empty and named: it is created without cards.
	await panel(page).getByRole('button', { name: 'Nová lekce' }).click();
	await page.keyboard.type('Opakování');
	await lessonField(page).blur();
	await expect.poll(lessonNames(page)).toEqual(['Sčítání zlomků', 'Opakování']);
	// A third one clicked away from without a name stays, „bez názvu“.
	await panel(page).getByRole('button', { name: 'Nová lekce' }).click();
	await expect(lessonField(page)).toBeFocused();
	await lessonField(page).blur();
	await expect.poll(lessonNames(page)).toEqual(['Sčítání zlomků', 'Opakování', 'bez názvu']);
	// Nothing is created while it has no name; the panel says so, and stops once it is unticked.
	await create(page).click();
	const hint = panel(page).getByText('Řádky bez názvu pojmenuj, nebo je odškrtni.');
	await expect(hint).toBeVisible();
	await expect(lessonsInCourse(page)).toHaveCount(1);
	// The cursor is in the row that needs the name.
	await expect(lessonField(page)).toBeFocused();
	await page.keyboard.press('Escape');
	await page.getByRole('checkbox', { name: 'Vytvořit lekci: bez názvu' }).uncheck();
	await expect(hint).toHaveCount(0);
	// It asks again only at the next click, not for every new row.
	await panel(page).getByRole('button', { name: 'Nová lekce' }).click();
	await lessonField(page).blur();
	await expect(page.getByRole('checkbox', { name: 'Vytvořit lekci: bez názvu' })).toHaveCount(2);
	await expect(hint).toHaveCount(0);
	await page.getByRole('button', { name: 'Odebrat z návrhu lekci: bez názvu' }).last().click();

	await create(page).click();
	// In place of the new course's empty first lesson.
	await expect(lessonsInCourse(page)).toHaveCount(2);
	await expect(lessonsInCourse(page).filter({ hasText: 'Opakování' })).toHaveCount(1);
	await expect(panel(page).locator('.queue-row')).toHaveCount(2);
});

test('cards for a lesson are started by hand too, where „Kam“ says', async ({ page }) => {
	await cardsIntoFirstLesson(page);
	// „Kam“ is in a lesson: the hand-made outline is cards, not a lesson.
	await expect(panel(page).getByRole('button', { name: 'Nová lekce' })).toHaveCount(0);
	await panel(page).getByRole('button', { name: 'Nová karta' }).click();
	await expect(cardField(page)).toBeFocused();
	await page.keyboard.type('Moje karta');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Moje karta' })).toBeChecked();
	// No lessons in a proposal of cards.
	await expect(page.getByRole('checkbox', { name: /^Vytvořit lekci/ })).toHaveCount(0);
	await create(page).click();
	// After the card the teacher wrote in.
	await expect(page.locator('.tree-card')).toHaveCount(2);
	await expect(page.locator('.tree-card').nth(1)).toContainText('Moje karta');
	await expect(lessonsInCourse(page)).toHaveCount(1);
});

test('„+ karta“ and „+ lekce“ show on hover, and a new row left empty stays unnamed while an emptied one keeps its name', async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích');
	const first = page.locator('.lessons > li').first();
	const addCard = panel(page).getByRole('button', { name: 'Nová karta v lekci: První lekce' });
	await page.mouse.move(0, 0);
	await expect(addCard).toHaveCSS('opacity', '0');
	await first.locator('.head').hover();
	await expect(addCard).toHaveCSS('opacity', '1');

	await addCard.click();
	await expect(cardField(page)).toBeFocused();
	await expect(cardField(page)).toHaveValue('');
	// It is of the kind of the card above it.
	await expect(
		first
			.locator('.cards > li')
			.last()
			.getByRole('button', { name: /^Typ karty/ })
	).toHaveAccessibleName('Typ karty: Otázka');
	// Its kind is changed before it has a name: the row stays.
	await first
		.locator('.cards > li')
		.last()
		.getByRole('button', { name: /^Typ karty/ })
		.click();
	await page.getByRole('menuitemradio', { name: 'Výklad' }).click();
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení', 'Ověření', 'bez názvu']);
	await expect(
		first
			.locator('.cards > li')
			.last()
			.getByRole('button', { name: /^Typ karty/ })
	).toHaveAccessibleName('Typ karty: Výklad');
	// Named later, by clicking it.
	await page.getByRole('button', { name: 'bez názvu', exact: true }).click();
	await page.keyboard.type('Shrnutí lekce');
	await cardField(page).blur();
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení', 'Ověření', 'Shrnutí lekce']);
	await page.getByRole('button', { name: 'Odebrat z návrhu: Shrnutí lekce' }).click();

	// An existing name emptied is the old one.
	await page.getByRole('button', { name: 'Procvičení', exact: true }).click();
	await cardField(page).fill('');
	await cardField(page).blur();
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení', 'Ověření']);

	await panel(page).getByRole('button', { name: 'Nová lekce' }).click();
	await page.keyboard.type('Třetí lekce');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Shrnutí');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect.poll(lessonNames(page)).toEqual(['První lekce', 'Druhá lekce', 'Třetí lekce']);
	await expect.poll(names(page, 2)).toEqual(['Shrnutí']);
	// A hand-made card starts as Výklad and has no sources line.
	const shrnuti = page.locator('.row.card').filter({ hasText: 'Shrnutí' });
	await expect(shrnuti.getByRole('button', { name: 'Typ karty: Výklad' })).toBeVisible();
	await expect(shrnuti.locator('.source')).toHaveCount(0);
});

test('Backspace in an empty name removes the row and goes on in the one above', async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích');
	await page.getByRole('button', { name: 'Ověření', exact: true }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect(cardField(page)).toHaveValue('');
	await page.keyboard.press('Backspace');
	// Back in Ověření, at the end of its name.
	await expect(cardField(page)).toHaveValue('Ověření');
	await expect(cardField(page)).toBeFocused();
	const rows = page.locator('.lessons > li').first().locator('.cards > li');
	await expect(rows).toHaveCount(3);
	// Emptied and Backspace once more: the card goes, and the one above is edited.
	await cardField(page).fill('');
	await page.keyboard.press('Backspace');
	await expect(cardField(page)).toHaveValue('Procvičení');
	await expect(rows).toHaveCount(2);
	await page.keyboard.press('Escape');
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení']);
	// A lesson with cards is not removed by Backspace.
	await page.getByRole('button', { name: 'Druhá lekce', exact: true }).click();
	await lessonField(page).fill('');
	await page.keyboard.press('Backspace');
	await expect(lessonField(page)).toBeFocused();
	await page.keyboard.press('Escape');
	await expect.poll(lessonNames(page)).toEqual(['První lekce', 'Druhá lekce']);
});

test("a card's kind is changed from its icon, by mouse or keyboard", async ({ page }) => {
	await ask(page, 'Kurz o zlomcích');
	const row = page.locator('.row.card').filter({ hasText: 'Co to je' });
	const kind = row.getByRole('button', { name: /^Typ karty/ });
	await expect(kind).toHaveAccessibleName('Typ karty: Výklad');
	await kind.click();
	const menu = page.getByRole('menu', { name: 'Typ karty' });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitemradio')).toHaveText(['Výklad', 'Otázka', 'Cvičení']);
	await expect(menu.getByRole('menuitemradio', { name: 'Výklad' })).toBeFocused();
	await expect(menu.getByRole('menuitemradio', { name: 'Výklad' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await menu.getByRole('menuitemradio', { name: 'Cvičení' }).click();
	await expect(menu).toBeHidden();
	await expect(kind).toHaveAccessibleName('Typ karty: Cvičení');
	// The card keeps its name and tick.
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Co to je' })).toBeChecked();

	// Keyboard: arrows, Enter; Escape closes without a change and focus is back on the icon.
	await kind.focus();
	await page.keyboard.press('Enter');
	await expect(menu.getByRole('menuitemradio', { name: 'Cvičení' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(menu.getByRole('menuitemradio', { name: 'Výklad' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(kind).toHaveAccessibleName('Typ karty: Otázka');
	await expect(kind).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(menu).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(kind).toBeFocused();
	await expect(kind).toHaveAccessibleName('Typ karty: Otázka');
	// A click outside closes it.
	await kind.click();
	await expect(menu).toBeVisible();
	await box(page).click();
	await expect(menu).toBeHidden();

	await create(page).click();
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(5);
});

/**
 * Press the card `name` by its handle and carry it down until its bottom edge is just past
 * `target`'s middle, or up (`up`) until its top edge is.
 */
async function carry(
	page: Page,
	name: string,
	target: () => Promise<{ y: number; height: number }>,
	up = false
) {
	const row = page.locator('.row.card').filter({ hasText: name });
	await row.hover();
	const grip = row.getByRole('button', { name: `Přesunout: ${name}` });
	const g = (await grip.boundingBox())!;
	const r = (await row.boundingBox())!;
	const t = await target();
	await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
	await page.mouse.down();
	const middle = t.y + t.height / 2;
	const by = up ? middle - 4 - r.y : middle + 4 - (r.y + r.height);
	await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + by, { steps: 10 });
}

test('a card is dragged into another lesson, into a folded one, and put back by Escape', async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích');
	const second = page.locator('.lessons > li').nth(1);
	const head = async () => (await second.locator('.head').boundingBox())!;

	// Past the middle of the next lesson's head: the start of that lesson.
	await carry(page, 'Ověření', head);
	await expect(page.locator('.row.card.dragged')).toHaveCount(1);
	await page.mouse.up();
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení']);
	await expect.poll(names(page, 1)).toEqual(['Ověření', 'Jak se to používá', 'Úlohy']);

	// And back up, past the head again, to the end of the first lesson.
	await carry(page, 'Ověření', head, true);
	await page.mouse.up();
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení', 'Ověření']);
	await expect.poll(names(page, 1)).toEqual(['Jak se to používá', 'Úlohy']);

	// Escape puts the row back.
	await carry(page, 'Co to je', head);
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.locator('.row.card.dragged')).toHaveCount(0);
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení', 'Ověření']);

	// Onto a folded lesson's head: the card goes to its end.
	await page.getByRole('button', { name: 'Sbalit lekci: Druhá lekce' }).click();
	await carry(page, 'Co to je', head);
	await expect(second.locator('.head')).toHaveClass(/dropping/);
	await page.mouse.up();
	await expect(page.getByRole('button', { name: 'Rozbalit lekci: Druhá lekce' })).toBeVisible();
	await page.getByRole('button', { name: 'Rozbalit lekci: Druhá lekce' }).click();
	await expect.poll(names(page, 1)).toContain('Co to je');
	expect((await names(page, 1)()).at(-1)).toBe('Co to je');
});

test('the arrow keys on a handle move a card past the end of its lesson into the next', async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích');
	const grip = page.getByRole('button', { name: 'Přesunout: Ověření' });
	await grip.focus();
	await page.keyboard.press('ArrowDown');
	await expect.poll(names(page, 1)).toEqual(['Ověření', 'Jak se to používá', 'Úlohy']);
	await expect(grip).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení', 'Ověření']);
	await expect(grip).toBeFocused();
	// At the very top it stays.
	const top = page.getByRole('button', { name: 'Přesunout: Co to je' });
	await top.focus();
	await page.keyboard.press('ArrowUp');
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení', 'Ověření']);
});

test("Ctrl+Z in the panel undoes the outline's changes, not the course's, and Ctrl+Shift+Z redoes them", async ({
	page
}) => {
	// Something in the course to undo, from cards the AI wrote.
	await cardsIntoFirstLesson(page);
	await ask(page, 'Dej mi karty');
	await create(page).click();
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(3);
	await expect(page.locator('.tree-card')).toHaveCount(4);

	await ask(page, 'Kurz o zlomcích');
	await page.getByRole('button', { name: 'Odebrat z návrhu: Procvičení' }).click({ force: true });
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Ověření']);
	await page.getByRole('checkbox', { name: 'Vytvořit: Co to je' }).uncheck();
	await page.keyboard.press('Control+z');
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Co to je' })).toBeChecked();
	await page.keyboard.press('Control+z');
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Procvičení', 'Ověření']);
	await expect(page.locator('.tree-card')).toHaveCount(4);
	await page.keyboard.press('Control+Shift+z');
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Ověření']);
	await page.keyboard.press('Control+y');
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Co to je' })).not.toBeChecked();

	// While a name is typed, Ctrl+Z is the field's own.
	await page.getByRole('button', { name: 'Ověření', exact: true }).click();
	await page.keyboard.press('End');
	await page.keyboard.type('xyz');
	await page.keyboard.press('Control+z');
	await expect(cardField(page)).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Co to je' })).not.toBeChecked();
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Ověření']);

	// „Zahodit návrh“ is undone too.
	const discard = page.getByRole('button', { name: 'Zahodit návrh' });
	await discard.click();
	await page.getByRole('button', { name: 'Opravdu zahodit? Klikni znovu' }).click();
	await expect(create(page)).toHaveCount(0);
	await page.keyboard.press('Control+z');
	await expect(create(page)).toBeVisible();
	await expect.poll(names(page, 0)).toEqual(['Co to je', 'Ověření']);

	// Back past the proposal itself, then the course's undo takes over.
	for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
	await expect(create(page)).toHaveCount(0);
	await expect(page.locator('.tree-card')).toHaveCount(4);
	// Three cards written and their insert: four steps of the course.
	for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
	await expect(page.locator('.tree-card')).toHaveCount(1);
});

test('„Zahodit návrh“ asks for a second click, red only then, and forgets it when left', async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích');
	const discard = page.getByRole('button', { name: 'Zahodit návrh', exact: true });
	const color = await discard.evaluate((el) => getComputedStyle(el).color);
	await discard.hover();
	const hoverColor = await discard.evaluate((el) => getComputedStyle(el).color);
	await discard.click();
	const armed = page.getByRole('button', { name: 'Opravdu zahodit? Klikni znovu' });
	await expect(armed).toBeVisible();
	await expect(create(page)).toBeVisible();
	const armedColor = await armed.evaluate((el) => getComputedStyle(el).color);
	expect(armedColor).not.toBe(color);
	expect(armedColor).not.toBe(hoverColor);
	// Moving on disarms it.
	await page.mouse.move(0, 0);
	await expect(discard).toBeVisible();
	await discard.focus();
	await page.keyboard.press('Enter');
	await expect(armed).toBeVisible();
	await page.keyboard.press('Shift+Tab');
	await expect(discard).toBeVisible();
	// Twice: the proposal goes, the course is as it was.
	await discard.click();
	await armed.click();
	await expect(create(page)).toHaveCount(0);
	await expect(panel(page).getByText('Napiš, co chceš vytvořit.')).toBeVisible();
	await expect(lessonsInCourse(page)).toHaveCount(1);
});

test('„Co změnit?“ works on an outline made by hand', async ({ page }) => {
	await panel(page).getByRole('button', { name: 'Nová lekce' }).click();
	await page.keyboard.type('Moje lekce');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect(box(page)).toHaveAttribute('placeholder', 'Co změnit?');
	await box(page).fill('doplň karty');
	await page.getByRole('button', { name: 'Odeslat', exact: true }).click();
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Úvod: Moje lekce' })).toBeChecked();
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Změna: doplň karty' })).toBeChecked();
	await expect(panel(page).getByRole('status')).toHaveCount(0);
});

test("a new course's empty first lesson and card give way to the outline, and come back with one undo", async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích');
	await create(page).click();
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(5);
	// Only the outline's lessons and cards: no empty lesson or card is left over.
	await expect
		.poll(() => lessonsInCourse(page).locator('.name').allTextContents())
		.toEqual(['První lekce', 'Druhá lekce']);
	// The tree shows the open lesson's cards: the selection was on the card that went, and
	// is on the first new one.
	await expect(page.locator('.tree-card')).toHaveCount(3);
	await expect(page.locator('.tree-card.selected')).toContainText('Co to je');

	// Five cards written, then the insert: the starter lesson and its card are back, selected.
	const undo = page.getByRole('button', { name: 'Vrátit', exact: true });
	for (let i = 0; i < 6; i++) await undo.click();
	await expect(lessonsInCourse(page)).toHaveCount(1);
	await expect(page.locator('.tree-card')).toHaveCount(1);
	await expect(page.locator('.tree-card.selected')).toHaveCount(1);
	await expect(page.locator('.rich-content').first()).toBeVisible();
});

test('once every card is written, the next outline is started by hand', async ({ page }) => {
	await ask(page, 'Kurz o zlomcích');
	await create(page).click();
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(5);
	await panel(page).getByRole('button', { name: 'Nová lekce', exact: true }).click();
	await expect(lessonField(page)).toBeFocused();
	// The finished cards gave way to the new outline.
	await expect(panel(page).locator('.queue-row')).toHaveCount(0);
});

test('a starter the teacher has typed into is kept', async ({ page }) => {
	await page.locator('.rich-content').first().click();
	await page.keyboard.type('Zlomek je část celku.');
	await ask(page, 'Kurz o zlomcích');
	await create(page).click();
	await expect(lessonsInCourse(page)).toHaveCount(3);
	// Still open, with its card.
	await expect(page.locator('.tree-card')).toHaveCount(1);
	await expect(page.locator('.tree-card').first()).toContainText('Zlomek je část celku.');
});

test('a „Nová lekce“ just added and selected gives way to the lessons of the outline', async ({
	page
}) => {
	// The starter is the teacher's now: they wrote in it.
	await page.locator('.rich-content').first().click();
	await page.keyboard.type('Úvod');
	// The tree's own button, not the panel's „+ lekce“.
	await page.locator('div.add').getByRole('button', { name: 'Nová lekce' }).click();
	const settings = page.getByRole('dialog', { name: 'Nastavení lekce' });
	await settings.getByRole('button', { name: 'Hotovo' }).click();
	await expect(settings).toHaveCount(0);
	await expect(lessonsInCourse(page)).toHaveCount(2);
	await ask(page, 'Kurz o zlomcích');
	await create(page).click();
	await expect
		.poll(() => lessonsInCourse(page).locator('.name').allTextContents())
		.toEqual(['První lekce', 'První lekce', 'Druhá lekce']);
});

test('the outline is back after a reload, with its hand-made rows, ticks and prompt', async ({
	page
}) => {
	await ask(page, 'Kurz o zlomcích');
	await page.getByRole('checkbox', { name: 'Vytvořit: Procvičení' }).uncheck();
	await panel(page).getByRole('button', { name: 'Nová lekce' }).click();
	await page.keyboard.type('Moje lekce');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Moje karta');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect.poll(lessonNames(page)).toEqual(['První lekce', 'Druhá lekce', 'Moje lekce']);

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect.poll(lessonNames(page)).toEqual(['První lekce', 'Druhá lekce', 'Moje lekce']);
	await expect.poll(names(page, 2)).toEqual(['Moje karta']);
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Procvičení' })).not.toBeChecked();
	await expect(page.getByRole('checkbox', { name: 'Vytvořit: Moje karta' })).toBeChecked();
	await expect(box(page)).toHaveAttribute('placeholder', 'Co změnit?');

	// Its first prompt came back with it: it is saved on the course at „Vytvořit vybrané“.
	await create(page).click();
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(5);
	await expect
		.poll(async () => {
			const saved = await page.evaluate(
				([open, prefix]) => {
					const id = localStorage.getItem(open);
					const key =
						id !== null && localStorage.getItem(prefix + id) !== null
							? prefix + id
							: Object.keys(localStorage).find((k) => k.startsWith(prefix));
					return key === undefined ? null : localStorage.getItem(key);
				},
				[OPEN_COURSE_KEY, DRAFT_PREFIX]
			);
			return saved === null ? undefined : JSON.parse(saved).doc.authoring_request;
		})
		.toBe('Kurz o zlomcích');
	// And once created it is not there after another reload.
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(panel(page).getByText('Napiš, co chceš vytvořit.')).toBeVisible();
});

test("another course does not show this course's outline", async ({ page }) => {
	await ask(page, 'Kurz o zlomcích');
	await page.setInputFiles(
		'input[type=file][accept*="json"]',
		'src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json'
	);
	await expect(page.getByText('každá otázka se teď žákovi hodnotí zvlášť')).toBeVisible();
	await expect(panel(page).getByText('Napiš, co chceš vytvořit.')).toBeVisible();
	await expect(create(page)).toHaveCount(0);
	// Its history is not this course's either.
	await panel(page).focus();
	await page.keyboard.press('Control+z');
	await expect(create(page)).toHaveCount(0);
});
