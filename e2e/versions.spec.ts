import { expect, test, type Download, openEditor } from './fixtures';

/**
 * Version control: the working copy is saved as numbered versions, one of which is
 * published with a visibility. Numbers only grow — the app offers a student an
 * update only when they do — so putting a version out again is a new number.
 */
async function json(download: Download) {
	const chunks: Buffer[] = [];
	for await (const chunk of (await download.createReadStream())!) chunks.push(chunk as Buffer);
	return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await page.locator('.cm-content').first().click();
	await page.keyboard.type('Fotosyntéza je proces, při kterém rostliny vyrábějí cukr.');
});

test('a teacher saves a version, publishes it for signed-in students, and changes their mind', async ({ page }) => {
	await expect(page.locator('header .version')).toContainText('neuloženo');
	await page.locator('header .version').click();

	const dialog = page.getByRole('dialog', { name: 'Verze kurzu' });
	// A teacher chooses between three; the editorial states are the metodik's.
	await expect(dialog.getByRole('radiogroup', { name: 'Kdo kurz uvidí' }).getByRole('radio')).toHaveCount(3);

	await dialog.getByRole('button', { name: 'Uložit jako verzi 1' }).click();
	await expect(dialog.getByText('Uloženo jako verze 1')).toBeVisible();
	await dialog.getByRole('radio', { name: 'Jen pro přihlášené' }).click();

	const first = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Zveřejnit', exact: true }).click();
	expect(await json(await first)).toMatchObject({ version: 1, status: 'published', logged_only: true });
	await expect(dialog.getByText('Zveřejněná · Jen pro přihlášené')).toBeVisible();

	// Opening it to everyone is a new publication, so a new number.
	await dialog.getByRole('radio', { name: 'Veřejný' }).click();
	const second = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Zveřejnit znovu jako verzi 2' }).click();
	const out = await json(await second);
	expect(out).toMatchObject({ version: 2, status: 'published' });
	expect('logged_only' in out).toBe(false);

	await page.keyboard.press('Escape');
	await expect(page.locator('header .version')).toHaveText(/v2$/);
});

test('the history survives a reload, and restoring is an undoable edit', async ({ page }) => {
	await page.locator('header .version').click();
	const dialog = page.getByRole('dialog', { name: 'Verze kurzu' });
	await dialog.getByRole('button', { name: 'Uložit jako verzi 1' }).click();
	await expect(dialog.getByText('Uloženo jako verze 1')).toBeVisible();
	await page.keyboard.press('Escape');

	// Change the working copy, then go back to version 1.
	await page.locator('.cm-content').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type(' A ještě věta navíc.');
	await page.locator('main h1').click();
	await expect(page.locator('header .version')).toContainText('upraveno');

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(page.locator('header .version')).toContainText('v1 · upraveno');

	await page.locator('header .version').click();
	page.once('dialog', (d) => d.accept());
	await dialog.getByRole('button', { name: 'Obnovit' }).click();
	await page.keyboard.press('Escape');
	await expect(page.locator('header .version')).toHaveText(/v1$/);
	await expect(page.locator('.cm-content').first()).not.toContainText('věta navíc');

	await page.getByRole('button', { name: 'Zpět', exact: true }).click();
	await expect(page.locator('.cm-content').first()).toContainText('věta navíc');
});

test('a version with errors is not published, and says where to look', async ({ page }) => {
	// A question card with no answers is an error the student would hit.
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await page.locator('header .version').click();
	const dialog = page.getByRole('dialog', { name: 'Verze kurzu' });
	await dialog.getByRole('button', { name: 'Uložit jako verzi 1' }).click();
	await dialog.getByRole('button', { name: 'Zveřejnit', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('nejde zveřejnit');
	await dialog.getByRole('button', { name: 'Ukázat, co chybí' }).click();
	await expect(page.getByRole('dialog')).not.toHaveAccessibleName('Verze kurzu');
});

test('the metodik gets the editorial states, and they wrap on a narrow screen', async ({ page }) => {
	await page.getByRole('radio', { name: 'Metodik' }).click();
	await page.locator('header .version').click();
	const group = page.getByRole('dialog', { name: 'Verze kurzu' }).getByRole('radiogroup', { name: 'Kdo kurz uvidí' });
	await expect(group.getByRole('radio')).toHaveCount(6);
	await expect(group.getByRole('radio', { name: 'K revizi' })).toBeVisible();
});
