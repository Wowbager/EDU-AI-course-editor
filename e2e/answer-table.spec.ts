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
	await expect(page.getByRole('radiogroup', { name: 'Známka za tuto odpověď' })).toHaveCount(0);
	await details(page).first().click();
	await expect(details(page).first()).toHaveAttribute('aria-expanded', 'true');
	await expect(
		page.getByRole('radiogroup', { name: 'Známka za tuto odpověď' }).first()
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Kam pokračovat po této odpovědi' }).first()
	).toBeVisible();

	// The line stays (the order is changed there), without the two fields.
	await multiple(page).check();
	await expect(page.getByRole('radiogroup', { name: 'Známka za tuto odpověď' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Kam pokračovat po této odpovědi' })).toHaveCount(
		0
	);

	// The values are still in the card; switching back shows them again.
	await multiple(page).uncheck();
	await expect(
		page
			.getByRole('radiogroup', { name: 'Známka za tuto odpověď' })
			.first()
			.getByRole('radio', { name: '1', exact: true })
	).toHaveAttribute('aria-checked', 'true');
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
	await expect(
		rows
			.first()
			.getByRole('radiogroup', { name: 'Známka za tuto odpověď' })
			.getByRole('radio', { name: '2', exact: true })
	).toHaveAttribute('aria-checked', 'true');
	await details(page).first().click();
	await expect(
		rows.first().getByRole('radiogroup', { name: 'Známka za tuto odpověď' })
	).toHaveCount(0);
});

test('an answer moves up and down from its detail line, and not past the ends', async ({
	page
}) => {
	await loadCourse(page);
	const rows = page.locator('.answers .row');
	// The answers' own text: the summary line under a row changes as its details open.
	const texts = () =>
		rows
			.getByRole('textbox', { name: 'Text odpovědi' })
			.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value ?? el.textContent));
	const before = await texts();
	expect(before.length).toBeGreaterThan(2);

	await details(page).first().click();
	const up = rows.first().getByRole('button', { name: /^Posunout nahoru/ });
	const down = rows.first().getByRole('button', { name: /^Posunout dolů/ });
	await expect(up).toBeDisabled();
	await down.click();
	await expect.poll(texts).toEqual([before[1], before[0], ...before.slice(2)]);

	// The moved answer is now second, and its line stayed open with it.
	await expect(rows.nth(1).getByRole('button', { name: /^Posunout nahoru/ })).toBeEnabled();
	await rows
		.nth(1)
		.getByRole('button', { name: /^Posunout nahoru/ })
		.click();
	await expect.poll(texts).toEqual(before);

	await details(page).last().click();
	await expect(rows.last().getByRole('button', { name: /^Posunout dolů/ })).toBeDisabled();
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

/** The "Kam dál" box of the first answer whose line is open. */
const goTo = (page: Page) => page.getByRole('button', { name: 'Kam pokračovat po této odpovědi' });
const goToBox = (page: Page) =>
	page.getByRole('dialog', { name: 'Kam pokračovat po této odpovědi' });

test('the line under an answer is a button: it looks quiet, answers to the pointer, and opens "Kam dál"', async ({
	page
}) => {
	await loadCourse(page);
	const rows = page.locator('.answers .row');
	// Answer b leads to step 3 in the fixture, and its line says so.
	const summary = rows.nth(1).locator('.set-values');
	await expect(summary).toContainText('Krok 3');
	await expect(summary).toHaveJSProperty('tagName', 'BUTTON');
	const resting = await summary.evaluate((el) => getComputedStyle(el).backgroundColor);
	await summary.hover();
	await expect
		.poll(() => summary.evaluate((el) => getComputedStyle(el).textDecorationLine))
		.toBe('underline');
	expect(await summary.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(resting);

	// One click: the detail line is open and the cursor is on "Kam dál".
	await summary.click();
	await expect(rows.nth(1).locator('.set-values')).toHaveCount(0);
	await expect(rows.nth(1).getByRole('group', { name: 'Podrobnosti odpovědi' })).toBeVisible();
	await expect(
		rows.nth(1).getByRole('button', { name: 'Kam pokračovat po této odpovědi' })
	).toBeFocused();
	// The chevron is still there to fold the line away.
	await expect(rows.nth(1).getByRole('button', { name: /^Podrobnosti odpovědi/ })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
});

test('the "Kam dál" box opens below its button, not over the answers above it', async ({
	page
}) => {
	await loadCourse(page);
	await page.locator('.answers .row').nth(1).locator('.set-values').click();
	const trigger = goTo(page).first();
	await trigger.click();
	const box = goToBox(page);
	await expect(box).toBeVisible();
	const t = (await trigger.boundingBox())!;
	const b = (await box.boundingBox())!;
	expect(b.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
});

test('letters typed at once after opening "Kam dál" are not lost', async ({ page }) => {
	await loadCourse(page);
	await page.locator('.answers .row').nth(1).locator('.set-values').click();
	await goTo(page).first().click();
	// No waiting: the keys follow the click as fast as they can.
	await page.keyboard.type('Krok');
	await expect(goToBox(page).getByRole('searchbox', { name: 'Hledat v nabídce' })).toHaveValue(
		'Krok'
	);
});

test('an answer that cuts a step off says so once, and "Vrátit zpět" brings it back', async ({
	page
}) => {
	await loadCourse(page);
	const rows = page.locator('.answers .row');
	const line = page.locator('.answers .cut-off');
	// Answer b is the only way to step 3; sending it to the end leaves step 3 without a path.
	await rows.nth(1).locator('.set-values').click();
	await goTo(page).first().click();
	await goToBox(page).getByRole('button', { name: 'Ukončit blok' }).click();
	await expect(line).toHaveCount(1);
	await expect(line).toContainText('Krok 3 teď nikam nevede — žák ho neuvidí');
	await expect(rows.nth(1).locator('.cut-off')).toBeVisible();

	// Undo is this change only: the answer leads to step 3 again and the line is gone.
	await line.getByRole('button', { name: 'Vrátit zpět' }).click();
	await expect(line).toHaveCount(0);
	await expect(goTo(page).first()).toContainText('Krok 3');

	// Do it again; the next edit of anything clears the line.
	await goTo(page).first().click();
	await goToBox(page).getByRole('button', { name: 'Ukončit blok' }).click();
	await expect(line).toHaveCount(1);
	await page.getByRole('textbox', { name: 'Text odpovědi' }).first().click();
	await page.keyboard.type('x');
	await expect(line).toHaveCount(0);
});

test('a change that loses nothing says nothing', async ({ page }) => {
	await loadCourse(page);
	await page.locator('.answers .row').nth(1).locator('.set-values').click();
	await goTo(page).first().click();
	// Carrying on from answer b reaches step 3 by the step order, so nothing is lost.
	await goToBox(page).getByRole('button', { name: 'Pokračovat dál' }).click();
	await expect(page.locator('.answers .cut-off')).toHaveCount(0);
});
