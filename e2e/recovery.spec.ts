import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const key = 'edu-editor:draft:v1';
const fixture = readFileSync(new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url));

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	// onMount has seeded/restored the document and attached every input handler.
	// Typing before this was the hydration race behind a lost import guard.
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
});

test('unblurred feedback survives reload even when export is blocked', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	const feedback = page.getByRole('textbox', { name: 'Zpětná vazba k této odpovědi' }).first();
	await feedback.fill('Nezapomeň porovnat jmenovatele.\nDruhý řádek.');
	await expect(feedback).toBeFocused();
	await expect(page.getByRole('button', { name: 'Stáhnout JSON' })).toBeDisabled();
	await expect(page.locator(".save-state")).toHaveText('Uloženo jen v tomto prohlížeči');
	await page.reload();
	await expect(feedback).toHaveValue('Nezapomeň porovnat jmenovatele.\nDruhý řádek.');
	expect(errors).toEqual([]);
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
	await expect(page.locator(".save-state")).toHaveText('Uloženo jen v tomto prohlížeči');
	await page.reload();
	await expect(field).toHaveValue('Moje lekce');
});

test('storage failure is visible and unload is guarded', async ({ page }) => {
	await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
	await page.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('Neztratit');
	await expect(page.locator(".save-state")).toHaveText('Koncept se nepodařilo uložit');
	expect(await page.evaluate(() => {
		const event = new Event('beforeunload', { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	})).toBe(true);
});

test('corrupt draft is not overwritten without an explicit backed-up replacement', async ({ page }) => {
	// Install after this page unloads so its final save cannot replace the fixture.
	await page.addInitScript((key) => localStorage.setItem(key, '{broken'), key);
	await page.reload();
	await expect(page.locator(".save-state")).toHaveText('Ukládání pozastaveno');
	await page.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('Náhradní kurz');
	expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe('{broken');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Zálohovat původní a uložit tento kurz' }).click();
	await expect(page.locator(".save-state")).toHaveText('Uloženo jen v tomto prohlížeči');
	expect(await page.evaluate((key) => Object.keys(localStorage).some((k) => k.startsWith(key + ':backup:') && localStorage.getItem(k) === '{broken'), key)).toBe(true);
});

test('import replacement can be cancelled without losing current work', async ({ page }) => {
	const name = page.getByRole('textbox', { name: 'Název kurzu', exact: true });
	await name.fill('Zachovat kurz');
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.setInputFiles('input[type=file]', { name: 'course.json', mimeType: 'application/json', buffer: fixture });
	await expect(name).toHaveValue('Zachovat kurz');
	await expect(page.locator(".save-state")).toHaveText('Uloženo jen v tomto prohlížeči');
	await page.reload();
	await expect(name).toHaveValue('Zachovat kurz');
});

test('another tab pauses writes instead of silently replacing its draft', async ({ page, context }) => {
	await expect(page.locator(".save-state")).toHaveText('Uloženo jen v tomto prohlížeči');
	const other = await context.newPage();
	await other.goto('/');
	await expect(other.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await other.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('Druhá karta');
	await expect(other.locator(".save-state")).toHaveText('Uloženo jen v tomto prohlížeči');
	await expect(page.locator(".save-state")).toHaveText('Ukládání pozastaveno');
	await page.getByRole('textbox', { name: 'Název kurzu', exact: true }).fill('První karta');
	expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).doc.name, key)).toBe('Druhá karta');
});

/**
 * The draft lives in `localStorage` and nowhere else, so the only backup a teacher
 * has is the file they downloaded. „Uloženo“ on its own reads as „safe“; the bar has
 * to say whether the work on screen has ever left the browser.
 */
test('the top bar says whether the work has ever left the browser', async ({ page }) => {
	await expect(page.locator('.save-status .backup')).toHaveText('· bez zálohy v souboru');

	await page.locator('.save-status').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('do tohoto prohlížeče');
	await expect(dialog).toContainText('ještě ani jednou nestáhl');
	await page.keyboard.press('Escape');

	// A fresh course is invalid (its seeded card has no text), so fill it in first —
	// export is gated on validity, and an ungated assertion would be testing nothing.
	await page.locator('.cm-content').first().click();
	await page.locator('.cm-content').first().fill('Zlomek popisuje část celku.');
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Stáhnout JSON' }).click();
	await download;

	await expect(page.locator('.save-status .backup')).toHaveText('· stáhnuto do souboru');

	// One more edit and the file on disk is behind again.
	await page.locator('.cm-content').first().click();
	await page.keyboard.type(' Jmenovatel říká, na kolik dílů.');
	await expect(page.locator('.save-status .backup')).toHaveText('· bez zálohy v souboru');
});
