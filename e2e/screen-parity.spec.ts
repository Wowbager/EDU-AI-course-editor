import { expect, test, openEditor, type Page } from './fixtures';
import { readFileSync } from 'node:fs';

/**
 * What is on the page is what the screen model says.
 *
 * Every value the tree, the top bar and Kontrola kurzu draw is a field of
 * `store.screen` (`src/lib/screen`), and the element that draws it carries
 * `data-screen="<region>.<path>"`. This suite reads the model through the test hook
 * (`window.__screen`, `state/screen-hook.ts`: only in the dev server and in a build made
 * with `--mode e2e`) and holds the page to it, for several courses in each of the three
 * modes and in the states that change what is drawn: feedback off, the export review
 * opened, the validation panel open, the tree folded to its rail with a panel peeked.
 *
 * Two checks per state:
 *
 *  1. Every `[data-screen]` element shows exactly the model's value at its path (its
 *     text, or `value` for a field), and there are enough of them for the check to mean
 *     something.
 *  2. Nothing is drawn that the model does not own: in those three regions every text
 *     node with a digit in it, or with any of the course's own words in it (names, step
 *     texts), sits inside a `[data-screen]` element. A number a component works out for
 *     itself, or a name it reads off the document, fails here.
 *
 * The card region (the editor column) joins these checks when it moves to the model
 * (Round 14 part 3).
 */
const FIXTURES_DIR = new URL('../src/lib/domain/__tests__/fixtures/', import.meta.url);
const read = (name: string): Record<string, unknown> =>
	JSON.parse(readFileSync(new URL(name, FIXTURES_DIR), 'utf8'));

interface Lesson {
	lesson_id: string;
	blocks: { block_id: string; order?: number }[];
}

/** A card two lessons hold: the second card of the first lesson, also in the second. */
function cardInTwoLessons(): Record<string, unknown> {
	const course = read('corpus/zlomky-5-trida.json') as { lessons: Lesson[] };
	const [first, second] = course.lessons;
	second.blocks.push({ block_id: first.blocks[1].block_id, order: second.blocks.length + 1 });
	return course;
}

const COURSES: { name: string; course: () => Record<string, unknown> }[] = [
	{
		name: 'zlomky (cards with several questions)',
		course: () => read('corpus/zlomky-5-trida.json')
	},
	{ name: 'spec §16 (clean)', course: () => read('spec-16-course.json') },
	{
		name: 'spec §16 broken (a branch to nowhere, two lessons with one id)',
		course: () => read('spec-16-course-broken.json')
	},
	{ name: 'onboarding', course: () => read('corpus/edu-onboarding-app.json') },
	{ name: 'a card in two lessons', course: cardInTwoLessons }
];

const MODES = ['Učitel', 'Metodik', 'Pokročilý'] as const;

// ───────────────────────────────── reading the page ─────────────────────────────────

type Json = unknown;

/** `tree.lessons[0].cards[2].name` in a region object. */
function at(root: Json, path: string): Json {
	let node = root;
	for (const part of path.match(/[^.[\]]+/g) ?? []) {
		if (node === null || typeof node !== 'object') return undefined;
		node = (node as Record<string, Json>)[part];
	}
	return node;
}

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

async function modelOf(page: Page): Promise<Json> {
	return page.evaluate(() =>
		(window as unknown as { __screen: { all(): unknown } }).__screen.all()
	);
}

/** Every `[data-screen]` element: where it says it gets its value, and what it shows. */
async function drawn(page: Page): Promise<{ path: string; shown: string }[]> {
	return page.locator('[data-screen]').evaluateAll((nodes) =>
		nodes.map((node) => ({
			path: node.getAttribute('data-screen')!,
			shown:
				node instanceof HTMLInputElement ||
				node instanceof HTMLTextAreaElement ||
				node instanceof HTMLSelectElement
					? node.value
					: (node.textContent ?? '')
		}))
	);
}

/** The text nodes of the three regions that no `[data-screen]` element holds. */
async function untracked(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const roots = [
			'nav[aria-label="Struktura kurzu"]',
			'header.topbar',
			'aside[aria-label="Kontrola kurzu"]',
			// A rail panel is drawn in the page's top layer, outside the nav it belongs to.
			'[role="group"][data-peek-panel], .peek'
		]
			.flatMap((selector) => [...document.querySelectorAll(selector)])
			.filter((el, i, all) => all.indexOf(el) === i);
		const found: string[] = [];
		for (const root of roots) {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
				const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
				if (text === '') continue;
				if (node.parentElement?.closest('[data-screen]') !== null) continue;
				if (node.parentElement?.closest('script, style') !== null) continue;
				found.push(text);
			}
			for (const field of root.querySelectorAll('input, textarea')) {
				if (field.closest('[data-screen]') !== null) continue;
				const value = (field as HTMLInputElement).value;
				if (value !== '') found.push(value);
			}
		}
		return found;
	});
}

/** The words of the course itself: names, and the text of every step. */
function courseWords(course: Record<string, unknown>): string[] {
	const words = new Set<string>();
	const add = (value: unknown) => {
		if (typeof value !== 'string') return;
		for (const line of value.split('\n')) {
			const plain = line
				.replace(/[*_`#>$]/g, '')
				.replace(/\s+/g, ' ')
				.trim();
			if (plain.length >= 4) words.add(plain);
		}
	};
	const walk = (node: unknown, key: string) => {
		if (Array.isArray(node)) node.forEach((item) => walk(item, key));
		else if (node !== null && typeof node === 'object') {
			for (const [k, v] of Object.entries(node)) walk(v, k);
		} else if (key === 'name' || key === 'content' || key === 'text' || key === 'alt') add(node);
	};
	walk(course, '');
	return [...words];
}

// ─────────────────────────────────── the two checks ───────────────────────────────────

async function expectParity(page: Page, course: Record<string, unknown>, state: string) {
	const words = courseWords(course);
	await expect(async () => {
		const model = await modelOf(page);
		const elements = await drawn(page);

		for (const { path, shown } of elements) {
			const value = at(model, path);
			expect(value, `${state}: ${path} is not in the model`).not.toBeUndefined();
			expect(squash(shown), `${state}: ${path}`).toBe(squash(String(value)));
		}
		const regions = new Set(elements.map((e) => e.path.split('.')[0]));
		expect(regions, `${state}: the top bar and the tree are drawn from the model`).toContain(
			'topbar'
		);
		expect(regions).toContain('tree');

		const loose = await untracked(page);
		const leaked = loose.filter((text) => {
			if (/\d/.test(text)) return true;
			const bare = text.replace(/…$/, '').trim();
			return (
				words.some((w) => w.includes(bare) && bare.length >= 12) ||
				words.some((w) => text.includes(w))
			);
		});
		expect(leaked, `${state}: drawn outside the model`).toEqual([]);
	}).toPass({ timeout: 10_000 });
}

// ─────────────────────────────────────── the states ───────────────────────────────────────

async function load(page: Page, course: Record<string, unknown>) {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(course))
	});
	await expect(page.locator('.cards .tree-card').first()).toBeVisible();
}

const setMode = (page: Page, mode: (typeof MODES)[number]) =>
	page.getByRole('radiogroup', { name: 'Režim editoru' }).getByText(mode, { exact: true }).click();

for (const { name, course } of COURSES) {
	for (const mode of MODES) {
		test(`the page is the screen model: ${name}, ${mode}`, async ({ page }) => {
			const doc = course();
			await load(page, doc);
			await setMode(page, mode);
			await expectParity(page, doc, 'as opened');

			// A card shared by two lessons is named by the lesson it is shown under.
			const lessons = page.locator('.tree-lesson > .lesson');
			if ((await lessons.count()) > 1) {
				await lessons.nth(1).click();
				await expectParity(page, doc, 'second lesson open');
			}

			// Zpětná vazba off: the advice about those fields is held back, not listed.
			const feedback = page.getByRole('button', { name: 'Zpětná vazba', exact: true });
			await feedback.click();
			await expectParity(page, doc, 'feedback off');
			await feedback.click();

			// Kontrola kurzu, with its own hidden warnings.
			const check = page.getByRole('button', { name: /^Kontrola kurzu:/ });
			await check.click();
			await expect(page.getByRole('complementary', { name: 'Kontrola kurzu' })).toBeVisible();
			await expectParity(page, doc, 'validation panel open');
			const dismiss = page.getByRole('button', { name: 'Skrýt upozornění' }).first();
			if (await dismiss.isVisible()) {
				await dismiss.click();
				await expectParity(page, doc, 'a warning hidden by hand');
			}
			await page
				.getByRole('complementary', { name: 'Kontrola kurzu' })
				.getByRole('button', { name: 'Zavřít' })
				.click();

			// The export review: what it lists is now to be fixed, so the count turns red.
			const chip = await page.locator('[data-screen="topbar.check.chip.text"]').textContent();
			if (squash(chip) !== '0') {
				await page.getByRole('button', { name: 'Stáhnout', exact: true }).click();
				await expect(page.getByRole('dialog')).toBeVisible();
				await expectParity(page, doc, 'export review open');
				await page.keyboard.press('Escape');
				await expect(page.getByRole('dialog')).toBeHidden();
				await expectParity(page, doc, 'after the export review');
			}

			// The tree folded to its rail, with a lesson's and a card's panel peeked.
			await page.getByRole('button', { name: 'Sbalit panel lekcí' }).click();
			await expect(page.locator('.rail-item').first()).toBeVisible();
			await expectParity(page, doc, 'rail');
			await page.locator('.rail-item').first().hover();
			await expect(page.locator('.peek').first()).toBeVisible();
			await expectParity(page, doc, 'rail, lesson panel');
			const tile = page.locator('.rail-tile:not(.missing)').first();
			if (await tile.isVisible()) {
				await tile.hover();
				await expect(page.locator('.peek').first()).toBeVisible();
				await expectParity(page, doc, 'rail, card panel');
			}
		});
	}
}

// ───────────────────────────── the preview with nothing to show ─────────────────────────────

test('the preview says nothing is selected instead of keeping the last card', async ({ page }) => {
	await openEditor(page);
	const received = async () =>
		(await page
			.locator('iframe')
			.elementHandle()
			.then((h) => h!.contentFrame()))!.evaluate(() =>
			(window as unknown as { received: { type: string }[] }).received.map((m) => m.type)
		);
	const empty = page.locator('[data-screen="preview.empty_text"]');

	// A course with a card: the player is given it, and the column has no such line.
	await page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(read('spec-16-course.json')))
	});
	await expect(page.locator('aside.preview')).toHaveAttribute('data-player', 'ready');
	await expect.poll(received).toContain('setBlock');
	await expect(empty).toHaveCount(0);
	await expect
		.poll(async () => ((await modelOf(page)) as { preview: { status: string } }).preview.status)
		.toBe('in_sync');

	// A course with no card at all: the column says so, and the player was cleared.
	const nothing = { ...read('spec-16-course.json'), lessons: [], blocks: [] };
	page.once('dialog', (dialog) => dialog.accept());
	await page.setInputFiles('input[type=file]', {
		name: 'empty.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(nothing))
	});
	await expect(empty).toBeVisible();
	await expect(empty).toHaveText(/Nic není vybráno/);
	await expect.poll(received).toContain('reset');
	await expectParity(page, nothing, 'nothing to preview');
	const model = (await modelOf(page)) as { preview: { status: string; target: unknown } };
	expect(model.preview).toMatchObject({ status: 'empty', target: { kind: 'none' } });

	// Adding a lesson and a card brings the preview back.
	await page.getByRole('button', { name: 'Nová lekce' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: /Zavřít|Hotovo/ })
		.first()
		.click();
	await page.getByRole('button', { name: 'Výklad', exact: true }).click();
	await expect(empty).toHaveCount(0);
});
