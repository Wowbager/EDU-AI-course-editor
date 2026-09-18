import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The player loads step/solution images through the Laravel API's
 * `/api/proxy/image` — a proxy that 502s for a number of ordinary image hosts (see
 * `src/routes/preview-image/+server.ts`'s doc comment). The fix lives entirely in
 * the editor: `src/lib/preview/player-shim.js`, injected into the player's page
 * (`vite-plugin-player.ts` in dev, `scripts/inject-player-shim.mjs` in production),
 * intercepts that request and rewrites it to this origin's own `/preview-image`
 * before it ever reaches the network.
 *
 * This suite needs the Flutter web build, like `preview.spec.ts` — see that file's
 * comment. It does not depend on any third-party host actually answering: the
 * assertion is about *which URL the browser asks for*, which is decided before the
 * request is sent, so it holds even if the (deliberately unresolvable) test image
 * URL never loads.
 */
const playerBuilt = existsSync(
	new URL('../../EDU-AI-asistent-APP/build/web/index.html', import.meta.url)
);

const TEST_IMAGE_URL = 'https://example.com/preview-image-proxy-test.png';

test.describe('the player is rewritten to fetch images from this origin', () => {
	test.skip(!playerBuilt, 'the Flutter web build is not present');
	test.describe.configure({ timeout: 150_000 });

	test('a step image request lands on /preview-image, never on the Laravel proxy directly', async ({
		page
	}) => {
		const fixture = JSON.parse(
			readFileSync(
				new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
				'utf-8'
			)
		);
		const imageStep = fixture.blocks[0].steps.find(
			(step: { type: string }) => step.type === 'image'
		);
		expect(imageStep, 'fixture must still have an image step to redirect').toBeTruthy();
		imageStep.image.url = TEST_IMAGE_URL;

		const requestUrls: string[] = [];
		page.on('request', (request) => requestUrls.push(request.url()));

		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
		await page.setInputFiles('input[type=file]', {
			name: 'preview-image-proxy-course.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(fixture))
		});
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		// The player announces itself once booted (see preview.spec.ts).
		await expect(page.locator('aside .chip.ok', { hasText: 'Náhled' })).toBeVisible({
			timeout: 120_000
		});

		// The first card carries the image step (fixture: L1_B1_uvod / step s2).
		await page.locator('.tree-card').first().click();
		// Náhled shows every step at once, so the player fetches the image as soon as
		// the card is on screen — give it a moment to issue the request.
		await page.waitForTimeout(3000);

		const origin = new URL(page.url()).origin;
		const encoded = encodeURIComponent(TEST_IMAGE_URL);

		const rewritten = requestUrls.filter((url) =>
			url.startsWith(`${origin}/preview-image?url=`)
		);
		const wentDirectlyToTheLaravelProxy = requestUrls.filter(
			(url) => url.includes('/api/proxy/image') && !url.startsWith(origin)
		);

		expect(rewritten.some((url) => url.includes(encoded))).toBe(true);
		expect(wentDirectlyToTheLaravelProxy).toHaveLength(0);
	});
});
