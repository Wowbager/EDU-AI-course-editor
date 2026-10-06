import { describe, expect, it } from 'vitest';
import { storeFor } from '$lib/screen/__tests__/fixtures';
import { createHeadlessContext } from '$lib/agent/context';
import { runTool } from '$lib/agent/handlers';
import { createBrowserContext, revertAiTo } from './agent-context.svelte';
import { MemoryBackend } from './versions/backend';
import { VersionStore } from './versions/version-store.svelte';
import { AiState } from './ai-state.svelte';

const CARD = '$.blocks[block_id=L1_B3_poznej]';

describe('AiState', () => {
	it('asks one question at a time; a new one declines the old', async () => {
		const ai = new AiState();
		const request = { title: 'A', message: 'm', items: ['x'], destructive: true };
		const first = ai.ask(request);
		const second = ai.ask({ ...request, title: 'B' });
		expect(await first).toBe(false);
		ai.confirm?.resolve(true);
		expect(await second).toBe(true);
		expect(ai.confirm).toBeNull();
	});

	it('knows from the status endpoint whether an AI is set up', async () => {
		const reply = (status: number, body: unknown) => async () =>
			new Response(JSON.stringify(body), { status });
		const ai = new AiState();
		await ai.checkStatus(reply(200, { configured: true }));
		expect(ai.configured).toBe(true);
		await ai.checkStatus(reply(200, { configured: false }));
		expect(ai.configured).toBe(false);
		await ai.checkStatus(reply(503, {}));
		expect(ai.configured).toBe(false);
		await ai.checkStatus(async () => {
			throw new Error('offline');
		});
		expect(ai.configured).toBeNull();
	});
});

describe('the ai region', () => {
	it('says the button, the log and the question in the screen model', () => {
		const store = storeFor('corpus/zlomky-5-trida.json');
		expect(store.screen.ai.button).toMatchObject({ label: 'AI asistent', disabled: false });
		expect(store.screen.ai.empty_text).not.toBeNull();
		store.ai.configured = false;
		expect(store.screen.ai.button).toMatchObject({ label: 'AI není nastavena', disabled: true });
		expect(store.screen.ai.status_text).toBe('AI není nastavena');
		store.ai.addLine('user', 'Ahoj');
		expect(store.screen.ai.messages_count).toBe(1);
		expect(store.screen.ai.empty_text).toBeNull();
		void store.ai.ask({ title: 'T', message: 'M', items: ['i'], destructive: false });
		expect(store.screen.ai.confirm).toEqual({
			title: 'T',
			message: 'M',
			items: ['i'],
			destructive: false
		});
	});
});

describe('the bubbles', () => {
	it('say the text without the blank lines the model leaves around it', () => {
		// A reply that goes on to call a tool ends in "\n\n"; pre-wrap would draw them as space.
		const store = storeFor('corpus/zlomky-5-trida.json');
		store.ai.addLine('assistant', '\nPodívám se na to.\n\n');
		expect(store.screen.ai.messages[0].text).toBe('Podívám se na to.');
	});
});

describe('the browser context', () => {
	it('confirm is the dialog, and show_in_preview moves the preview', async () => {
		const store = storeFor('corpus/zlomky-5-trida.json');
		const ctx = createBrowserContext(store, new VersionStore([new MemoryBackend()]));
		const asked = ctx.confirm({ title: 'T', message: 'M', items: [], destructive: true });
		expect(store.ai.confirm?.request.title).toBe('T');
		store.ai.confirm?.resolve(true);
		expect(await asked).toBe(true);
		const result = await runTool('show_in_preview', { path: CARD, view: 'play' }, ctx);
		expect(result.ok).toBe(true);
		expect(store.preview.view).toBe('play');
	});

	it('saves "Před úpravami AI" only when the course differs from the last saved version', async () => {
		const store = storeFor('corpus/zlomky-5-trida.json');
		const versions = new VersionStore([new MemoryBackend()]);
		await versions.load(store.doc.course_id);
		const ctx = createBrowserContext(store, versions);
		await versions.save(store.source, 'Uloženo');
		store.dirty = true;
		const write = (value: string) =>
			runTool('set_field', { expected_revision: store.revision, path: `${CARD}.name`, value }, ctx);
		// The course equals the newest version: nothing to protect, nothing saved.
		await write('A');
		await new Promise((r) => setTimeout(r, 0));
		expect(versions.versions.map((v) => v.note)).toEqual(['Uloženo']);

		// A fresh session on a course with unsaved work saves one version, once.
		store.endAiSession();
		await write('B');
		await new Promise((r) => setTimeout(r, 10));
		expect(versions.versions.map((v) => v.note)).toEqual(['Uloženo', 'Před úpravami AI']);
		await write('C');
		await new Promise((r) => setTimeout(r, 10));
		expect(versions.versions).toHaveLength(2);
	});

	it('"Vrátit až sem" undoes the later AI changes and stops at the teacher\'s own', async () => {
		const store = storeFor('corpus/zlomky-5-trida.json');
		const ctx = createHeadlessContext(store, { confirm: () => true });
		const rename = (value: string) =>
			runTool('set_field', { expected_revision: store.revision, path: `${CARD}.name`, value }, ctx);
		await rename('A');
		await rename('B');
		await rename('C');
		const [first, second] = store.aiActions;
		const name = () => store.doc.blocks.find((b) => b.block_id === 'L1_B3_poznej')?.name;
		expect(revertAiTo(store, second.actionId)).toEqual({ undone: 1, reached: true });
		expect(name()).toBe('B');
		expect(store.aiActions.map((a) => a.undone)).toEqual([false, false, true]);
		expect(revertAiTo(store, first.actionId)).toEqual({ undone: 1, reached: true });
		expect(name()).toBe('A');
		// Already undone: nothing to do.
		expect(revertAiTo(store, store.aiActions[2].actionId)).toEqual({ undone: 0, reached: false });
	});
});
