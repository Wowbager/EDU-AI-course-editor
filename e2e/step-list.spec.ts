import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The step list inside a card: folding, focus and reordering.
 *
 * Folding used to be state inside each step's component, and a drag remounts the
 * dragged step — so a folded step left an expanded-height hole while it was carried
 * and came back open after the drop. These tests hold the rule in
 * `ui/step-expansion.ts` from the outside.
 */
const fixture = (name: string) =>
	readFileSync(new URL(`../src/lib/domain/__tests__/fixtures/${name}`, import.meta.url), 'utf8');

async function openQuizCard(page: Page) {
	await page.setInputFiles('input[type=file]', {
		name: 'spec-16-course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(fixture('spec-16-course.json'))
	});
	// The third card of the first lesson has four steps.
	await page.locator('.tree-card').nth(2).click();
	await expect(page.locator('.step')).toHaveCount(4);
}

const steps = (page: Page) => page.locator('main .step');
const fold = (step: Locator) => step.getByRole('button', { name: 'Sbalit krok' }).click();
const isFolded = (step: Locator) => step.getByRole('button', { name: 'Rozbalit krok' });

/** Press a step's drag handle. The mouse works in viewport coordinates, so scroll first. */
async function press(page: Page, position: number) {
	const handle = page.getByRole('button', { name: `Přesunout krok ${position}` });
	await handle.scrollIntoViewIfNeeded();
	const box = (await handle.boundingBox())!;
	const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(at.x, at.y);
	await page.mouse.down();
	return at;
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
});

test('a folded step stays folded while it is carried and after it lands', async ({ page }) => {
	await openQuizCard(page);
	const list = steps(page);
	await fold(list.nth(0));
	await expect(isFolded(list.nth(0))).toBeVisible();
	const folded = (await list.nth(0).boundingBox())!.height;
	const summary = await list.nth(0).locator('.summary').textContent();

	// Carry step 1 below step 3. Every step is folded while the drag is on.
	const from = await press(page, 1);
	await page.mouse.move(from.x, from.y + 20, { steps: 4 });
	for (const box of await page.locator('main .step').evaluateAll((els) =>
		els.map((el) => el.getBoundingClientRect().height)
	)) {
		expect(box).toBeLessThanOrEqual(folded + 2);
	}
	const target = (await list.nth(2).boundingBox())!;
	await page.mouse.move(from.x, target.y + target.height - 4, { steps: 12 });
	await page.mouse.up();

	// It landed further down, and it is still folded. The others opened again.
	const moved = list.filter({ has: page.locator('.summary', { hasText: summary! }) });
	await expect(moved).toHaveCount(1);
	await expect(isFolded(moved)).toBeVisible();
	await expect(list.nth(0)).not.toContainText(summary!);
	await expect(page.locator('main .step .summary')).toHaveCount(1);
});

test('a drag dropped where it started is not an edit', async ({ page }) => {
	await openQuizCard(page);
	const undo = page.getByRole('button', { name: 'Zpět', exact: true });
	await expect(undo).toBeDisabled();

	const from = await press(page, 2);
	await page.mouse.move(from.x, from.y + 30, { steps: 5 });
	await page.mouse.move(from.x, from.y, { steps: 5 });
	await page.mouse.up();

	await expect(page.locator('main .step .summary')).toHaveCount(0);
	await expect(undo).toBeDisabled();
});

test('a folded step opens while it is focused and folds again when left', async ({ page }) => {
	await openQuizCard(page);
	const list = steps(page);
	await fold(list.nth(2));
	await expect(isFolded(list.nth(2))).toBeVisible();

	// Looking inside opens it without unfolding it for good…
	await list.nth(2).locator('.summary').click();
	await expect(list.nth(2).getByRole('button', { name: 'Sbalit krok' })).toBeVisible();
	await expect(list.nth(2)).toHaveClass(/targeted/);

	// …and working in another step folds it back.
	await list.nth(0).locator('.cm-content').click();
	await expect(isFolded(list.nth(2))).toBeVisible();
});

test('a validation jump opens the folded step it points at', async ({ page }) => {
	// A new course: one card, one empty text step. Add a question step and fold it.
	await page.locator('main .add-step').getByRole('button', { name: 'Otázka', exact: true }).click();
	const list = steps(page);
	await expect(list).toHaveCount(2);
	await fold(list.nth(1));
	await expect(isFolded(list.nth(1))).toBeVisible();

	await page.locator('header .chip-button').first().click();
	const panel = page.getByRole('complementary', { name: 'Kontrola kurzu' });
	await panel.locator('button.issue').filter({ hasText: /Krok 2/ }).first().click();

	await expect(list.nth(1)).toHaveClass(/targeted/);
	await expect(list.nth(1).getByRole('button', { name: 'Sbalit krok' })).toBeVisible();
});

test('folding a step in one card does not fold the step with the same id in another', async ({ page }) => {
	await openQuizCard(page);
	await fold(steps(page).nth(0));
	await expect(isFolded(steps(page).nth(0))).toBeVisible();
	await page.locator('.tree-card').nth(0).click();
	await expect(steps(page)).toHaveCount(2);
	await expect(steps(page).locator('.summary')).toHaveCount(0);
	// And coming back finds it the way it was left.
	await page.locator('.tree-card').nth(2).click();
	await expect(isFolded(steps(page).nth(0))).toBeVisible();
});
