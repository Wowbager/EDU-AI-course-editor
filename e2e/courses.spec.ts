import { readFileSync } from 'node:fs';
import { expect, openEditor, test, OPEN_COURSE_KEY, DRAFT_PREFIX, type Page } from './fixtures';

/**
 * „Moje kurzy“: more than one course in the editor, without losing work. The
 * switcher is the chevron beside the course name; switching flushes the course
 * being left and opens the target's own draft, so nothing is replaced and nothing
 * asks. A file arrives as a course of its own, or updates the one it belongs to.
 */

const fixture = readFileSync(
	new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url)
);

const saved = (page: Page) =>
	page.getByRole('button', { name: /^Koncept uložen v tomto prohlížeči\./ });
const paused = (page: Page) => page.getByRole('button', { name: /^Ukládání pozastaveno\./ });
const name = (page: Page) => page.getByRole('textbox', { name: 'Název kurzu', exact: true });
const switcher = (page: Page) => page.getByRole('button', { name: 'Moje kurzy', exact: true });
const box = (page: Page) => page.getByRole('dialog', { name: 'Moje kurzy' });
const row = (page: Page, course: RegExp) => box(page).getByRole('button', { name: course });

const importFixture = (page: Page) =>
	page.setInputFiles('input[type=file]', {
		name: 'course.json',
		mimeType: 'application/json',
		buffer: fixture
	});

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('the switcher is quiet until the teacher goes to the name', async ({ page }) => {
	await expect(switcher(page)).toHaveCSS('opacity', '0');
	await name(page).hover();
	await expect(switcher(page)).toHaveCSS('opacity', '1');
});

test('two courses keep their own work when switching', async ({ page }) => {
	await name(page).fill('Zlomky');
	await expect(saved(page)).toBeVisible();

	await switcher(page).click();
	await box(page).getByRole('button', { name: 'Nový kurz', exact: true }).click();
	await expect(name(page)).toHaveValue('Nový kurz');
	// A new course is named right away: the title has the focus.
	await expect(name(page)).toBeFocused();
	await name(page).fill('Rovnice');
	await expect(saved(page)).toBeVisible();

	await switcher(page).click();
	await row(page, /Zlomky/).click();
	await expect(name(page)).toHaveValue('Zlomky');

	await switcher(page).click();
	await row(page, /Rovnice/).click();
	await expect(name(page)).toHaveValue('Rovnice');

	// A reload opens the course that was open last, and both are still listed.
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(name(page)).toHaveValue('Rovnice');
	await switcher(page).click();
	await expect(row(page, /Zlomky/)).toBeVisible();
	await expect(row(page, /Rovnice/)).toHaveAttribute('aria-current', 'true');
});

test('a file arrives as a course of its own; the same file again updates it', async ({ page }) => {
	await name(page).fill('První');
	await expect(saved(page)).toBeVisible();
	let asked = false;
	page.on('dialog', (dialog) => {
		asked = true;
		void dialog.dismiss();
	});

	await importFixture(page);
	await expect(name(page)).toHaveValue('Zlomky pro 5. třídu');
	expect(asked).toBe(false);
	await expect(saved(page)).toBeVisible();

	// The first course is intact, one click away.
	await switcher(page).click();
	await expect(row(page, /První/)).toBeVisible();
	await row(page, /První/).click();
	await expect(name(page)).toHaveValue('První');

	// The same file again: it opens its course and updates it as one undoable edit.
	await importFixture(page);
	await expect(name(page)).toHaveValue('Zlomky pro 5. třídu');
	expect(asked).toBe(false);
	await expect(page.getByRole('button', { name: 'Vrátit', exact: true })).toBeEnabled();
	await expect(saved(page)).toBeVisible();
});

test('two tabs on two courses save independently', async ({ page, context }) => {
	await name(page).fill('Kurz A');
	await expect(saved(page)).toBeVisible();

	const other = await context.newPage();
	await openEditor(other);
	// The second tab opens the same course; a new one there is its own.
	await switcher(other).click();
	await box(other).getByRole('button', { name: 'Nový kurz', exact: true }).click();
	await name(other).fill('Kurz B');
	await expect(saved(other)).toBeVisible();

	// The first tab keeps saving its course; neither tab pauses the other.
	await name(page).fill('Kurz A2');
	await expect(saved(page)).toBeVisible();
	await expect(paused(page)).toHaveCount(0);
	await expect(paused(other)).toHaveCount(0);

	const keys = await page.evaluate(
		(prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)),
		DRAFT_PREFIX
	);
	expect(keys).toHaveLength(2);
});

test('a draft evicted from localStorage opens from the durable copy', async ({ page }) => {
	await name(page).fill('Zálohovaný');
	await expect(saved(page)).toBeVisible();

	// Move to a second course, so the first one can be evicted while closed.
	await switcher(page).click();
	await box(page).getByRole('button', { name: 'Nový kurz', exact: true }).click();
	await name(page).fill('Druhý');
	await expect(saved(page)).toBeVisible();

	// The durable copy of the first course has landed in IndexedDB.
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					new Promise<boolean>((resolve) => {
						const request = indexedDB.open('edu-editor-drafts', 1);
						request.onsuccess = () => {
							const db = request.result;
							const all = db.transaction('drafts').objectStore('drafts').getAll();
							all.onsuccess = () => {
								resolve((all.result as unknown[]).length > 0);
								db.close();
							};
							all.onerror = () => {
								resolve(false);
								db.close();
							};
						};
						request.onerror = () => resolve(false);
					})
			)
		)
		.toBe(true);

	// Evict every draft key but the open course's — the quota eviction's shape.
	await page.evaluate(
		([open, prefix]) => {
			const id = localStorage.getItem(open);
			for (const key of Object.keys(localStorage))
				if (key.startsWith(prefix) && key !== prefix + id) localStorage.removeItem(key);
		},
		[OPEN_COURSE_KEY, DRAFT_PREFIX]
	);

	await switcher(page).click();
	await row(page, /Zálohovaný/).click();
	await expect(name(page)).toHaveValue('Zálohovaný');
	await expect(saved(page)).toBeVisible();
});
