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

const counter = (page: Page, name: string) => page.getByRole('img', { name, exact: true });
const summary = (page: Page) => page.getByRole('region', { name: 'Shrnutí zkoušky' });

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
	await expect(counter(page, 'Získáno 0 z 14 XP')).toHaveText('0 / 14 XP');
	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await expect(counter(page, 'Získáno 2 z 14 XP')).toHaveText('2 / 14 XP');
	await expect(summary(page)).toHaveCount(0);

	await page.getByRole('radio', { name: 'Náhled' }).click();
	await expect(counter(page, 'Karta je za nejvýš 2 XP')).toHaveText('2 XP');
	await page.locator('.tree-card').nth(2).click();
	await expect(counter(page, 'Karta je za nejvýš 11 XP')).toHaveText('11 XP');
});

test('a run from a later card offers only the cards it plays', async ({ page }) => {
	await page.getByRole('radio', { name: 'Náhled' }).click();
	await page.locator('.tree-card').nth(1).click();
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await expect(counter(page, 'Získáno 0 z 12 XP')).toBeVisible();
});

test('finishing shows the overview, and × closes it', async ({ page }) => {
	await finishAll(page, '2');
	await expect(summary(page)).toContainText('Hotovo');
	await expect(summary(page)).toContainText('8 z 14 XP · úspěšnost 83 % · známka 2');
	await summary(page).getByRole('button', { name: 'Zavřít' }).click();
	await expect(summary(page)).toHaveCount(0);
	await expect(counter(page, 'Získáno 8 z 14 XP')).toBeVisible();
});

test('no mark is shown when the player sent none', async ({ page }) => {
	await finishAll(page);
	await expect(summary(page)).toContainText('8 z 14 XP · úspěšnost 83 %');
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
	await expect(counter(page, 'Získáno 2 z 14 XP')).toBeVisible();
});

test('Zkusit znovu and Od začátku start the count again', async ({ page }) => {
	await finishAll(page);
	await summary(page).getByRole('button', { name: 'Zkusit znovu' }).click();
	await expect(summary(page)).toHaveCount(0);
	await expect(counter(page, 'Získáno 0 z 14 XP')).toBeVisible();
	await expect.poll(() => sent(page, 'restart')).toBe(1);

	await finish(page, 0, { xp: 2, scoreKoef: 1 });
	await page.getByRole('button', { name: 'Od začátku' }).click();
	await expect(counter(page, 'Získáno 0 z 14 XP')).toBeVisible();
	await expect.poll(() => sent(page, 'restart')).toBe(2);
});

test('leaving Vyzkoušet, or editing the course, closes the overview', async ({ page }) => {
	await finishAll(page);
	await page.getByRole('radio', { name: 'Náhled' }).click();
	await expect(summary(page)).toHaveCount(0);

	// The run moved the selection to the card it ended on; start again from the first.
	await page.locator('.tree-card').nth(0).click();
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await expect(counter(page, 'Získáno 0 z 14 XP')).toBeVisible();
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
	await beside('Získáno 0 z 14 XP');
	const back = page.locator('aside.preview').getByRole('button', { name: 'Zpět', exact: true });
	expect((await back.boundingBox())!.x).toBeGreaterThan(
		(await counter(page, 'Získáno 0 z 14 XP').boundingBox())!.x
	);
	await page.getByRole('radio', { name: 'Náhled' }).click();
	await beside('Karta je za nejvýš 2 XP');

	// A narrow column wraps the buttons below instead of overflowing.
	await page.addStyleTag({ content: ':root { --e-preview-width: 360px !important; }' });
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await beside('Získáno 0 z 14 XP');
	const header = (await page.locator('aside.preview header').boundingBox())!;
	const right = (await page.getByRole('button', { name: 'Od začátku' }).boundingBox())!;
	expect(right.x + right.width).toBeLessThanOrEqual(header.x + header.width);
});
