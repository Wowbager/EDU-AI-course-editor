import { readFileSync } from 'node:fs';
import { expect, openEditor, openSection, test, type Page } from './fixtures';

/**
 * A step's own settings: folded under one quiet line, and the step's "Zařadit do
 * cvičení" only where it changes something.
 */
async function load(page: Page, edit: (doc: any) => void = () => {}) {
	const doc = JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
			'utf8'
		)
	);
	edit(doc);
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	await page.locator('.tree-card').nth(2).click();
	await expect(page.locator('.answers').first()).toBeVisible();
	await page.getByRole('radio', { name: 'Metodik' }).click();
}

const NOT_IN_PRACTICE = (doc: any) => {
	for (const lesson of doc.lessons) for (const b of lesson.blocks) delete b.default_practice;
	for (const card of doc.blocks) {
		delete card.default_practice;
		for (const step of card.steps) delete step.default_practice;
	}
};
// The open step is the one with the answers in it; the others are folded.
const open = (page: Page) => page.locator('.step', { has: page.locator('.answers') });
const fold = (page: Page) =>
	open(page).getByRole('button', { name: 'Další nastavení kroku', exact: true });
const practice = (page: Page) => page.getByRole('checkbox', { name: /^Zařadit do cvičení/ });

test('the step settings are one folded line until they are asked for', async ({ page }) => {
	await load(page, NOT_IN_PRACTICE);
	await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
	await expect(practice(page)).toHaveCount(0);
	await openSection(open(page), 'Další nastavení kroku');
	await expect(practice(page)).toHaveCount(1);
});

test('a step offers its practice switch only when the card is not already in practice', async ({
	page
}) => {
	await load(page, (doc) => {
		NOT_IN_PRACTICE(doc);
		doc.blocks.find((b: { block_id: string }) => b.block_id === 'L1_B3_poznej').default_practice =
			true;
	});
	// Nothing is left in the fold of a card that is already in practice, so there is no fold.
	await expect(fold(page)).toHaveCount(0);
	await expect(practice(page)).toHaveCount(0);
});
