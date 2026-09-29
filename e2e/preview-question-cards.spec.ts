import { readFileSync } from 'node:fs';
import { expect, openEditor, test, type Page } from './fixtures';
import { playerBuilt } from './player-build';
import { button, inspect, press, recordMessages, waitForPlayer } from './player';

/**
 * A teacher's card with two questions is two cards in the app (`domain/groups.ts`).
 * Náhled shows both, one under another, as the pupil meets them; Vyzkoušet plays them
 * as the pupil does, one card each; and the editor stays on the teacher's one card.
 *
 * The admin's test course has such a card: L1_B4_cviceni, a choice (s2) and, after a
 * second prompt (s3), an open question (s4). On import it becomes L1_B4_cviceni and
 * L1_B4_cviceni_2.
 */
const FILE = readFileSync(
	new URL('../src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json', import.meta.url)
);
const CARD = 'L1_B4_cviceni';
const SECOND = 'L1_B4_cviceni_2';

async function openCard(page: Page) {
	await page.locator('.tree-card').nth(3).click();
	await waitForPlayer(page, { view: 'expanded', blockIds: [CARD, SECOND] });
}

test.describe('a card with two questions in the preview', () => {
	test.skip(!playerBuilt, 'the Flutter web build is not present');
	test.describe.configure({ timeout: 90_000 });

	let log: Awaited<ReturnType<typeof recordMessages>>;

	test.beforeEach(async ({ page }) => {
		log = await recordMessages(page);
		await openEditor(page);
		await page.setInputFiles('input[type=file]', { name: 'zlomky-5-trida.json', mimeType: 'application/json', buffer: FILE });
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(page.locator('aside.preview')).toHaveAttribute('data-player', 'ready', { timeout: 60_000 });
	});

	test('Náhled shows both of its cards, and a click in the second lands on the teacher’s card', async ({ page }) => {
		await openCard(page);
		const state = await inspect(page);
		expect(state.shownStepIds).toEqual(['s1', 's2', 's3', 's4']);

		// The step rows' round buttons, one per step: the third is s3, in the second card.
		const mark = log.mark();
		await press(page, button(page, 'Hotovo').nth(2));
		await expect.poll(() => log.up('clicked', mark).length).toBeGreaterThan(0);
		expect(log.up('clicked', mark).at(-1)).toMatchObject({ ref: { blockId: SECOND, stepId: 's3' } });

		await expect(page.locator('.tree-card.selected')).toHaveCount(1);
		await expect(page.locator('main .step').nth(2)).toHaveClass(/targeted/);
	});

	test('Vyzkoušet grades each question as its own card, and the editor stays on the one card', async ({ page }) => {
		await openCard(page);
		const selected = await page.locator('.tree-card.selected').textContent();
		const mark = log.mark();

		await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
		await waitForPlayer(page, { view: 'play', blockId: CARD, stepId: 's2' });

		await press(page, button(page, '2/6'));
		await press(page, button(page, 'Zkontrolovat'));
		// The first question's card is finished on its own: the player moves on to the
		// second question's card, which the lesson binds right after it.
		for (let i = 0; i < 5 && (await inspect(page)).blockId !== SECOND; i++) {
			const next = button(page, 'Další').or(button(page, 'Pokračovat'));
			if ((await next.count()) > 0) await press(page, next.first());
		}
		await waitForPlayer(page, { blockId: SECOND, stepId: 's4' });

		const positions = log.up('stepChanged', mark).map((m) => m.blockId as string);
		expect(positions).toContain(CARD);
		expect(positions).toContain(SECOND);
		expect(log.up('completed', mark).length).toBeGreaterThan(0);

		// The editor follows the pupil, on the teacher's card: the same card is still
		// the selected one, and the step on screen is the card's fourth.
		await expect(page.locator('.tree-card.selected')).toHaveText(selected ?? '');
		await expect(page.locator('main .step.targeted')).toHaveCount(1);
		await expect(page.locator('main .step').nth(3)).toHaveClass(/targeted/);
	});
});
