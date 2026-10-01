import { expect, test, type Locator, type Page, openEditor, openSection } from './fixtures';
import { readFileSync } from 'node:fs';

async function load(page: Page, marks: boolean, branching: boolean) {
	const doc = JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
			'utf8'
		)
	);
	doc.export_type = branching ? 'course_v2' : 'exercise_v2';
	doc.quiz_evaluate = marks;
	// The flag is set at the end of onMount, so it also means the seed has run and
	// the import handler is wired — unlike counting sections, which SSR can satisfy.
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'layout.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	await page.locator('.tree-card').nth(2).click();
	await expect(page.locator('.answers').first()).toBeVisible();
}

async function noOverflow(locator: Locator) {
	for (const el of await locator.all()) {
		expect(await el.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
	}
}

for (const marks of [false, true]) {
	for (const branching of [false, true]) {
		test(`answer tracks: marks=${marks}, branching=${branching}`, async ({ page }) => {
			await page.setViewportSize({ width: 2200, height: 1100 });
			await load(page, marks, branching);
			await page.getByRole('radio', { name: 'Pokročilý' }).click();
			const answers = page.locator('.answers').first();
			const head = answers.locator('.head');
			await expect(head).toBeVisible();
			// Mark, answer, feedback and the row-end control: whatever else an answer has is
			// in its detail line, so the grid no longer grows with the course's settings.
			const columns = 4;
			await expect(head.locator(':scope > span')).toHaveCount(columns);
			const template = await head.evaluate((node) => getComputedStyle(node).gridTemplateColumns);
			expect(template.split(' ')).toHaveLength(columns);
			for (const row of await answers.locator('.row').all()) {
				expect(await row.evaluate((node) => getComputedStyle(node).gridTemplateColumns)).toBe(
					template
				);
			}
			// Podíl bodů is advanced-only and always offered, so the line is too; opening it
			// shows the fields the course's settings allow, spanning the whole row.
			const first = answers.locator('.row').first();
			await first.getByRole('button', { name: /^Podrobnosti odpovědi/ }).click();
			const detail = first.getByRole('group', { name: 'Podrobnosti odpovědi' });
			await expect(
				detail.getByRole('textbox', { name: 'Podíl bodů za tuto odpověď' })
			).toBeVisible();
			await expect(
				detail.getByRole('combobox', { name: 'Kam pokračovat po této odpovědi' })
			).toHaveCount(Number(branching));
			await expect(detail.getByRole('combobox', { name: 'Známka za tuto odpověď' })).toHaveCount(
				Number(marks)
			);
			await noOverflow(answers.locator('.row, .cell, .detail'));

			const feedback = answers.locator('.feedback').first();
			const before = await feedback.boundingBox();
			const field = feedback.getByRole('textbox');
			await field.fill('Dlouhá zpětná vazba vysvětluje chybu. '.repeat(12) + 'x'.repeat(160));
			await field.blur();
			expect((await feedback.boundingBox())!.width).toBeCloseTo(before!.width, 0);
			expect(before!.width).toBeGreaterThan(160);
			await noOverflow(answers.locator('.row, .cell, .detail'));

			// Keep the desktop viewport, constrain only the editor's available space.
			await answers.evaluate((node) => {
				node.style.width = '420px';
			});
			await expect(head).toBeHidden();
			expect((await feedback.boundingBox())!.width).toBeGreaterThan(380);
			await noOverflow(answers.locator('.row, .cell, .detail'));
		});
	}
}

for (const width of [1316, 600, 390]) {
	test(`course settings fit at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await load(page, true, true);
		await page.getByRole('radio', { name: 'Pokročilý' }).click();
		await page.getByRole('button', { name: /Nastavení kurzu/ }).click();
		const modal = page.getByRole('dialog', { name: 'Nastavení kurzu' });
		await expect(modal).toBeVisible();
		for (const name of ['Pro AI lektora', 'Průběh kurzu', 'Údaje o kurzu']) {
			await openSection(modal, name);
		}
		await page.setViewportSize({ width, height: 900 });
		await noOverflow(modal.locator('.body, .grid, .field-row, .control, .segmented'));
		const grid = await modal.locator('.grid').boundingBox();
		for (const row of await modal.locator('.grid > .row').all()) {
			expect((await row.boundingBox())!.width).toBeCloseTo(grid!.width, 0);
		}
		// Who sees the course is set with its versions now, not here.
		await expect(modal.getByRole('radiogroup', { name: 'Stav kurzu' })).toHaveCount(0);
		await modal.press('Escape');
		await expect(modal).toBeHidden();
	});
}
