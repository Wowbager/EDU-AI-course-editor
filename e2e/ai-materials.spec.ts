import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openEditor, type Page } from './fixtures';

/**
 * Materials in AI pomocník: files are attached, read in the browser, kept with the course,
 * and the proposal and the cards written from it carry them.
 *
 * Runs against the `fake` provider: a picture is "read" as a fixed line, and a proposal
 * made with materials gives its first card the first section as its source.
 */

const fixtures = join(import.meta.dirname, '..', 'src/lib/materials/__tests__/fixtures');
const docx = join(fixtures, 'handout.docx');
const png = join(fixtures, 'page.png');
const pdf = join(fixtures, 'scan.pdf');

const aiTab = (page: Page) => page.getByRole('button', { name: 'AI pomocník', exact: true });
const panel = (page: Page) => page.getByRole('region', { name: 'AI', exact: true });
const box = (page: Page) => page.getByRole('textbox', { name: /^Co (mám vytvořit|změnit)\?$/ });
const chips = (page: Page) => panel(page).getByRole('list', { name: 'Podklady' });
const picker = (page: Page) => panel(page).locator('input[type="file"]');
const create = (page: Page) => page.getByRole('button', { name: 'Vytvořit vybrané', exact: true });

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await aiTab(page).click();
});

test('a file is attached with the paperclip, shown as a chip while it is read, and kept', async ({
	page
}) => {
	// The picture is read by the server; hold it to see the chip say so.
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/ai/read', async (route) => {
		await gate;
		await route.continue();
	});
	await expect(page.getByRole('button', { name: 'Přiložit podklady' })).toBeEnabled();
	await picker(page).setInputFiles([png]);
	// While it is read the chip shows a spinner, and says so to a screen reader.
	const reading = chips(page).getByRole('listitem').filter({ hasText: 'page' });
	await expect(reading.getByText('Čtu soubor page.png')).toBeAttached();
	await expect(reading.getByRole('button')).toHaveCount(0);
	release();
	await expect(reading.getByText('Čtu soubor page.png')).toHaveCount(0);
	// The chip shows the name without its extension; the full name is its tooltip.
	await expect(reading).toHaveText('page');
	await expect(reading).toHaveAttribute('title', 'page.png');
	await expect(reading.getByRole('button', { name: 'Odebrat podklad: page.png' })).toBeAttached();
	await expect(page.getByRole('textbox', { name: 'Co mám vytvořit?' })).toBeVisible();
});

test('a proposal made from materials shows where each card comes from, and the cards are written from them', async ({
	page
}) => {
	const sent: { materials?: string; card: { title: string } }[] = [];
	await page.route('**/ai/block', async (route) => {
		if (route.request().method() === 'POST') sent.push(route.request().postDataJSON());
		await route.continue();
	});
	await picker(page).setInputFiles([docx, png]);
	await expect(chips(page).getByRole('listitem')).toHaveCount(2);

	await box(page).fill('Kurz podle podkladů');
	await page.getByRole('button', { name: 'Odeslat', exact: true }).click();
	await expect(create(page)).toBeEnabled();
	// A card with sources has one quiet line under its name; one without has none.
	const first = page.locator('.row.card').filter({ hasText: 'Co to je' });
	await expect(first.locator('.source')).toHaveText('handout');
	await expect(
		page.locator('.row.card').filter({ hasText: 'Procvičení' }).locator('.source')
	).toHaveCount(0);
	await expect(page.locator('.source')).toHaveCount(2);
	await expect(
		page.locator('.row.card').filter({ hasText: 'Jak se to používá' }).locator('.source')
	).toHaveText('handout; page');

	await create(page).click();
	await expect(panel(page).locator('.queue-row.done')).toHaveCount(5);

	// Every card's request carried the materials; the card with sources named them.
	expect(sent).toHaveLength(5);
	for (const request of sent) {
		expect(request.materials).toContain('x + 5 = 12');
		expect(request.materials).toContain('Ukázkový přepis obrázku');
	}
	const withSources = sent.find((r) => r.card.title === 'Co to je')!;
	expect(withSources.materials).toMatch(/This card draws mainly on: \[[0-9a-f]{8}\.0\]\./);
	const without = sent.find((r) => r.card.title === 'Procvičení')!;
	expect(without.materials).not.toContain('This card draws mainly on');
});

test('the materials belong to the course: they are there after a reload, and × takes one out for good', async ({
	page
}) => {
	await picker(page).setInputFiles([docx, png]);
	await expect(chips(page).getByRole('listitem')).toHaveCount(2);

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(chips(page).getByRole('listitem')).toHaveCount(2);
	await expect(chips(page)).toContainText('handout');
	await expect(chips(page)).toContainText('page');

	await chips(page).getByRole('listitem').filter({ hasText: 'page' }).hover();
	await page.getByRole('button', { name: 'Odebrat podklad: page.png' }).click();
	await expect(chips(page).getByRole('listitem')).toHaveCount(1);

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(chips(page).getByRole('listitem')).toHaveCount(1);
	await expect(chips(page)).toContainText('handout');
});

test('a page that could not be read is said, quietly, and the rest of the file is kept', async ({
	page
}) => {
	await page.route('**/ai/read', (route) => route.fulfill({ status: 502, body: 'failed' }));
	await picker(page).setInputFiles([pdf]);
	const chip = chips(page).getByRole('listitem').filter({ hasText: 'scan' });
	await expect(chip).toBeVisible();
	// The file's own chip is marked, and its tooltip says which pages; the line names the file.
	await expect(chip.locator('.chip-warn')).toHaveText('!');
	await expect(chip).toHaveAttribute('title', /scan\.pdf\nStranu 2 se nepodařilo přečíst/);
	await expect(panel(page).getByText('scan: stranu 2 se nepodařilo přečíst')).toBeVisible();
});

test('chips stay in one row; „+N“ opens the rest and folds them again', async ({ page }) => {
	const bytes = readFileSync(docx);
	const names = [1, 2, 3, 4, 5, 6].map((n) => `Pracovní list lineární rovnice třída ${n}.docx`);
	await picker(page).setInputFiles(
		names.map((name, n) => ({
			name,
			mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			buffer: Buffer.concat([bytes, Buffer.from([n])])
		}))
	);
	const more = chips(page).getByRole('button', { name: /^Ukázat dalších \d+ podkladů$/ });
	await expect(more).toBeVisible();
	const row = (list: ReturnType<typeof chips>) =>
		list.getByRole('listitem').evaluateAll((items) => new Set(items.map((i) => i.offsetTop)).size);
	expect(await row(chips(page))).toBe(1);
	const shown = await chips(page).locator('.chip:not(.more)').filter({ visible: true }).count();
	expect(shown).toBeLessThan(6);
	await more.click();
	await expect(chips(page).locator('.chip:not(.more)').filter({ visible: true })).toHaveCount(6);
	await chips(page).getByRole('button', { name: 'Sbalit podklady' }).click();
	await expect(chips(page).locator('.chip:not(.more)').filter({ visible: true })).toHaveCount(
		shown
	);
});

test('a file that is refused says why in one line', async ({ page }) => {
	await picker(page).setInputFiles([
		{ name: 'archiv.zip', mimeType: 'application/zip', buffer: Buffer.from('x') }
	]);
	await expect(panel(page).getByRole('status')).toHaveText(
		'Soubor archiv.zip neumím přečíst. Zkus Word, PowerPoint, PDF nebo obrázek.'
	);
	await expect(chips(page)).toHaveCount(0);

	await picker(page).setInputFiles([
		{ name: 'stary.doc', mimeType: 'application/msword', buffer: Buffer.from('x') }
	]);
	await expect(panel(page).getByRole('status')).toContainText('.docx');
});

test('a file dropped on the panel is attached', async ({ page }) => {
	const data = await page.evaluateHandle(() => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(['x'], 'poznamky.zip', { type: 'application/zip' }));
		return transfer;
	});
	await panel(page).dispatchEvent('dragover', { dataTransfer: data });
	await expect(panel(page).locator('.box.dragging')).toBeVisible();
	await panel(page).dispatchEvent('drop', { dataTransfer: data });
	// It reached the same place as the paperclip: this kind of file is refused with a line.
	await expect(panel(page).getByRole('status')).toContainText('poznamky.zip');
	await expect(panel(page).locator('.box.dragging')).toHaveCount(0);
});

test('with files attached and nothing proposed, the send button asks for a course from them', async ({
	page
}) => {
	const send = page.getByRole('button', { name: 'Odeslat', exact: true });
	// Without files an empty box sends nothing.
	await expect(send).toBeDisabled();
	await expect(send).toHaveAttribute('title', 'Odeslat (Enter)');
	const asked: { prompt: string; materials?: string }[] = [];
	await page.route('**/ai/outline', async (route) => {
		asked.push(route.request().postDataJSON());
		await route.continue();
	});
	await picker(page).setInputFiles([docx]);
	await expect(chips(page).getByRole('listitem')).toHaveCount(1);
	await expect(send).toBeEnabled();
	await expect(send).toHaveAttribute('title', 'Navrhnout kurz z podkladů (Enter)');
	await send.click();
	await expect(create(page)).toBeEnabled();
	expect(asked).toHaveLength(1);
	expect(asked[0].prompt).toBe('Navrhni kurz z přiložených podkladů.');
	expect(asked[0].materials).toContain('x + 5 = 12');
	// With a proposal on screen the box is for changes, and empty it sends nothing.
	await expect(send).toBeDisabled();
});
