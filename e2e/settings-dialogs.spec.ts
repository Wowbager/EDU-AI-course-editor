import { readFileSync } from 'node:fs';
import { expect, openEditor, openSection, test, type Page } from './fixtures';

/**
 * The card settings' hand-made controls: removing a skill, the difficulty field, the
 * grade/level selects, the RVP outputs and the prerequisites.
 */
async function load(page: Page, section: string) {
	const doc = JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json', import.meta.url),
			'utf8'
		)
	);
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await page.getByRole('button', { name: 'Nastavení karty' }).first().click();
	const dialog = page.getByRole('dialog', { name: 'Nastavení karty' });
	return { dialog, pane: await openSection(dialog, section) };
}

test('a skill row has a delete button that is visible without hovering', async ({ page }) => {
	const { pane } = await load(page, 'Co karta procvičuje');
	await pane.getByRole('button', { name: 'Přidat dovednost', exact: true }).click();
	const picker = page.getByRole('dialog', { name: 'Přidat dovednost' });
	await picker.getByRole('button', { name: 'Zlomky', exact: true }).click();
	await picker.getByRole('button', { name: /^Úroveň 1/ }).click();
	await picker.getByRole('button', { name: /^Je o tom/ }).click();
	const row = pane.getByRole('listitem').filter({ hasText: 'Zlomky' });
	const remove = row.getByRole('button', { name: 'Odebrat Zlomky' });
	await expect(remove).toBeVisible();
	await expect(remove).toHaveCSS('opacity', '1');

	// An emptied difficulty gives back the default, which the field offers as a placeholder.
	const elo = row.getByRole('spinbutton');
	await expect(elo).toHaveAttribute('placeholder', 'výchozí 6');
	await elo.fill('8');
	await elo.blur();
	await expect(elo).toHaveValue('8');
	await elo.fill('');
	await elo.blur();
	await expect(elo).toHaveValue('6');
});

test('grade, level and Bloom are chosen from words and stored as numbers', async ({ page }) => {
	const { pane } = await load(page, 'Co karta procvičuje');
	const grade = pane.getByRole('combobox', { name: 'Ročník' });
	await grade.selectOption({ label: '5. ročník' });
	await expect(grade).toHaveValue('5');
	await pane
		.getByRole('combobox', { name: 'Bloomova úroveň' })
		.selectOption({ label: '3 – aplikovat' });
	await expect(pane.getByRole('combobox', { name: 'Bloomova úroveň' })).toHaveValue('3');
	await pane
		.getByRole('combobox', { name: 'Úroveň zvládnutí' })
		.selectOption({ label: '3 – splňuje' });
	await expect(pane.getByRole('combobox', { name: 'Úroveň zvládnutí' })).toHaveValue('3');
	await pane
		.getByRole('combobox', { name: 'Odhad obtížnosti' })
		.selectOption({ label: '2 – snadná' });
	await expect(pane.getByRole('combobox', { name: 'Odhad obtížnosti' })).toHaveValue('2');
});

test('RVP outputs: no duplicate, an emptied weight stays, the code is edited in place', async ({
	page
}) => {
	const { pane } = await load(page, 'Co karta procvičuje');
	const code = pane.getByRole('textbox', { name: 'Kód výstupu RVP' });
	await code.fill('M-5-1-02');
	await pane.getByRole('button', { name: 'Přidat', exact: true }).click();
	const weight = pane.getByRole('spinbutton', { name: 'Váha výstupu M-5-1-02' });
	await expect(weight).toHaveValue('50');

	await code.fill('M-5-1-02');
	await pane.getByRole('button', { name: 'Přidat', exact: true }).click();
	await expect(pane.getByText('Tenhle výstup už karta má.')).toBeVisible();
	await expect(weight).toHaveValue('50');

	await weight.fill('');
	await weight.blur();
	await expect(weight).toHaveValue('50');

	await pane.getByRole('button', { name: 'Změnit kód M-5-1-02' }).click();
	const rename = pane.getByRole('textbox', { name: 'Kód výstupu M-5-1-02' });
	await rename.fill('M-5-1-03');
	await rename.press('Enter');
	await expect(pane.getByRole('button', { name: 'Změnit kód M-5-1-03' })).toBeVisible();

	await pane.getByRole('button', { name: 'Odebrat M-5-1-03' }).click();
	await expect(pane.getByRole('button', { name: 'Změnit kód M-5-1-03' })).toHaveCount(0);
	await page
		.getByRole('dialog', { name: 'Nastavení karty' })
		.locator('.toast')
		.getByRole('button', { name: 'Vrátit zpět' })
		.click();
	await expect(pane.getByRole('button', { name: 'Změnit kód M-5-1-03' })).toBeVisible();

	// A typed weight, not only the default: the number input hands over a number.
	await code.fill('M-5-1-07');
	await pane.getByRole('spinbutton', { name: 'Váha výstupu', exact: true }).fill('70');
	await pane.getByRole('button', { name: 'Přidat', exact: true }).click();
	await expect(pane.getByRole('spinbutton', { name: 'Váha výstupu M-5-1-07' })).toHaveValue('70');
});

test('a prerequisite is one line, added through the picker and changed in place', async ({
	page
}) => {
	const { pane } = await load(page, 'Návaznost');
	// No selects in a rule.
	await expect(pane.getByRole('combobox')).toHaveCount(0);
	await pane.getByRole('button', { name: 'Přidat předpoklad' }).click();
	const picker = page.getByRole('dialog', { name: 'Na co karta čeká?' });
	await expect(picker).toBeVisible();
	await picker.getByRole('button', { name: /^Jinou kartu/ }).click();
	// The card being edited is not offered; the others are grouped by lesson.
	await expect(picker.getByRole('button', { name: 'Zpět' })).toBeVisible();
	await picker.locator('.choice').nth(1).click();
	await expect(picker).toBeHidden();

	const line = pane.getByRole('button', { name: /^Nejdřív karta „/ });
	await expect(line).toHaveCount(1);
	// A teacher never sees an id.
	await expect(line).not.toContainText(/block_|L\d_B\d/);

	const level = pane.getByRole('spinbutton', { name: 'Požadované zvládnutí v procentech' });
	await expect(level).toHaveValue('50');
	await level.fill('');
	await level.blur();
	await expect(level).toHaveValue('50');
	await level.fill('80');
	await level.blur();
	await expect(level).toHaveValue('80');

	// Clicking the line reopens the picker on the current choice; the percentage stays.
	await line.click();
	await expect(picker.getByRole('button', { name: 'Zpět' })).toBeVisible();
	await expect(picker.locator('[aria-current="true"]')).toHaveCount(1);
	await picker.getByRole('button', { name: 'Zpět' }).click();
	// Switching from a card to a skill is choosing the other branch.
	await picker.getByRole('button', { name: /^Dovednost/ }).click();
	await picker.getByRole('button', { name: /^Zlomky/ }).click();
	await picker.getByRole('button', { name: /^Úroveň 1/ }).click();
	await expect(pane.getByRole('button', { name: /^Nejdřív dovednost Zlomky/ })).toBeVisible();
	await expect(level).toHaveValue('80');

	await pane.getByRole('button', { name: 'Odebrat předpoklad' }).click();
	await expect(level).toHaveCount(0);
});

test('a card that already waits for this one cannot be picked as its prerequisite', async ({
	page
}) => {
	const doc = JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json', import.meta.url),
			'utf8'
		)
	);
	// The second card waits for the first, so the first cannot wait for the second.
	doc.blocks[1].learning = {
		...doc.blocks[1].learning,
		prerequisites: [{ block_id: doc.blocks[0].block_id, min_level: 0.5 }]
	};
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await page.getByRole('button', { name: 'Nastavení karty' }).first().click();
	const dialog = page.getByRole('dialog', { name: 'Nastavení karty' });
	const pane = await openSection(dialog, 'Návaznost');
	await pane.getByRole('button', { name: 'Přidat předpoklad' }).click();
	const picker = page.getByRole('dialog', { name: 'Na co karta čeká?' });
	await picker.getByRole('button', { name: /^Jinou kartu/ }).click();
	const waiting = picker.getByRole('button', { name: /na tuhle kartu čeká/ });
	await expect(waiting).toHaveCount(1);
	await expect(waiting).toHaveAttribute('aria-disabled', 'true');
	await waiting.click();
	await expect(picker).toBeVisible();
	await expect(pane.getByRole('button', { name: /^Nejdřív/ })).toHaveCount(0);
});
