import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The preview is the real player in an iframe, so this suite needs the Flutter web
 * build. It skips rather than fails when that is absent — the editor is developed
 * and tested without a Flutter toolchain most of the time.
 *
 *     flutter build web --release --base-href /player/
 *
 * Flutter draws to a canvas, so there is no DOM inside the frame to assert against.
 * These tests therefore check the *contract* (plan §4) rather than the pixels: that
 * the player boots and says so, that a click on rendered content comes back as the
 * ref that produced it — which also proves the right block is on screen — and that
 * an edit reaches the player without reloading it.
 */
const playerBuilt = existsSync(
	new URL('../../EDU-AI-asistent-APP/build/web/index.html', import.meta.url)
);

/** Record every message the player posts up to the editor. */
async function watchMessages(page: Page) {
	await page.evaluate(() => {
		const seen: string[] = [];
		(window as unknown as { __preview: string[] }).__preview = seen;
		window.addEventListener('message', (event) => {
			if (typeof event.data === 'string') seen.push(event.data);
		});
	});
	return () =>
		page.evaluate(() => (window as unknown as { __preview: string[] }).__preview ?? []);
}

/**
 * Answer the question on screen and press the card's action button.
 *
 * Flutter draws to a canvas, so nothing inside the frame can be addressed by role or
 * text: the only way to drive it is to click where it painted. Everything here is
 * therefore a probe — pick an answer somewhere in the options band, scroll down to
 * the action bar, and press along it — repeated until `done()` says the player
 * moved. That keeps the test about the contract rather than about a pixel.
 */
async function playOneStep(page: Page, done: () => Promise<boolean>) {
	const frame = (await page.locator('iframe').boundingBox())!;

	for (let attempt = 0; attempt < 3; attempt++) {
		for (const optionY of [220, 150, 290, 360]) {
			await page.mouse.click(frame.x + frame.width / 2, frame.y + optionY);
			await page.waitForTimeout(250);
		}

		await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
		for (let i = 0; i < 12; i++) {
			await page.mouse.wheel(0, 300);
			await page.waitForTimeout(100);
		}
		await page.waitForTimeout(600);

		for (let y = frame.height - 60; y > frame.height - 220; y -= 20) {
			await page.mouse.click(frame.x + frame.width - 110, frame.y + y);
			await page.waitForTimeout(350);
			if (await done()) return true;
		}
	}
	return done();
}

/**
 * Click down the first band of the frame until something reports a ref. The player
 * draws to a canvas, so there is no element to address and exactly where the text
 * landed depends on how it wrapped.
 */
async function clickUntilTargeted(page: Page, targeted = page.locator('.step.targeted')) {
	const frame = (await page.locator('iframe').boundingBox())!;
	for (let offset = 30; offset <= 200 && (await targeted.count()) === 0; offset += 10) {
		await page.mouse.click(frame.x + 80, frame.y + offset);
		await page.waitForTimeout(350);
	}
}

test.describe('live preview', () => {
	test.skip(!playerBuilt, 'the Flutter web build is not present');
	// Serial: each test boots a full Flutter app, and two racing for the dev server's
	// attention is slower than running them one after another.
	test.describe.configure({ timeout: 150_000, mode: 'serial' });

	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// The import handler is client-side: wait for hydration, which the starter card
		// appearing proves, before handing the page a file.
		await expect(page.locator('.tree-card')).toHaveCount(1);
		await page.setInputFiles('input[type=file]', {
			name: 'spec-16-course.json',
			mimeType: 'application/json',
			buffer: Buffer.from(
				readFileSync(
					new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url)
				)
			)
		});
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		// The player announces itself over the message channel once it has booted.
		await expect(page.getByText('živý náhled')).toBeVisible({ timeout: 120_000 });
	});

	test('clicking rendered content lands on the field that produced it', async ({ page }) => {
		const messages = await watchMessages(page);

		await page.locator('.tree-card').nth(2).click();
		await page.waitForTimeout(2500);
		await expect(page.locator('.step.targeted')).toHaveCount(0);

		await clickUntilTargeted(page);

		const targeted = page.locator('.step.targeted');
		await expect(targeted).toHaveCount(1);

		// The ref names the block that was on screen, which is how we know the player
		// was showing the card the author selected.
		const clicked = (await messages()).filter((m) => m.includes('"clicked"'));
		expect(clicked.length).toBeGreaterThan(0);
		expect(clicked.at(-1)).toContain('"blockId":"L1_B3_poznej"');
	});

	test('the expanded view is inert: nothing in it answers or advances', async ({ page }) => {
		// Náhled is the default, and it is the whole point of it: the author reads the
		// card rather than taking it. A tap on an answer reports where that answer is
		// authored, so `clicked` arrives and `stepChanged` never does.
		await page.locator('.tree-card').nth(2).click();
		await page.waitForTimeout(2500);
		const messages = await watchMessages(page);

		await clickUntilTargeted(page);

		const seen = await messages();
		expect(seen.filter((m) => m.includes('"clicked"')).length).toBeGreaterThan(0);
		expect(seen.filter((m) => m.includes('"stepChanged"'))).toHaveLength(0);
		expect(seen.filter((m) => m.includes('"completed"'))).toHaveLength(0);
	});

	test('the question mark in Náhled goes to the text behind it', async ({ page }) => {
		// Náhled draws the card's own buttons now, and the "?" is the first front door
		// to `hint` and `help` — fields that are otherwise only reachable by scrolling
		// to the bottom of the card. A card-level hint is reported without a `stepId`,
		// because it belongs to the card, so the card editor is what has to answer.
		await page.locator('.tree-card').nth(2).click();
		await page.waitForTimeout(2500);

		const targeted = page.locator('main .field-row.targeted');
		await expect(targeted).toHaveCount(0);

		// The bubble sits under the first card's text, and where exactly depends on how
		// that text wrapped — so probe along it rather than trusting a pixel.
		const frame = (await page.locator('iframe').boundingBox())!;
		for (let y = 150; y <= 280 && (await targeted.count()) === 0; y += 10) {
			await page.mouse.click(frame.x + 180, frame.y + y);
			await page.waitForTimeout(250);
		}

		await expect(targeted).toHaveCount(1);
		await expect(targeted).toContainText('Nápověda');
	});

	test('the expanded view never names another card by its id in teacher mode', async ({ page }) => {
		// The branch markers name where each answer leads. The player holds one card
		// and cannot look another one up, so the editor supplies the names — and in
		// teacher mode a name is never an id (plan §8). Asserted on the wire, because
		// the frame itself is a canvas with nothing to read.
		const posted: string[] = [];
		await page.exposeFunction('__record', (m: string) => void posted.push(m));
		await page.evaluate(() => {
			const frame = document.querySelector('iframe') as HTMLIFrameElement;
			const original = frame.contentWindow!.postMessage.bind(frame.contentWindow);
			frame.contentWindow!.postMessage = ((data: unknown, origin: string) => {
				if (typeof data === 'string') void (window as unknown as { __record: (m: string) => void }).__record(data);
				return original(data as string, origin);
			}) as typeof original;
		});

		await page.locator('.tree-card').nth(2).click();
		await page.waitForTimeout(2000);

		const setBlock = posted.filter((m) => m.includes('"setBlock"'));
		expect(setBlock.length).toBeGreaterThan(0);
		const labels = JSON.parse(setBlock.at(-1)!).blockLabels as Record<string, string>;
		expect(Object.keys(labels).length).toBeGreaterThan(0);
		for (const [blockId, label] of Object.entries(labels)) {
			expect(label, `${blockId} was named by its id`).not.toBe(blockId);
		}

		// The advanced author, who may change ids, gets the ids.
		await page.getByRole('radio', { name: 'Pokročilý' }).click();
		await page.waitForTimeout(2000);
		const advanced = JSON.parse(
			posted.filter((m) => m.includes('"setBlock"')).at(-1)!
		).blockLabels as Record<string, string>;
		expect(Object.entries(advanced).every(([id, label]) => id === label)).toBe(true);
	});

	test('Vyzkoušet plays the lesson and Zpět retraces it', async ({ page }) => {
		await page.locator('.tree-card').nth(2).click();
		await page.waitForTimeout(1500);

		const back = page.getByRole('button', { name: '← Zpět' });
		await expect(back).toHaveCount(0);

		await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
		await page.waitForTimeout(3000);

		// Nowhere to go back to until the author has moved.
		await expect(back).toBeVisible();
		await expect(back).toBeDisabled();

		const messages = await watchMessages(page);

		await playOneStep(page, async () => back.isEnabled());

		// Having moved, Zpět becomes available — that is the navState message arriving.
		await expect(back).toBeEnabled({ timeout: 15_000 });
		expect((await messages()).filter((m) => m.includes('"navState"')).length).toBeGreaterThan(0);

		await back.click();
		await page.waitForTimeout(1500);
		// Still the same player: going back must never cost a Flutter boot.
		expect((await messages()).filter((m) => m.includes('"ready"'))).toHaveLength(0);
	});

	test('what Vyzkoušet did never decides where Náhled lands', async ({ page }) => {
		// The played run reports every step it reaches. That used to be the only writer
		// of the bridge's restore point — which only Náhled read — so an abandoned run
		// sent the expanded view to the step it happened to stop on, of whatever card
		// was open. Asserted on the wire, because the frame is a canvas.
		await page.locator('.tree-card').nth(2).click();
		await page.waitForTimeout(1500);

		const posted: string[] = [];
		await page.exposeFunction('__record', (m: string) => void posted.push(m));
		await page.evaluate(() => {
			const frame = document.querySelector('iframe') as HTMLIFrameElement;
			const original = frame.contentWindow!.postMessage.bind(frame.contentWindow);
			frame.contentWindow!.postMessage = ((data: unknown, origin: string) => {
				if (typeof data === 'string') void (window as unknown as { __record: (m: string) => void }).__record(data);
				return original(data as string, origin);
			}) as typeof original;
		});

		const messages = await watchMessages(page);
		const back = page.getByRole('button', { name: '← Zpět' });
		await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
		await page.waitForTimeout(3000);
		await playOneStep(page, async () => back.isEnabled());
		await expect(back).toBeEnabled({ timeout: 15_000 });

		// Whatever the run walked through.
		const played = new Set(
			(await messages())
				.filter((m) => m.includes('"stepChanged"'))
				.map((m) => JSON.parse(m).stepId as string)
		);

		await page.getByRole('radio', { name: 'Náhled' }).click();
		await page.waitForTimeout(2000);

		const setBlock = posted.filter((m) => m.includes('"setBlock"'));
		expect(setBlock.length).toBeGreaterThan(0);
		const restored = JSON.parse(setBlock.at(-1)!).stepId as string | undefined;

		// It may carry the editor's own selection, or nothing at all. What it must never
		// carry is a step that only the run knew about.
		if (restored !== undefined && played.size > 0) {
			const selected = await page.locator('.step.targeted').count();
			expect(played.has(restored) && selected === 0).toBe(false);
		}

		// And the run's own "back" is gone with it.
		await expect(back).toHaveCount(0);
	});

	test('editing content updates the player without reloading it', async ({ page }) => {
		await page.locator('.tree-card').first().click();
		await page.waitForTimeout(2000);
		const messages = await watchMessages(page);

		await page.locator('.cm-content').first().click();
		await page.keyboard.type(' Změna.');
		await page.waitForTimeout(2000);

		// A reload would boot the whole Flutter app again and announce a second time.
		// That is the thing the contract exists to avoid — it costs seconds and the
		// author is typing.
		expect((await messages()).filter((m) => m.includes('"ready"'))).toHaveLength(0);
		await expect(page.getByText('živý náhled')).toBeVisible();
	});

	test('switching between the two modes keeps the player alive', async ({ page }) => {
		await page.locator('.tree-card').first().click();
		await page.waitForTimeout(2000);
		const messages = await watchMessages(page);

		await page.getByRole('radio', { name: 'Vyzkoušet' }).click();
		await page.waitForTimeout(2500);
		await page.getByRole('radio', { name: 'Náhled' }).click();
		await page.waitForTimeout(2500);

		expect((await messages()).filter((m) => m.includes('"ready"'))).toHaveLength(0);
		await expect(page.getByText('živý náhled')).toBeVisible();
	});

	test('switching to a card with different steps keeps the player alive', async ({ page }) => {
		await page.locator('.tree-card').first().click();
		await page.waitForTimeout(2000);
		const messages = await watchMessages(page);

		// Different step graph: the engine re-mounts, but the iframe does not reload.
		await page.locator('.tree-card').nth(2).click();
		await page.waitForTimeout(2500);

		expect((await messages()).filter((m) => m.includes('"ready"'))).toHaveLength(0);
		await expect(page.getByText('živý náhled')).toBeVisible();
	});
});
