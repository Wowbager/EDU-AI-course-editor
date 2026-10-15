import { expect, openEditor, test, type Page } from './fixtures';

/**
 * A numeric question's "Správný výsledek" and "Tolerance". The field keeps what the
 * teacher types while they type, and shows the document's number otherwise. It used
 * to round what it showed to three decimals and write that back when it was next
 * left, to keep its own text after an undo, and to save text that is not a number
 * as 0.
 *
 * What is exported is read from the draft the editor keeps in the browser.
 */

interface Question {
	type: string;
	correct_number?: number;
	tolerance?: number;
}

const question = (page: Page) =>
	page.evaluate((): Question | undefined => {
		const doc = JSON.parse(localStorage.getItem('edu-editor:draft:v1') ?? 'null')?.doc;
		for (const block of doc?.blocks ?? [])
			for (const step of block.steps) if (step.question?.type === 'numeric') return step.question;
		return undefined;
	});

const answer = (page: Page) => page.getByRole('textbox', { name: 'Správný výsledek', exact: true });
const tolerance = (page: Page) => page.getByRole('textbox', { name: 'Tolerance', exact: true });

/** Type into a field and leave it, the way a teacher does. */
async function enter(page: Page, field: ReturnType<typeof answer>, text: string) {
	await field.click();
	await field.fill(text);
	await field.press('Tab');
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await page
		.getByRole('radiogroup', { name: 'Typ otázky' })
		.getByRole('radio', { name: 'Číslo' })
		.click();
	await expect(answer(page)).toBeVisible();
});

test('a number keeps every digit, also after the field is left again', async ({ page }) => {
	await enter(page, answer(page), '-3,14159');
	await expect.poll(async () => (await question(page))?.correct_number).toBe(-3.14159);
	await expect(answer(page)).toHaveValue('-3,14159');

	// In and out again, with no edit: the number stays what it was.
	await answer(page).click();
	await answer(page).press('Tab');
	await expect(answer(page)).toHaveValue('-3,14159');
	expect((await question(page))?.correct_number).toBe(-3.14159);

	await enter(page, tolerance(page), '0,0005');
	await expect.poll(async () => (await question(page))?.tolerance).toBe(0.0005);
	await expect(tolerance(page)).toHaveValue('0,0005');
});

test('a half-typed number is kept while typing', async ({ page }) => {
	await answer(page).click();
	await answer(page).pressSequentially('2,');
	await expect(answer(page)).toHaveValue('2,');
	await answer(page).pressSequentially('5');
	await expect(answer(page)).toHaveValue('2,5');
	await expect.poll(async () => (await question(page))?.correct_number).toBe(2.5);
});

test('undo shows the number the course holds again', async ({ page }) => {
	await enter(page, answer(page), '3');
	await expect.poll(async () => (await question(page))?.correct_number).toBe(3);
	await enter(page, answer(page), '5');
	await expect.poll(async () => (await question(page))?.correct_number).toBe(5);

	await page.getByRole('button', { name: 'Zpět', exact: true }).click();
	await expect.poll(async () => (await question(page))?.correct_number).toBe(3);
	await expect(answer(page)).toHaveValue('3');

	// Leaving the field after the undo does not bring the 5 back.
	await answer(page).click();
	await answer(page).press('Tab');
	expect((await question(page))?.correct_number).toBe(3);
});

test('text that is not a number is not saved as 0', async ({ page }) => {
	await enter(page, answer(page), '7');
	await expect.poll(async () => (await question(page))?.correct_number).toBe(7);
	await enter(page, answer(page), 'pět');
	await expect.poll(async () => (await question(page))?.correct_number).toBeUndefined();
	await expect(answer(page)).toHaveValue('');
});
