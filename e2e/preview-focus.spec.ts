import { expect, test, openEditor } from './fixtures';
import { playerBuilt } from './player-build';

/**
 * The real player takes keyboard focus by itself while it boots (OPEN-PROBLEMS #46).
 * `layout.spec.ts` covers the editor's answer with a stand-in; this is the player
 * that actually does it.
 */
test.describe('the real player at boot', () => {
	test.skip(!playerBuilt, 'the Flutter web build is not present');
	test.describe.configure({ timeout: 90_000 });

	test('does not take focus from a field the teacher clicked into', async ({ page }) => {
		await openEditor(page);
		const name = page.getByRole('textbox', { name: 'Název kurzu', exact: true });
		await name.click();
		await name.press('End');
		await expect(page.locator('aside.preview')).toHaveAttribute('data-player', 'ready', {
			timeout: 60_000
		});
		// The steal comes a moment after `ready`; wait it out, then type.
		await page.waitForTimeout(4_000);
		await page.keyboard.type('Xyz');
		await expect(name).toHaveValue(/Xyz$/);
	});
});
