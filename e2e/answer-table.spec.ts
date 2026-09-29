import { readFileSync } from 'node:fs';
import { expect, openEditor, test, type Page } from './fixtures';

/**
 * The answer table of a question step: what is wrong with the list of answers is said
 * under the list, not only in the topbar count.
 */
const fixture = () =>
	JSON.parse(
		readFileSync(new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url), 'utf8')
	);

const trash = (page: Page) => page.getByRole('button', { name: /^Smazat odpověď/ });

/** A fresh question card: two answers, one right. */
async function addQuestionCard(page: Page) {
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Text odpovědi' }).first()).toBeVisible();
}

async function loadCourse(page: Page, edit: (doc: ReturnType<typeof fixture>) => void = () => {}) {
	const doc = fixture();
	edit(doc);
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	await page.locator('.tree-card').nth(2).click();
	await expect(page.locator('.answers').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	// Wide enough for the table's own columns; below 760px it stacks.
	await page.setViewportSize({ width: 2200, height: 1100 });
	await openEditor(page);
});

test('a question cannot lose answers below the two it needs, and says why', async ({ page }) => {
	await addQuestionCard(page);
	await expect(trash(page)).toHaveCount(2);
	for (const button of await trash(page).all()) {
		await expect(button).toBeDisabled();
		await expect(button).toHaveAttribute('title', /aspoň dvě/);
	}

	await page.getByRole('button', { name: 'Další odpověď' }).click();
	await expect(trash(page)).toHaveCount(3);
	await expect(trash(page).first()).toBeEnabled();
	await trash(page).first().click({ force: true });
	await expect(trash(page)).toHaveCount(2);
	await expect(trash(page).first()).toBeDisabled();
});

test('what is wrong with the list of answers is said under it', async ({ page }) => {
	await loadCourse(page, (doc) => {
		const question = doc.blocks.find((b: { block_id: string }) => b.block_id === 'L1_B3_poznej').steps[1].question;
		question.options = question.options.slice(0, 1);
	});
	// Errors of a card wait until the card is left.
	await expect(page.locator('.answers .list-issue')).toHaveCount(0);
	await page.locator('.tree-card').nth(0).click();
	await page.locator('.tree-card').nth(2).click();
	await expect(page.locator('.answers .list-issue')).toContainText('Žák nemá z čeho vybírat');
});
