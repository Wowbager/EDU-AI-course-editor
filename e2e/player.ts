import { expect, type Locator, type Page } from '@playwright/test';
import type { PlayerState } from '../src/lib/preview/bridge';

/**
 * Reading and driving the player without guessing at pixels.
 *
 * Flutter draws to a canvas, but the preview keeps Flutter's accessibility layer on
 * (the fork's `lib/preview/README.md` → "The accessibility layer is always on"), so
 * the frame holds an invisible element with a role and a name for every button,
 * answer option and marker. `player(page)` finds them, `press` clicks one with the
 * real mouse, and `inspect` asks the player what it shows.
 */

export const player = (page: Page) => page.frameLocator('iframe');

/**
 * What the player shows, as it says itself (`inspect` → `inspected`). The reply
 * comes once the frame drawing it has been painted, so everything sent before it is
 * on screen.
 */
export async function inspect(page: Page, timeout = 5_000): Promise<PlayerState> {
	return page.evaluate(
		(timeout) =>
			new Promise<PlayerState>((resolve, reject) => {
				const frame = document.querySelector('iframe');
				if (!frame?.contentWindow) return reject(new Error('there is no player frame'));
				const id = Math.floor(Math.random() * 1e9);
				const timer = setTimeout(() => {
					removeEventListener('message', answer);
					reject(new Error('the player did not answer inspect'));
				}, timeout);
				function answer(event: MessageEvent) {
					if (event.source !== frame!.contentWindow || typeof event.data !== 'string') return;
					const message = JSON.parse(event.data);
					if (message.type !== 'inspected' || message.id !== id) return;
					clearTimeout(timer);
					removeEventListener('message', answer);
					resolve(message);
				}
				addEventListener('message', answer);
				frame.contentWindow.postMessage(JSON.stringify({ type: 'inspect', id }), location.origin);
			}),
		timeout
	);
}

/** Wait until the player shows what `expected` describes. */
export async function waitForPlayer(page: Page, expected: Partial<PlayerState>, timeout = 30_000) {
	await expect
		.poll(() => inspect(page).catch(() => null), {
			timeout,
			message: `the player never showed ${JSON.stringify(expected)}`
		})
		.toMatchObject(expected);
}

/**
 * Click a target inside the player with the real mouse, so that the click goes
 * through Flutter's own hit-testing as a teacher's does. The player scrolls; a
 * target outside the frame is wheeled into view first.
 */
export async function press(page: Page, target: Locator) {
	const frame = (await page.locator('iframe').boundingBox())!;
	const top = frame.y + 8;
	const bottom = frame.y + frame.height - 8;
	await target.waitFor({ state: 'attached' });
	for (let attempt = 0; attempt < 20; attempt++) {
		const box = await target.boundingBox();
		if (box === null) throw new Error('the target has no box in the player');
		const y = box.y + box.height / 2;
		if (y > top && y < bottom) {
			await page.mouse.click(box.x + box.width / 2, y);
			return;
		}
		await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
		const distance = y - (frame.y + frame.height / 2);
		await page.mouse.wheel(0, Math.sign(distance) * Math.min(Math.abs(distance), frame.height * 0.8));
		// The accessibility layer moves with the next painted frame; inspect waits for it.
		await inspect(page);
	}
	throw new Error('could not scroll the target into the player frame');
}

/** A button in the player, by its exact name. */
export const button = (page: Page, name: string) =>
	player(page).getByRole('button', { name, exact: true });

type Direction = 'up' | 'down';
interface Logged {
	direction: Direction;
	// Loose on purpose: a test reads the fields of the message type it asked for.
	message: { type: string; [key: string]: any };
}

/**
 * Record every message between the editor and the player, both ways, including
 * across a reload of either. Call it before `page.goto`.
 *
 * `up` is player → editor, `down` is editor → player. `inspect` traffic is left
 * out, so it never counts as something the editor or the player did.
 */
export async function recordMessages(page: Page) {
	const log: Logged[] = [];
	await page.exposeBinding('__recordPreview', (_source, direction: Direction, data: string) => {
		const message = JSON.parse(data);
		if (message.type !== 'inspect' && message.type !== 'inspected') log.push({ direction, message });
	});
	await page.addInitScript(() => {
		const record = (window as unknown as { __recordPreview: (d: string, m: string) => void })
			.__recordPreview;
		addEventListener('message', (event) => {
			if (typeof event.data !== 'string') return;
			if (window === window.top) {
				if (event.source === document.querySelector('iframe')?.contentWindow) record('up', event.data);
			} else if (event.source === window.parent) {
				record('down', event.data);
			}
		});
	});

	const since = (mark: number, direction: Direction, type?: string) =>
		log
			.slice(mark)
			.filter((m) => m.direction === direction && (type === undefined || m.message.type === type))
			.map((m) => m.message);

	return {
		/** A point in the log; pass it to `up`/`down` to see only what came after. */
		mark: () => log.length,
		up: (type?: string, mark = 0) => since(mark, 'up', type),
		down: (type?: string, mark = 0) => since(mark, 'down', type)
	};
}
