import { expect, openEditor, openSection, test, type Locator, type Page } from './fixtures';

/**
 * Settings the app reads since its 2026-10-15 sync, offered in Pokročilý: how an open
 * answer is graded by the AI, answer shuffling, and course-wide lesson and attempt rules.
 */
/** A switch's box is drawn as a track, so it is its label that gets clicked. */
async function turnOn(scope: Locator, label: string) {
	await scope.getByText(label, { exact: true }).click();
	await expect(scope.getByRole('checkbox', { name: new RegExp(`^${label}`) })).toBeChecked();
}

async function openQuestion(page: Page) {
	await openEditor(page);
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	return page.locator('.step', { has: page.getByRole('radio', { name: 'Otevřená odpověď' }) });
}

test('a choice question offers shuffling; an open one the AI settings, each when it applies', async ({
	page
}) => {
	const step = await openQuestion(page);
	await openSection(step, 'Další nastavení kroku');
	await expect(step.getByRole('radiogroup', { name: 'Míchat odpovědi' })).toBeVisible();
	await expect(step.getByRole('checkbox', { name: /^Zpětná vazba od AI/ })).toHaveCount(0);

	await step.getByRole('radio', { name: 'Otevřená odpověď' }).click();
	const confirm = page.getByRole('dialog', { name: 'Změnit typ otázky?' });
	if (await confirm.isVisible())
		await confirm.getByRole('button', { name: 'Přesto změnit' }).click();
	await expect(step.getByRole('radiogroup', { name: 'Míchat odpovědi' })).toHaveCount(0);

	const feedback = step.getByRole('checkbox', { name: /^Zpětná vazba od AI/ });
	const guided = step.getByRole('checkbox', { name: /^Vést žáka k řešení/ });
	const attempts = step.getByRole('textbox', { name: 'Počet pokusů' });
	await expect(feedback).toHaveCount(1);
	await expect(guided).toHaveCount(0);
	await turnOn(step, 'Zpětná vazba od AI');
	await expect(guided).toHaveCount(1);
	await expect(attempts).toHaveCount(0);
	await turnOn(step, 'Vést žáka k řešení');
	await expect(attempts).toBeVisible();

	await step.getByRole('button', { name: 'Přidat kritérium' }).click();
	await expect(step.getByRole('textbox', { name: 'Název kritéria 1' })).toBeVisible();
});

test('the course offers open lessons, shuffling and which attempt counts', async ({ page }) => {
	await openEditor(page);
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await page.getByRole('button', { name: /Nastavení kurzu/ }).click();
	const modal = page.getByRole('dialog', { name: 'Nastavení kurzu' });
	await openSection(modal, 'Průběh kurzu');
	await turnOn(modal, 'Všechny lekce odemčené');
	await turnOn(modal, 'Míchat odpovědi');
	await expect(modal.getByRole('radiogroup', { name: 'Který pokus se počítá' })).toBeVisible();
});

test('an imported rubric with missing or repeated ids opens, one row per criterion', async ({
	page
}) => {
	await openEditor(page);
	const doc = {
		export_type: 'course_v2',
		course_id: 'c',
		name: 'Kurz',
		lessons: [{ lesson_id: 'l', name: 'Lekce', blocks: [{ block_id: 'b' }] }],
		blocks: [
			{
				block_id: 'b',
				type: 'question',
				steps: [
					{
						id: 's1',
						type: 'question',
						content: 'Proč?',
						question: {
							type: 'open',
							correct_answer: 'Protože.',
							ai_criteria_list: [
								{ name: 'a' },
								{ name: 'b' },
								{ id: 'x', name: 'c' },
								{ id: 'x', name: 'd' }
							]
						}
					}
				]
			}
		]
	};
	await page.setInputFiles('input[type=file]', {
		name: 'rubric.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await page.locator('.tree-card').first().click();
	const step = page.locator('.step', {
		has: page.getByRole('radio', { name: 'Otevřená odpověď' })
	});
	await openSection(step, 'Další nastavení kroku');
	for (const n of [1, 2, 3, 4])
		await expect(step.getByRole('textbox', { name: `Název kritéria ${n}` })).toBeVisible();
});
