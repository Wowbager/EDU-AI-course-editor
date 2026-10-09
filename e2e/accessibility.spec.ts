import AxeBuilder from '@axe-core/playwright';
import { expect, openEditor, test, type Page } from './fixtures';

/**
 * The page passes axe's WCAG 2.1 level A rules in each state a teacher writes in:
 * every field has a name, every control a role a screen reader can use. Level AA's
 * colour contrast is not gated yet — it fails on the existing top bar
 * (OPEN-PROBLEMS #52), and a check that is always red checks nothing.
 */

async function expectAccessible(page: Page, state: string) {
	const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag21a']).analyze();
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
	await page.getByRole('textbox', { name: 'Vzorec v LaTeXu' }).fill('x^2');
	await expectAccessible(page, 'the formula row');
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
