import { addStep, expect, openEditor, test, type Page } from './fixtures';

/**
 * Choosing a picture: the same dialog from an image step and from a text. Every test
 * page is a workspace of its own, so each starts with an empty gallery.
 */

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);
const photo = { name: 'žába na listu.png', mimeType: 'image/png', buffer: PNG };

const step = (page: Page) => page.getByRole('group', { name: 'Obsah kroku 2' });
const choose = (page: Page) =>
	step(page).getByRole('button', { name: 'Vybrat obrázek', exact: true });
const change = (page: Page) =>
	step(page).getByRole('button', { name: 'Změnit obrázek', exact: true });
const picker = (page: Page) => page.getByRole('dialog', { name: 'Vybrat obrázek' });
const fileInput = (page: Page) => picker(page).getByLabel('Soubor s obrázkem');
const description = (page: Page) =>
	page.getByRole('textbox', { name: 'Popis obrázku pro čtečku obrazovky', exact: true });
const text = (page: Page) => page.locator('.rich-content').first();
const textImage = (page: Page) => text(page).locator('img:not(.ProseMirror-separator)');

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await addStep(page, 'Obrázek');
});

async function uploadIntoStep(page: Page) {
	await choose(page).click();
	await fileInput(page).setInputFiles(photo);
	await expect(change(page)).toBeVisible();
}

test('a picture from the computer shows in the step, with its description to write', async ({
	page
}) => {
	await uploadIntoStep(page);
	await expect(picker(page)).toHaveCount(0);
	await expect(step(page).locator('img')).toHaveAttribute('src', /\/images\/file\//);
	await expect(description(page)).toBeVisible();
	// No file name, no address: the picture is what tells which one it is.
	await expect(step(page)).not.toContainText('.png');

	// With something in the gallery, that is where the dialog opens, under the file's own name.
	await change(page).click();
	await expect(picker(page).getByRole('radio', { name: 'Galerie' })).toBeChecked();
	await expect(picker(page).getByRole('button', { name: photo.name, exact: true })).toBeVisible();
});

test('a file the server would refuse is refused before it is sent, in plain words', async ({
	page
}) => {
	let sent = 0;
	page.on('request', (request) => {
		if (request.url().includes('/images/upload')) sent++;
	});
	await choose(page).click();
	await fileInput(page).setInputFiles({ name: 'foto.heic', mimeType: 'image/heic', buffer: PNG });
	await expect(picker(page).getByRole('alert')).toHaveText(
		'Tenhle soubor nahrát nejde. Použij obrázek JPG, PNG, GIF nebo WebP.'
	);
	await fileInput(page).setInputFiles({
		name: 'velky.png',
		mimeType: 'image/png',
		buffer: Buffer.alloc(8 * 1024 * 1024 + 1)
	});
	await expect(picker(page).getByRole('alert')).toHaveText(
		'Obrázek je větší než 8 MB. Zmenši ho a zkus to znovu.'
	);
	await expect(picker(page).getByText('nejvýš 8 MB')).toBeVisible();
	expect(sent).toBe(0);
});

test("the server's failure is told as a sentence, never as what the server wrote", async ({
	page
}) => {
	await page.route('**/images/upload', (route) =>
		route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
	);
	await choose(page).click();
	await fileInput(page).setInputFiles(photo);
	await expect(picker(page).getByRole('alert')).toHaveText(
		'Nahrání se nepovedlo. Zkontroluj připojení a zkus to znovu.'
	);
	// The same file can be tried again.
	await page.unroute('**/images/upload');
	await fileInput(page).setInputFiles(photo);
	await expect(change(page)).toBeVisible();
});

test('closing the dialog while a picture is on its way cancels it', async ({ page }) => {
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/images/upload', async (route) => {
		await held;
		await route.abort().catch(() => {});
	});
	await choose(page).click();
	const cancelled = page.waitForEvent('requestfailed', (request) =>
		request.url().includes('/images/upload')
	);
	await fileInput(page).setInputFiles(photo);
	await expect(picker(page).getByText('Nahrávám…')).toBeVisible();
	await picker(page).getByRole('button', { name: 'Zrušit' }).click();
	await cancelled;
	release();
	await expect(picker(page)).toHaveCount(0);
	await expect(choose(page)).toBeVisible();
	await expect(step(page).locator('img')).toHaveCount(0);
});

test('a step without a picture says so only after the card was left', async ({ page }) => {
	const missing = step(page).getByText('Krok 2 zatím nemá obrázek');
	await expect(missing).toHaveCount(0);
	await page.locator('.tree-add').getByRole('button', { name: 'Výklad', exact: true }).click();
	await page.getByRole('button', { name: /^Karta 1 / }).click();
	await expect(missing).toBeVisible();
	await uploadIntoStep(page);
	await expect(missing).toHaveCount(0);
});

test('the text editor uses the same dialog, and takes a pasted or dropped picture file', async ({
	page
}) => {
	await uploadIntoStep(page);
	await text(page).click();
	await page.keyboard.type('Žába: ');
	await page
		.getByRole('toolbar', { name: 'Formátování textu' })
		.getByRole('button', { name: 'Obrázek' })
		.click();
	await picker(page).getByRole('button', { name: photo.name, exact: true }).click();
	await expect(textImage(page)).toHaveCount(1);
	await expect(textImage(page)).toHaveAttribute('src', /\/images\/file\//);
	// Writing goes on after the picture.
	await page.keyboard.type(' a dál');
	await expect(text(page)).toContainText('a dál');

	// A picture file pasted into the text is uploaded and placed, not refused.
	await page.evaluate(
		(bytes) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File([new Uint8Array(bytes)], 'druha.png', { type: 'image/png' }));
			document.activeElement!.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
			);
		},
		[...PNG]
	);
	await expect(textImage(page)).toHaveCount(2);

	// And so is one dropped onto the text.
	await text(page).evaluate(
		(element, bytes) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File([new Uint8Array(bytes)], 'treti.png', { type: 'image/png' }));
			const box = element.getBoundingClientRect();
			element.dispatchEvent(
				new DragEvent('drop', {
					dataTransfer: transfer,
					clientX: box.left + 8,
					clientY: box.top + 8,
					bubbles: true,
					cancelable: true
				})
			);
		},
		[...PNG]
	);
	await expect(textImage(page)).toHaveCount(3);
});

test('deleting from the gallery says where the picture goes from, and takes it from there', async ({
	page
}) => {
	await uploadIntoStep(page);
	await text(page).click();
	await page
		.getByRole('toolbar', { name: 'Formátování textu' })
		.getByRole('button', { name: 'Obrázek' })
		.click();
	await picker(page).getByRole('button', { name: photo.name, exact: true }).click();
	await expect(textImage(page)).toHaveCount(1);

	await change(page).click();
	await picker(page)
		.getByRole('button', { name: `Smazat obrázek ${photo.name}` })
		.click();
	const confirm = page.getByRole('dialog', { name: 'Smazat obrázek?' });
	await expect(confirm).toContainText(
		'zmizí z galerie i ze všech míst v tomto kurzu, kde je použitý. Nejde to vrátit.'
	);
	await confirm.getByRole('button', { name: 'Smazat', exact: true }).click();
	await expect(confirm).toHaveCount(0);
	await expect(picker(page).getByText('Zatím tu není žádný obrázek.')).toBeVisible();
	await picker(page).getByRole('button', { name: 'Zrušit' }).click();
	await expect(choose(page)).toBeVisible();
	await expect(textImage(page)).toHaveCount(0);
});
