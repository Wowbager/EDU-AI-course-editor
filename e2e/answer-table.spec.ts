import { readFileSync } from 'node:fs';
import { expect, openEditor, test, type Page } from './fixtures';

/**
 * The answer table of a question step: what it hides until it is needed, what its
 * markers say, and which columns a question with several picks has.
 */
const fixture = () =>
	JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
			'utf8'
		)
	);

const trash = (page: Page) => page.getByRole('button', { name: /^Smazat odpověď/ });
const multipleBox = (page: Page) => page.getByRole('checkbox', { name: 'Víc správných možností' });
/** The switch's box is drawn as a track, so it is the label that gets clicked. */
const multiple = (page: Page) => ({
	check: () =>
		page
			.getByText('Víc správných možností', { exact: true })
			.click()
			.then(() => expect(multipleBox(page)).toBeChecked()),
	uncheck: () =>
		page
			.getByText('Víc správných možností', { exact: true })
			.click()
			.then(() => expect(multipleBox(page)).not.toBeChecked())
});
const head = (page: Page) => page.locator('.answers .head');

/** A fresh question card: two answers, one right. */
async function addQuestionCard(page: Page) {
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Text odpovědi' }).first()).toBeVisible();
}

async function loadCourse(page: Page, edit: (doc: ReturnType<typeof fixture>) => void = () => {}) {
	const doc = fixture();
	edit(doc);
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	await page.locator('.tree-card').nth(2).click();
	await expect(page.locator('.answers').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	// Wide enough for the table's own columns; below 760px it stacks and has no heading.
	await page.setViewportSize({ width: 2200, height: 1100 });
	await openEditor(page);
});

test('the trash of an answer is faintly there, full when its row is pointed at, and red only under the pointer', async ({
	page
}) => {
	await addQuestionCard(page);
	await page.getByRole('button', { name: 'Další odpověď' }).click();
	await expect(trash(page)).toHaveCount(3);

	const opacity = (i: number) =>
		trash(page)
			.nth(i)
			.evaluate((el) => Number(getComputedStyle(el.parentElement!).opacity));
	const color = (i: number) =>
		trash(page)
			.nth(i)
			.evaluate((el) => getComputedStyle(el).color);
	await page.mouse.move(0, 0);
	// Faint, never invisible: a teacher must be able to see that an answer can go.
	await expect.poll(() => opacity(0)).toBe(0.45);

	const rows = page.locator('.answers .row');
	await rows.nth(0).hover();
	await expect.poll(() => opacity(0)).toBe(1);
	await expect.poll(() => opacity(1)).toBe(0.45);
	const rest = await color(0);

	await trash(page).nth(0).hover();
	await expect.poll(() => color(0)).not.toBe(rest);

	// Working in a row shows it too, so a keyboard can reach it.
	await page.mouse.move(0, 0);
	await rows.nth(1).getByRole('textbox', { name: 'Text odpovědi' }).click();
	await expect.poll(() => opacity(1)).toBe(1);
});

test('a question cannot lose answers below the two it needs, and says why', async ({ page }) => {
	await addQuestionCard(page);
	await expect(trash(page)).toHaveCount(2);
	for (const button of await trash(page).all()) {
		await expect(button).toBeDisabled();
		await expect(button).toHaveAttribute('title', /aspoň dvě/);
	}

	await page.getByRole('button', { name: 'Další odpověď' }).click();
	await expect(trash(page)).toHaveCount(3);
	await expect(trash(page).first()).toBeEnabled();
	await trash(page).first().click({ force: true });
	await expect(trash(page)).toHaveCount(2);
	await expect(trash(page).first()).toBeDisabled();
});

test('the marker is a circle, or a square when several answers may be picked, and filled when right', async ({
	page
}) => {
	await addQuestionCard(page);
	const markers = page.getByRole('button', { name: /^Správná odpověď:/ });
	const shape = (i: number) =>
		markers
			.nth(i)
			.locator('.mark-box')
			.evaluate((el) => {
				const style = getComputedStyle(el);
				return { radius: parseFloat(style.borderTopLeftRadius), fill: style.backgroundColor };
			});

	const right = await shape(0);
	const wrong = await shape(1);
	expect(wrong.radius).toBeGreaterThanOrEqual(10);
	expect(right.fill).not.toBe(wrong.fill);
	// The right one carries a tick, the wrong one is empty.
	await expect(markers.nth(0).locator('svg')).toHaveCount(1);
	await expect(markers.nth(1).locator('svg')).toHaveCount(0);

	await multiple(page).check();
	expect((await shape(1)).radius).toBeLessThan(10);
	await multiple(page).uncheck();
	expect((await shape(1)).radius).toBeGreaterThanOrEqual(10);
});

test('the several-picks switch is worded once, and explains itself only while it is on', async ({
	page
}) => {
	await addQuestionCard(page);
	const hint = page.getByText('za částečný výběr nejsou body');
	await expect(multipleBox(page)).not.toBeChecked();
	await expect(hint).toHaveCount(0);
	await multiple(page).check();
	await expect(hint).toBeVisible();
	await multiple(page).uncheck();
	await expect(hint).toHaveCount(0);
});

const details = (page: Page) => page.getByRole('button', { name: /^Podrobnosti odpovědi/ });

test('a question with several picks has no "Kam dál" and no grade, since the app reads neither', async ({
	page
}) => {
	await loadCourse(page, (doc) => {
		doc.quiz_evaluate = true;
	});
	// Both live in the answer's detail line, which is closed until it is asked for.
	await expect(page.getByRole('combobox', { name: 'Známka za tuto odpověď' })).toHaveCount(0);
	await details(page).first().click();
	await expect(details(page).first()).toHaveAttribute('aria-expanded', 'true');
	await expect(
		page.getByRole('combobox', { name: 'Známka za tuto odpověď' }).first()
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Kam pokračovat po této odpovědi' }).first()
	).toBeVisible();

	await multiple(page).check();
	await expect(details(page)).toHaveCount(0);
	await expect(page.getByRole('combobox', { name: 'Známka za tuto odpověď' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Kam pokračovat po této odpovědi' })).toHaveCount(
		0
	);

	// The values are still in the card; switching back shows them again.
	await multiple(page).uncheck();
	await expect(page.getByRole('combobox', { name: 'Známka za tuto odpověď' }).first()).toHaveValue(
		'1'
	);
});

test('the detail line opens from the row, and a set value is read without opening it', async ({
	page
}) => {
	await loadCourse(page, (doc) => {
		doc.quiz_evaluate = true;
		const options = doc.blocks.find((b: { block_id: string }) => b.block_id === 'L1_B3_poznej')
			.steps[1].question.options;
		for (const option of options) {
			delete option.mark;
			delete option.go_to;
		}
		options[0].mark = '2';
		options[1].go_to = 'END';
	});
	const rows = page.locator('.answers .row');
	// The control is faint until the row is pointed at, and named for a screen reader.
	await expect(details(page).first()).toHaveCSS('opacity', '0.45');
	await rows.first().hover();
	await expect(details(page).first()).toHaveCSS('opacity', '1');

	// A value that is set shows as inert text; the unset answer says nothing.
	await expect(rows.nth(0).locator('.set-values')).toHaveText('známka 2');
	await expect(rows.nth(1).locator('.set-values')).toHaveText('konec bloku');
	await expect(rows.nth(2).locator('.set-values')).toHaveCount(0);

	// Opening the line swaps the text for the fields that hold the values.
	await details(page).first().click();
	await expect(rows.first().locator('.set-values')).toHaveCount(0);
	await expect(rows.first().getByRole('combobox', { name: 'Známka za tuto odpověď' })).toHaveValue(
		'2'
	);
	await details(page).first().click();
	await expect(rows.first().getByRole('combobox', { name: 'Známka za tuto odpověď' })).toHaveCount(
		0
	);
});

test('the heading row goes when "Odpověď" would be its only label', async ({ page }) => {
	await addQuestionCard(page);
	await expect(head(page)).toBeVisible();
	await page.getByRole('button', { name: 'Zpětná vazba', exact: true }).click();
	await expect(head(page)).toHaveCount(0);
	await page.getByRole('button', { name: 'Zpětná vazba', exact: true }).click();
	await expect(head(page)).toBeVisible();
});

test('what is wrong with the list of answers is said under it', async ({ page }) => {
	await loadCourse(page, (doc) => {
		const question = doc.blocks.find((b: { block_id: string }) => b.block_id === 'L1_B3_poznej')
			.steps[1].question;
		question.options = question.options.slice(0, 1);
	});
	// Errors of a card wait until the card is left.
	await expect(page.locator('.answers .list-issue')).toHaveCount(0);
	await page.locator('.tree-card').nth(0).click();
	await page.locator('.tree-card').nth(2).click();
	await expect(page.locator('.answers .list-issue')).toContainText('Žák nemá z čeho vybírat');
});

test('a problem with where an answer leads opens that answer’s detail line by itself', async ({
	page
}) => {
	await loadCourse(page, (doc) => {
		const options = doc.blocks.find((b: { block_id: string }) => b.block_id === 'L1_B3_poznej')
			.steps[1].question.options;
		options[1].go_to = 'neexistuje';
	});
	// Errors of a card wait until the card is left.
	await page.locator('.tree-card').nth(0).click();
	await page.locator('.tree-card').nth(2).click();
	const rows = page.locator('.answers .row');
	await expect(
		rows.nth(1).getByRole('button', { name: 'Kam pokračovat po této odpovědi' })
	).toBeVisible();
	await expect(
		rows.nth(0).getByRole('button', { name: 'Kam pokračovat po této odpovědi' })
	).toHaveCount(0);
});

test('a detail line that was pointed at can still be closed by hand', async ({ page }) => {
	await loadCourse(page);
	const first = page.locator('.answers .row').first();
	const more = first.getByRole('button', { name: /^Podrobnosti odpovědi/ });
	// A warning on the row may have opened it already.
	if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
	await expect(more).toHaveAttribute('aria-expanded', 'true');
	await first.getByRole('button', { name: 'Kam pokračovat po této odpovědi' }).click();
	await page
		.getByRole('dialog', { name: 'Kam pokračovat po této odpovědi' })
		.getByRole('button', { name: 'Ukončit blok' })
		.click();
	await first.getByRole('button', { name: /^Podrobnosti odpovědi/ }).click();
	await expect(first.getByRole('button', { name: 'Kam pokračovat po této odpovědi' })).toHaveCount(
		0
	);
	await expect(first.locator('.set-values')).toContainText('konec bloku');
});
