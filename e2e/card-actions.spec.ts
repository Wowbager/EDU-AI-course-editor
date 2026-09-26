import { expect, test, type Page, openEditor } from './fixtures';
import { readFileSync } from 'node:fs';

const course = () => JSON.parse(readFileSync(new URL(
	'../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url
), 'utf8'));

async function load(page: Page, doc = course()) {
	// Wait for the initial onMount document, not the SSR file input.
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'card-actions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc))
	});
	// A modified seed course is dirty; keep it explicitly when asked.
	page.on('dialog', (dialog) => dialog.accept());
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('.tree-lesson.open .name')).toHaveText(doc.lessons[0].name);
}

async function exported(page: Page) {
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Stáhnout', exact: true }).click();
	// An orphaned card is a warning, and warnings open the review before the file.
	const anyway = page.getByRole('button', { name: 'Stáhnout i tak' });
	if (await anyway.isVisible()) await anyway.click();
	const stream = await (await pending).createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString());
}

const remove = (page: Page) => page.getByRole('button', { name: 'Odebrat z lekce', exact: true });
const erase = (page: Page) => page.getByRole('button', { name: 'Smazat kartu', exact: true });
const assign = (page: Page) => page.getByRole('button', { name: 'Zařadit do lekce', exact: true });

test('unlinking creates an editable orphan; picker cancels, binds once and undoes', async ({ page }) => {
	const doc = course();
	await load(page, doc);
	await remove(page).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.locator('.orphans .tree-card')).toHaveCount(1);
	await expect(page.locator('.action-notice')).toContainText('Karty mimo lekci');
	await expect(remove(page)).toHaveCount(0);
	await page.getByRole('button', { name: 'Vrátit zpět', exact: true }).click();
	await expect(page.locator('.orphans .tree-card')).toHaveCount(0);
	await remove(page).click();
	await assign(page).click();
	const dialog = page.getByRole('dialog', { name: 'Zařadit do lekce', exact: true });
	await expect(dialog.getByRole('button', { name: 'Zařadit', exact: true })).toBeDisabled();
	await page.keyboard.press('Escape');
	await expect(page.locator('.orphans .tree-card')).toHaveCount(1);
	await assign(page).click();
	await dialog.getByRole('combobox', { name: 'Lekce', exact: true }).selectOption(doc.lessons[0].lesson_id);
	await dialog.getByRole('button', { name: 'Zařadit', exact: true }).click();
	await expect(page.locator('.orphans .tree-card')).toHaveCount(0);
	await expect(assign(page)).toHaveCount(0);
	const result = await exported(page);
	expect(result.blocks).toEqual(doc.blocks);
	expect(result.lessons[0].blocks.filter((b: { block_id: string }) => b.block_id === doc.blocks[0].block_id)).toHaveLength(1);
	await page.getByRole('button', { name: 'Vrátit zpět', exact: true }).click();
	await expect(page.locator('.orphans .tree-card')).toHaveCount(1);
});

test('unlinking a shared and referenced card preserves content, references and other lessons', async ({ page }) => {
	const doc = course();
	const id = doc.blocks[0].block_id;
	doc.lessons.push({ lesson_id: 'OTHER', version: 1, name: 'Další lekce', order: 2, blocks: [{ block_id: id, order: 1 }] });
	doc.blocks[1].learning!.prerequisites = [{ block_id: id, min_level: 1 }];
	doc.blocks[2].steps.find((s: { type: string }) => s.type === 'question').question.options[0].go_to = id;
	await load(page, doc);
	await remove(page).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.locator('.action-notice')).toContainText('Karta zůstává v lekcích (1): „Další lekce“');
	await expect(page.locator('.action-notice')).not.toContainText('Karty mimo lekci');
	const result = await exported(page);
	expect(result.blocks).toEqual(doc.blocks);
	expect(result.lessons[1]).toEqual(doc.lessons[1]);
	expect(result.lessons[0].blocks.map((b: { block_id: string }) => b.block_id)).not.toContain(id);
	await page.getByRole('button', { name: 'Vrátit zpět', exact: true }).click();
	expect((await exported(page)).lessons).toEqual(doc.lessons);
});

for (const orphan of [false, true]) {
	test(`delete always opens RepairDialog (${orphan ? 'unreferenced orphan' : 'bound card'})`, async ({ page }) => {
		await load(page);
		if (orphan) await remove(page).click();
		await erase(page).click();
		const dialog = page.getByRole('dialog', { name: /Smazat kartu/ });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(orphan ? 'Na tuto část nic neodkazuje' : 'tuto kartu obsahuje');
		await dialog.getByRole('button', { name: 'Zpět', exact: true }).click();
		expect((await exported(page)).blocks).toHaveLength(3);
		await erase(page).click();
		await dialog.getByRole('button', { name: 'Smazat a opravit odkazy' }).click();
		expect((await exported(page)).blocks).toHaveLength(2);
	});
}


test('an undo notice cannot undo a later content edit', async ({ page }) => {
	await load(page);
	await remove(page).click();
	await expect(page.locator('.action-notice')).toBeVisible();
	await page.locator('main .card .add-step').getByRole('button', { name: 'Text', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Vrátit zpět', exact: true })).toHaveCount(0);
	await expect(page.locator('.orphans .tree-card')).toHaveCount(1);
});

test('automatic XP explains incomplete steps and keeps the existing arithmetic', async ({ page }) => {
	await openEditor(page);
	const card = page.locator('main .card');
	await expect(card).toContainText('1 XP · automaticky');
	// The explanation is on the chip itself, so it does not take a line on every card.
	const xpChip = card.getByTitle(/8 XP za každý krok s otázkou, 1 XP za obsahový krok/);
	await expect(xpChip).toHaveAttribute('title', /i když je karta ještě rozepsaná/);
	await card.locator('.add-step').getByRole('button', { name: 'Otázka', exact: true }).click();
	await expect(card).toContainText('9 XP · automaticky');
	await card.locator('.add-step').getByRole('button', { name: 'Text', exact: true }).click();
	await expect(card).toContainText('10 XP · automaticky');
	await load(page);
	await expect(card).toContainText('5 XP · vlastní hodnota');
	await card.locator('.add-step').getByRole('button', { name: 'Text', exact: true }).click();
	await expect(card).toContainText('5 XP · vlastní hodnota');
});
