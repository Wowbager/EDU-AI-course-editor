import { expect, test, type Page, openEditor } from './fixtures';
import { readFileSync } from 'node:fs';

// Ctrl+C / Ctrl+V of a whole card or step, through the system clipboard.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const course = () =>
	JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
			'utf8'
		)
	);

async function load(page: Page, doc = course()) {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'clipboard.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	page.on('dialog', (dialog) => dialog.accept());
	await expect(page.locator('.tree-lesson.open .name')).toHaveText(doc.lessons[0].name);
}

const cards = (page: Page) => page.locator('.tree-lesson.open .tree-card');
const steps = (page: Page) => page.locator('main .step-wrap');
const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test('a card is copied with Ctrl+C and pasted after the selected card; Ctrl+Z takes it back', async ({
	page
}) => {
	await load(page);
	await expect(cards(page)).toHaveCount(3);
	await cards(page).nth(2).click();
	await page.keyboard.press('Control+c');
	expect(await clipboardText(page)).toContain('"kind": "card"');

	await cards(page).nth(0).click();
	await page.keyboard.press('Control+v');
	await expect(cards(page)).toHaveCount(4);
	// The copy sits right after the card that was selected, and is the one now open.
	await expect(cards(page).nth(1)).toHaveClass(/selected/);
	await expect(steps(page)).toHaveCount(4);

	await page.keyboard.press('Control+z');
	await expect(cards(page)).toHaveCount(3);
});

test('a step is copied from inside it and pasted after the step the cursor is in', async ({
	page
}) => {
	await load(page);
	await cards(page).nth(2).click();
	await expect(steps(page)).toHaveCount(4);
	const first = steps(page).nth(0).locator('.rich-content').first();
	await first.click();
	await page.keyboard.press('Control+c');
	expect(await clipboardText(page)).toContain('"kind": "step"');

	await steps(page).nth(2).locator('.rich-content').first().click();
	await page.keyboard.press('Control+v');
	await expect(steps(page)).toHaveCount(5);
	await expect(steps(page).nth(3).locator('.rich-content').first()).toHaveText(
		(await first.textContent())!
	);
});

test('selected text still copies and pastes as text', async ({ page }) => {
	await load(page);
	await cards(page).nth(0).click();
	const field = steps(page).nth(0).locator('.rich-content').first();
	await field.click();
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Control+c');
	expect(await clipboardText(page)).not.toContain('edu_ai_editor');

	await page.evaluate(() => navigator.clipboard.writeText(' a ještě tohle'));
	await page.keyboard.press('End');
	await page.keyboard.press('Control+v');
	await expect(field).toContainText('a ještě tohle');
	await expect(cards(page)).toHaveCount(3);
});

test('a card copied from another course pastes in, even with the cursor in a field', async ({
	page
}) => {
	const other = course();
	const card = { ...other.blocks[0], block_id: 'JINY_B1' };
	card.steps = [{ id: 's1', type: 'text', order: 1, content: 'Karta z jiného kurzu' }];
	await load(page);
	await page.evaluate(
		(block) =>
			navigator.clipboard.writeText(JSON.stringify({ edu_ai_editor: 1, kind: 'card', block })),
		card
	);
	await cards(page).nth(0).click();
	await steps(page).nth(0).locator('.rich-content').first().click();
	await page.keyboard.press('Control+v');
	await expect(cards(page)).toHaveCount(4);
	await expect(steps(page).nth(0).locator('.rich-content').first()).toHaveText(
		'Karta z jiného kurzu'
	);
});
