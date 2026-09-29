import { expect, test, openEditor, type Page } from './fixtures';

/**
 * Which side panels are folded is remembered in the browser (`state/layout-prefs.ts`)
 * and can be toggled from the keyboard. Folding is not an edit, so it must never
 * look like one to another tab.
 */
const fold = (page: Page) => page.getByRole('button', { name: 'Sbalit panel lekcí' });
const unfold = (page: Page) => page.getByRole('button', { name: 'Rozbalit panel lekcí' });

test('Ctrl+B folds the lesson panel and the choice survives a reload', async ({ page }) => {
	await openEditor(page);
	await expect(fold(page)).toBeVisible();
	await page.keyboard.press('Control+b');
	await expect(unfold(page)).toBeVisible();

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(unfold(page)).toBeVisible();

	await unfold(page).click();
	await expect(fold(page)).toBeVisible();
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(fold(page)).toBeVisible();
});

test('a page that opens with the panel remembered as folded starts folded', async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'edu-editor:ui:v1',
			JSON.stringify({ format: 1, sidebarCollapsed: true, previewCollapsed: false })
		)
	);
	await openEditor(page);
	await expect(unfold(page)).toBeVisible();
	// The transition is back on once the page has settled, for the teacher's own clicks.
	await expect(page.locator('.columns.settled')).toHaveCount(1);
	const width = await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
	expect(width).toBeLessThan(80);
});

test('AltGr+B (Ctrl+Alt+B) does not fold the panel', async ({ page }) => {
	await openEditor(page);
	await page.keyboard.press('Control+Alt+b');
	await expect(fold(page)).toBeVisible();
});

test('another tab does not see a layout change as a conflicting edit', async ({ page, context }) => {
	await openEditor(page);
	const other = await context.newPage();
	await openEditor(other);
	const heard = other.evaluate(
		() => new Promise<string | null>((resolve) => addEventListener('storage', (e) => resolve(e.key), { once: true }))
	);
	await page.keyboard.press('Control+b');
	expect(await heard).toBe('edu-editor:ui:v1');
	await page.keyboard.press('Control+Shift+B');
	await expect(other.getByText(/změnil v jiné kartě/)).toHaveCount(0);
	await expect(other.locator('.save-state')).not.toHaveText('Ukládání pozastaveno');

	// Control: the draft's own key still is a conflict for the second tab.
	await page.evaluate(() => localStorage.setItem('edu-editor:draft:v1', '{}'));
	await expect(other.getByText(/změnil v jiné kartě/)).toBeVisible();
	await expect(other.locator('.save-state')).toHaveText('Ukládání pozastaveno');
});

// ─────────────────────────────── the preview column ───────────────────────────────

const PREVIEW_LAYOUT_KEY = 'edu-editor:ui:v1';
const startWith = (page: Page, layout: { sidebarCollapsed: boolean; previewCollapsed: boolean }) =>
	page.addInitScript(
		([key, value]) => localStorage.setItem(key, value),
		[PREVIEW_LAYOUT_KEY, JSON.stringify({ format: 1, ...layout })]
	);

const player = (page: Page) => page.locator('iframe[title="Náhled kurzu očima žáka"]');
const hide = (page: Page) => page.getByRole('button', { name: 'Skrýt náhled' });
const show = (page: Page) => page.getByRole('button', { name: 'Ukázat náhled' });
const booted = (page: Page) => page.locator('aside .chip.ok', { hasText: 'Náhled' });
const sent = async (page: Page, type: string) =>
	(await player(page).elementHandle().then((h) => h!.contentFrame()))!.evaluate(
		(t) => (window as unknown as { received: { type: string }[] }).received.filter((m) => m.type === t).length,
		type
	);

test('folding the preview keeps the same player running, untouched', async ({ page }) => {
	await openEditor(page);
	await expect(booted(page)).toBeVisible();
	await player(page).evaluate((el) => (el.dataset.probe = '1'));
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await expect.poll(() => sent(page, 'setLesson')).toBe(1);
	const size = await player(page).boundingBox();

	await hide(page).click();
	await expect(show(page)).toBeFocused();
	await expect(page.locator('aside.preview.collapsed')).toHaveCount(1);
	// Clipped, not resized: the player still has its whole column.
	expect((await player(page).boundingBox())!.width).toBe(size!.width);
	await show(page).click();
	await expect(hide(page)).toBeFocused();
	await expect(page.locator('aside.preview.collapsed')).toHaveCount(0);

	// The very same frame, still booted, still on Vyzkoušet, and the run was not restarted.
	await expect(player(page)).toHaveCount(1);
	await expect(page.locator('iframe[data-probe="1"]')).toHaveCount(1);
	await expect(page.getByRole('radio', { name: 'Vyzkoušet' })).toBeChecked();
	await expect(booted(page)).toBeVisible();
	expect(await sent(page, 'setLesson')).toBe(1);
});

test('a preview remembered as folded boots no player until it is opened', async ({ page }) => {
	await startWith(page, { sidebarCollapsed: false, previewCollapsed: true });
	// The probe of the player's URL is the column's first act; once it has answered, a
	// column that were going to mount the frame would have.
	const probed = page.waitForResponse('**/player/preview');
	await openEditor(page);
	await probed;
	await expect(show(page)).toBeVisible();
	await expect(player(page)).toHaveCount(0);

	await show(page).click();
	await expect(player(page)).toHaveCount(1);
	await expect(booted(page)).toBeVisible();
	await expect(hide(page)).toBeFocused();
});

test('Ctrl+Shift+B folds and opens the preview, and the choice survives a reload', async ({ page }) => {
	await openEditor(page);
	await expect(hide(page)).toBeVisible();
	await page.keyboard.press('Control+Shift+B');
	await expect(show(page)).toBeVisible();
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(show(page)).toBeVisible();
	await page.keyboard.press('Control+Shift+B');
	await expect(hide(page)).toBeVisible();
	await expect(page.locator('aside.preview.collapsed')).toHaveCount(0);
});

test('a folded preview does not run the boot watchdog, and opening it starts a fresh one', async ({ page }) => {
	// A player that never announces itself.
	await page.route('**/player/**', (route) =>
		route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><p>silent</p>' })
	);
	await page.clock.install();
	await openEditor(page);
	await expect(player(page)).toHaveCount(1);
	await player(page).evaluate((el) => (el.dataset.probe = '1'));

	// 19 s of a 20 s allowance, then folded: an hour passes and nothing is given up on.
	await page.clock.runFor(19_000);
	await hide(page).click();
	await expect(show(page)).toBeVisible();
	await page.clock.runFor(60 * 60_000);
	await expect(page.locator('iframe[data-probe="1"]')).toHaveCount(1);
	await expect(page.getByText('přehrávač neběží')).toHaveCount(0);

	// Opened again, the allowance starts over: 19 s is still fine, 2 more loads it again.
	await show(page).click();
	await page.clock.runFor(19_000);
	await expect(page.locator('iframe[data-probe="1"]')).toHaveCount(1);
	await page.clock.runFor(2_000);
	await expect(page.locator('iframe[data-probe="1"]')).toHaveCount(0);
	await expect(player(page)).toHaveCount(1);
});
