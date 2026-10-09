#!/usr/bin/env node
/**
 * Does a running editor load? `node scripts/smoke.mjs <url>`
 *
 * CI's `run-dev` job runs this against `npm run dev`; the Docker job only curls the
 * image. It passes only when the page comes back 200 and hydrates (`html[data-hydrated]`, set last by `+page.svelte`), with no error
 * thrown on the page. A server that starts and then answers every request with a 500
 * is the failure it exists for: the start-up log looks healthy, the page does not.
 *
 * Waits up to two minutes for the server to answer at all, so a CI step can start the
 * server in the background and call this straight after.
 */
import { chromium } from '@playwright/test';

const [url] = process.argv.slice(2);
if (!url) {
	console.error('usage: node scripts/smoke.mjs <url>');
	process.exit(2);
}

/** @param {string} message */
function fail(message) {
	console.error(`smoke: ${url}: ${message}`);
	process.exit(1);
}

const deadline = Date.now() + 120_000;
for (;;) {
	const answered = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(
		() => true,
		() => false
	);
	if (answered) break;
	if (Date.now() > deadline) fail('nothing answered within two minutes');
	await new Promise((resolve) => setTimeout(resolve, 1000));
}

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const response = await page.goto(url);
	if (response?.status() !== 200) {
		const heading = await page
			.locator('h1')
			.first()
			.textContent()
			.catch(() => null);
		fail(`the page came back ${response?.status()}${heading ? ` ("${heading.trim()}")` : ''}`);
	}
	await page
		.locator('html[data-hydrated="true"]')
		.waitFor({ timeout: 60_000 })
		.catch(() => fail(`the page did not hydrate${errors.length ? `: ${errors.join('; ')}` : ''}`));
	if (errors.length) fail(`the page threw: ${errors.join('; ')}`);

	console.log(`smoke: ${url}: loaded`);
} finally {
	await browser.close();
}
