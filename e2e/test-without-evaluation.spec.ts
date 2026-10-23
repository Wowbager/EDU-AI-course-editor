import { readFileSync } from 'node:fs';
import { expect, openEditor, test, type Page } from './fixtures';

/**
 * A test course (`quiz_v2`) without `quiz_evaluate` shows the pupil no solution and no
 * per-answer feedback (OPEN-PROBLEMS #25), so the editor does not ask for them. The
 * hint stays. The same question in a course keeps every field.
 */

const fixture = JSON.parse(
	readFileSync(
		new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
		'utf8'
	)
);

const solution = (page: Page) => page.getByRole('textbox', { name: 'Vysvětlení řešení' });
const answerFeedback = (page: Page) =>
	page.getByRole('textbox', { name: 'Zpětná vazba k této odpovědi' });
const hint = (page: Page) => page.getByRole('textbox', { name: 'Nápověda', exact: true });

async function load(page: Page, patch: Record<string, unknown>) {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'kurz.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify({ ...fixture, ...patch }))
	});
	await page.locator('.tree-card').nth(2).click();
	await expect(page.locator('.answers').first()).toBeVisible();
}

test('a test without evaluation asks for no solution and no answer feedback', async ({ page }) => {
	await load(page, { export_type: 'quiz_v2', quiz_evaluate: false });
	await expect(hint(page).first()).toBeVisible();
	await expect(solution(page)).toHaveCount(0);
	await expect(answerFeedback(page)).toHaveCount(0);
});

test('the same question in a course, or in a test that shows evaluation, keeps them', async ({
	page
}) => {
	await load(page, { export_type: 'course_v2' });
	await expect(solution(page).first()).toBeVisible();
	await expect(answerFeedback(page).first()).toBeVisible();
	await expect(hint(page).first()).toBeVisible();

	await load(page, { export_type: 'quiz_v2', quiz_evaluate: true });
	await expect(solution(page).first()).toBeVisible();
	await expect(answerFeedback(page).first()).toBeVisible();
});
