import { expect, openEditor, test, type Locator, type Page } from './fixtures';

/**
 * The formula row's keypad: the acceptance table (§8) pressed on the real keys, the
 * search palette (§5.3), the subject profiles (§4.2) and the physical-keyboard path
 * (§5.1). The canonical LaTeX each formula must store is read from the `.math` node's
 * label, which carries the app-side LaTeX (`toAppLatex` applied); compared without
 * whitespace. MathLive commits typed keys a moment after the key event, so reads poll.
 */

const text = (page: Page) => page.locator('.rich-content').first();
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formátování textu' });
const formula = (page: Page) => page.locator('math-field');

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

type Keypad = Locator;

/** Open a new formula and the on-screen keypad. */
async function openKeypad(page: Page): Promise<Keypad> {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	await page.getByRole('button', { name: 'Klávesnice se značkami' }).click();
	return page.getByRole('group', { name: 'Klávesnice se značkami' });
}

/** The stored LaTeX of the formula in the text, polled until it matches (no whitespace). */
async function storedLatex(page: Page, expected: string): Promise<void> {
	const want = expected.replace(/\s+/g, '');
	await expect
		.poll(async () => {
			const label = await text(page).locator('.math').getAttribute('aria-label');
			return label?.replace(/^Vzorec /, '').replace(/\s+/g, '');
		})
		.toBe(want);
}

/** Press a keypad key by its Czech name (the zones, not the recently-used row). */
async function key(keypad: Keypad, name: string) {
	await keypad.locator('.keypad-zones').getByRole('button', { name, exact: true }).click();
}

/** Switch the keypad to a tab by its Czech name. */
async function tab(keypad: Keypad, name: string) {
	await keypad.locator('.keypad-tabs').getByRole('button', { name, exact: true }).click();
}

/** Press Enter — the next placeholder, or done after the last one. */
async function next(keypad: Keypad) {
	await keypad.getByRole('button', { name: 'Potvrdit', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('§8 #1: 3,75 : 1,5 = 2,5 — decimal comma and Czech division', async ({ page }) => {
	const keypad = await openKeypad(page);
	await tab(keypad, 'Základ');
	for (const name of [
		'Číslice 3',
		'Desetinná čárka',
		'Číslice 7',
		'Číslice 5',
		'Děleno dvěma tečkami',
		'Číslice 1',
		'Desetinná čárka',
		'Číslice 5',
		'Rovná se',
		'Číslice 2',
		'Desetinná čárka',
		'Číslice 5'
	])
		await key(keypad, name);
	await storedLatex(page, '3{,}75 : 1{,}5 = 2{,}5');
});

test('§8 #3: x ∈ ⟨−2; 5)', async ({ page }) => {
	const keypad = await openKeypad(page);
	await tab(keypad, 'Základ');
	await key(keypad, 'Písmeno x');
	await tab(keypad, 'Množiny a logika');
	await key(keypad, 'Je prvkem');
	await tab(keypad, 'Algebra a funkce');
	await key(keypad, 'Interval otevřený vlevo');
	await tab(keypad, 'Základ');
	await key(keypad, 'Minus');
	await key(keypad, 'Číslice 2');
	await next(keypad);
	await key(keypad, 'Číslice 5');
	await storedLatex(page, 'x \\in \\langle -2; 5)');
});

test('§8 #5: tg α = sin α / cos α', async ({ page }) => {
	const keypad = await openKeypad(page);
	await tab(keypad, 'Geometrie a goniometrie');
	await key(keypad, 'Tangens');
	await key(keypad, 'Alfa');
	await tab(keypad, 'Základ');
	await key(keypad, 'Rovná se');
	await key(keypad, 'Zlomek');
	await tab(keypad, 'Geometrie a goniometrie');
	await key(keypad, 'Sinus');
	await key(keypad, 'Alfa');
	await next(keypad);
	await key(keypad, 'Kosinus');
	await key(keypad, 'Alfa');
	await storedLatex(page, '\\operatorname{tg} \\alpha = \\frac{\\sin \\alpha}{\\cos \\alpha}');
});

test('§8 #8: log₂ 8 = 3', async ({ page }) => {
	const keypad = await openKeypad(page);
	await tab(keypad, 'Algebra a funkce');
	await key(keypad, 'Logaritmus se základem');
	await tab(keypad, 'Základ');
	await key(keypad, 'Číslice 2');
	await next(keypad);
	await key(keypad, 'Číslice 8');
	await key(keypad, 'Rovná se');
	await key(keypad, 'Číslice 3');
	await storedLatex(page, '\\log_2 8 = 3');
});

test('§8 #11: π ≐ 3,14', async ({ page }) => {
	const keypad = await openKeypad(page);
	await tab(keypad, 'Základ');
	await key(keypad, 'Pí');
	await tab(keypad, 'Algebra a funkce');
	await key(keypad, 'Rovná se přibližně');
	await tab(keypad, 'Základ');
	await key(keypad, 'Číslice 3');
	await key(keypad, 'Desetinná čárka');
	await key(keypad, 'Číslice 1');
	await key(keypad, 'Číslice 4');
	await storedLatex(page, '\\pi \\doteq 3{,}14');
});

test('§8 #13: v = 12,5 m·s⁻¹ — one upright unit group, thin space before it', async ({ page }) => {
	const keypad = await openKeypad(page);
	await page.keyboard.type('v');
	await tab(keypad, 'Základ');
	await key(keypad, 'Rovná se');
	await tab(keypad, 'Fyzika');
	await key(keypad, 'Číslo s jednotkou');
	await tab(keypad, 'Základ');
	await key(keypad, 'Číslice 1');
	await key(keypad, 'Číslice 2');
	await key(keypad, 'Desetinná čárka');
	await key(keypad, 'Číslice 5');
	await next(keypad);
	await tab(keypad, 'Fyzika');
	await key(keypad, 'Metr');
	await key(keypad, 'Jednotky krát');
	await key(keypad, 'Sekunda');
	await key(keypad, 'Jednotka na minus první');
	await storedLatex(page, 'v = 12{,}5\\,\\mathrm{m\\cdot s^{-1}}');
});

test('§8 #17: 2 H₂ + O₂ → 2 H₂O — the Chemie tab opens a \\ce node and types into it', async ({
	page
}) => {
	const keypad = await openKeypad(page);
	await tab(keypad, 'Chemie');
	await page.keyboard.type('2 H2 + O2');
	await key(keypad, 'Šipka reakce');
	await page.keyboard.type('2 H2O');
	await storedLatex(page, '\\ce{2 H2 + O2 -> 2 H2O}');
});

test('§8 #24: p ∧ q ⇒ ¬r', async ({ page }) => {
	const keypad = await openKeypad(page);
	await tab(keypad, 'Množiny a logika');
	await page.keyboard.type('p');
	await key(keypad, 'A (konjunkce)');
	await page.keyboard.type('q');
	await key(keypad, 'Implikace');
	await key(keypad, 'Negace');
	await page.keyboard.type('r');
	await storedLatex(page, 'p \\wedge q \\Rightarrow \\neg r');
});

test('§8 #25: a system of equations', async ({ page }) => {
	const keypad = await openKeypad(page);
	await tab(keypad, 'Algebra a funkce');
	await key(keypad, 'Soustava rovnic');
	await page.keyboard.type('x+y=3');
	await next(keypad);
	await page.keyboard.type('x-y=1');
	await storedLatex(page, '\\begin{cases} x + y = 3 \\\\ x - y = 1 \\end{cases}');
});

test('§5.3: the search finds a key by its Czech name without diacritics', async ({ page }) => {
	const keypad = await openKeypad(page);
	await keypad.getByRole('button', { name: 'Hledat značku' }).click();
	await keypad
		.getByRole('searchbox', { name: 'Hledat značku podle českého názvu' })
		.fill('rovnovaha');
	await keypad.getByRole('option', { name: 'Rovnovážná šipka, Chemie' }).click();
	await storedLatex(page, '\\ce{<=>}');
});

test('§4.2: the ⋯ menu switches the subject profile', async ({ page }) => {
	const keypad = await openKeypad(page);
	// Default profile Vše shows all tabs.
	await expect(
		keypad.locator('.keypad-tabs').getByRole('button', { name: 'Chemie' })
	).toBeVisible();
	await keypad.getByRole('button', { name: 'Profil klávesnice' }).click();
	await page.getByRole('menuitemcheckbox', { name: 'Matematika ZŠ' }).click();
	await expect(keypad.locator('.keypad-tabs').getByRole('button', { name: 'Chemie' })).toHaveCount(
		0
	);
	await expect(
		keypad.locator('.keypad-tabs').getByRole('button', { name: 'Řecká písmena' })
	).toBeVisible();
});

test('§5.1: the physical keyboard — `*` is ·, `,` between digits is a decimal comma, `->` is →', async ({
	page
}) => {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	await page.keyboard.type('2*3');
	await page.keyboard.type(',5->x');
	await storedLatex(page, '2\\cdot3{,}5\\to x');
});

test('§5.1: `=.` types ≐ (\\doteq), not a literal "=."', async ({ page }) => {
	await text(page).click();
	await toolbar(page).getByRole('button', { name: 'Vzorec' }).click();
	await formulaReady(page);
	await page.keyboard.type('a');
	await page.keyboard.type('=.');
	await page.keyboard.type('b');
	await storedLatex(page, 'a\\doteqb');
});
