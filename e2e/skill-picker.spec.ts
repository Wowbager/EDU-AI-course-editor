import { readFileSync } from 'node:fs';
import { expect, openEditor, openSection, test, type Page } from './fixtures';

/**
 * Skills on a card: a row per skill with a "Je o tom" / "Využívá" switch, and a small
 * box that walks through skill → level → how the card works with it.
 */
async function load(page: Page) {
	const doc = JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
			'utf8'
		)
	);
	// No card starts with a skill, so every row below is one the test added.
	for (const lesson of doc.lessons) for (const b of lesson.blocks) delete b.gpf;
	for (const card of doc.blocks) delete card.gpf;
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await page.getByRole('radio', { name: 'Metodik' }).click();
	await page.getByRole('button', { name: 'Nastavení karty' }).click();
	const dialog = page.getByRole('dialog', { name: 'Nastavení karty' });
	const section = await openSection(dialog, 'Co karta procvičuje');
	return { dialog, section };
}

test('a skill is added in three steps, switched to "Využívá" and removed again', async ({
	page
}) => {
	const { dialog, section } = await load(page);
	const picker = page.getByRole('dialog', { name: 'Přidat dovednost' });

	await expect(section.getByText('nenastaveno', { exact: true })).toBeVisible();
	await section.getByRole('button', { name: 'Přidat dovednost', exact: true }).click();
	await expect(picker).toBeVisible();

	// 1. the skill, under its area.
	await expect(picker.getByText('Číslo a operace', { exact: true })).toBeVisible();
	await picker.getByRole('button', { name: 'Zlomky', exact: true }).click();

	// 2. the level, named by its number.
	await expect(picker.getByRole('button', { name: /^Úroveň 1/ })).toBeVisible();
	await picker.getByRole('button', { name: /^Úroveň 2/ }).click();

	// 3. how the card works with it.
	await expect(picker.getByRole('button', { name: /^Je o tom/ })).toBeVisible();
	await picker.getByRole('button', { name: /^Využívá/ }).click();
	await expect(picker).toBeHidden();

	const row = section.getByRole('listitem').filter({ hasText: 'Zlomky' });
	await expect(row).toHaveCount(1);
	await expect(row).toContainText('Úroveň 2');
	// A teacher never sees the code or the difficulty.
	await expect(row).not.toContainText('N2.2');
	await expect(row.getByRole('spinbutton')).toHaveCount(0);
	await expect(row.getByRole('radio', { name: 'Využívá' })).toHaveAttribute('aria-checked', 'true');

	await row.getByRole('radio', { name: 'Je o tom' }).click();
	await expect(row.getByRole('radio', { name: 'Je o tom' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await row.getByRole('radio', { name: 'Využívá' }).click();
	await expect(row.getByRole('radio', { name: 'Využívá' })).toHaveAttribute('aria-checked', 'true');

	// The level already chosen is not offered again.
	await section.getByRole('button', { name: 'Přidat dovednost', exact: true }).click();
	await picker.getByRole('button', { name: 'Zlomky', exact: true }).click();
	await expect(picker.getByRole('button', { name: /^Úroveň 2/ })).toHaveCount(0);
	await expect(picker.getByRole('button', { name: /^Úroveň 1/ })).toBeVisible();

	// Zpět returns to the skills; Escape closes the box and not the settings.
	await picker.getByRole('button', { name: 'Zpět' }).click();
	await expect(picker.getByRole('button', { name: 'Zlomky', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(picker).toBeHidden();
	await expect(dialog).toBeVisible();

	await row.getByRole('button', { name: 'Odebrat Zlomky' }).click();
	await expect(row).toHaveCount(0);
	await expect(section.getByText('nenastaveno', { exact: true })).toBeVisible();
});

test('the code and the difficulty appear only in Pokročilý', async ({ page }) => {
	const { dialog, section } = await load(page);
	const picker = page.getByRole('dialog', { name: 'Přidat dovednost' });
	await section.getByRole('button', { name: 'Přidat dovednost', exact: true }).click();
	await picker.getByRole('button', { name: 'Zlomky', exact: true }).click();
	await picker.getByRole('button', { name: /^Úroveň 2/ }).click();
	await picker.getByRole('button', { name: /^Je o tom/ }).click();

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await page.getByRole('button', { name: 'Nastavení karty' }).click();
	const advanced = await openSection(
		page.getByRole('dialog', { name: 'Nastavení karty' }),
		'Co karta procvičuje'
	);
	const row = advanced.getByRole('listitem').filter({ hasText: 'Zlomky' });
	await expect(row).toContainText('N2.2');
	await expect(row.getByRole('spinbutton')).toHaveCount(1);
});
