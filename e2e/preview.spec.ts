import { readFileSync } from 'node:fs';
import { expect, test, type Page, openEditor } from './fixtures';
import { playerBuilt } from './player-build';
import { button, inspect, player, press, recordMessages, waitForPlayer } from './player';

/**
 * The preview is the real player in an iframe, so this suite needs the Flutter web
 * build. It skips rather than fails when that is absent — the editor is developed
 * and tested without a Flutter toolchain most of the time.
 *
 *     flutter build web --release --base-href /player/ --no-web-resources-cdn
 *
 * Flutter draws to a canvas, but the preview keeps Flutter's accessibility layer on,
 * so buttons, answer options and markers are found by name (`e2e/player.ts`) and
 * clicked with the real mouse. What the player shows is asked of the player
 * (`inspect`), and waited for, rather than slept on. What travels between the two is
 * recorded both ways, so the tests check the contract (plan §4): the player boots
 * and says so, a click lands on the field behind it, and an edit reaches the player
 * without reloading it.
 *
 * The spec course's cards: 0 is L1_B1_uvod (text and image), 2 is L1_B3_poznej, a
 * question card whose question (s2) has options a–d, `a` correct.
 */

const COURSE = readFileSync(
	new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url)
);
const QUIZ = 'L1_B3_poznej';
const INTRO = 'L1_B1_uvod';
const RIGHT_ANSWER = 'Čitatel je 5, jmenovatel je 7';

type Log = Awaited<ReturnType<typeof recordMessages>>;

async function openCard(page: Page, index: number, blockId: string) {
	await page.locator('.tree-card').nth(index).click();
	await waitForPlayer(page, { view: 'expanded', blockId });
}

async function play(page: Page, blockId: string) {
	await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
	await waitForPlayer(page, { view: 'play', content: 'lesson', blockId });
}

/** Answer the quiz card's question right, as a pupil does. */
async function answerRight(page: Page) {
	await press(page, button(page, RIGHT_ANSWER));
	await press(page, button(page, 'Zkontrolovat'));
}

test.describe('live preview', () => {
	test.skip(!playerBuilt, 'the Flutter web build is not present');
	test.describe.configure({ timeout: 90_000 });

	let log: Log;

	test.beforeEach(async ({ page }) => {
		log = await recordMessages(page);
		// The import handler is client-side: wait for hydration before handing the
		// page a file. The flag is set last in onMount, so it also covers the seed.
		await openEditor(page);
		await page.setInputFiles('input[type=file]', {
			name: 'spec-16-course.json',
			mimeType: 'application/json',
			buffer: COURSE
		});
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		// The player announces itself over the message channel once it has booted.
		await expect(page.locator('aside .chip.ok', { hasText: 'Náhled' })).toBeVisible({ timeout: 60_000 });
	});

	test('clicking rendered content lands on the field that produced it', async ({ page }) => {
		await openCard(page, 2, QUIZ);
		await expect(page.locator('.step.targeted')).toHaveCount(0);
		const mark = log.mark();

		await press(page, button(page, RIGHT_ANSWER));

		// The ref names the block that was on screen, which is how we know the player
		// was showing the card the author selected.
		await expect.poll(() => log.up('clicked', mark).length).toBeGreaterThan(0);
		expect(log.up('clicked', mark).at(-1)).toMatchObject({
			ref: { blockId: QUIZ, stepId: 's2', optionId: 'a', field: 'text' }
		});
		await expect(page.locator('.step.targeted')).toHaveCount(1);
	});

	test('the expanded view is inert: nothing in it answers or advances', async ({ page }) => {
		// Náhled is the default, and it is the whole point of it: the author reads the
		// card rather than taking it. A tap on an answer, or on the card's own button,
		// reports where it is authored, so `clicked` arrives and `stepChanged` never does.
		await openCard(page, 2, QUIZ);
		const mark = log.mark();

		await press(page, button(page, RIGHT_ANSWER));
		await press(page, button(page, 'Hotovo').first());
		// Everything the clicks caused has been painted once the player answers.
		await inspect(page);

		expect(log.up('clicked', mark).length).toBeGreaterThan(0);
		expect(log.up('stepChanged', mark)).toHaveLength(0);
		expect(log.up('completed', mark)).toHaveLength(0);
		await waitForPlayer(page, { view: 'expanded', blockId: QUIZ });
	});

	test('the question mark in Náhled goes to the text behind it', async ({ page }) => {
		// Náhled draws the card's own buttons, and the "?" is a front door to `hint`
		// and `help`. In the quiz card the "?" is the question's own — the step on
		// screen's hint, as in the app — so the answer is that step's hint field.
		// (A card-level hint is reported without a `stepId` and opens the card's
		// settings; the Flutter suite holds that path.)
		await openCard(page, 2, QUIZ);
		const mark = log.mark();

		await press(page, button(page, 'Nápověda'));

		await expect.poll(() => log.up('clicked', mark).length).toBeGreaterThan(0);
		expect(log.up('clicked', mark).at(-1)).toMatchObject({
			ref: { blockId: QUIZ, stepId: 's2', field: 'hint' }
		});
		await expect(page.locator('main .step.targeted')).toHaveCount(1);
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('the expanded view never names another card by its id in teacher mode', async ({ page }) => {
		// The branch markers name where each answer leads. The player holds one card
		// and cannot look another one up, so the editor supplies the names — and in
		// teacher mode a name is never an id (plan §8). Asserted on what the player
		// received, and on what it drew.
		await openCard(page, 2, QUIZ);

		const lastSetBlock = () => log.down('setBlock').at(-1) as { blockLabels?: Record<string, string> };
		const labels = lastSetBlock().blockLabels ?? {};
		expect(Object.keys(labels).length).toBeGreaterThan(0);
		for (const [blockId, label] of Object.entries(labels)) {
			expect(label, `${blockId} was named by its id`).not.toBe(blockId);
		}
		// The markers the player drew carry the name too, never the id.
		const markers = player(page).getByRole('group', { name: /→/ });
		await expect(markers).toHaveCount(1);
		await expect(markers).toHaveAccessibleName(/karta „Části zlomku“/);
		await expect(markers).not.toHaveAccessibleName(/L1_B2_casti/);

		// The advanced author, who may change ids, gets the ids.
		await page.getByRole('radio', { name: 'Pokročilý' }).click();
		await expect
			.poll(() => Object.entries(lastSetBlock().blockLabels ?? {}).every(([id, label]) => id === label))
			.toBe(true);
	});

	test('Vyzkoušet plays the lesson and Zpět retraces it', async ({ page }) => {
		await openCard(page, 2, QUIZ);

		const back = page.getByRole('button', { name: '← Zpět' });
		await expect(back).toHaveCount(0);

		await play(page, QUIZ);

		// Nowhere to go back to until the author has moved.
		await expect(back).toBeVisible();
		await expect(back).toBeDisabled();
		const mark = log.mark();

		await answerRight(page);

		// Having moved, Zpět becomes available — that is the navState message arriving.
		await expect(back).toBeEnabled({ timeout: 15_000 });
		expect(log.up('navState', mark).length).toBeGreaterThan(0);
		await waitForPlayer(page, { canGoBack: true });

		await back.click();
		await waitForPlayer(page, { canGoBack: false });
		// Still the same player: going back must never cost a Flutter boot.
		expect(log.up('ready', mark)).toHaveLength(0);
	});

	test('Vyzkoušet moves the editor to where the pupil is, and nothing else', async ({ page }) => {
		// The run is the only thing that decides where the editor is while it plays:
		// every step the player reports is selected and opened in the editor. The
		// player's own state still never leaks into Náhled — Náhled shows what the
		// editor has selected, and after a run that is where the run ended, openly.
		await openCard(page, 2, QUIZ);
		const mark = log.mark();
		const positions = () =>
			log.up('stepChanged', mark) as unknown as { blockId: string; stepId: string; shownStepIds: string[] }[];

		await page.getByRole('radio', { name: 'Vyzkoušet' }).click();

		// The first card reports itself on mount, and the editor opens that step.
		await expect.poll(() => positions().length, { timeout: 15_000 }).toBeGreaterThan(0);
		const first = positions().at(-1)!;
		expect(first.blockId).toBe(QUIZ);
		await expect(page.locator('main .step.targeted')).toHaveCount(1);

		// The quiz card is one bubble that grows question by question: the pupil has
		// the text before the question and the question, not the text after it. The
		// step list shows the card the same way — the steps not reached are folded.
		expect(first).toMatchObject({ stepId: 's2', shownStepIds: ['s1', 's2'] });
		await waitForPlayer(page, { blockId: QUIZ, stepId: 's2', shownStepIds: ['s1', 's2'] });
		const steps = page.locator('main .step');
		await expect(steps).toHaveCount(4);
		await expect(steps.nth(0)).not.toHaveClass(/collapsed/);
		await expect(steps.nth(1)).not.toHaveClass(/collapsed/);
		await expect(steps.nth(2)).toHaveClass(/collapsed/);
		await expect(steps.nth(3)).toHaveClass(/collapsed/);

		// The player is told nothing about focus while it plays: no highlight, and no
		// setLesson carries a step.
		expect(log.down('highlight', mark)).toHaveLength(0);

		const back = page.getByRole('button', { name: '← Zpět' });
		await answerRight(page);
		await expect(back).toBeEnabled({ timeout: 15_000 });
		const last = positions().at(-1)!;

		// Back in Náhled, the outline is the editor's selection — the step the run
		// reached, because the run moved the editor there — and no hidden state.
		await page.getByRole('radio', { name: 'Náhled' }).click();
		await waitForPlayer(page, { view: 'expanded' });
		const outlined = log.down('setBlock').at(-1)!;
		if (outlined.block[0]?.block_id === last.blockId) expect(outlined.stepId).toBe(last.stepId);

		// And the run's own "back" is gone with it, and so is its folding.
		await expect(back).toHaveCount(0);
		await page.locator('.tree-card').nth(2).click();
		await expect(page.locator('main .step.collapsed')).toHaveCount(0);
	});

	test("a click in Vyzkoušet is the pupil's and never jumps the editor", async ({ page }) => {
		await openCard(page, 0, INTRO);
		await play(page, INTRO);
		const mark = log.mark();

		// Click the text of the first card, where Náhled would report `content`.
		const texts = player(page).getByRole('textbox');
		expect(await texts.count()).toBeGreaterThan(0);
		for (let i = 0; i < (await texts.count()); i++) await press(page, texts.nth(i));
		await inspect(page);

		expect(log.up('clicked', mark)).toHaveLength(0);
	});

	test('editing content updates the player without reloading it', async ({ page }) => {
		await openCard(page, 0, INTRO);
		const mark = log.mark();

		await page.locator('.cm-content').first().click();
		await page.keyboard.type(' Změna.');
		await expect
			.poll(() => log.down('setBlock', mark).some((m) => JSON.stringify(m).includes('Změna.')))
			.toBe(true);
		await inspect(page);

		// A reload would boot the whole Flutter app again and announce a second time.
		// That is the thing the contract exists to avoid — it costs seconds and the
		// author is typing.
		expect(log.up('ready', mark)).toHaveLength(0);
		await expect(page.locator('aside .chip.ok', { hasText: 'Náhled' })).toBeVisible();
	});

	test('switching between the two modes keeps the player alive', async ({ page }) => {
		await openCard(page, 0, INTRO);
		const mark = log.mark();

		await play(page, INTRO);
		await page.getByRole('radio', { name: 'Náhled' }).click();
		await waitForPlayer(page, { view: 'expanded', blockId: INTRO });

		expect(log.up('ready', mark)).toHaveLength(0);
		await expect(page.locator('aside .chip.ok', { hasText: 'Náhled' })).toBeVisible();
	});

	test('switching to a card with different steps keeps the player alive', async ({ page }) => {
		await openCard(page, 0, INTRO);
		const mark = log.mark();

		// Different step graph: the engine re-mounts, but the iframe does not reload.
		await openCard(page, 2, QUIZ);

		expect(log.up('ready', mark)).toHaveLength(0);
		await expect(page.locator('aside .chip.ok', { hasText: 'Náhled' })).toBeVisible();
	});
});

test.describe('the player on a plain page open', () => {
	test.skip(!playerBuilt, 'the Flutter web build is not present');
	test.describe.configure({ timeout: 90_000 });

	test('boots and answers, with nothing imported', async ({ page }) => {
		// The other suites import a course first. This is the page as a teacher opens
		// it — the case that used to show an empty preview (DECISIONS Round 5).
		await openEditor(page);
		await expect(page.locator('aside .chip.ok', { hasText: 'Náhled' })).toBeVisible({ timeout: 60_000 });
		const state = await inspect(page);
		expect(['none', 'block']).toContain(state.content);
	});
});
