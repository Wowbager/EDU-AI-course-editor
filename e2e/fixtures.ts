import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Which player the page's preview column gets.
 *
 *  - `fake` (the `editor` project): `fake-player.html`, served in place of
 *    `/player/`. It announces itself and answers `inspect`, and it costs nothing
 *    to load. The real one is about 11 MB of JavaScript and several MB of wasm per
 *    page, and on this machine a boot caught by a dropped connection never
 *    finishes (OPEN-PROBLEMS 17). Suites about the editor have no reason to pay that.
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

/**
 * Open the editor and wait until it has hydrated.
 *
 * On this machine the network drops every few seconds to minutes, localhost included
 * (OPEN-PROBLEMS 17). A drop mid-load aborts a chunk, and SvelteKit shows its 500
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

	const shown = (await page.locator('h1').first().textContent().catch(() => null)) ?? 'nothing';
	test.info().annotations.push({ type: 'load retried', description: `the first load showed: ${shown}` });
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true', { timeout: 15_000 });
	return true;
}
