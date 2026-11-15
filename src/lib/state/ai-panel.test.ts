import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocStore } from './doc-store.svelte';
import { aiPanel } from './ai-panel.svelte';
import { addBlock, addLesson } from '$lib/domain/commands';
import { emptyCourse } from '$lib/domain/document';
import { buildOutlineRequest, setCardTick, type Outline } from '$lib/domain/outline';
import { fakeCard, fakeOutline } from '$lib/server/ai/fake';
import type { GenRequest } from '$lib/domain/authoring';

vi.mock('$lib/state/versions/server', () => ({ workspaceKey: () => 'k'.repeat(43) }));

function setup() {
	const store = new DocStore();
	let doc = addLesson(emptyCourse('KURZ', 'Zlomky'), 'Polovina').doc;
	const lessonId = doc.lessons[0].lesson_id;
	const added = addBlock(doc, lessonId, 'display');
	store.load(added.doc);
	return { store, lessonId, blockId: added.ref!.blockId! };
}

/** The fake provider behind `fetch`, with the requests it saw. */
function server() {
	const seen: { route: string; body: any }[] = [];
	const fetcher = vi.fn(async (route: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		seen.push({ route, body });
		if (route === '/ai/outline') return Response.json({ status: 'ok', outline: fakeOutline(body) });
		return Response.json({ status: 'ok', card: fakeCard(body as GenRequest) });
	});
	vi.stubGlobal('fetch', fetcher);
	return seen;
}

const done = async () => {
	while (aiPanel.queue.writing) await new Promise((r) => setTimeout(r, 2));
};

afterEach(() => {
	vi.unstubAllGlobals();
	aiPanel.discard();
	aiPanel.queue.clear();
});

describe('the AI panel state', () => {
	it('asks for a proposal with the selected lesson, and shows it all ticked', async () => {
		const { store, lessonId, blockId } = setup();
		const seen = server();
		store.selection = { lessonId, blockId };
		await aiPanel.send(store, 'Dej mi karty');
		expect(seen).toHaveLength(1);
		expect(seen[0].body.target).toEqual({ lesson: 'Polovina', lessons: 1 });
		expect(aiPanel.draft?.scope).toBe('cards');
		expect(aiPanel.draft?.lessons[0].cards.every((c) => c.on)).toBe(true);
		expect(aiPanel.last).toBe('Dej mi karty');
		// Nothing is in the course yet.
		expect(store.doc.blocks).toHaveLength(1);
	});

	it('a change is sent with the edited proposal and replaces it, keeping the ticks of kept cards', async () => {
		const { store } = setup();
		const seen = server();
		await aiPanel.send(store, 'Kurz o zlomcích');
		const first = aiPanel.draft!;
		aiPanel.draft = setCardTick(first, first.lessons[0].cards[1].key, false);
		await aiPanel.send(store, 'přidej kvíz');
		expect(seen[1].body.current.scope).toBe('lessons');
		expect(seen[1].body.original).toBe('Kurz o zlomcích');
		expect(JSON.stringify(aiPanel.draft)).toContain('Změna: přidej kvíz');
		const cards = aiPanel.draft!.lessons[0].cards;
		expect(cards.map((c) => c.on)).toEqual([true, false, true]);
	});

	it('a failed request leaves the proposal as it was and says so', async () => {
		const { store } = setup();
		server();
		await aiPanel.send(store, 'Kurz o zlomcích');
		const before = aiPanel.draft;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('x', { status: 502 }))
		);
		await aiPanel.send(store, 'změň to');
		expect(aiPanel.draft).toBe(before);
		expect(aiPanel.problem).not.toBe('');
		expect(aiPanel.asking).toBe(false);
	});

	it('discard clears the proposal and ignores an answer still on its way', async () => {
		const { store } = setup();
		let release!: (r: Response) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>((r) => (release = r)))
		);
		const pending = aiPanel.send(store, 'Kurz');
		aiPanel.discard();
		release(
			Response.json({
				status: 'ok',
				outline: fakeOutline(buildOutlineRequest(store.doc, null, 'Kurz'))
			})
		);
		await pending;
		expect(aiPanel.draft).toBeNull();
		expect(aiPanel.last).toBe('');
	});

	it('creating inserts the ticked cards as one undo step and writes each of them, nothing else changing', async () => {
		const { store, lessonId, blockId } = setup();
		server();
		store.selection = { lessonId, blockId };
		await aiPanel.send(store, 'Dej mi karty');
		const draft = aiPanel.draft!;
		aiPanel.draft = setCardTick(draft, draft.lessons[0].cards[2].key, false);
		const before = store.undoStack.length;
		aiPanel.create(store);
		expect(aiPanel.draft).toBeNull();
		expect(store.undoStack.length).toBe(before + 1);
		expect(store.doc.blocks).toHaveLength(3);
		expect(store.selection).toEqual({ lessonId, blockId });
		await done();
		expect(aiPanel.queue.rows.map((r) => r.state)).toEqual(['done', 'done']);
		// Each written card is its own undo step.
		expect(store.undoStack.length).toBe(before + 3);
		const names = store.doc.blocks.map((b) => b.name);
		expect(names).toEqual([undefined, 'Příklady k procvičení', 'Kvíz na závěr']);
		expect(store.doc.blocks[1].steps.length).toBeGreaterThan(1);
		// The teacher's own card was not written.
		expect(store.doc.blocks[0].steps).toHaveLength(1);
	});

	it('undoing the insert after the cards are written takes the cards back one step at a time', async () => {
		const { store, lessonId } = setup();
		server();
		store.selection = { lessonId };
		await aiPanel.send(store, 'Dej mi karty');
		aiPanel.create(store);
		await done();
		for (let i = 0; i < 4; i++) store.undo();
		expect(store.doc.blocks).toHaveLength(1);
	});
});

describe('creating when the selection has gone', () => {
	it('puts the cards at the end of the course instead of failing, with one undo step', async () => {
		const { store, lessonId, blockId } = setup();
		server();
		await aiPanel.send(store, 'Kurz o zlomcích');
		// The selected lesson and card are not in the course any more.
		store.selection = { lessonId: 'L99', blockId: 'L99_B1' };
		const before = store.undoStack.length;
		aiPanel.create(store);
		expect(aiPanel.draft).toBeNull();
		expect(aiPanel.problem).toBe('');
		expect(store.undoStack.length).toBe(before + 1);
		expect(store.doc.lessons.map((l) => l.name).slice(-2)).toEqual(['První lekce', 'Druhá lekce']);
		expect(store.doc.lessons[0].lesson_id).toBe(lessonId);
		expect(blockId).toBeDefined();
		await done();
	});
});

describe('buildOutlineRequest', () => {
	it('names the target by lesson and card, anchors the dossier, and sends the audience', () => {
		const { store, lessonId, blockId } = setup();
		const request = buildOutlineRequest(store.doc, { lessonId, blockId }, '  Kurz  ');
		expect(request.prompt).toBe('Kurz');
		expect(request.target).toEqual({ lesson: 'Polovina', lessons: 1 });
		expect(request.context).toContain('Zlomky');
		const none = buildOutlineRequest(store.doc, null, 'Kurz');
		expect(none.target).toEqual({ lessons: 1 });
		const outline: Outline = fakeOutline(none);
		const change = buildOutlineRequest(store.doc, null, 'Změň', {
			current: outline,
			original: 'Kurz'
		});
		expect(change.current).toEqual(outline);
		expect(change.original).toBe('Kurz');
	});
});
