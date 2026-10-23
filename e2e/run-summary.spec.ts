import { readFileSync } from 'node:fs';
import { expect, test, openEditor, type Page } from './fixtures';

/**
 * The XP counter beside Náhled / Vyzkoušet, and the note a finished run leaves. The
 * fake player stands in for the pupil: it sends `stepChanged` and `completed` when
 * the test says so, exactly as the real one does (`e2e/preview*.spec.ts` plays the
 * real one). The spec course's lesson has three cards: 2 XP (text, image), 1 XP, and
 * a question card worth 1 + 8 + 1 + 1.
 */
const COURSE = readFileSync(
	new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url)
);
const CARDS = ['L1_B1_uvod', 'L1_B2_casti', 'L1_B3_poznej'];

type Message = Record<string, unknown>;
const emit = async (page: Page, message: Message) => {
	const frame = await page.locator('iframe').elementHandle();
	await (await frame!.contentFrame())!.evaluate(
		(m) => (window as unknown as { emit: (m: unknown) => void }).emit(m),
		message
	);
};
const sent = async (page: Page, type: string) => {
	const frame = await page.locator('iframe').elementHandle();
	return (await frame!.contentFrame())!.evaluate(
		(t) =>
			(window as unknown as { received: { type: string }[] }).received.filter((m) => m.type === t)
				.length,
		type
	);
};

/** Finish card `index`: the pupil is on it, then it is completed. */
async function finish(page: Page, index: number, result: Message) {
	await emit(page, { type: 'stepChanged', blockId: CARDS[index], stepId: 's1' });
	await emit(page, { type: 'completed', ...result });
}
async function finishAll(page: Page, mark?: string) {
	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await finish(page, 1, { xp: 1, scoreKoef: 1 });
	await finish(page, 2, { xp: 5, scoreKoef: 0.5, ...(mark ? { mark } : {}) });
}

const counter = (page: Page, text: string) =>
	page.locator('aside.preview .xp').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) });
const summary = (page: Page) => page.getByRole('region', { name: 'Shrnutí vyzkoušení' });

test.beforeEach(async ({ page }) => {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'spec-16-course.json',
		mimeType: 'application/json',
		buffer: COURSE
	});
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('aside.preview')).toHaveAttribute('data-player', 'ready');
	await page.locator('.tree-card').nth(0).click();
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await expect.poll(() => sent(page, 'setLesson')).toBe(1);
});

test('Náhled shows what the card is worth, Vyzkoušet what the run has earned', async ({ page }) => {
	await expect(counter(page, '0 / 14 XP')).toBeVisible();
	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await expect(counter(page, '2 / 14 XP')).toBeVisible();
	await expect(summary(page)).toHaveCount(0);

	await page.getByRole('radio', { name: 'Náhled' }).click();
	await expect(counter(page, '2 XP')).toBeVisible();
	await page.locator('.tree-card').nth(2).click();
	await expect(counter(page, '11 XP')).toBeVisible();
});

test('a run from a later card offers only the cards it plays', async ({ page }) => {
	await page.getByRole('radio', { name: 'Náhled' }).click();
	await page.locator('.tree-card').nth(1).click();
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await expect(counter(page, '0 / 12 XP')).toBeVisible();
});

test('finishing shows the overview, and × closes it', async ({ page }) => {
	await finishAll(page, '2');
	await expect(summary(page)).toContainText('Hotovo');
	await expect(summary(page)).toContainText('8 / 14 XP');
	await expect(summary(page)).toContainText('úspěšnost 83 %');
	await expect(summary(page)).toContainText('známka 2');
	await summary(page).getByRole('button', { name: 'Zavřít' }).click();
	await expect(summary(page)).toHaveCount(0);
	await expect(counter(page, '8 / 14 XP')).toBeVisible();
});

test('no mark is shown when the player sent none', async ({ page }) => {
	await finishAll(page);
	await expect(summary(page)).toContainText('8 / 14 XP');
	await expect(summary(page)).not.toContainText('známka');
});

test('Escape closes the overview', async ({ page }) => {
	await finishAll(page);
	await expect(summary(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(summary(page)).toHaveCount(0);
});

test('a card answered again counts once', async ({ page }) => {
	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await expect(counter(page, '2 / 14 XP')).toBeVisible();
});

test('Zkusit znovu and Od začátku start the count again', async ({ page }) => {
	await finishAll(page);
	await summary(page).getByRole('button', { name: 'Od začátku' }).click();
	await expect(summary(page)).toHaveCount(0);
	await expect(counter(page, '0 / 14 XP')).toBeVisible();
	await expect.poll(() => sent(page, 'restart')).toBe(1);

	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await page.locator('aside.preview header').getByRole('button', { name: 'Od začátku' }).click();
	await expect(counter(page, '0 / 14 XP')).toBeVisible();
	await expect.poll(() => sent(page, 'restart')).toBe(2);
});

test('leaving Vyzkoušet, or editing the course, closes the overview', async ({ page }) => {
	await finishAll(page);
	await page.getByRole('radio', { name: 'Náhled' }).click();
	await expect(summary(page)).toHaveCount(0);

	// The run moved the selection to the card it ended on; start again from the first.
	await page.locator('.tree-card').nth(0).click();
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await expect(counter(page, '0 / 14 XP')).toBeVisible();
	await finishAll(page);
	await expect(summary(page)).toBeVisible();
	await page.getByRole('textbox').first().fill('Jiný text');
	await expect(summary(page)).toHaveCount(0);
});

test('the overview does not take focus from the field being typed in', async ({ page }) => {
	const field = page.getByRole('textbox').first();
	await field.click();
	await finishAll(page);
	await expect(summary(page)).toBeVisible();
	await expect(field).toBeFocused();
	// Escape in a field belongs to the field.
	await page.keyboard.press('Escape');
	await expect(summary(page)).toBeVisible();
});

test('the overview sits below the player and never over it', async ({ page }) => {
	await finishAll(page);
	const frame = (await page.locator('aside.preview iframe').boundingBox())!;
	const note = (await summary(page).boundingBox())!;
	expect(note.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
});

test('a card with no steps sends no position, and its completion is still its own', async ({
	page
}) => {
	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	// The next card shows nothing to report: `completed` comes with no `stepChanged`.
	await emit(page, { type: 'completed', xp: 1, scoreKoef: 1 });
	await expect(counter(page, '3 / 14 XP')).toBeVisible();
});

test('a completion that arrives before any position is not counted twice or under no card', async ({
	page
}) => {
	await emit(page, { type: 'completed', xp: 2, scoreKoef: 1 });
	await expect(counter(page, '2 / 14 XP')).toBeVisible();
	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await expect(counter(page, '2 / 14 XP')).toBeVisible();
});

test('Zpět drops what the card returned to had earned', async ({ page }) => {
	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await finish(page, 1, { xp: 1, scoreKoef: 1 });
	await emit(page, { type: 'navState', canGoBack: true });
	await page.locator('aside.preview').getByRole('button', { name: 'Zpět', exact: true }).click();
	await emit(page, { type: 'stepChanged', blockId: CARDS[1], stepId: 's1' });
	await expect(counter(page, '2 / 14 XP')).toBeVisible();
});

test('the counter explains itself in a tooltip', async ({ page }) => {
	await expect(page.locator('aside.preview .xp')).toHaveAttribute('title', /XP/);
});

test('the counter sits right beside the mode switch in both modes, and wraps at 360 px', async ({
	page
}) => {
	const group = page.getByRole('radiogroup', { name: 'Co je v náhledu' });
	const beside = async (name: string) => {
		const g = (await group.boundingBox())!;
		const c = (await counter(page, name).boundingBox())!;
		expect(Math.abs(c.y + c.height / 2 - (g.y + g.height / 2))).toBeLessThan(g.height / 2);
		expect(c.x).toBeGreaterThanOrEqual(g.x + g.width);
		expect(c.x - (g.x + g.width)).toBeLessThan(24);
	};
	await beside('0 / 14 XP');
	const back = page.locator('aside.preview').getByRole('button', { name: 'Zpět', exact: true });
	expect((await back.boundingBox())!.x).toBeGreaterThan(
		(await counter(page, '0 / 14 XP').boundingBox())!.x
	);
	await page.getByRole('radio', { name: 'Náhled' }).click();
	await beside('2 XP');

	// A narrow column wraps the buttons below instead of overflowing.
	await page.addStyleTag({ content: ':root { --e-preview-width: 360px !important; }' });
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await beside('0 / 14 XP');
	const header = (await page.locator('aside.preview header').boundingBox())!;
	const right = (await page
		.locator('aside.preview header')
		.getByRole('button', { name: 'Od začátku' })
		.boundingBox())!;
	expect(right.x + right.width).toBeLessThanOrEqual(header.x + header.width);
});
