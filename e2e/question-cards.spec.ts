import { readFileSync } from 'node:fs';
import { addStep, expect, openEditor, test, type Page } from './fixtures';

/**
 * Every question is its own card in the app, because the app grades a card as one
 * item (`src/lib/domain/groups.ts`). The teacher never sees that: in Učitel and
 * Metodik a card with three questions is one card. Pokročilý shows the cards the
 * course is exported as, and can keep one card's questions together on purpose.
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
		page.evaluate(() => JSON.parse(localStorage.getItem('edu-editor:draft:v1') ?? 'null')?.doc ?? null);
	await expect.poll(async () => (await read()) !== null).toBe(true);
	return read();
}

const questions = (block: Block) => block.steps.filter((s) => s.type === 'question').length;

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('a second question stays in the teacher’s card, and is its own card for the pupil', async ({ page }) => {
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

	// And back: one card again, still selected.
	await page.getByRole('radio', { name: 'Učitel' }).click();
	await expect(page.locator('.tree-card')).toHaveCount(2);
	await expect(page.locator('.tree-card.selected')).toHaveCount(1);
	await expect(page.locator('main .step')).toHaveCount(3);
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

	test('keeps the teacher’s cards as they were, and exports one question per card', async ({ page }) => {
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

	test('in Pokročilý, a card’s questions can be kept together, and split again', async ({ page }) => {
		await page.getByRole('radio', { name: 'Pokročilý' }).click();
		const lesson = original.lessons[0].blocks.length;
		await expect(page.locator('.tree-card')).toHaveCount(lesson + 1);

		await page.locator('.tree-card', { hasText: 'část 1/2' }).click();
		await page.getByRole('button', { name: 'Nastavení karty' }).click();
		const together = page.getByRole('checkbox', { name: /Více otázek v jedné kartě/ });
		// The switch is drawn over a visually hidden checkbox; a person clicks its label.
		const toggle = page.locator('label.toggle', { hasText: 'Více otázek v jedné kartě' });
		await expect(together).not.toBeChecked();
		await toggle.click();
		await expect(together).toBeChecked();
		await expect(page.locator('.tree-card')).toHaveCount(lesson);
		await expect
			.poll(async () => (await exported(page)).blocks.find((b) => b.block_id === 'L1_B4_cviceni')?.multi_question)
			.toBe(true);

		await toggle.click();
		await expect(together).not.toBeChecked();
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
