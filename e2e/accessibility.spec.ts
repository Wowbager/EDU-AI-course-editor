import AxeBuilder from '@axe-core/playwright';
import { expect, openEditor, test, type Page } from './fixtures';

/**
 * The page passes axe's WCAG 2.1 level A and AA rules in each state a teacher writes
 * in: every field has a name, every control a role a screen reader can use, and text
 * has enough contrast.
 */

async function expectAccessible(page: Page, state: string) {
	const result = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag21a', 'wcag2aa', 'wcag21aa'])
		.analyze();
	const found = result.violations.map(
		(v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(found, state).toEqual([]);
}

const moreFormatting = (page: Page) =>
	page.getByRole('button', { name: 'Další formátování' }).first();

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('writing a text, a formula and an image', async ({ page }) => {
	await expectAccessible(page, 'a new course');
	await page.locator('.rich-content').first().click();
	await expectAccessible(page, 'a text field with its formatting buttons');
	await page.getByRole('button', { name: 'Vzorec' }).first().click();
	await expect(page.locator('math-field')).toBeFocused();
	// MathLive takes the keys a moment after it takes focus.
	await expect
		.poll(() =>
			page.evaluate(() =>
				document.activeElement?.shadowRoot?.activeElement?.classList.contains('ML__keyboard-sink')
			)
		)
		.toBe(true);
	await page.keyboard.type('x^2');
	await expectAccessible(page, 'the formula row');
	await page.getByRole('button', { name: 'Klávesnice se značkami' }).click();
	await expect(page.locator('.MLK__keycap').filter({ visible: true }).first()).toBeVisible();
	await expectAccessible(page, 'the formula row with its keyboard');
	await page.locator('math-field').focus();
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Obrázek', exact: true }).first().click();
	await expectAccessible(page, 'the image row');
});

test('the Markdown view', async ({ page }) => {
	await page.locator('.rich-content').first().click();
	await moreFormatting(page).click();
	await page.getByRole('menuitem', { name: 'Upravit jako text (Markdown)' }).click();
	await expect(page.locator('[data-source] .cm-content')).toBeVisible();
	await expectAccessible(page, 'a field shown as Markdown');
});

test('a question card with its answers', async ({ page }) => {
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await page.locator('.answers').getByRole('textbox', { name: 'Text odpovědi' }).first().click();
	await expectAccessible(page, 'an answer being written');
});
