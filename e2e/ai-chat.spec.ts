import { expect, test, openEditor, type Page } from './fixtures';
import { readFileSync } from 'node:fs';

/**
 * The AI assistant's drawer, against a scripted server.
 *
 * `/ai/chat` is replaced by a script of turns (text, tool calls, done), sent as the
 * server-sent events the real route sends, so the suite needs no key and no network.
 * What it checks is everything on the editor's side of the line: the loop runs the
 * tools through the real tool layer, a change shows on screen and in the model the AI
 * reads back, one Zpět takes it away, a delete asks first and "Nepovolit" changes
 * nothing, Zastavit ends the loop, and "Vrátit změny AI" gives the course back.
 */
const course = () =>
	JSON.parse(
		readFileSync(
			new URL('../src/lib/domain/__tests__/fixtures/spec-16-course.json', import.meta.url),
			'utf8'
		)
	);

const CARD = '$.blocks[block_id=L1_B1_uvod]';
const STEP = `${CARD}.steps[id=s1]`;

type Call = { name: string; arguments: Record<string, unknown> };
/** A turn: what the "model" says, and the tools it calls. `$rev` is the revision it last read. */
type Turn = { text?: string; calls?: Call[]; hold?: Promise<void> };
type Message = {
	role: string;
	content?: string;
	toolCallId?: string;
	toolCalls?: { id: string }[];
};

interface Chat {
	/** Every POST body, in order. */
	requests: Message[][];
	/** Tool results the page sent back, parsed, by tool name. */
	results(name: string): Record<string, any>[];
}

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function sse(turn: Turn, n: number, revision: number): string {
	const calls = (turn.calls ?? []).map((c, i) => ({
		id: `call_${n}_${i}`,
		name: c.name,
		arguments: JSON.stringify(c.arguments).replace('"$rev"', String(revision))
	}));
	const events: unknown[] = [];
	if (turn.text) events.push({ type: 'text_delta', text: turn.text });
	events.push({
		type: 'done',
		finishReason: calls.length > 0 ? 'tool_calls' : 'stop',
		assistant: { role: 'assistant', text: turn.text ?? '', toolCalls: calls },
		usage
	});
	return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/** The newest `revision` a tool result carried: what a model that read last would use. */
function lastRevision(messages: Message[]): number {
	for (const m of [...messages].reverse()) {
		if (m.role !== 'tool') continue;
		const found = /"revision":(\d+)/.exec(m.content ?? '');
		if (found) return Number(found[1]);
	}
	return 0;
}

async function scripted(page: Page, turns: Turn[], configured = true): Promise<Chat> {
	const requests: Message[][] = [];
	await page.route('**/ai/chat', async (route) => {
		const request = route.request();
		if (request.method() === 'GET') {
			return route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({ configured })
			});
		}
		const { messages } = request.postDataJSON() as { messages: Message[] };
		const n = requests.push(messages);
		const turn = turns[Math.min(n - 1, turns.length - 1)];
		if (turn.hold) await turn.hold;
		await route.fulfill({
			contentType: 'text/event-stream',
			body: sse(turn, n, lastRevision(messages))
		});
	});
	return {
		requests,
		results: (name) => {
			const out: Record<string, any>[] = [];
			for (const messages of requests.slice(-1)) {
				const ids = new Map<string, string>();
				for (const m of messages) {
					for (const c of (m as any).toolCalls ?? []) ids.set(c.id, (c as any).name);
					if (m.role === 'tool' && ids.get(m.toolCallId!) === name)
						out.push(JSON.parse(m.content!));
				}
			}
			return out;
		}
	};
}

async function load(page: Page) {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'ai-chat.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(course()))
	});
	await expect(page.locator('.tree-lesson.open .name')).toHaveText(course().lessons[0].name);
}

const openPanel = async (page: Page) => {
	await page.getByRole('button', { name: 'AI asistent' }).click();
	return page.getByRole('complementary', { name: 'AI asistent' });
};

async function ask(panel: ReturnType<Page['getByRole']>, text: string) {
	await panel.getByRole('textbox', { name: 'Zpráva asistentovi' }).fill(text);
	await panel.getByRole('button', { name: 'Odeslat' }).click();
}

const screenOf = (page: Page) => page.evaluate(() => window.__screen!.all());
const firstCardName = async (page: Page) => (await screenOf(page)).tree.lessons[0].cards[0].name;

test.describe('AI asistent', () => {
	test('a set_field call changes the card, the AI reads back what the screen says, Ctrl+Z undoes it', async ({
		page
	}) => {
		const NEW_TEXT = 'Zlomek je část celku, třeba půlka pizzy.';
		const chat = await scripted(page, [
			{ calls: [{ name: 'get_outline', arguments: { lesson: null } }] },
			{
				calls: [
					{
						name: 'set_field',
						arguments: { expected_revision: '$rev', path: `${STEP}.content`, value: NEW_TEXT }
					}
				]
			},
			{ calls: [{ name: 'get_outline', arguments: { lesson: null } }] },
			{ text: 'Úvodní text jsem zjednodušil.' }
		]);
		await load(page);
		expect(await firstCardName(page)).toContain('Zlomek');
		const panel = await openPanel(page);
		await ask(panel, 'Zjednoduš úvodní text');

		await expect(panel.getByText('Úvodní text jsem zjednodušil.')).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Odeslat' })).toBeVisible();
		expect(await firstCardName(page)).toContain('půlka pizzy');
		await expect(panel.getByRole('region', { name: 'Změny asistenta' })).toContainText('Změněno');

		// What the AI read after its edit is what the page shows: the same tree, verbatim.
		const [outline] = chat.results('get_outline').slice(-1);
		const tree = (await screenOf(page)).tree;
		expect(outline.ok).toBe(true);
		expect(outline.data.slice).toEqual(tree);
		const [write] = chat.results('set_field');
		expect(write.ok).toBe(true);
		expect(write.data.changed).toBe(true);

		// Every word the drawer shows from the model is the model's: its own parity check.
		const drawn = await page.evaluate(() => {
			const model = window.__screen!.all() as unknown as Record<string, unknown>;
			return [...document.querySelectorAll('[data-screen^="ai."]')].map((el) => {
				let node: unknown = model;
				for (const part of el.getAttribute('data-screen')!.match(/[^.[\]]+/g) ?? [])
					node = (node as Record<string, unknown> | undefined)?.[part];
				return { shown: el.textContent!.trim(), model: String(node).trim() };
			});
		});
		expect(drawn.length).toBeGreaterThan(4);
		for (const { shown, model } of drawn) expect(shown).toBe(model);

		// One Zpět takes the whole action back.
		await page.locator('main.editor').click({ position: { x: 5, y: 5 } });
		await page.keyboard.press('Control+z');
		await expect.poll(() => firstCardName(page)).not.toContain('půlka pizzy');
		expect(await firstCardName(page)).toContain('Zlomek');
	});

	test('the message box keeps its own Ctrl+Z', async ({ page }) => {
		await scripted(page, [{ text: 'Ok.' }]);
		await load(page);
		const panel = await openPanel(page);
		const box = panel.getByRole('textbox', { name: 'Zpráva asistentovi' });
		await box.fill('něco');
		const before = await firstCardName(page);
		await box.press('Control+z');
		expect(await firstCardName(page)).toBe(before);
	});

	test('a delete asks in Czech first, and Nepovolit changes nothing', async ({ page }) => {
		const chat = await scripted(page, [
			{ calls: [{ name: 'get_outline', arguments: { lesson: null } }] },
			{
				calls: [
					{
						name: 'delete',
						arguments: {
							expected_revision: '$rev',
							path: '$.blocks[block_id=L1_B3_poznej]',
							repairs: []
						}
					}
				]
			},
			{ text: 'Rozumím, nic jsem nemazal.' }
		]);
		await load(page);
		const before = JSON.stringify((await screenOf(page)).tree);
		const panel = await openPanel(page);
		await ask(panel, 'Smaž poslední kartu');

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Povolit', exact: true })).toBeVisible();
		await expect(dialog.getByRole('listitem').first()).toBeVisible();
		await dialog.getByRole('button', { name: 'Nepovolit' }).click();

		await expect(panel.getByText('Rozumím, nic jsem nemazal.')).toBeVisible();
		expect(JSON.stringify((await screenOf(page)).tree)).toBe(before);
		const [deleted] = chat.results('delete');
		expect(deleted.ok).toBe(false);
		expect(deleted.error.code).toBe('declined');
		await expect(panel.getByRole('region', { name: 'Změny asistenta' })).toHaveCount(0);
	});

	test('Zastavit ends the loop: nothing is asked of the model after it', async ({ page }) => {
		let release!: () => void;
		const hold = new Promise<void>((resolve) => (release = resolve));
		const chat = await scripted(page, [
			{ calls: [{ name: 'get_outline', arguments: { lesson: null } }] },
			{ calls: [{ name: 'get_outline', arguments: { lesson: null } }], hold },
			{ text: 'To by už nemělo přijít.' }
		]);
		await load(page);
		const panel = await openPanel(page);
		await ask(panel, 'Projdi kurz');
		await expect(panel.getByRole('button', { name: 'Zastavit' })).toBeVisible();
		await expect.poll(() => chat.requests.length).toBe(2);
		await panel.getByRole('button', { name: 'Zastavit' }).click();
		await expect(panel.getByRole('button', { name: 'Odeslat' })).toBeVisible();
		await expect(panel.getByText('Zastaveno.')).toBeVisible();
		release();
		// The held answer, had it arrived, would have been a third request or a bubble.
		await expect(panel.getByText('To by už nemělo přijít.')).toHaveCount(0);
		expect(chat.requests).toHaveLength(2);
	});

	test('Vrátit změny AI asks, and gives the course back', async ({ page }) => {
		await scripted(page, [
			{ calls: [{ name: 'get_outline', arguments: { lesson: null } }] },
			{
				calls: [
					{
						name: 'set_field',
						arguments: { expected_revision: '$rev', path: `${STEP}.content`, value: 'První změna.' }
					}
				]
			},
			{
				calls: [
					{
						name: 'set_field',
						arguments: { expected_revision: '$rev', path: `${STEP}.content`, value: 'Druhá změna.' }
					}
				]
			},
			{ text: 'Hotovo.' }
		]);
		await load(page);
		const start = JSON.stringify((await screenOf(page)).tree);
		const panel = await openPanel(page);
		await ask(panel, 'Dvakrát to přepiš');
		await expect(panel.getByText('Hotovo.')).toBeVisible();
		expect(await firstCardName(page)).toContain('Druhá změna');
		await expect(panel.getByRole('listitem')).toHaveCount(2);

		// "Vrátit až sem" on the first change takes the second one back.
		await panel.getByRole('button', { name: 'Vrátit až sem' }).first().click();
		expect(await firstCardName(page)).toContain('První změna');

		await panel.getByRole('button', { name: 'Vrátit změny AI' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Povolit', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		expect(JSON.stringify((await screenOf(page)).tree)).toBe(start);
		expect(await firstCardName(page)).toContain('Zlomek');
		await expect(panel.getByRole('region', { name: 'Změny asistenta' })).toHaveCount(0);
	});

	test('without an AI on the server the button says so and cannot be used', async ({ page }) => {
		await scripted(page, [{ text: 'x' }], false);
		await load(page);
		const button = page.getByRole('button', { name: 'AI není nastavena' });
		await expect(button).toBeVisible();
		await expect(button).toBeDisabled();
		await expect(page.getByRole('complementary', { name: 'AI asistent' })).toHaveCount(0);
		expect((await screenOf(page)).ai.configured).toBe(false);
	});

	test('a server that refuses shows its Czech message in the conversation', async ({ page }) => {
		await page.route('**/ai/chat', (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ contentType: 'application/json', body: '{"configured":true}' })
				: route.fulfill({
						status: 429,
						contentType: 'application/json',
						body: JSON.stringify({
							message: 'Denní limit AI je vyčerpán. Zkus to zítra.',
							code: 'budget'
						})
					})
		);
		await load(page);
		const panel = await openPanel(page);
		await ask(panel, 'Ahoj');
		await expect(panel.getByText('Denní limit AI je vyčerpán. Zkus to zítra.')).toBeVisible();
	});
});
