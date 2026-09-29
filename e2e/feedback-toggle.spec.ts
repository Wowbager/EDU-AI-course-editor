import { readFileSync } from 'node:fs';
import { expect, openEditor, test, type Page } from './fixtures';

/**
 * Zpětná vazba is one switch for the whole course: what the pupil is told aside from
 * the question (answer feedback, hint, help, solution) is out of the way while the
 * flow is being written, and everything needed to make a question correct stays.
 * The toggle keeps one name; `aria-pressed` carries the state.
 */

const draftKey = 'edu-editor:draft:v1';
const fixture = readFileSync(new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url));

const toggle = (page: Page) => page.getByRole('button', { name: 'Zpětná vazba', exact: true });
const answerFeedback = (page: Page) => page.getByRole('textbox', { name: 'Zpětná vazba k této odpovědi' });
const solution = (page: Page) => page.getByRole('textbox', { name: 'Vysvětlení řešení' });
const hint = (page: Page) => page.getByRole('textbox', { name: 'Nápověda', exact: true });
const help = (page: Page) => page.getByRole('textbox', { name: 'Podrobná pomoc', exact: true });
const correctMarker = (page: Page) => page.getByRole('button', { name: /^Správná odpověď:/ });
const answerText = (page: Page) => page.getByRole('textbox', { name: 'Text odpovědi' });

const savedFeedbackVisible = (page: Page) =>
	page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.feedbackVisible, draftKey);

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

async function addQuestionCard(page: Page) {
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await expect(answerFeedback(page).first()).toBeVisible();
}

test('one toggle hides feedback, hints and the solution, and keeps the question authorable', async ({ page }) => {
	await addQuestionCard(page);

	// On by default: pressed, and every kind of feedback is there.
	await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(answerFeedback(page).first()).toBeVisible();
	await expect(solution(page)).toBeVisible();
	await expect(hint(page)).toBeVisible();
	await expect(help(page)).toBeVisible();

	await toggle(page).click();
	await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(answerFeedback(page)).toHaveCount(0);
	await expect(solution(page)).toHaveCount(0);
	await expect(hint(page)).toHaveCount(0);
	await expect(help(page)).toHaveCount(0);
	await expect(page.locator('.answers .head')).not.toContainText('Co se žák dozví');

	// What makes the question correct stays: the answers and which one is right.
	await expect(answerText(page).first()).toBeVisible();
	await expect(correctMarker(page).first()).toBeVisible();
	await correctMarker(page).first().click();
	await expect(correctMarker(page).first()).toHaveAttribute('aria-pressed', 'true');

	await toggle(page).click();
	await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(answerFeedback(page).first()).toBeVisible();
	await expect(solution(page)).toBeVisible();
	await expect(hint(page)).toBeVisible();
	await expect(help(page)).toBeVisible();
});

test('the choice is kept with the draft across a reload', async ({ page }) => {
	await addQuestionCard(page);
	await toggle(page).click();
	await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => savedFeedbackVisible(page)).toBe(false);

	await openEditor(page);
	await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(answerText(page).first()).toBeVisible();
	await expect(answerFeedback(page)).toHaveCount(0);

	await toggle(page).click();
	await expect.poll(() => savedFeedbackVisible(page)).toBe(true);
	await openEditor(page);
	await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(answerFeedback(page).first()).toBeVisible();
});

test.describe('advice about a hidden field', () => {
	const chip = (page: Page, name: string | RegExp) => page.getByRole('button', { name });

	/** A course with nothing wrong, then a detailed help on a step that has no hint to open it from. */
	async function withUnreachableHelp(page: Page) {
		await page.setInputFiles('input[type=file]', { name: 'kurz.json', mimeType: 'application/json', buffer: fixture });
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(chip(page, 'Kontrola kurzu: v pořádku')).toBeVisible();
		await help(page).first().fill('Nakresli si to.');
		await expect(chip(page, 'Kontrola kurzu: 1 upozornění')).toBeVisible();
	}

	test('is held back while feedback is hidden, listed in the export review, and jumped to', async ({ page }) => {
		await withUnreachableHelp(page);

		await toggle(page).click();
		await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
		await expect(chip(page, 'Kontrola kurzu: v pořádku')).toBeVisible();

		// The export review is the full list, whatever the toggle says.
		await page.getByRole('button', { name: 'Stáhnout', exact: true }).click();
		const review = page.getByRole('dialog', { name: 'Stáhnout kurz' });
		await expect(review).toContainText('podrobnou pomoc, kterou žák neuvidí');
		await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');

		// Going to it needs the field, so feedback comes back, and stays.
		await review.getByRole('button', { name: 'Přejít' }).click();
		await expect(review).toHaveCount(0);
		await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
		await expect(help(page).first()).toBeVisible();
		await expect(chip(page, 'Kontrola kurzu: 1 upozornění')).toBeVisible();
	});

	test('the panel says how many are held, and shows them on request', async ({ page }) => {
		await withUnreachableHelp(page);
		await toggle(page).click();
		await expect(chip(page, 'Kontrola kurzu: v pořádku')).toBeVisible();

		await chip(page, 'Kontrola kurzu: v pořádku').click();
		const panel = page.getByRole('complementary', { name: 'Kontrola kurzu' });
		await expect(panel).toContainText('Skryto 1 doporučení ke zpětné vazbě.');
		await panel.getByRole('button', { name: 'Ukázat', exact: true }).click();

		await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
		await expect(panel).not.toContainText('Skryto');
		await expect(panel).toContainText('podrobnou pomoc, kterou žák neuvidí');
	});
});
