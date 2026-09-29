import { addStep, cardAction, expect, test, type Page, openEditor } from './fixtures';
import { readFileSync } from 'node:fs';

const fixture = (name: string) =>
	readFileSync(new URL(`../src/lib/domain/__tests__/fixtures/${name}`, import.meta.url), 'utf8');

/** Load a course through the editor's own import path, as an author would. */
async function importCourse(page: Page, name: string, text = fixture(name)) {
	await page.setInputFiles('input[type=file]', {
		name,
		mimeType: 'application/json',
		buffer: Buffer.from(text)
	});
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	// Only real exceptions count. The editor is built to work with the API and the
	// player absent — those show up here as failed resource loads, and treating them
	// as failures would mean the suite could only ever run against a full stack.
	const thrown: string[] = [];
	page.on('pageerror', (error) => thrown.push(error.message));

	// A load the network dropped throws on its way down ("Failed to fetch dynamically
	// imported module"). What counts is the page that did load.
	if (await openEditor(page)) thrown.length = 0;
	expect(thrown).toEqual([]);
});

test('a teacher builds a lesson from scratch', async ({ page }) => {
	// A new course starts with one lesson and one card, ready to type into. The
	// lesson is named in the tree; the heading names the card being worked on.
	await expect(page.locator('.tree-lesson.open .name')).toHaveText('První lekce');
	await expect(page.locator('.tree-card')).toHaveCount(1);

	// Write the explanation. A text step is a Markdown editor, not a revealed field.
	await page.locator('.cm-content').first().click();
	await page.locator('.cm-content').first().fill('Zlomek popisuje **část celku**.');

	// Add a question card. The add buttons live under the open lesson in the tree —
	// scoped, because "Otázka" is also the name of an add-*step* button.
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await expect(page.locator('.tree-card')).toHaveCount(2);

	// The new card is the one on screen, so there is exactly one answer table.
	const answers = page.locator('.answers');
	await answers.getByRole('textbox', { name: 'Text odpovědi' }).first().click();
	await page.keyboard.type('Čitatel je 5');
	await page.keyboard.press('Enter');

	await expect(answers.getByRole('textbox', { name: 'Text odpovědi' }).first()).toHaveValue('Čitatel je 5');

	// The lesson totals move with the content: two cards now.
	await expect(page.locator('.tree-lesson.open .meta')).toContainText('2 karty');
});

test('a teacher is never shown an id they must not change', async ({ page }) => {
	await importCourse(page, 'spec-16-course.json');

	// Ids key a student's progress and saved answers, so teacher mode hides them —
	// in the card, in the tree, and behind the settings button.
	await expect(page.locator('.card')).not.toContainText('L1_B1_uvod');
	await expect(page.locator('nav')).not.toContainText('L1_B1_uvod');
	await expect(page.locator('.step').first()).toContainText('Krok 1');

	await page.getByRole('button', { name: 'Nastavení karty' }).click();
	await expect(page.getByRole('dialog')).not.toContainText('L1_B1_uvod');
	await page.keyboard.press('Escape');

	// The advanced mode is where they become visible — and the metodik, who edits
	// didactics rather than structure, must not see them either.
	await page.getByRole('radio', { name: 'Metodik' }).click();
	await expect(page.locator('.step').first()).toContainText('Krok 1');

	await page.getByRole('radio', { name: 'Pokročilý' }).click();
	await expect(page.locator('.step').first()).toContainText('s1');
});

test('teacher mode hides nothing behind a disclosure', async ({ page }) => {
	await importCourse(page, 'spec-16-course.json');

	// The whole point of the mode: what a teacher may edit, a teacher can see. The
	// help ladder in particular — the app's question mark has nothing to show when
	// these are empty, so a field the author never finds is a button that never works.
	await expect(page.locator('main .disclosure')).toHaveCount(0);
	await expect(page.locator('.step').first()).toContainText('Nápověda');
	await expect(page.locator('.step').first()).toContainText('Podrobná pomoc');
	// The card-wide ladder is a fallback, so it sits in the card's settings.
	await expect(page.locator('.card')).not.toContainText('Nápověda ke kartě');
	await page.getByRole('button', { name: 'Nastavení karty' }).click();
	await expect(page.getByRole('dialog')).toContainText('Nápověda ke kartě');
	await expect(page.getByRole('dialog')).toContainText('Podrobná pomoc');
});

test('a type change that loses answers says Zpět brings them back, even from another card', async ({ page }) => {
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	const answer = page.locator('.answers').getByRole('textbox', { name: 'Text odpovědi' }).first();
	await answer.fill('Čitatel je 5');
	await page.getByRole('radio', { name: 'Otevřená odpověď' }).click();

	const dialog = page.getByRole('dialog', { name: 'Změnit typ otázky?' });
	await expect(dialog).toContainText('Zpět se dá vrátit tlačítkem Zpět v liště.');
	// The promise is not limited to the card: undo is the course's.
	await expect(dialog).not.toContainText('neopustíš');
	await dialog.getByRole('button', { name: 'Přesto změnit' }).click();
	await expect(dialog).toBeHidden();

	await page.locator('.tree-card').first().click();
	await expect(page.locator('.answers')).toHaveCount(0);
	await page.getByRole('button', { name: 'Zpět', exact: true }).click();
	await expect(answer).toHaveValue('Čitatel je 5');
});

test('the practice switch agrees with the Opakování chip, and off means off', async ({ page }) => {
	// The second card is in practice through the flag on its one step, not its own.
	await importCourse(page, 'spec-16-course.json');
	await page.getByRole('radio', { name: 'Metodik' }).click();
	await page.locator('.tree-card').nth(1).click();
	const chip = page.locator('main .card header').getByText('Opakování', { exact: true });
	await expect(chip).toBeVisible();

	await page.getByRole('button', { name: 'Nastavení karty' }).click();
	const dialog = page.getByRole('dialog', { name: 'Nastavení karty' });
	const practice = dialog.getByRole('checkbox', { name: /^Zařadit do cvičení/ });
	await expect(practice).toBeChecked();
	// The box itself is drawn as a track; the label is what a teacher clicks.
	const label = dialog.locator('label.toggle').filter({ hasText: 'Zařadit do cvičení' });
	await label.click();
	await expect(chip).toBeHidden();
	await expect(practice).not.toBeChecked();
	await label.click();
	await expect(chip).toBeVisible();
	await expect(practice).toBeChecked();
});

test('the settings panels are real dialogs', async ({ page }) => {
	await importCourse(page, 'spec-16-course.json');

	for (const open of [
		() => page.locator('.course').click(),
		() => page.locator('.tree-lesson.open .row-actions button').click(),
		() => page.getByRole('button', { name: 'Nastavení karty' }).click()
	]) {
		await open();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		// `showModal` puts focus inside and takes the page behind out of the tab order.
		expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	}
});

test('a card that is in no lesson can still be opened', async ({ page }) => {
	await importCourse(page, 'spec-16-course.json');

	// Unbinding the last card in a lesson leaves the block in the course with nothing
	// pointing at it. It used to be unselectable: the click registered and the
	// "always keep a card open" effect immediately threw the selection back.
	await cardAction(page, 'Odebrat z lekce');
	const orphan = page.locator('.orphans .tree-card').first();
	await expect(orphan).toBeVisible();

	await orphan.click();
	await expect(page.locator('.crumb')).toContainText('mimo lekce');
	await expect(page.locator('.card')).toHaveCount(1);
});

test('the validation panel jumps to the field that needs fixing', async ({ page }) => {
	await importCourse(page, 'spec-16-course-broken.json');

	await page.getByRole('button', { name: /chyb/ }).first().click();
	const panel = page.getByRole('complementary', { name: 'Kontrola kurzu' });
	await expect(panel).toBeVisible();

	// Every error reads as a consequence for the student, not as a field name.
	const firstIssue = panel.locator('.issue').first();
	await expect(firstIssue).toContainText(/žák|Žák/);

	await firstIssue.click();
	await expect(panel).toBeHidden();
	// The card the issue was about is the one now open: highlighted in the tree, and
	// alone in the editor column. Counted loosely in the tree on purpose — this
	// fixture's first error is two lessons sharing an id, so the offending card is
	// genuinely in the tree twice, which is the thing the panel is complaining about.
	expect(await page.locator('.tree-card.selected').count()).toBeGreaterThan(0);
	await expect(page.locator('main .card')).toHaveCount(1);
});

test('the spec course imports clean and publishes', async ({ page }) => {
	await importCourse(page, 'spec-16-course.json');

	await expect(page.getByRole('button', { name: 'Kontrola kurzu: v pořádku' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Stáhnout', exact: true })).toBeEnabled();
	await expect(page.locator('.tree-lesson.open .name')).toHaveText('Co je zlomek?');
	await expect(page.locator('.tree-card')).toHaveCount(3);
});

test('a course with errors cannot be exported, one with warnings can', async ({ page }) => {
	const download = page.getByRole('button', { name: 'Stáhnout', exact: true });
	let downloads = 0;
	page.on('download', () => downloads++);

	// Errors block export (§3 invariant 5) — but the button says why instead of
	// being greyed out: it opens a review of what is left, grouped by card.
	await importCourse(page, 'spec-16-course-broken.json');
	await download.click();
	const review = page.getByRole('dialog', { name: 'Než kurz stáhneš' });
	await expect(review).toBeVisible();
	await expect(review.locator('.group.error').first()).toBeVisible();
	await expect(review.getByRole('button', { name: 'Stáhnout i tak' })).toHaveCount(0);
	// Warnings are there too, folded away: they do not block anything.
	await expect(review.locator('details.advice')).not.toHaveAttribute('open');

	// „Přejít“ closes the review and opens the card the row is about.
	await review.locator('.group.error').first().getByRole('button', { name: /Přejít/ }).first().click();
	await expect(review).toBeHidden();
	await expect(page.locator('main .card')).toHaveCount(1);
	expect(await page.locator('.tree-card.selected').count()).toBeGreaterThan(0);
	expect(downloads).toBe(0);

	// A clean course downloads straight away, with no dialog in between.
	await importCourse(page, 'spec-16-course.json');
	const direct = page.waitForEvent('download');
	await download.click();
	await direct;
	await expect(page.getByRole('dialog')).toHaveCount(0);

	// Warnings alone never block: the review offers the download. (Edited after the
	// import on purpose — importing over an edited course asks for confirmation.)
	await cardAction(page, 'Odebrat z lekce');
	await download.click();
	const advice = page.getByRole('dialog', { name: 'Stáhnout kurz' });
	await expect(advice).toContainText('dá se stáhnout');
	const file = page.waitForEvent('download');
	await advice.getByRole('button', { name: 'Stáhnout i tak' }).click();
	await file;
	await expect(advice).toBeHidden();
});

test('unfinished content stays quiet until the card is left, and the review shows the rest', async ({ page }) => {
	// A fresh course is one empty text card — unfinished, not wrong. Nothing on it is red.
	const check = page.locator('.topbar .chip-button');
	await expect(check).toContainText('k dokončení');
	await expect(page.locator('.missing-text')).toHaveCount(0);
	await expect(page.locator('.tree-card .chip.error')).toHaveCount(0);

	// Moving to a new card leaves the first one; now its empty text is plainly skipped.
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await expect(page.locator('.tree-card').first().locator('.chip.error')).toBeVisible();
	// The new question card, still being written, stays quiet.
	await expect(page.locator('.tree-card').nth(1).locator('.chip.error')).toHaveCount(0);

	await page.locator('.tree-card').first().click();
	await expect(page.locator('.missing-text')).toBeVisible();

	// On a card still being written, a field says so once it is left — not while
	// it is being typed into.
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	const answer = page.locator('.answers').getByRole('textbox', { name: 'Text odpovědi' }).first();
	await answer.click();
	await expect(answer).not.toHaveAttribute('aria-invalid', 'true');
	await page.locator('.answers').getByRole('textbox', { name: 'Zpětná vazba k této odpovědi' }).first().click();
	await expect(answer).toHaveAttribute('aria-invalid', 'true');

	// Asking to export turns the author from writing to fixing: the count goes red.
	await page.getByRole('button', { name: 'Stáhnout', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Než kurz stáhneš' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(check).not.toContainText('k dokončení');
	await expect(check.locator('.chip.error')).toBeVisible();

	// What the review listed is now to fix, but a card added afterwards is a new
	// draft like any other, not red at birth.
	await page.locator('.tree-add').getByRole('button', { name: 'Otázka', exact: true }).click();
	await expect(page.locator('.tree-card')).toHaveCount(4);
	await expect(page.locator('.tree-card').first().locator('.chip.error')).toBeVisible();
	await expect(page.locator('.tree-card').nth(3).locator('.chip.error')).toHaveCount(0);
});

test('an imported course with problems says so once, calmly', async ({ page }) => {
	await importCourse(page, 'spec-16-course-broken.json');
	const banner = page.locator('.banner.unfinished');
	await expect(banner).toContainText('k dokončení');
	await banner.getByRole('button', { name: 'Zobrazit' }).click();
	await expect(page.getByRole('dialog', { name: 'Než kurz stáhneš' })).toBeVisible();
	await page.keyboard.press('Escape');
	// Seen: the banner has done its job.
	await expect(banner).toHaveCount(0);
});

test('deleting a branched step asks where its branches should go', async ({ page }) => {
	await importCourse(page, 'spec-16-course.json');

	// The editor column holds one card, so open the one the branching lives in.
	await page.locator('.tree-card').nth(2).click();

	// The remediation step is the target of a wrong answer's `go_to`. It is addressed
	// by its position, because a teacher never sees a step id (plan §8) — and the
	// inbound-branch chip says a branch points at it.
	// Matched on the step's own label, not on any text containing it — the `go_to`
	// picker lists the other steps by the same names.
	const step = page.locator('.step').filter({
		has: page.getByText('Krok 3', { exact: true })
	});
	await expect(step).toHaveCount(1);
	await expect(step.getByTitle('Na tento krok vede větvení z jiné odpovědi')).toContainText('1');
	await step.getByRole('button', { name: 'Smazat' }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText('uvízl');
	// The pointer at it is listed, with a destination to choose.
	await expect(dialog.getByRole('combobox')).toHaveCount(1);
});

test('undo puts back what a delete took away', async ({ page }) => {
	await importCourse(page, 'spec-16-course.json');
	// Scoped to the lesson: "Odebrat" unbinds rather than deletes, so the card is
	// still in the course — it moves to "Karty mimo lekce", which is the whole point.
	const inLesson = page.locator('.tree-lesson.open .cards .tree-card');
	await expect(inLesson).toHaveCount(3);

	await inLesson.first().click();
	await cardAction(page, 'Odebrat z lekce');
	// The removed card stays selected in the orphan bucket; its old lesson closes.
	await expect(page.locator('.tree-lesson .meta').first()).toContainText('2 karty');
	await expect(page.locator('.orphans .tree-card')).toHaveCount(1);

	// The glyph is what a mouse sees; "Zpět" is what the button is called.
	await page.getByRole('button', { name: 'Zpět', exact: true }).click();
	await expect(inLesson).toHaveCount(3);
});

test('the card heading carries no breadcrumb, and its help shows only while it is edited', async ({ page }) => {
	await importCourse(page, 'spec-16-course.json');
	await expect(page.locator('.crumb')).toHaveCount(0);

	const help = page.locator('.card-head-hint');
	const opacity = () => help.evaluate((el) => Number(getComputedStyle(el).opacity));
	const cardTop = () => page.locator('main .card').evaluate((el) => el.getBoundingClientRect().top);
	const before = await cardTop();
	await expect.poll(opacity).toBe(0);

	await page.getByRole('textbox', { name: 'Název karty', exact: true }).click();
	await expect.poll(opacity).toBe(1);
	// It sits over the layout: showing it moves nothing.
	expect(await cardTop()).toBe(before);

	await page.getByRole('textbox', { name: 'Název kurzu', exact: true }).click();
	await expect.poll(opacity).toBe(0);
	expect(await cardTop()).toBe(before);
});

test('an image step asks for the picture first, and for its description once there is one', async ({ page }) => {
	await addStep(page, 'Obrázek');
	const url = page.getByRole('textbox', { name: 'Adresa obrázku', exact: true });
	const alt = page.getByRole('textbox', { name: 'Popis obrázku pro čtečku obrazovky', exact: true });
	await expect(url).toBeVisible();
	await expect(url).toHaveAttribute('placeholder', 'Vlož odkaz na obrázek (např. https://…/obrazek.jpg)');
	await expect(alt).toHaveCount(0);

	await url.fill('https://example.com/zlomek.png');
	await url.press('Enter');
	await expect(alt).toBeVisible();

	await url.fill('');
	await url.press('Enter');
	await expect(alt).toHaveCount(0);
});
