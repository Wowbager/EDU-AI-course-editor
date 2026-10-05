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
	// Level and difficulty are a few short choices: segments, not selects. The chosen
	// one is stored as a number, and clicking it again gives "nenastaveno" back.
	const level = pane.getByRole('radiogroup', { name: 'Úroveň zvládnutí' });
	await level.getByRole('radio', { name: 'splňuje', exact: true }).click();
	await expect(level.getByRole('radio', { name: 'splňuje', exact: true })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	const difficulty = pane.getByRole('radiogroup', { name: 'Odhad obtížnosti' });
	await difficulty.getByRole('radio', { name: 'snadná', exact: true }).click();
	await expect(difficulty.getByRole('radio', { name: 'snadná', exact: true })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await difficulty.getByRole('radio', { name: 'snadná', exact: true }).click();
	await expect(difficulty.getByRole('radio', { checked: true })).toHaveCount(0);
});

test('RVP outputs: adding is its own action, no duplicate, an emptied weight stays, the code is edited in place', async ({
	page
}) => {
	const { pane } = await load(page, 'Co karta procvičuje');
	const code = pane.getByRole('textbox', { name: 'Kód výstupu RVP' });
	const add = pane.getByRole('button', { name: 'Přidat', exact: true });
	const open = pane.getByRole('button', { name: 'Přidat výstup', exact: true });

	// The add row is not there until asked for, and Zrušit closes it without saving.
	await expect(code).toHaveCount(0);
	await open.click();
	await code.fill('M-5-1-99');
	await pane.getByRole('button', { name: 'Zrušit', exact: true }).click();
	await expect(code).toHaveCount(0);
	await expect(pane.getByRole('button', { name: 'Změnit kód M-5-1-99' })).toHaveCount(0);

	await open.click();
	await code.fill('M-5-1-02');
	await add.click();
	// Saved: it is now a list row and the add row is closed again.
	const weight = pane.getByRole('spinbutton', { name: 'Váha výstupu M-5-1-02' });
	await expect(weight).toHaveValue('50');
	await expect(code).toHaveCount(0);

	await open.click();
	await code.fill('M-5-1-02');
	await add.click();
	await expect(pane.getByText('Tenhle výstup už karta má.')).toBeVisible();
	const newWeight = pane.getByRole('spinbutton', { name: 'Váha výstupu', exact: true });
	await expect(newWeight).toHaveValue('50');

	await newWeight.fill('');
	await newWeight.blur();
	await expect(newWeight).toHaveValue('');
	await pane.getByRole('button', { name: 'Zrušit', exact: true }).click();

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
	await open.click();
	await code.fill('M-5-1-07');
	await pane.getByRole('spinbutton', { name: 'Váha výstupu', exact: true }).fill('70');
	await add.click();
	await expect(pane.getByRole('spinbutton', { name: 'Váha výstupu M-5-1-07' })).toHaveValue('70');
});

test('Pojmy are chips: added with Enter or a pasted list, no duplicates, removed with undo', async ({
	page
}) => {
	const { pane } = await load(page, 'Co karta procvičuje');
	const input = pane.getByRole('combobox', { name: 'Nový pojem' });
	await input.fill('čitatel');
	await input.press('Enter');
	await expect(pane.getByRole('button', { name: 'Odebrat pojem čitatel' })).toBeVisible();
	await expect(input).toHaveValue('');

	await input.fill('jmenovatel, zlomková čára');
	await pane.getByRole('button', { name: 'Přidat pojem', exact: true }).click();
	await expect(pane.getByRole('button', { name: 'Odebrat pojem jmenovatel' })).toBeVisible();
	await expect(pane.getByRole('button', { name: 'Odebrat pojem zlomková čára' })).toBeVisible();

	await input.fill('Čitatel');
	await input.press('Enter');
	await expect(pane.getByText('Pojem „Čitatel“ už karta má.')).toBeVisible();

	await pane.getByRole('button', { name: 'Odebrat pojem čitatel' }).click();
	await expect(pane.getByRole('button', { name: 'Odebrat pojem čitatel' })).toHaveCount(0);
	await page
		.getByRole('dialog', { name: 'Nastavení karty' })
		.locator('.toast')
		.getByRole('button', { name: 'Vrátit zpět' })
		.click();
	await expect(pane.getByRole('button', { name: 'Odebrat pojem čitatel' })).toBeVisible();
});

test('Pojmy: terms other cards use are suggested, and keep their spelling', async ({ page }) => {
	const { dialog, pane } = await load(page, 'Co karta procvičuje');
	const input = pane.getByRole('combobox', { name: 'Nový pojem' });
	await input.fill('Čtvrtina');
	await input.press('Enter');
	await expect(pane.getByRole('button', { name: 'Odebrat pojem Čtvrtina' })).toBeVisible();
	// Nothing to suggest on the card that has it.
	await input.fill('čtvr');
	await expect(page.getByRole('listbox')).toHaveCount(0);
	await input.fill('');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	// On another card: typed in lower case, offered with the course's spelling.
	await page.locator('.tree-card').nth(1).click();
	await page.getByRole('button', { name: 'Nastavení karty' }).first().click();
	const other = await openSection(
		page.getByRole('dialog', { name: 'Nastavení karty' }),
		'Co karta procvičuje'
	);
	const field = other.getByRole('combobox', { name: 'Nový pojem' });
	await field.fill('čtvr');
	const options = page.getByRole('listbox', { name: 'Pojmy z jiných karet' });
	await expect(options.getByRole('option', { name: 'Čtvrtina' })).toBeVisible();
	// The keyboard reaches the list.
	await field.press('ArrowDown');
	await field.press('Enter');
	await expect(other.getByRole('button', { name: 'Odebrat pojem Čtvrtina' })).toBeVisible();
	await expect(field).toHaveValue('');

	// Typed out in full with another case: written the way the course has it.
	await other.getByRole('button', { name: 'Odebrat pojem Čtvrtina' }).click();
	await field.fill('čtvrtina');
	await field.press('Enter');
	await expect(other.getByRole('button', { name: 'Odebrat pojem Čtvrtina' })).toBeVisible();
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
	await picker.locator('.choice:not([aria-disabled="true"])').first().click();
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
	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await page.getByRole('button', { name: 'Nastavení karty' }).first().click();
	const dialog = page.getByRole('dialog', { name: 'Nastavení karty' });
	const pane = await openSection(dialog, 'Návaznost');
	await pane.getByRole('button', { name: 'Přidat předpoklad' }).click();
	const picker = page.getByRole('dialog', { name: 'Na co karta čeká?' });
	await picker.getByRole('button', { name: /^Jinou kartu/ }).click();
	// The second card waits for it directly, and the next three through the chain
	// (each of lesson 1's cards waits for the one before).
	const waiting = picker.getByRole('button', { name: /čeká na tuhle kartu/ });
	await expect(waiting).toHaveCount(4);
	await expect(waiting.first()).toContainText('Části zlomku');
	for (const item of await waiting.all())
		await expect(item).toHaveAttribute('aria-disabled', 'true');
	await waiting.first().click({ force: true });
	await expect(picker).toBeVisible();
	await expect(pane.getByRole('button', { name: /^Nejdřív/ })).toHaveCount(0);
});
