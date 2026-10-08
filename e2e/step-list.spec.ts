import {
	addStep,
	addStepItem,
	expect,
	openMenu,
	test,
	type Locator,
	type Page,
	openEditor
} from './fixtures';
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
	await openEditor(page);
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
	for (const box of await page
		.locator('main .step')
		.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
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
	await list.nth(0).locator('.rich-content').click();
	await expect(isFolded(list.nth(2))).toBeVisible();
});

test('a validation jump opens the folded step it points at', async ({ page }) => {
	// A new course: one card, one empty text step. Add a question step and fold it.
	await addStep(page, 'Otázka');
	const list = steps(page);
	await expect(list).toHaveCount(2);
	await fold(list.nth(1));
	await expect(isFolded(list.nth(1))).toBeVisible();

	await page.locator('header .chip-button').first().click();
	const panel = page.getByRole('complementary', { name: 'Kontrola kurzu' });
	await panel
		.locator('button.issue')
		.filter({ hasText: /Krok 2/ })
		.first()
		.click();

	await expect(list.nth(1)).toHaveClass(/targeted/);
	await expect(list.nth(1).getByRole('button', { name: 'Sbalit krok' })).toBeVisible();
});

test('folding a step in one card does not fold the step with the same id in another', async ({
	page
}) => {
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

/** What a step's action button looks like right now; the reveal is a 120 ms transition. */
const opacityOf = (step: Locator, name: string) =>
	step
		.getByRole('button', { name, exact: true })
		.evaluate((el) => Number(getComputedStyle(el.parentElement!).opacity));

test('a step shows Duplikovat and Smazat faintly, and in full while it is the one being worked on', async ({
	page
}) => {
	await openQuizCard(page);
	const list = steps(page);

	// Focus goes into step 2, and the pointer is over it: step 1's stay faint, never
	// invisible, so a teacher can tell a step can be removed.
	await list.nth(1).getByRole('textbox', { name: 'Text odpovědi' }).first().click();
	await expect.poll(() => opacityOf(list.nth(1), 'Smazat krok')).toBe(1);
	await expect.poll(() => opacityOf(list.nth(0), 'Smazat krok')).toBe(0.45);
	await expect.poll(() => opacityOf(list.nth(0), 'Duplikovat krok')).toBe(0.45);

	// Pointing at step 1 brings its own back.
	await list.nth(0).hover();
	await expect.poll(() => opacityOf(list.nth(0), 'Smazat krok')).toBe(1);
});

test('the add-step menu closes on Escape and gives focus back to its button', async ({ page }) => {
	await openQuizCard(page);
	const trigger = page
		.locator('main .add-step')
		.getByRole('button', { name: 'Přidat krok', exact: true });
	const menu = await openMenu(page, trigger, 'Přidat krok', addStepItem(page, 'Text'));
	await expect(menu.getByRole('menuitem')).toHaveCount(5);
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(trigger).toBeFocused();
	await expect(steps(page)).toHaveCount(4);
});

test('a step can be inserted between two others', async ({ page }) => {
	await openQuizCard(page);
	const list = steps(page);
	await list.nth(0).hover();
	await page.getByRole('button', { name: 'Vložit krok za krok 1', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Text', exact: true }).click();

	await expect(list).toHaveCount(5);
	// The new step is second, and the old second one is third now.
	await expect(list.nth(1).getByText('Krok 2', { exact: true })).toBeVisible();
	await expect(list.nth(1).getByText(' · Text')).toBeVisible();
	await expect(list.nth(2).getByText(' · Otázka')).toBeVisible();
});

/**
 * Pressing a handle folds every step, which moves the handle. `grab` scrolls the
 * column back by the shift; where that scroll cannot happen (the column is at its top,
 * or has shrunk under the bottom) the step used to be picked up from wherever it
 * landed, and stayed offset from the pointer for the whole drag.
 */
const column = (page: Page) => page.locator('main.editor');

/** A card of one text step and `questions` question steps, which are tall while open. */
async function openTallCard(page: Page, questions: number) {
	for (let i = 0; i < questions; i++) await addStep(page, 'Otázka');
	await expect(steps(page)).toHaveCount(questions + 1);
	// Every step's text says which one it is, so a reorder can be told from the outside.
	for (let i = 0; i <= questions; i++) {
		await steps(page).nth(i).locator('.rich-content').first().click();
		await page.keyboard.type(`krok-${i + 1}`);
	}
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const order = (page: Page) =>
	steps(page).evaluateAll((els) => els.map((el) => /krok-\d+/.exec(el.textContent ?? '')?.[0]));

/** Whether the pointer is inside the carried step's box, and by how much it is not. */
async function pointerMissesClone(page: Page, y: number) {
	const clone = page.locator('#dnd-action-dragged-el');
	await expect(clone).toBeVisible();
	const box = (await clone.boundingBox())!;
	return Math.max(box.y - y, y - (box.y + box.height), 0);
}

test('a step grabbed under tall steps, with the column at its top, is under the pointer', async ({
	page
}) => {
	await openTallCard(page, 3);
	await column(page).evaluate((el) => (el.scrollTop = 0));
	const from = await press(page, 3);
	await page.mouse.move(from.x, from.y + 20, { steps: 4 });
	expect(await pointerMissesClone(page, from.y + 20)).toBe(0);

	// Put back where it was picked up, it stays put: the drop follows the pointer.
	await page.mouse.move(from.x, from.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(() => order(page)).toEqual(['krok-1', 'krok-2', 'krok-3', 'krok-4']);
});

const placeholderIndex = (page: Page) =>
	page
		.locator('main .steps > *')
		.evaluateAll((els) =>
			els.findIndex(
				(el) =>
					el.hasAttribute('data-is-dnd-shadow-item-internal') ||
					el.hasAttribute('data-is-dnd-shadow-item-hint')
			)
		);

test('a step grabbed under tall steps drops where the pointer is', async ({ page }) => {
	await openTallCard(page, 3);
	await column(page).evaluate((el) => (el.scrollTop = 0));
	const from = await press(page, 3);
	await page.mouse.move(from.x, from.y + 20, { steps: 4 });
	// The list is folded now: step 2 is a short row, and the pointer goes to its middle.
	const second = (await steps(page).nth(1).boundingBox())!;
	await page.mouse.move(from.x, second.y + second.height / 2, { steps: 8 });
	// The gap follows the carried step's centre; it is where the step will land.
	await expect.poll(() => placeholderIndex(page)).toBe(1);
	await page.mouse.up();
	await expect.poll(() => order(page)).toEqual(['krok-1', 'krok-3', 'krok-2', 'krok-4']);
});

test('the last step grabbed with the column scrolled to the bottom is under the pointer', async ({
	page
}) => {
	await openTallCard(page, 4);
	await column(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
	const from = await press(page, 5);
	await page.mouse.move(from.x, from.y + 20, { steps: 4 });
	expect(await pointerMissesClone(page, from.y + 20)).toBe(0);

	await page.mouse.move(from.x, from.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(() => order(page)).toEqual(['krok-1', 'krok-2', 'krok-3', 'krok-4', 'krok-5']);
});
