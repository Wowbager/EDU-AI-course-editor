import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Which player the page's preview column gets.
 *
 *  - `fake` (the `editor` project): `fake-player.html`, served in place of
 *    `/player/`. It announces itself and answers `inspect`, and it costs nothing
 *    to load. The real one is about 11 MB of JavaScript and several MB of wasm per
 *    page, and a boot caught by a dropped connection never finishes. Suites about
 *    the editor have no reason to pay that.
 *  - `real` (the `player` project): the Flutter build, as a teacher gets it.
 *
 * Suites import `test` and `expect` from here, not from `@playwright/test`, so
 * that the project decides.
 */
export type PlayerKind = 'fake' | 'real';

const FAKE_PLAYER = readFileSync(new URL('./fake-player.html', import.meta.url), 'utf8');

export const test = base.extend<{ player: PlayerKind; playerRoute: void }>({
	player: ['fake', { option: true }],
	playerRoute: [
		async ({ page, player }, use) => {
			if (player === 'fake') {
				await page.route('**/player/**', (route) =>
					route.fulfill({ contentType: 'text/html; charset=utf-8', body: FAKE_PLAYER })
				);
			}
			await use();
		},
		{ auto: true }
	]
});

export { expect };
export type { Download, Locator, Page } from '@playwright/test';
export type StepKind = 'Text' | 'Otázka' | 'Obrázek' | 'Video' | 'Audio';

/**
 * Open the editor and wait until it has hydrated.
 *
 * A connection that drops mid-load (it happens on some networks, localhost included)
 * aborts a chunk, and SvelteKit shows its 500
 * page instead of the editor. That is a failed page load, not a failed test, so a
 * load that has neither hydrated nor come back within 15 s is tried once more, and
 * the retry is recorded on the test (`load retried` in the report). A page that fails
 * twice fails the test. Returns whether it retried.
 */
export async function openEditor(page: Page, url = '/'): Promise<boolean> {
	const hydrated = page.locator('html[data-hydrated="true"]');
	await page.goto(url);
	const loaded = await hydrated
		.waitFor({ timeout: 15_000 })
		.then(() => true)
		.catch(() => false);
	if (loaded) return false;

	const shown =
		(await page
			.locator('h1')
			.first()
			.textContent()
			.catch(() => null)) ?? 'nothing';
	test
		.info()
		.annotations.push({ type: 'load retried', description: `the first load showed: ${shown}` });
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true', { timeout: 15_000 });
	return true;
}

/**
 * Open a menu by its trigger and return the menu. A menu closes on any scroll, and the
 * editor scrolls itself smoothly to a card it has just selected, so a click that lands
 * during that scroll opens a menu that is shut again at once. The click is repeated
 * until the menu is really open, which is the condition the caller wants.
 *
 * `toBeVisible` on the panel alone is not enough, and `item` is the parameter that
 * matters. The panel is a native popover (`popover="auto"`) whose position is applied on
 * a `requestAnimationFrame` after `showPopover()`, so the panel reports visible while
 * its items are still laid out at the browser's default popover position — off-screen,
 * and not clickable. Waiting on "some item" does not help either, because a menu with
 * several items becomes visible one row at a time as the panel settles; waiting on the
 * *first* item still leaves the caller's `.click()` retrying against a later row that is
 * not visible yet. So the menu counts as open only once the item the caller is about to
 * use is really visible: pass it in, and this is the only reliable condition.
 *
 * Locally the frames land before the next assertion, so waiting on the panel looked
 * sufficient for a long time. On a CI runner (and under load) they do not, and the
 * caller burned its whole 30 s timeout on a not-visible element.
 */
export async function openMenu(
	page: Page,
	trigger: Locator,
	name: string,
	item: Locator
): Promise<Locator> {
	const menu = page.getByRole('menu', { name, exact: true });
	await expect(async () => {
		if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
		await expect(item).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 10_000 });
	return menu;
}

/**
 * Add a step at the end of the open card, through the "Přidat krok" menu. `within`
 * narrows it to one card when the column holds more than one.
 */
export async function addStep(page: Page, type: StepKind, within: Pick<Page, 'locator'> = page) {
	const trigger = within
		.locator('.add-step')
		.getByRole('button', { name: 'Přidat krok', exact: true });
	const menu = await openMenu(page, trigger, 'Přidat krok', addStepItem(page, type));
	await menu.getByRole('menuitem', { name: type, exact: true }).click();
}

/** An item of a named menu, as `openMenu` wants it. */
const itemIn = (page: Page, menu: string, item: string) =>
	page
		.getByRole('menu', { name: menu, exact: true })
		.getByRole('menuitem', { name: item, exact: true });

/** An item of the "Přidat krok" menu — what `openMenu` waits on for `addStep`. */
export const addStepItem = (page: Page, type: StepKind) => itemIn(page, 'Přidat krok', type);

/** The card's ⋯ menu, opened: Duplikovat kartu, Zařadit do / Odebrat z lekce, Smazat kartu. */
export const cardMenu = (page: Page) =>
	openMenu(
		page,
		page.getByRole('button', { name: 'Další akce s kartou', exact: true }),
		'Další akce s kartou',
		// Always present, and a real item of this menu. `Nastavení karty` is a sibling
		// button outside it, so it would never become visible as a menu item here.
		itemIn(page, 'Další akce s kartou', 'Duplikovat kartu')
	);

/**
 * Open a section of a settings dialog by its name and return what it shows. From
 * Metodik up the sections are tabs in a list down the dialog's left; in Učitel they
 * are folds under the main fields. Clicking a fold that is already open (it opens by
 * itself when a jump or an issue points into it) would shut it, so the click happens
 * only when it is shut.
 */
export async function openSection(scope: Pick<Page, 'getByRole'>, name: string): Promise<Locator> {
	const tab = scope.getByRole('tab', { name, exact: true });
	if ((await tab.count()) > 0) {
		await tab.click();
		await expect(tab).toHaveAttribute('aria-selected', 'true');
		return scope.getByRole('tabpanel', { name, exact: true });
	}
	const header = scope.getByRole('button', { name, exact: true });
	if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	return scope.getByRole('region', { name, exact: true });
}

/** Do one of the card's actions by its name in the ⋯ menu. */
export async function cardAction(page: Page, name: string) {
	const menu = await cardMenu(page);
	await menu.getByRole('menuitem', { name, exact: true }).click();
}

/**
 * How many items of that name the ⋯ menu offers. A closed menu has none, so a bare
 * `toHaveCount(0)` on an item would pass whatever the card allows; this opens it first.
 */
export async function cardActionCount(page: Page, name: string): Promise<number> {
	const menu = await cardMenu(page);
	const count = await menu.getByRole('menuitem', { name, exact: true }).count();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	return count;
}
