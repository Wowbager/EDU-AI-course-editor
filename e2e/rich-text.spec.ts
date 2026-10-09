import { expect, openEditor, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';

/**
 * The visual text editor: formatted text in, Markdown the app reads out.
 */

const course = () =>
	JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
			'utf8'
		)
	);

const text = (page: Page) => page.locator('.rich-content').first();
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formátování textu' });

/** What the field stores, read through its own source view. */
async function markdownOf(page: Page): Promise<string> {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Další formátování' }).click();
	await page.getByRole('menuitem', { name: 'Upravit jako text (Markdown)' }).click();
	const source = page.locator('[data-source] .cm-content').first();
	await expect(source).toBeVisible();
	return (await source.locator('.cm-line').allTextContents()).join('\n');
}

async function paste(page: Page, data: Record<string, string>) {
	await page.evaluate((entries) => {
		const transfer = new DataTransfer();
		for (const [type, value] of Object.entries(entries)) transfer.setData(type, value);
		document.activeElement!.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
		);
	}, data);
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('the formatting buttons are there only while the text is being written', async ({ page }) => {
	await expect(toolbar(page)).toHaveCount(0);
	await text(page).click();
	await expect(toolbar(page)).toBeVisible();
	await expect(toolbar(page).getByRole('button', { name: 'Tučně' })).toBeVisible();
	await page.getByRole('heading', { level: 1 }).click();
	await expect(toolbar(page)).toHaveCount(0);
});

test('bold, a list and a formula are written as the Markdown the app reads', async ({ page }) => {
	await text(page).click();
	await page.keyboard.type('Zlomek je ');
	await page.keyboard.press('Control+b');
	await page.keyboard.type('část celku');
	await page.keyboard.press('Control+b');
	await page.keyboard.type(', třeba $\\frac{1}{2}$.');
	await expect(text(page).locator('strong')).toHaveText('část celku');
	await expect(text(page).locator('.math')).toHaveCount(1);
	await page.keyboard.press('Enter');
	await page.keyboard.type('- první');
	await page.keyboard.press('Enter');
	await page.keyboard.type('druhá');
	await expect(text(page).locator('li')).toHaveCount(2);
	// A star the teacher types is a star, not formatting.
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.type('3 * 4 = 12');

	expect(await markdownOf(page)).toBe(
		'Zlomek je **část celku**, třeba $\\frac{1}{2}$.\n\n* první\n* druhá\n\n3 \\* 4 = 12'
	);
});

test('a formula opens for editing in the field and draws as it is typed', async ({ page }) => {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	const latex = page.getByRole('textbox', { name: 'Vzorec v LaTeXu' });
	await expect(latex).toBeFocused();
	await latex.fill('x^2');
	await latex.press('Enter');
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec x^2');
	await text(page).locator('.math').click();
	await expect(latex).toHaveValue('x^2');
	// An emptied formula is gone, not an empty pair of dollars.
	await latex.fill('');
	await page.getByRole('button', { name: 'Hotovo' }).click();
	await expect(text(page).locator('.math')).toHaveCount(0);
});

test('a paste from Google Docs keeps its bold and lists, and drops its fonts', async ({ page }) => {
	await text(page).click();
	await paste(page, {
		'text/html':
			'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr">' +
			'<span style="font-family:Arial;color:#000;font-weight:400">Pizza má </span>' +
			'<span style="font-family:Arial;font-weight:700">8 dílků</span></p>' +
			'<ul><li><p><span style="font-style:italic">jeden</span></p></li><li><p>dva</p></li></ul></b>',
		'text/plain': 'Pizza má 8 dílků\njeden\ndva'
	});
	await expect(text(page).locator('strong')).toHaveText('8 dílků');
	await expect(text(page).locator('[style]')).toHaveCount(0);
	expect(await markdownOf(page)).toBe('Pizza má **8 dílků**\n\n* *jeden*\n* dva');
});

test('pasted Markdown text is read as Markdown', async ({ page }) => {
	await text(page).click();
	await paste(page, { 'text/plain': '## Postup\n\n1. **Najdi** jmenovatel\n2. Sečti $a+b$' });
	await expect(text(page).locator('h4[data-level="2"]')).toHaveText('Postup');
	await expect(text(page).locator('ol li')).toHaveCount(2);
	await expect(text(page).locator('.math')).toHaveCount(1);
});

test('an image goes in by its web address, and an image file says how', async ({ page }) => {
	await page.route('https://example.com/**', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="orange"/></svg>'
		})
	);
	await text(page).click();
	await page.keyboard.type('Kruh: ');
	await toolbar(page).getByRole('button', { name: 'Obrázek' }).click();
	const address = page.getByRole('textbox', { name: 'Webová adresa obrázku' });
	await address.fill('http://example.com/kruh.svg');
	await page.getByRole('button', { name: 'Vložit', exact: true }).click();
	await expect(page.getByText('musí začínat https://')).toBeVisible();
	await address.fill('https://example.com/kruh.svg');
	await page.getByRole('textbox', { name: 'Popis (nepovinný)' }).fill('Kruh');
	await page.getByRole('button', { name: 'Vložit', exact: true }).click();
	await expect(text(page).locator('img:not(.ProseMirror-separator)')).toHaveAttribute(
		'src',
		'https://example.com/kruh.svg'
	);

	await page.evaluate(() => {
		const transfer = new DataTransfer();
		transfer.items.add(new File([new Uint8Array([137, 80])], 'snimek.png', { type: 'image/png' }));
		document.activeElement!.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
		);
	});
	await expect(
		page.getByRole('status').filter({ hasText: 'Kopírovat adresu obrázku' })
	).toBeVisible();
	await expect(text(page).locator('img:not(.ProseMirror-separator)')).toHaveCount(1);

	expect(await markdownOf(page)).toBe('Kruh: ![Kruh](https://example.com/kruh.svg)');
});

test('a text the visual editor cannot hold opens as text, and is not rewritten', async ({
	page
}) => {
	const doc = course();
	const legacy = '<h3>Co je zlomek?</h3><p><strong>Zlomek</strong> je <em>část celku</em>.</p>';
	doc.blocks[0].steps[0].content = legacy;
	await page.setInputFiles('input[type=file]', {
		name: 'legacy.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(doc))
	});
	page.on('dialog', (dialog) => dialog.accept());
	await page.locator('.tree-card').first().click();
	const source = page.locator('[data-source] .cm-content').first();
	await expect(source).toHaveText(legacy);
	await source.click();
	// No formatting buttons, and no way into a visual view that would convert it.
	await expect(toolbar(page)).toHaveCount(0);
	await page.getByRole('heading', { level: 1 }).click();
	await expect(source).toHaveText(legacy);
});

test('Ctrl+Z in the text undoes the course, not just the field', async ({ page }) => {
	await text(page).click();
	await page.keyboard.type('Ahoj');
	await page.keyboard.press('Control+b');
	await page.keyboard.type(' světe');
	await page.keyboard.press('Control+z');
	await expect(text(page)).not.toContainText('Ahoj');
	await expect(text(page)).toBeFocused();
	await page.keyboard.press('Control+Shift+z');
	await expect(text(page).locator('strong')).toHaveText('světe');
});

test('a formula and an image open from the keyboard, as they do with a click', async ({ page }) => {
	// Copilot, PR #3: a formula inside the text was a button nobody could reach without
	// a mouse. The arrows land on it like on a letter; Enter opens it.
	await text(page).click();
	await page.keyboard.type('Plocha $x^2$');
	await expect(text(page).locator('.math')).toHaveCount(1);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Enter');
	const latex = page.getByRole('textbox', { name: 'Vzorec v LaTeXu' });
	await expect(latex).toBeFocused();
	await expect(latex).toHaveValue('x^2');
	await latex.fill('x^3');
	await latex.press('Enter');
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', /x\^3/);
	// Back in the text, after the formula: typing goes on where it was.
	await page.keyboard.type(' m');
	await expect(text(page)).toContainText(' m');

	await page.route('https://example.com/**', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'
		})
	);
	await toolbar(page).getByRole('button', { name: 'Obrázek' }).click();
	await page
		.getByRole('textbox', { name: 'Webová adresa obrázku' })
		.fill('https://example.com/a.svg');
	await page.keyboard.press('Enter');
	await expect(text(page).locator('img:not(.ProseMirror-separator)')).toHaveCount(1);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('textbox', { name: 'Webová adresa obrázku' })).toHaveValue(
		'https://example.com/a.svg'
	);
});

test.describe('the system clipboard', () => {
	test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

	test('copying formatted text into another field keeps it; Ctrl+Shift+V pastes it plain', async ({
		page
	}) => {
		await text(page).click();
		await page.keyboard.type('Zlomek je ');
		await page.keyboard.press('Control+b');
		await page.keyboard.type('část');
		await page.keyboard.press('Control+b');
		await page.keyboard.type(' a $x^2$ hotovo');
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+c');
		// Plain text elsewhere (a chat, a text editor) gets the Markdown, formula and all.
		const plain = await page.evaluate(async () => {
			const [item] = await navigator.clipboard.read();
			return (await item.getType('text/plain')).text();
		});
		expect(plain).toBe('Zlomek je **část** a $x^2$ hotovo');

		const hint = page.getByRole('textbox', { name: 'Nápověda', exact: true });
		await hint.click();
		await page.keyboard.press('Control+v');
		await expect(hint.locator('strong')).toHaveText('část');
		await expect(hint.locator('.math')).toHaveCount(1);

		const help = page.getByRole('textbox', { name: 'Podrobná pomoc', exact: true });
		await help.click();
		await page.keyboard.press('Control+Shift+v');
		await expect(help).toContainText('Zlomek je **část** a $x^2$ hotovo');
		await expect(help.locator('strong')).toHaveCount(0);
	});
});
