import { expect, openEditor, openSection, test, type Locator, type Page } from './fixtures';

/**
 * Every number field behaves like "Správný výsledek" (`numeric-answer.spec.ts`,
 * `NumberField`): a half-typed number stays while the teacher types, and text that is
 * not a number writes nothing and is gone once the field is left, showing the number
 * the course still holds. The share of points, a settings-panel number and a rubric
 * weight each used to keep the rejected text on screen.
 *
 * What is exported is read from the draft the editor keeps in the browser.
 */

interface Question {
	type: string;
	options?: { score_koef?: number }[];
	ai_guided_attempts?: number;
	ai_criteria_list?: { weight?: number }[];
}

const question = (page: Page) =>
	page.evaluate((): Question | undefined => {
		const doc = JSON.parse(localStorage.getItem('edu-editor:draft:v1') ?? 'null')?.doc;
		for (const block of doc?.blocks ?? [])
			for (const step of block.steps) if (step.question) return step.question;
		return undefined;
	});

async function enter(field: Locator, text: string) {
	await field.click();
	await field.fill(text);
	await field.press('Tab');
}

async function addQuestion(page: Page) {
	await openEditor(page);
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	return page.locator('.step', { has: page.getByRole('radio', { name: 'Otevřená odpověď' }) });
}

async function makeOpen(page: Page, step: Locator) {
	await step.getByRole('radio', { name: 'Otevřená odpověď' }).click();
	const confirm = page.getByRole('dialog', { name: 'Změnit typ otázky?' });
	if (await confirm.isVisible())
		await confirm.getByRole('button', { name: 'Přesto změnit' }).click();
	await openSection(step, 'Další nastavení kroku');
}

/** A switch's box is drawn as a track, so it is its label that gets clicked. */
async function turnOn(scope: Locator, label: string) {
	await scope.getByText(label, { exact: true }).click();
	await expect(scope.getByRole('checkbox', { name: new RegExp(`^${label}`) })).toBeChecked();
}

test('the share of points keeps a half-typed number and drops text', async ({ page }) => {
	const step = await addQuestion(page);
	const row = step.locator('.answers .row').first();
	const more = row.getByRole('button', { name: /^Podrobnosti odpovědi/ });
	if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
	const share = row.getByRole('textbox', { name: 'Podíl bodů za tuto odpověď' });

	await share.click();
	await share.pressSequentially('0,');
	await expect(share).toHaveValue('0,');
	await share.pressSequentially('5');
	await expect(share).toHaveValue('0,5');
	await share.press('Tab');
	await expect.poll(async () => (await question(page))?.options?.[0]?.score_koef).toBe(0.5);

	await enter(share, 'pět');
	await expect(share).toHaveValue('0,5');
	expect((await question(page))?.options?.[0]?.score_koef).toBe(0.5);
});

test('a settings number drops text that is not a number', async ({ page }) => {
	const step = await addQuestion(page);
	await makeOpen(page, step);
	await turnOn(step, 'Zpětná vazba od AI');
	await turnOn(step, 'Vést žáka k řešení');
	const attempts = step.getByRole('textbox', { name: 'Počet pokusů' });

	await enter(attempts, '4');
	await expect.poll(async () => (await question(page))?.ai_guided_attempts).toBe(4);
	await enter(attempts, 'pět');
	await expect(attempts).toHaveValue('4');
	expect((await question(page))?.ai_guided_attempts).toBe(4);
});

test('a rubric weight drops text that is not a number', async ({ page }) => {
	const step = await addQuestion(page);
	await makeOpen(page, step);
	await step.getByRole('button', { name: 'Přidat kritérium' }).click();
	const weight = step.getByRole('textbox', { name: 'Váha kritéria 1' });

	await enter(weight, '2');
	await expect.poll(async () => (await question(page))?.ai_criteria_list?.[0]?.weight).toBe(2);
	await enter(weight, 'pět');
	await expect(weight).toHaveValue('2');
	expect((await question(page))?.ai_criteria_list?.[0]?.weight).toBe(2);
});

test('spaces alone in an empty number field are gone once it is left', async ({ page }) => {
	const step = await addQuestion(page);
	await makeOpen(page, step);
	await step.getByRole('button', { name: 'Přidat kritérium' }).click();
	const weight = step.getByRole('textbox', { name: 'Váha kritéria 1' });

	await enter(weight, '   ');
	await expect(weight).toHaveValue('');
});
