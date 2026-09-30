import { expect, test, openEditor, type Page } from './fixtures';
import { readFileSync } from 'node:fs';

const key = 'edu-editor:draft:v1';
const fixture = readFileSync(
	new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url)
);

/**
 * The draft's state is the top bar button's accessible name, so a test that needs to
 * know the draft has been flushed waits for "Koncept uložen…" — the same condition the
 * teacher's screen reader hears, and the one that means `localStorage` holds the edit.
 */
const saved = (page: Page) =>
	page.getByRole('button', { name: /^Koncept uložen v tomto prohlížeči\./ });
const failed = (page: Page) =>
	page.getByRole('button', { name: /^Koncept se nepodařilo uložit\./ });
const paused = (page: Page) => page.getByRole('button', { name: /^Ukládání pozastaveno\./ });
const backup = (
	page: Page,
	has: 'Bez zálohy v souboru' | 'Staženo do souboru' | 'Uloženo v tomto prohlížeči'
) => page.getByRole('button', { name: new RegExp(`${has}\\.$`) });

test.beforeEach(async ({ page }) => {
	// onMount has seeded/restored the document and attached every input handler.
	// Typing before this was the hydration race behind a lost import guard.
	await openEditor(page);
});

test('unblurred feedback survives reload even when export is blocked', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	const feedback = page.getByRole('textbox', { name: 'Zpětná vazba k této odpovědi' }).first();
	await feedback.fill('Nezapomeň porovnat jmenovatele.\nDruhý řádek.');
	await expect(feedback).toBeFocused();
	// Checked without touching the page: clicking anything would blur the field.
	await expect(page.getByRole('button', { name: /^Kontrola kurzu: .*chyb/ })).toBeVisible();
	await expect(saved(page)).toBeVisible();
	await page.reload();
	await expect(feedback).toHaveValue('Nezapomeň porovnat jmenovatele.\nDruhý řádek.');
	expect(errors).toEqual([]);
});

test('a restored draft says so quietly, once, and does not repeat the count', async ({ page }) => {
	await page.locator('.cm-content').first().click();
	await page.keyboard.type('Zlomek');
	await expect(saved(page)).toBeVisible();
	await page.reload();
	// The top bar already counts what is left; the banner is for a file just loaded.
	await expect(page.getByRole('button', { name: /^Kontrola kurzu: / })).toBeVisible();
	await expect(page.locator('.banner.unfinished')).toHaveCount(0);
	const notice = page.locator('.recovery');
	await expect(notice).toContainText('Obnoven koncept uložený v tomto prohlížeči.');
	await expect(notice).not.toHaveClass(/stuck/);
	// It has no button to press, so it goes by itself.
	await expect(notice).toHaveCount(0, { timeout: 15_000 });
});

test('typing groups undo, Escape cancels, and redo is saved', async ({ page }) => {
	const field = page.getByRole('textbox', { name: 'Název kurzu', exact: true });
	await field.click({ position: { x: 3, y: 4 } });
	await field.fill('');
	await field.pressSequentially('Moje lekce');
	await field.press('Enter');
	await field.press('Control+z');
	await expect(field).toHaveValue('Nový kurz');
	await field.press('Control+y');
	await expect(field).toHaveValue('Moje lekce');
	await field.fill('Zrušit tuto změnu');
	await field.press('Escape');
	await expect(field).toHaveValue('Moje lekce');
	await field.blur();
	await page.getByRole('button', { name: 'Zpět', exact: true }).click();
	await expect(field).toHaveValue('Nový kurz');
	await page.getByRole('button', { name: 'Vpřed', exact: true }).click();
	await expect(saved(page)).toBeVisible();
	await page.reload();
	await expect(field).toHaveValue('Moje lekce');
});

test('a run of typing in a text step is one undo, however it ends', async ({ page }) => {
	const text = page.locator('.cm-content').first();

	// Typed key by key, then left: one Ctrl+Z takes the whole sentence back.
	await text.click();
	await page.keyboard.type('Zlomek popisuje část celku.');
	await expect(text).toContainText('Zlomek popisuje část celku.');
	await page.getByRole('heading', { level: 1 }).click();
	await expect(text).not.toBeFocused();
	await page.keyboard.press('Control+z');
	await expect(text).not.toContainText('Zlomek');
	await page.keyboard.press('Control+Shift+z');
	await expect(text).toContainText('Zlomek popisuje část celku.');

	// Still inside the field, Ctrl+Z undoes the run too, and what is typed after it
	// is a run of its own.
	await page.keyboard.press('Control+z');
	await text.click();
	await page.keyboard.type('První věta.');
	await page.keyboard.press('Control+z');
	await expect(text).not.toContainText('První');
	await expect(text).toBeFocused();
	await page.keyboard.type('Druhá věta.');
	await expect(text).toContainText('Druhá věta.');
	await page.keyboard.press('Control+z');
	await expect(text).not.toContainText('Druhá');
	await page.keyboard.press('Control+Shift+z');
	await expect(text).toContainText('Druhá věta.');
});

test('undoing an edit in the middle of a text leaves the cursor where the edit was', async ({
	page
}) => {
	const text = page.locator('.cm-content').first();
	await text.click();
	await page.keyboard.type('Ahoj světe');
	await page.getByRole('heading', { level: 1 }).click();
	await text.click();
	await page.keyboard.press('Home');
	for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.type('!');
	await expect(text).toContainText('Ahoj! světe');
	await page.keyboard.press('Control+z');
	await expect(text).toContainText('Ahoj světe');
	await page.keyboard.type('?');
	await expect(text).toContainText('Ahoj? světe');
});

test('storage failure is visible and unload is guarded', async ({ page }) => {
	await page.evaluate(() => {
		Storage.prototype.setItem = () => {
			throw new DOMException('full', 'QuotaExceededError');
		};
	});
	await page.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('Neztratit');
	await expect(failed(page)).toHaveText('Koncept se nepodařilo uložit');
	await expect(page.getByRole('alert')).toHaveText('Koncept se nepodařilo uložit');
	expect(
		await page.evaluate(() => {
			const event = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		})
	).toBe(true);
});

test('corrupt draft is not overwritten without an explicit backed-up replacement', async ({
	page
}) => {
	// Install after this page unloads so its final save cannot replace the fixture.
	await page.addInitScript((key) => localStorage.setItem(key, '{broken'), key);
	await page.reload();
	await expect(paused(page)).toHaveText('Ukládání pozastaveno');
	await page.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('Náhradní kurz');
	expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe('{broken');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Zálohovat původní a uložit tento kurz' }).click();
	await expect(saved(page)).toBeVisible();
	expect(
		await page.evaluate(
			(key) =>
				Object.keys(localStorage).some(
					(k) => k.startsWith(key + ':backup:') && localStorage.getItem(k) === '{broken'
				),
			key
		)
	).toBe(true);
});

test('import replacement can be cancelled without losing current work', async ({ page }) => {
	const name = page.getByRole('textbox', { name: 'Název kurzu', exact: true });
	await name.fill('Zachovat kurz');
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: fixture
	});
	await expect(name).toHaveValue('Zachovat kurz');
	await expect(saved(page)).toBeVisible();
	await page.reload();
	await expect(name).toHaveValue('Zachovat kurz');
});

test('another tab pauses writes instead of silently replacing its draft', async ({
	page,
	context
}) => {
	await expect(saved(page)).toBeVisible();
	const other = await context.newPage();
	await openEditor(other);
	await other.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('Druhá karta');
	await expect(saved(other)).toBeVisible();
	await expect(paused(page)).toHaveText('Ukládání pozastaveno');
	await page.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('První karta');
	expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).doc.name, key)).toBe(
		'Druhá karta'
	);
});

/**
 * The draft lives in `localStorage` and nowhere else, so the only backup a teacher
 * has is the file they downloaded. „Uloženo“ on its own reads as „safe“; the bar has
 * to say whether the work on screen has ever left the browser.
 */
test('the top bar says whether the work has ever left the browser', async ({ page }) => {
	// A fresh course cannot be downloaded yet (its card has no text), so "Bez zálohy"
	// would be a warning about something the teacher cannot act on: the line is calm
	// and true, and never reads "Ukládání…".
	const line = page.locator('.save-status');
	await expect(line).toHaveText('Uloženo v tomto prohlížeči');
	await expect(line).toHaveClass(/faint/);
	await expect(backup(page, 'Bez zálohy v souboru')).toBeVisible();
	await expect(page.locator('.topbar')).not.toContainText('Ukládání');
	await expect(page.locator('.topbar')).not.toContainText('XP');

	await line.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('do tohoto prohlížeče');
	await expect(dialog).toContainText('ještě ani jednou nestáhl');
	await page.keyboard.press('Escape');

	// Changed but still not downloadable: still nothing to warn about.
	await page.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('Zlomky');
	await expect(saved(page)).toBeVisible();
	await expect(line).toHaveText('Uloženo v tomto prohlížeči');
	await expect(line).toHaveClass(/faint/);

	// A fresh course is invalid (its seeded card has no text), so fill it in first —
	// export is gated on validity, and an ungated assertion would be testing nothing.
	await page.locator('.cm-content').first().click();
	await page.locator('.cm-content').first().fill('Zlomek popisuje část celku.');
	// Unsaved work that could be downloaded, and has not been, is the one thing to warn about.
	await expect(line).toHaveText('Bez zálohy v souboru');
	await expect(line).toHaveClass(/warning/);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Stáhnout', exact: true }).click();
	const anyway = page.getByRole('button', { name: 'Stáhnout i tak' });
	if (await anyway.isVisible()) await anyway.click();
	await download;

	await expect(backup(page, 'Staženo do souboru')).toHaveText('Staženo do souboru');

	// One more edit and the file on disk is behind again.
	await page.locator('.cm-content').first().click();
	await page.keyboard.type(' Jmenovatel říká, na kolik dílů.');
	await expect(backup(page, 'Bez zálohy v souboru')).toHaveText('Bez zálohy v souboru');
});
