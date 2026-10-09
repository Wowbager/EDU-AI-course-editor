#!/usr/bin/env node
/**
 * Does a running editor load? `node scripts/smoke.mjs <url> [--player]`
 *
 * CI starts the editor every way the README tells people to — `npm run dev` and the
 * Docker image — and runs this against each. It passes only when the page comes back
 * 200 and hydrates (`html[data-hydrated]`, set last by `+page.svelte`), with no error
 * thrown on the page. A server that starts and then answers every request with a 500
 * is the failure it exists for: the start-up log looks healthy, the page does not.
 *
 * `--player` also checks that `/player/` serves the Flutter build with the image shim
 * spliced in, which only the Docker image is expected to have.
 *
 * Waits up to two minutes for the server to answer at all, so a CI step can start the
 * server in the background and call this straight after.
 */
import { chromium } from '@playwright/test';
import { SHIM_START } from './inject-player-shim.mjs';

const [url, ...flags] = process.argv.slice(2);
if (!url) {
	console.error('usage: node scripts/smoke.mjs <url> [--player]');
	process.exit(2);
}

/** @param {string} message */
function fail(message) {
	console.error(`smoke: ${url}: ${message}`);
	process.exit(1);
}

const deadline = Date.now() + 120_000;
for (;;) {
	const answered = await fetch(url).then(
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

	if (flags.includes('--player')) {
		const player = await fetch(new URL('/player/', url));
		const html = await player.text();
		if (!player.ok) fail(`/player/ came back ${player.status}`);
		if (!html.includes('flutter_bootstrap.js')) fail('/player/ is not the Flutter build');
		if (!html.includes(SHIM_START)) fail('/player/ is missing the preview image shim');
		// OPEN-PROBLEMS #40: nginx once answered these from the wrong root, and a blank
		// preview was the only sign. A file served as the index page is the other way
		// the same mistake looks like success.
		for (const [asset, type] of [
			['canvaskit/canvaskit.wasm', 'application/wasm'],
			['favicon.ico', 'image/'],
			['favicon.png', 'image/png']
		]) {
			const response = await fetch(new URL(`/player/${asset}`, url));
			const served = response.headers.get('content-type') ?? '';
			if (!response.ok || !served.startsWith(type))
				fail(`/player/${asset} came back ${response.status} as "${served}", not ${type}`);
		}
	}
	console.log(`smoke: ${url}: loaded${flags.includes('--player') ? ', player served' : ''}`);
} finally {
	await browser.close();
}
