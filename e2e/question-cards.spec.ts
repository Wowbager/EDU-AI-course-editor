import { readFileSync } from 'node:fs';
import { addStep, cardMenu, expect, openEditor, test, type Page } from './fixtures';

/**
 * Every question is its own card in the app, because the app grades a card as one
 * item (`src/lib/domain/groups.ts`). The teacher never sees that: in Učitel and
 * Metodik a card with three questions is one card. Pokročilý shows the cards the
 * course is exported as. In every mode, the card's ⋯ menu can keep its questions
 * together in one exported block („Všechny otázky v jedné kartě“).
 *
 * What is exported is read from the draft the editor keeps in the browser, which is
 * the exported document.
 */

interface Block {
	block_id: string;
	type: string;
	group?: string;
	multi_question?: boolean;
	steps: { id: string; type: string }[];
}
interface Course {
	lessons: { lesson_id: string; blocks: { block_id: string }[] }[];
	blocks: Block[];
}

async function exported(page: Page): Promise<Course> {
	// The draft is written a moment after the edit; wait until it has the edit.
	const read = () =>
		page.evaluate(
			() => JSON.parse(localStorage.getItem('edu-editor:draft:v1') ?? 'null')?.doc ?? null
		);
	await expect.poll(async () => (await read()) !== null).toBe(true);
	return read();
}

const questions = (block: Block) => block.steps.filter((s) => s.type === 'question').length;

/** „Všechny otázky v jedné kartě“ in the open card's ⋯ menu, with the menu open. */
async function togetherItem(page: Page) {
	const menu = await cardMenu(page);
	return menu.getByRole('menuitemcheckbox', { name: 'Všechny otázky v jedné kartě' });
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('a second question stays in the teacher’s card, and is its own card for the pupil', async ({
	page
}) => {
	await page.locator('.tree-add').getByRole('button', { name: 'Cvičení', exact: true }).click();
	await expect(page.locator('.tree-card')).toHaveCount(2);

	await addStep(page, 'Text');
	await addStep(page, 'Otázka');

	// One card in the tree, with every step in it.
	await expect(page.locator('.tree-card')).toHaveCount(2);
	await expect(page.locator('main .step')).toHaveCount(3);

	// Two blocks in the export, one question each, marked as one card.
	await expect
		.poll(async () => (await exported(page)).blocks.filter((b) => b.type === 'exercise').length)
		.toBe(2);
	const course = await exported(page);
	const card = course.blocks.filter((b) => b.type === 'exercise');
	expect(card.map(questions)).toEqual([1, 1]);
	expect(new Set(card.map((b) => b.group)).size).toBe(1);
	expect(course.lessons[0].blocks.map((b) => b.block_id)).toEqual(
		expect.arrayContaining(card.map((b) => b.block_id))
	);

	// Pokročilý shows the cards the pupil gets.
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await expect(page.locator('.tree-card')).toHaveCount(3);
	await expect(page.locator('.tree-card', { hasText: 'část 1/2' })).toHaveCount(1);
	await expect(page.locator('.tree-card', { hasText: 'část 2/2' })).toHaveCount(1);

	// The parts are joined by a line, and the first time a note says why there are more cards.
	const joined = page.locator('.tree-row[data-join]');
	await expect(joined).toHaveCount(2);
	await expect(joined.nth(0)).toHaveAttribute('data-join', 'first');
	await expect(joined.nth(1)).toHaveAttribute('data-join', 'last');
	const note = page.getByRole('note').filter({ hasText: 'karta s více otázkami je rozdělená' });
	await expect(note).toBeVisible();
	await note.getByRole('button', { name: 'Rozumím' }).click();
	await expect(note).toHaveCount(0);
	// Closed once: not again, not even after switching away and back.
	await page.getByRole('radio', { name: 'Učitel' }).click();
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await expect(page.locator('.tree-card')).toHaveCount(3);
	await expect(note).toHaveCount(0);

	// And back: one card again, still selected.
	await page.getByRole('radio', { name: 'Učitel' }).click();
	await expect(page.locator('.tree-card')).toHaveCount(2);
	await expect(page.locator('.tree-card.selected')).toHaveCount(1);
	await expect(page.locator('main .step')).toHaveCount(3);
});

test('the teacher puts a card’s questions in one card from its ⋯ menu, and splits them again', async ({
	page
}) => {
	await page.locator('.tree-add').getByRole('button', { name: 'Cvičení', exact: true }).click();
	await expect(page.locator('.tree-card')).toHaveCount(2);

	// One question: nothing to put together, so nothing is offered.
	await expect(await togetherItem(page)).toHaveCount(0);
	await page.keyboard.press('Escape');

	await addStep(page, 'Otázka');
	await expect
		.poll(async () => (await exported(page)).blocks.filter((b) => b.type === 'exercise').length)
		.toBe(2);

	const item = await togetherItem(page);
	await expect(item).toHaveAttribute('aria-checked', 'false');
	await item.click();

	// Still one card for the teacher, now one block for the pupil.
	await expect(page.locator('.tree-card')).toHaveCount(2);
	await expect(page.locator('main .step')).toHaveCount(2);
	await expect
		.poll(async () => (await exported(page)).blocks.filter((b) => b.type === 'exercise').length)
		.toBe(1);
	const whole = (await exported(page)).blocks.find((b) => b.type === 'exercise')!;
	expect(whole.multi_question).toBe(true);
	expect(questions(whole)).toBe(2);
	await expect(await togetherItem(page)).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');

	// A question added later joins the card.
	await addStep(page, 'Otázka');
	await expect
		.poll(async () =>
			(await exported(page)).blocks.filter((b) => b.type === 'exercise').map(questions)
		)
		.toEqual([3]);

	// Turned off: one block per question again.
	await (await togetherItem(page)).click();
	await expect
		.poll(async () =>
			(await exported(page)).blocks.filter((b) => b.type === 'exercise').map(questions)
		)
		.toEqual([1, 1, 1]);
	await expect(page.locator('.tree-card')).toHaveCount(2);
});

test.describe('a course made elsewhere, with several questions in one block', () => {
	const file = readFileSync(
		new URL('../src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json', import.meta.url)
	);
	const original = JSON.parse(file.toString()) as Course;

	test.beforeEach(async ({ page }) => {
		await page.setInputFiles('input[type=file]', {
			name: 'zlomky-5-trida.json',
			mimeType: 'application/json',
			buffer: file
		});
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('keeps the teacher’s cards as they were, and exports one question per card', async ({
		page
	}) => {
		await expect(page.getByText('každá otázka se teď žákovi hodnotí zvlášť')).toBeVisible();
		await expect(page.getByText('hodnotí se jako celek')).toBeVisible();

		// The first lesson looks the same as in the file.
		await expect(page.locator('.tree-card')).toHaveCount(original.lessons[0].blocks.length);

		await expect
			.poll(async () => (await exported(page)).blocks.length)
			.toBeGreaterThan(original.blocks.length);
		const course = await exported(page);
		for (const block of course.blocks) {
			if (block.multi_question === true) continue;
			expect(questions(block), block.block_id).toBeLessThanOrEqual(1);
		}
		expect(course.blocks.filter((b) => b.multi_question === true).map((b) => b.block_id)).toEqual([
			'L3_B3_mc',
			'L5_B3_pizza'
		]);
	});

	test('in Pokročilý, a card’s parts can be put in one card, and split again', async ({ page }) => {
		await page.getByRole('radio', { name: 'Pokročilý' }).click();
		const lesson = original.lessons[0].blocks.length;
		await expect(page.locator('.tree-card')).toHaveCount(lesson + 1);

		await page.locator('.tree-card', { hasText: 'část 1/2' }).click();
		await (await togetherItem(page)).click();
		await expect(page.locator('.tree-card')).toHaveCount(lesson);
		await expect
			.poll(
				async () =>
					(await exported(page)).blocks.find((b) => b.block_id === 'L1_B4_cviceni')?.multi_question
			)
			.toBe(true);

		const item = await togetherItem(page);
		await expect(item).toHaveAttribute('aria-checked', 'true');
		await item.click();
		await expect(page.locator('.tree-card')).toHaveCount(lesson + 1);
	});

	test('undo puts the course back as it came in', async ({ page }) => {
		await page.getByRole('button', { name: 'Zpět', exact: true }).click();
		await expect
			.poll(async () => (await exported(page)).blocks.length)
			.toBe(original.blocks.length);
		// The teacher's cards look the same either way.
		await expect(page.locator('.tree-card')).toHaveCount(original.lessons[0].blocks.length);
	});
});
