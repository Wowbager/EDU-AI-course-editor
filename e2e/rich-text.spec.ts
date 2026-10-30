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
/** The formula row's visual editor (MathLive). */
const formula = (page: Page) => page.locator('math-field');
/** MathLive takes the keys a moment after it takes focus; until then they are lost. */
async function formulaReady(page: Page) {
	await expect(formula(page)).toBeFocused();
	await expect
		.poll(() =>
			page.evaluate(() =>
				document.activeElement?.shadowRoot?.activeElement?.classList.contains('ML__keyboard-sink')
			)
		)
		.toBe(true);
}
/** The formula's ⋯: on a separate line, LaTeX, help. */
async function formulaMenu(page: Page, item: string) {
	await page.getByRole('button', { name: 'Další možnosti vzorce' }).click();
	await page.getByRole('menuitem', { name: item }).click();
}
const formulaValue = (page: Page) => formula(page).evaluate((el) => (el as HTMLInputElement).value);

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

// `1. ` sent `\1. ` and then the list's `1.` in one tick; the second matched the stale
// value and was dropped, so the typed text came back over the list.
test('1. typed into an empty text starts a numbered list that stays', async ({ page }) => {
	await text(page).click();
	await page.keyboard.type('1. první');
	await expect(text(page).locator('ol li')).toHaveText('první');
	expect(await markdownOf(page)).toBe('1. první');
});

test('a list also starts after a space and on a line begun with Shift+Enter', async ({ page }) => {
	await text(page).click();
	await page.keyboard.type(' 1. a');
	await expect(text(page).locator('ol li')).toHaveText('a');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Úvod');
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type('1. b');
	await expect(text(page).locator('ol')).toHaveCount(2);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Dál');
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type('- c');
	await expect(text(page).locator('ul li')).toHaveText('c');
	expect(await markdownOf(page)).toBe('1. a\n\nÚvod\n\n1. b\n\nDál\n\n* c');
});

test('one list button goes bullets, numbers, none; Citace is a button of its own', async ({
	page
}) => {
	await text(page).click();
	await page.keyboard.type('a');
	const list = toolbar(page).getByRole('button', { name: 'Seznam' });
	await list.click();
	await expect(list).toHaveAccessibleName('Seznam: odrážky');
	await expect(text(page).locator('ul li')).toHaveText('a');
	await list.click();
	await expect(list).toHaveAccessibleName('Seznam: číslování');
	await expect(text(page).locator('ol li')).toHaveText('a');
	await list.click();
	await expect(list).toHaveAccessibleName('Seznam');
	await expect(text(page).locator('ol, ul')).toHaveCount(0);

	const quote = toolbar(page).getByRole('button', { name: 'Citace' });
	await quote.click();
	await expect(quote).toHaveAttribute('aria-pressed', 'true');
	expect(await markdownOf(page)).toBe('> a');
});

test('a formula opens for editing in the field and draws as it is typed', async ({ page }) => {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	await page.keyboard.type('x^2');
	await page.keyboard.press('Enter');
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec x^2');
	await text(page).locator('.math').click();
	await formulaReady(page);
	await expect.poll(() => formulaValue(page)).toBe('x^2');
	// An emptied formula is gone, not an empty pair of dollars.
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Backspace');
	await page.getByRole('button', { name: 'Hotovo' }).click();
	await expect(text(page).locator('.math')).toHaveCount(0);
});

test('a formula is typed without LaTeX, and the LaTeX is there for who wants it', async ({
	page
}) => {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	// `/` makes a fraction; the arrow leaves the denominator.
	await page.keyboard.type('1/2');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type('+x');
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec \\frac12+x');

	// The row is the formula, its keyboard, ⋯ and Hotovo: nothing else until asked.
	const row = page.getByRole('group', { name: 'Vzorec' });
	await expect(row.getByRole('button')).toHaveText(['', '', 'Hotovo']);
	await expect(row.getByRole('textbox', { name: 'Vzorec v LaTeXu' })).toHaveCount(0);
	await expect(row.getByRole('checkbox')).toHaveCount(0);

	// The on-screen keyboard opens inside the row, types into the formula and leaves the
	// row open.
	await page.getByRole('button', { name: 'Klávesnice se značkami' }).click();
	await row.getByRole('button', { name: '7', exact: true }).click();
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec \\frac12+x7');
	await expect(formula(page)).toBeVisible();

	// The same field shows the LaTeX, and back.
	await formulaMenu(page, 'Upravit jako LaTeX');
	const latex = page.getByRole('textbox', { name: 'Vzorec v LaTeXu' });
	await expect(latex).toBeFocused();
	await expect(latex).toHaveValue('\\frac12+x7');
	await expect(formula(page)).toHaveCount(0);
	await latex.fill('x\\ne 1');
	await formulaMenu(page, 'Upravit vizuálně');
	await formulaReady(page);
	await expect.poll(() => formulaValue(page)).toBe('x\\ne 1');
	await page.keyboard.press('End');
	await page.keyboard.type('0');
	// ≠ is stored as `\not=`, which survives the app's `\n` line breaks in a text step.
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec x\\not=10');
	await page.getByRole('button', { name: 'Hotovo' }).click();
	expect(await markdownOf(page)).toBe('$x\\not=10$');
});

test("the keypad's icon keys keep their icon centred inside the key", async ({ page }) => {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	await page.getByRole('button', { name: 'Klávesnice se značkami' }).click();
	const keypad = page.getByRole('group', { name: 'Klávesnice se značkami' });
	await expect(keypad).toBeVisible();
	// The command keys (delete, arrows, enter): their icon must sit inside the button,
	// centred — MathLive's keyboard let the delete glyph overflow its keycap.
	for (const name of ['Smazat znak', 'Předchozí znak', 'Další znak', 'Potvrdit']) {
		const key = keypad.getByRole('button', { name, exact: true });
		const icon = key.locator('svg');
		await expect(icon).toBeVisible();
		const keyBox = (await key.boundingBox())!;
		const iconBox = (await icon.boundingBox())!;
		expect(iconBox.width).toBeLessThanOrEqual(keyBox.width);
		expect(iconBox.height).toBeLessThanOrEqual(keyBox.height);
		expect(
			Math.abs(iconBox.x + iconBox.width / 2 - (keyBox.x + keyBox.width / 2))
		).toBeLessThanOrEqual(2);
		expect(
			Math.abs(iconBox.y + iconBox.height / 2 - (keyBox.y + keyBox.height / 2))
		).toBeLessThanOrEqual(2);
	}
	// The keypad types into the formula: a digit key and a function key.
	await keypad.getByRole('button', { name: '7', exact: true }).click();
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec 7');
	await keypad.getByRole('button', { name: 'Zlomek' }).click();
	// `#@` takes what is before the caret into the numerator.
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec \\frac{7}{}');
	// The keypad's Potvrdit ends the formula, like the Enter key in the field.
	await keypad.getByRole('button', { name: 'Potvrdit' }).click();
	await expect(page.getByRole('group', { name: 'Vzorec' })).toHaveCount(0);
	expect(await markdownOf(page)).toBe('$\\frac{7}{}$');
});

test('a formula opened and closed unchanged keeps its LaTeX as written', async ({ page }) => {
	await text(page).click();
	await page.keyboard.type('Půl je $\\dfrac{1}{2}$');
	await text(page).locator('.math').click();
	await formulaReady(page);
	await page.keyboard.press('Enter');
	expect(await markdownOf(page)).toBe('Půl je $\\dfrac{1}{2}$');
});

test('a dollar typed into a formula leaves no backslash behind', async ({ page }) => {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	await page.keyboard.type('5$+3');
	await page.keyboard.press('Enter');
	expect(await markdownOf(page)).toBe('$5+3$');
	// In the LaTeX box, a row break before a dollar stays a row break.
	await page.getByRole('button', { name: 'Upravit vizuálně' }).click();
	await text(page).locator('.math').click();
	await formulaReady(page);
	await formulaMenu(page, 'Upravit jako LaTeX');
	await page.getByRole('textbox', { name: 'Vzorec v LaTeXu' }).fill('a\\\\$b');
	await page.getByRole('button', { name: 'Hotovo' }).click();
	expect(await markdownOf(page)).toBe('$a\\\\b$');
});

test('without the visual formula editor, the LaTeX box edits the formula', async ({ page }) => {
	// A dropped connection while MathLive loads: its chunk is the one that defines it.
	await page.route('**/*.js*', async (route) => {
		// A reload while a request is out disposes its response; let that one go.
		try {
			const response = await route.fetch();
			const body = await response.text();
			if (body.includes('mathVirtualKeyboard') && body.includes('MathfieldElement'))
				return await route.abort();
			return await route.fulfill({ response, body });
		} catch {
			await route.continue().catch(() => {});
		}
	});
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	const latex = page.getByRole('textbox', { name: 'Vzorec v LaTeXu' });
	await expect(latex).toBeFocused();
	await page.keyboard.type('x^2');
	await page.keyboard.press('Enter');
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec x^2');
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

test('the image row closes when the teacher clicks back into the text', async ({ page }) => {
	await text(page).click();
	await page.keyboard.type('Kruh: ');
	await toolbar(page).getByRole('button', { name: 'Obrázek' }).click();
	const address = page.getByRole('textbox', { name: 'Webová adresa obrázku' });
	await expect(address).toBeVisible();
	// A click into the text, away from where the caret is.
	await text(page).click({ position: { x: 4, y: 8 } });
	await expect(address).toHaveCount(0);
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

test('a click back into the text closes the formula, and typing goes where it landed', async ({
	page
}) => {
	// The row used to close only when focus left the whole field. A click into the
	// same text left it open, still editing the formula the teacher had walked away from.
	await text(page).click();
	await page.keyboard.type('Plocha ');
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	await page.keyboard.type('x^2');

	await text(page).click({ position: { x: 2, y: 2 } });
	await expect(formula(page)).toBeHidden();
	await expect(toolbar(page)).toBeVisible();
	await page.keyboard.type('Velká ');
	await expect(text(page)).toContainText('Velká Plocha');
	await expect(text(page).locator('.math')).toHaveAttribute('aria-label', 'Vzorec x^2');
});

test('a formula left empty by a click into the text is gone', async ({ page }) => {
	await text(page).click();
	await page.keyboard.type('Plocha ');
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);

	await text(page).click({ position: { x: 2, y: 2 } });
	await expect(formula(page)).toBeHidden();
	await expect(text(page).locator('.math')).toHaveCount(0);
});

test('undo while a formula is open closes its row with it', async ({ page }) => {
	await text(page).click();
	await page.keyboard.type('Plocha ');
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	await page.keyboard.type('x^2');
	await expect(text(page).locator('.math')).toHaveCount(1);

	// Ctrl+Z is the course's, as in every other field: it closes the row with the formula.
	await page.keyboard.press('Control+z');
	await expect(formula(page)).toBeHidden();
});

test('a formula and an image open from the keyboard, as they do with a click', async ({ page }) => {
	// Copilot, PR #3: a formula inside the text was a button nobody could reach without
	// a mouse. The arrows land on it like on a letter; Enter opens it.
	await text(page).click();
	await page.keyboard.type('Plocha $x^2$');
	await expect(text(page).locator('.math')).toHaveCount(1);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Enter');
	await formulaReady(page);
	await expect.poll(() => formulaValue(page)).toBe('x^2');
	await page.keyboard.press('Control+a');
	await page.keyboard.type('x^3');
	await page.keyboard.press('Enter');
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

test('the Markdown source continues a list and makes a pasted URL a link', async ({ page }) => {
	// The source view has only the Markdown parts of CodeMirror's Markdown support
	// (`ui/codemirror.ts`); these are the two a teacher uses.
	await markdownOf(page);
	const source = page.locator('[data-source] .cm-content').first();
	await source.click();
	await page.keyboard.press('Control+a');
	await page.keyboard.type('- první');
	await page.keyboard.press('Enter');
	await page.keyboard.type('druhá');
	await expect(source.locator('.cm-line')).toHaveText(['- první', '- druhá']);

	await page.keyboard.press('Control+Shift+ArrowLeft');
	await paste(page, { 'text/plain': 'https://example.com' });
	await expect(source.locator('.cm-line')).toHaveText([
		'- první',
		'- [druhá](https://example.com)'
	]);
});

// OPEN-PROBLEMS #55: the app reads a line starting `- ` as a list, so a plain text is
// stored with a backslash before it. The editor shows, copies and re-imports what the
// teacher typed; only the file (and the app's preview) carry the backslash.
test('a plain line starting with a dash is shown as typed after reload and re-import', async ({
	page
}) => {
	await text(page).click();
	// `- ` turns into a list as it is typed; Backspace takes the list back, leaving a dash.
	await page.keyboard.type('- ');
	await expect(text(page).locator('ul')).toHaveCount(1);
	await page.keyboard.press('Backspace');
	await page.keyboard.type('a');
	await expect(text(page)).toHaveText('- a');
	await expect(text(page).locator('ul')).toHaveCount(0);
	await page.getByRole('heading', { level: 1 }).click();

	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Stáhnout', exact: true }).click();
	const anyway = page.getByRole('button', { name: 'Stáhnout i tak' });
	if (await anyway.isVisible()) await anyway.click();
	const file = await (await download).path();
	const json = readFileSync(file, 'utf8');
	expect(json).toContain('"\\\\- a"');

	await page.reload();
	await expect(text(page)).toHaveText('- a');

	await page.setInputFiles('input[type=file]', file);
	await expect(text(page)).toHaveText('- a');
	await expect(text(page).locator('ul')).toHaveCount(0);
});
