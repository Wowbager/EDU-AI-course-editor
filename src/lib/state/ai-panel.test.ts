import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocStore } from './doc-store.svelte';
import { aiPanel, FROM_MATERIALS } from './ai-panel.svelte';
import { materials } from './materials.svelte';
import { addBlock, addLesson } from '$lib/domain/commands';
import { emptyCourse } from '$lib/domain/document';
import {
	addDraftCard,
	buildOutlineRequest,
	renameDraftCard,
	renameDraftLesson,
	setCardTick,
	toOutline,
	type Outline
} from '$lib/domain/outline';
import { fakeChat, fakeOutline, FAKE_REASONING } from '$lib/server/ai/fake';
import { lessonEvents, makePlan } from '$lib/server/ai/lesson';
import { BRIEF_KEY, REQUEST_KEY, sourceRefsOf } from '$lib/domain/authoring';

vi.mock('$lib/state/versions/server', () => ({ workspaceKey: () => 'k'.repeat(43) }));

let courses = 0;
/**
 * A course with one lesson and one card. Its id is new every time: the panel keeps the plan
 * of a course in memory, so a plan must not leak from one test to the next.
 */
function setup(id = `KURZ${++courses}`) {
	const store = new DocStore();
	// The panel is on this course, as it is in the app (`planning` is reset only there).
	aiPanel.follow(id);
	let doc = addLesson(emptyCourse(id, 'Zlomky'), 'Polovina').doc;
	const lessonId = doc.lessons[0].lesson_id;
	const added = addBlock(doc, lessonId, 'display');
	store.load(added.doc);
	return { store, lessonId, blockId: added.ref!.blockId! };
}

/** An outline as the route streams it: the scope, a lesson or card per line, done. */
function stream(outline: Outline, ending: unknown = { type: 'done' }): Response {
	const items = outline.scope === 'cards' ? outline.cards : outline.lessons;
	const events = [
		{ type: 'scope', scope: outline.scope },
		...items.map((item) => ({
			type: outline.scope === 'cards' ? 'card' : 'lesson',
			[outline.scope === 'cards' ? 'card' : 'lesson']: item
		})),
		ending
	];
	return new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(''));
}

const ndjson = (events: unknown[]) =>
	new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(''));

/**
 * What the real server answers to a route that holds a conversation with the model, with
 * the fake provider behind it. `undefined` for a route that is not one of them.
 */
async function answerAi(route: string, body: any): Promise<Response | undefined> {
	if (route === '/ai/outline') return stream(fakeOutline(body));
	if (route === '/ai/lesson') {
		const events: unknown[] = [];
		for await (const e of lessonEvents(body, fakeChat)) events.push(e);
		return ndjson(events);
	}
	if (route === '/ai/plan') return ndjson([await makePlan(body, fakeChat)]);
	return undefined;
}

type Seen = { route: string; body: any };

/** The events the real lesson route would send for `body`. */
async function answerLesson(body: any): Promise<any[]> {
	const events: any[] = [];
	for await (const e of lessonEvents(body, fakeChat)) events.push(e);
	return events;
}

/**
 * The fake provider behind `fetch`, with the requests it saw. `plan`: `'fail'` answers
 * /ai/plan with a 500; `'hold'` keeps it pending until `release()`.
 */
function server(options: { plan?: 'fail' | 'hold' } = {}) {
	const seen: Seen[] & { release: () => void } = Object.assign([] as Seen[], {
		release: () => {}
	});
	const held = new Promise<void>((resolve) => (seen.release = resolve));
	const fetcher = vi.fn(async (route: string, init?: RequestInit) => {
		if (init?.body === undefined) {
			// The course's materials, and whether AI is on offer.
			return route === '/ai/block'
				? Response.json({ configured: true })
				: Response.json({ files: [] });
		}
		const body = JSON.parse(String(init.body));
		seen.push({ route, body });
		if (route === '/ai/plan') {
			if (options.plan === 'fail') return new Response('x', { status: 500 });
			if (options.plan === 'hold') await held;
		}
		return (await answerAi(route, body)) ?? Response.json({ status: 'ok', cards: [] });
	});
	vi.stubGlobal('fetch', fetcher);
	return seen;
}

const routes = (seen: Seen[]) => seen.map((s) => s.route);
const only = (seen: Seen[], route: string) => seen.filter((s) => s.route === route);

const done = async () => {
	while (aiPanel.queue.writing) await new Promise((r) => setTimeout(r, 2));
};

afterEach(() => {
	vi.unstubAllGlobals();
	aiPanel.discard();
	aiPanel.forget();
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
		release(stream(fakeOutline(buildOutlineRequest(store.doc, null, 'Kurz'))));
		await pending;
		expect(aiPanel.draft).toBeNull();
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

describe('planning before writing, and a lesson per request', () => {
	/** Cards for the selected lesson, accepted. */
	async function accept(store: DocStore, lessonId: string, prompt = 'Dej mi karty') {
		store.selection = { lessonId };
		await aiPanel.send(store, prompt);
		aiPanel.create(store);
	}

	it('asks /ai/plan once, before any lesson is written', async () => {
		const { store, lessonId } = setup();
		const seen = server();
		await accept(store, lessonId, 'Kurz o zlomcích');
		await done();
		expect(only(seen, '/ai/plan')).toHaveLength(1);
		expect(only(seen, '/ai/lesson').length).toBeGreaterThan(1);
		const rest = routes(seen).slice(routes(seen).indexOf('/ai/plan'));
		expect(routes(seen).indexOf('/ai/plan')).toBeLessThan(routes(seen).indexOf('/ai/lesson'));
		expect(rest.filter((r) => r === '/ai/plan')).toHaveLength(1);
		// The plan is for the new cards, by lesson.
		const request = only(seen, '/ai/plan')[0].body;
		expect(request.schema).toBe('eduai.plan-request/1');
		expect(request.lessons.map((l: { name: string }) => l.name)).toEqual([
			'První lekce',
			'Druhá lekce'
		]);
	});

	it('hands the plan and the model\u2019s turn back, unchanged, with every lesson', async () => {
		const { store, lessonId } = setup();
		const seen = server();
		await accept(store, lessonId, 'Kurz o zlomcích');
		await done();
		const lessons = only(seen, '/ai/lesson');
		expect(lessons).toHaveLength(2);
		for (const { body } of lessons) {
			expect(body.plan.request).toEqual(only(seen, '/ai/plan')[0].body);
			expect(body.plan.turn.reasoning_details).toEqual(FAKE_REASONING);
			expect(body.plan.turn.role).toBe('assistant');
			expect(body.plan.turn.tool_calls[0].function.name).toBe('save_plan');
			// Each card knows its number in the plan.
			expect(body.cards.every((c: { plan_card?: number }) => c.plan_card !== undefined)).toBe(true);
		}
	});

	it('sends a lesson\u2019s cards in one request, in course order, a request per lesson', async () => {
		const { store, lessonId } = setup();
		const seen = server();
		await accept(store, lessonId, 'Kurz o zlomcích');
		await done();
		const byLesson = new Map(
			only(seen, '/ai/lesson').map(({ body }) => [
				body.lesson.name as string,
				body.cards.map((c: { title: string }) => c.title)
			])
		);
		expect(byLesson.get('První lekce')).toEqual(['Co to je', 'Procvičení', 'Ověření']);
		expect(byLesson.get('Druhá lekce')).toEqual(['Jak se to používá', 'Úlohy']);
		expect(aiPanel.queue.rows.every((r) => r.state === 'done')).toBe(true);
		for (const row of aiPanel.queue.rows)
			expect(
				store.doc.blocks.find((b) => b.block_id === row.blockId)!.steps.length
			).toBeGreaterThan(1);
	});

	it('the plan is not asked again for cards of the same batch written later', async () => {
		const { store, lessonId } = setup();
		const seen = server();
		await accept(store, lessonId);
		await done();
		expect(only(seen, '/ai/plan')).toHaveLength(1);
	});

	it('is planning while /ai/plan is pending, and not after', async () => {
		const { store, lessonId } = setup();
		const seen = server({ plan: 'hold' });
		expect(aiPanel.planning).toBe(false);
		await accept(store, lessonId);
		await new Promise((r) => setTimeout(r, 5));
		expect(aiPanel.planning).toBe(true);
		expect(only(seen, '/ai/plan')).toHaveLength(1);
		// The cards wait for it.
		expect(only(seen, '/ai/lesson')).toHaveLength(0);
		expect(aiPanel.queue.rows.map((r) => r.state)).toEqual(['waiting', 'waiting', 'waiting']);
		seen.release();
		await done();
		expect(aiPanel.planning).toBe(false);
		expect(aiPanel.queue.rows.every((r) => r.state === 'done')).toBe(true);
	});

	it('puts the plan in the document only where nothing is written, and keeps what the teacher typed', async () => {
		const { store, lessonId } = setup();
		const seen = server({ plan: 'hold' });
		await accept(store, lessonId, 'Kurz o zlomcích');
		await new Promise((r) => setTimeout(r, 5));
		const [typed, other] = aiPanel.queue.rows.map((r) => r.blockId);
		// While the plan is being made the teacher gives a card a brief, and the first new lesson a note.
		store.apply((d) => ({
			doc: {
				...d,
				lessons: d.lessons.map((l) =>
					l.blocks.some((b) => b.block_id === typed) ? { ...l, ai_context: 'Moje poznámka' } : l
				),
				blocks: d.blocks.map((b) => (b.block_id === typed ? { ...b, [BRIEF_KEY]: 'Můj záměr' } : b))
			},
			description: 'x'
		}));
		seen.release();
		await done();
		const blocks = store.source.blocks as Record<string, unknown>[];
		const brief = (id: string) => blocks.find((b) => b.block_id === id)![BRIEF_KEY];
		expect(brief(typed)).toBe('Můj záměr');
		expect(brief(other)).toMatch(/^Ukázkový záměr: /);
		const lessons = store.source.lessons as Record<string, unknown>[];
		expect(lessons.map((l) => l.ai_context)).toEqual([
			undefined,
			'Moje poznámka',
			'Ukázková poznámka: Druhá lekce.'
		]);
		expect((store.source as Record<string, unknown>).ai_context).toBe('Ukázkové úmluvy kurzu.');
		// What the lesson requests carried is what stood in the document by then.
		const first = only(seen, '/ai/lesson').find((s) => s.body.lesson.name === 'První lekce')!;
		expect(first.body.context).toContain('Můj záměr');
	});

	it('undoing the insert takes the cards and their briefs; one undo step per written card, none for the plan', async () => {
		const { store, lessonId } = setup();
		server();
		const before = store.undoStack.length;
		await accept(store, lessonId);
		await done();
		const added = aiPanel.queue.rows.length;
		expect(added).toBe(3);
		expect(store.undoStack.length).toBe(before + 1 + added);
		const briefs = () =>
			(store.source.blocks as Record<string, unknown>[]).filter((b) => b[BRIEF_KEY] !== undefined);
		expect(briefs()).toHaveLength(added);
		for (let i = 0; i < added; i++) store.undo();
		// The cards are back to what the plan left, still in the document, so are their briefs.
		expect(store.doc.blocks).toHaveLength(4);
		store.undo();
		expect(store.doc.blocks).toHaveLength(1);
		expect(briefs()).toEqual([]);
		expect(store.undoStack.length).toBe(before);
		// Redo brings the cards back with the plan.
		store.redo();
		expect(store.doc.blocks).toHaveLength(4);
		expect(briefs()).toHaveLength(added);
		expect((store.source as Record<string, unknown>).ai_context).toBe('Ukázkové úmluvy kurzu.');
	});

	it('writes the cards without a plan when /ai/plan fails', async () => {
		const { store, lessonId } = setup();
		const seen = server({ plan: 'fail' });
		await accept(store, lessonId);
		await done();
		expect(only(seen, '/ai/plan')).toHaveLength(1);
		const lessons = only(seen, '/ai/lesson');
		expect(lessons).toHaveLength(1);
		expect(lessons[0].body.plan).toBeUndefined();
		expect(lessons[0].body.cards).toHaveLength(3);
		expect(aiPanel.queue.rows.every((r) => r.state === 'done')).toBe(true);
		expect(aiPanel.planning).toBe(false);
		// No plan: no briefs, no course note.
		expect((store.source.blocks as Record<string, unknown>[]).some((b) => BRIEF_KEY in b)).toBe(
			false
		);
		expect((store.source as Record<string, unknown>).ai_context).toBeUndefined();
		expect(aiPanel.problem).toBe('');
	});

	it('a plan that is a refusal from the limits does not stop the cards either', async () => {
		const { store, lessonId } = setup();
		const seen = server();
		const fetcher = vi.mocked(fetch);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (route: string, init?: RequestInit) =>
				route === '/ai/plan'
					? new Response('{"reason":"budget"}', { status: 429 })
					: fetcher(route, init)
			)
		);
		await accept(store, lessonId);
		await done();
		expect(only(seen, '/ai/lesson')[0].body.plan).toBeUndefined();
		expect(aiPanel.queue.rows.every((r) => r.state === 'done')).toBe(true);
	});

	it('a second batch whose plan fails does not carry the first batch\u2019s plan', async () => {
		const { store, lessonId } = setup();
		server();
		await accept(store, lessonId);
		await done();
		aiPanel.queue.clear();
		const seen = server({ plan: 'fail' });
		await accept(store, lessonId);
		await done();
		// The first batch's plan is about other cards: it is not sent with these.
		expect(only(seen, '/ai/lesson')[0].body.plan).toBeUndefined();
	});

	it('stopping during a lesson leaves the cards not reached waiting, and resume writes them', async () => {
		const { store, lessonId } = setup();
		const seen = server();
		// The lesson request is let through by hand, one line at a time.
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const encoder = new TextEncoder();
		const lessonSeen: any[] = [];
		const inner = vi.mocked(fetch);
		let first = true;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (route: string, init?: RequestInit) => {
				if (route === '/ai/lesson' && first) {
					first = false;
					lessonSeen.push(JSON.parse(String(init!.body)));
					return new Response(new ReadableStream<Uint8Array>({ start: (c) => (controller = c) }));
				}
				return inner(route, init);
			})
		);
		await accept(store, lessonId);
		while (lessonSeen.length === 0) await new Promise((r) => setTimeout(r, 2));
		const line = async (event: unknown) => {
			controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			await new Promise((r) => setTimeout(r, 5));
		};
		const [a, b, c] = aiPanel.queue.rows.map((r) => r.blockId);
		await line({ type: 'writing', card: 0 });
		expect(aiPanel.queue.rows.map((r) => r.state)).toEqual(['writing', 'waiting', 'waiting']);
		const answer = (await answerLesson(lessonSeen[0])).find((e) => e.type === 'card')!;
		aiPanel.stop();
		// The card being written is finished, then the conversation ends.
		await line(answer);
		await line({ type: 'writing', card: 1 });
		controller.close();
		while (aiPanel.queue.writing) await new Promise((r) => setTimeout(r, 2));
		expect(aiPanel.queue.rows.map((r) => r.state)).toEqual(['done', 'waiting', 'waiting']);
		expect(store.doc.blocks.find((x) => x.block_id === a)!.steps.length).toBeGreaterThan(1);
		expect(store.doc.blocks.find((x) => x.block_id === b)!.steps).toHaveLength(1);

		aiPanel.resume(store);
		await done();
		expect(aiPanel.queue.rows.every((r) => r.state === 'done')).toBe(true);
		const resumed = only(seen, '/ai/lesson').at(-1)!.body;
		// Only the cards that were not written; the plan goes along.
		expect(resumed.cards).toHaveLength(2);
		expect(resumed.plan).toBeDefined();
		expect(store.doc.blocks.find((x) => x.block_id === c)!.steps.length).toBeGreaterThan(1);
	});
});

describe('an outline made by hand, and its undo', () => {
	it('starts with a lesson or a card to name; a row left unnamed is taken back without a trace', () => {
		aiPanel.start('lessons');
		const typing = aiPanel.typing!;
		expect(aiPanel.draft?.lessons).toEqual([{ key: typing.key, name: '', cards: [], on: true }]);
		aiPanel.takeBack(typing.step, null);
		expect(aiPanel.draft).toBeNull();
		expect(aiPanel.canUndo).toBe(false);
		expect(aiPanel.canRedo).toBe(false);

		aiPanel.start('cards');
		expect(aiPanel.draft?.scope).toBe('cards');
		expect(aiPanel.draft?.lessons[0].cards.map((c) => c.key)).toEqual([aiPanel.typing!.key]);
	});

	it('a row added and named is one step; undo and redo walk the steps', () => {
		aiPanel.start('lessons');
		const lesson = aiPanel.typing!.key;
		aiPanel.amend(renameDraftLesson(aiPanel.draft!, lesson, 'Moje'));
		const card = aiPanel.key();
		aiPanel.change(addDraftCard(aiPanel.draft!, lesson, card));
		aiPanel.amend(renameDraftCard(aiPanel.draft!, card, 'Karta'));
		expect(toOutline(aiPanel.draft!)).toEqual({
			scope: 'lessons',
			lessons: [{ name: 'Moje', cards: [{ kind: 'display', name: 'Karta' }] }]
		});
		expect(aiPanel.undo()).toBe(true);
		expect(aiPanel.draft?.lessons[0]).toMatchObject({ name: 'Moje', cards: [] });
		expect(aiPanel.undo()).toBe(true);
		expect(aiPanel.draft).toBeNull();
		expect(aiPanel.undo()).toBe(false);
		aiPanel.redo();
		aiPanel.redo();
		expect(aiPanel.draft?.lessons[0].cards[0].name).toBe('Karta');
		expect(aiPanel.redo()).toBe(false);
	});

	it('a change that made no step is not taken back as the step before it', () => {
		aiPanel.start('lessons');
		aiPanel.amend(renameDraftLesson(aiPanel.draft!, aiPanel.typing!.key, 'Moje'));
		const step = aiPanel.change(aiPanel.draft);
		expect(step).toBe(-1);
		aiPanel.takeBack(step, aiPanel.draft);
		expect(aiPanel.draft?.lessons[0].name).toBe('Moje');
		expect(aiPanel.canUndo).toBe(true);
	});

	it('takes back an unnamed row by removing it once another step came after', () => {
		aiPanel.start('lessons');
		const step = aiPanel.typing!.step;
		const lesson = aiPanel.typing!.key;
		aiPanel.change(renameDraftLesson(aiPanel.draft!, lesson, 'X'));
		aiPanel.takeBack(step, { ...aiPanel.draft!, lessons: [] });
		expect(aiPanel.draft?.lessons).toEqual([]);
		aiPanel.undo();
		expect(aiPanel.draft?.lessons[0].name).toBe('X');
	});

	it('„Zahodit návrh“ and an AI change are undone; creating ends the history', async () => {
		const { store } = setup();
		server();
		await aiPanel.send(store, 'Kurz o zlomcích');
		const proposed = aiPanel.draft;
		await aiPanel.send(store, 'přidej kvíz');
		const changed = aiPanel.draft;
		expect(JSON.stringify(changed)).toContain('Změna: přidej kvíz');
		aiPanel.discard();
		expect(aiPanel.draft).toBeNull();
		aiPanel.undo();
		expect(aiPanel.draft).toBe(changed);
		aiPanel.undo();
		expect(aiPanel.draft).toBe(proposed);
		// The fresh proposal is one step from the empty panel.
		aiPanel.undo();
		expect(aiPanel.draft).toBeNull();
		aiPanel.redo();
		aiPanel.create(store);
		expect(aiPanel.canUndo).toBe(false);
		expect(aiPanel.canRedo).toBe(false);
		await done();
	});

	it('„Co změnit?“ on a hand-made outline sends it with an empty lesson and no first prompt', async () => {
		const { store } = setup();
		const seen = server();
		aiPanel.start('lessons');
		aiPanel.amend(renameDraftLesson(aiPanel.draft!, aiPanel.typing!.key, 'Moje lekce'));
		await aiPanel.send(store, 'doplň karty');
		expect(seen[0].body.current).toEqual({
			scope: 'lessons',
			lessons: [{ name: 'Moje lekce', cards: [] }]
		});
		expect(seen[0].body.original).toBeUndefined();
		expect(aiPanel.problem).toBe('');
		expect(aiPanel.draft?.lessons[0].cards.map((c) => c.name)).toEqual([
			'Úvod: Moje lekce',
			'Změna: doplň karty'
		]);
		aiPanel.undo();
		expect(aiPanel.draft?.lessons[0].cards).toEqual([]);
	});
});

describe('a streamed proposal', () => {
	/** A response whose lines are let through by hand. */
	function manual() {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(body))
		);
		return {
			line: async (event: unknown) => {
				controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				await new Promise((r) => setTimeout(r, 5));
			},
			close: () => controller.close()
		};
	}
	const lesson = (name: string) => ({
		type: 'lesson',
		lesson: { name, cards: [{ kind: 'display', name: `${name}: karta` }] }
	});

	it('grows on screen lesson by lesson, and create waits until it is complete', async () => {
		const { store } = setup();
		const m = manual();
		const pending = aiPanel.send(store, 'Kurz o zlomcích');
		await m.line({ type: 'scope', scope: 'lessons' });
		await m.line(lesson('První'));
		expect(aiPanel.draft?.lessons.map((l) => l.name)).toEqual(['První']);
		expect(aiPanel.incoming).toBe(true);
		aiPanel.create(store);
		expect(store.doc.lessons).toHaveLength(1);
		// What the teacher does while the rest is arriving is not lost to the next lesson.
		aiPanel.draft = setCardTick(aiPanel.draft!, aiPanel.draft!.lessons[0].cards[0].key, false);
		await m.line(lesson('Druhá'));
		expect(aiPanel.draft?.lessons.map((l) => l.name)).toEqual(['První', 'Druhá']);
		expect(aiPanel.draft?.lessons[0].cards[0].on).toBe(false);
		await m.line({ type: 'done' });
		m.close();
		await pending;
		expect(aiPanel.incoming).toBe(false);
		expect(aiPanel.asking).toBe(false);
		expect(aiPanel.problem).toBe('');
	});

	it('a change is built beside the old proposal, which stays until the new one is done', async () => {
		const { store } = setup();
		server();
		await aiPanel.send(store, 'Kurz o zlomcích');
		const old = aiPanel.draft;
		const m = manual();
		const pending = aiPanel.send(store, 'jen jedna lekce');
		await m.line({ type: 'scope', scope: 'lessons' });
		await m.line(lesson('Nová'));
		expect(aiPanel.draft).toBe(old);
		expect(aiPanel.incoming).toBe(false);
		await m.line({ type: 'done' });
		m.close();
		await pending;
		expect(aiPanel.draft?.lessons.map((l) => l.name)).toEqual(['Nová']);
	});

	it('a connection cut half way keeps what had arrived and says so', async () => {
		const { store } = setup();
		const m = manual();
		const pending = aiPanel.send(store, 'Kurz');
		await m.line({ type: 'scope', scope: 'lessons' });
		await m.line(lesson('První'));
		m.close();
		await pending;
		expect(aiPanel.draft?.lessons.map((l) => l.name)).toEqual(['První']);
		expect(aiPanel.problem).not.toBe('');
		expect(aiPanel.asking).toBe(false);
	});

	it('a failure before any lesson leaves no proposal', async () => {
		const { store } = setup();
		const m = manual();
		const pending = aiPanel.send(store, 'Kurz');
		await m.line({ type: 'failed', problem: 'busy' });
		m.close();
		await pending;
		expect(aiPanel.draft).toBeNull();
		expect(aiPanel.problem).not.toBe('');
	});

	it('creating a structure saves the first request on the course; cards alone do not', async () => {
		const { store, lessonId } = setup();
		server();
		await aiPanel.send(store, 'Kurz o zlomcích');
		await aiPanel.send(store, 'přidej kvíz');
		aiPanel.create(store);
		expect((store.source as Record<string, unknown>)[REQUEST_KEY]).toBe('Kurz o zlomcích');
		await done();
		aiPanel.queue.clear();
		store.selection = { lessonId };
		await aiPanel.send(store, 'Dej mi karty');
		aiPanel.create(store);
		expect((store.source as Record<string, unknown>)[REQUEST_KEY]).toBe('Kurz o zlomcích');
		await done();
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

describe('a card waiting in the queue, in the editor', () => {
	it('shows no error in the tree until it is written or has failed, then the usual timing applies', async () => {
		const { store, lessonId, blockId } = setup();
		server();
		store.awaiting = () => aiPanel.queue.pending;
		store.selection = { lessonId, blockId };
		await aiPanel.send(store, 'Dej mi karty');
		// Hold the writing so the cards stay in the queue.
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				await gate;
				return new Response('x', { status: 502 });
			})
		);
		aiPanel.create(store);
		const waiting = aiPanel.queue.rows[0].blockId;
		store.selection = { lessonId, blockId: waiting };
		// Left once (selection moved) and still no error shown on it.
		store.selection = { lessonId, blockId };
		expect(store.touchedCards.has(waiting)).toBe(true);
		expect(store.shown.errors.filter((i) => i.ref.blockId === waiting)).toEqual([]);
		// The review still lists it.
		expect(store.validation.errors.some((i) => i.ref.blockId === waiting)).toBe(true);
		// It fails: the usual timing applies.
		open();
		while (aiPanel.queue.pending.has(waiting)) await new Promise((r) => setTimeout(r, 2));
		expect(store.shown.errors.some((i) => i.ref.blockId === waiting)).toBe(true);
		aiPanel.queue.clear();
	});
});

describe('what is counted for a card waiting in the queue', () => {
	it('leaves it out of the top bar and banner count, and keeps it in what the review lists', async () => {
		const { store, lessonId, blockId } = setup();
		server();
		store.awaiting = () => aiPanel.queue.pending;
		store.selection = { lessonId, blockId };
		const listedBefore = store.listed.errors.length;
		await aiPanel.send(store, 'Dej mi karty');
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				await gate;
				return new Response('x', { status: 502 });
			})
		);
		aiPanel.create(store);
		const waiting = new Set(aiPanel.queue.pending);
		expect(waiting.size).toBe(3);
		// The review sees the three new cards; the count does not.
		expect(store.listed.errors.length).toBeGreaterThan(listedBefore);
		expect(store.counted.errors.length).toBe(listedBefore);
		open();
		while (aiPanel.queue.pending.size > 0) await new Promise((r) => setTimeout(r, 2));
		// Failed: the usual counting applies.
		expect(store.counted.errors.length).toBe(store.listed.errors.length);
		aiPanel.queue.clear();
	});
});

describe('the outline belongs to its course and is kept in the browser', () => {
	/** A `localStorage` of our own, shared by the "reloads" of one test. */
	function storage() {
		const items = new Map<string, string>();
		const fake = {
			getItem: (k: string) => items.get(k) ?? null,
			setItem: (k: string, v: string) => void items.set(k, v),
			removeItem: (k: string) => void items.delete(k)
		};
		vi.stubGlobal('localStorage', fake);
		return items;
	}
	let n = 0;
	/** A course id no other test has used, as a fresh singleton would see it. */
	const course = () => `KURZ-${++n}-${Math.random()}`;

	it('is back after a reload with its ticks, hand-made rows and first prompt, but no history', async () => {
		const { store } = setup();
		server();
		const items = storage();
		const id = course();
		aiPanel.follow(id);
		await aiPanel.send(store, 'Kurz o zlomcích');
		const lesson = aiPanel.draft!.lessons[0];
		aiPanel.change(setCardTick(aiPanel.draft!, lesson.cards[1].key, false));
		aiPanel.change(addDraftCard(aiPanel.draft!, lesson.key, 'mine'));
		aiPanel.amend(renameDraftCard(aiPanel.draft!, 'mine', 'Moje karta'));
		const before = toOutline(aiPanel.draft!, 'all');
		const ticked = toOutline(aiPanel.draft!, 'ticked');
		expect(items.size).toBe(1);

		// A reload: another course, then this one again, from storage alone.
		aiPanel.follow(course());
		expect(aiPanel.draft).toBeNull();
		aiPanel.follow(id);
		expect(toOutline(aiPanel.draft!, 'all')).toEqual(before);
		expect(toOutline(aiPanel.draft!, 'ticked')).toEqual(ticked);
		expect(aiPanel.draft!.original).toBe('Kurz o zlomcích');
		expect(aiPanel.canUndo).toBe(false);
		// Created, it is gone from storage, and its prompt is on the course.
		aiPanel.create(store);
		expect((store.source as Record<string, unknown>)[REQUEST_KEY]).toBe('Kurz o zlomcích');
		expect(items.size).toBe(0);
		await done();
	});

	it('is not shown on another course, nor its history; „Zahodit návrh“ forgets it', async () => {
		const { store } = setup();
		server();
		const items = storage();
		const first = course();
		aiPanel.follow(first);
		aiPanel.start('lessons');
		aiPanel.amend(renameDraftLesson(aiPanel.draft!, aiPanel.typing!.key, 'Moje lekce'));
		const other = course();
		aiPanel.follow(other);
		expect(aiPanel.draft).toBeNull();
		expect(aiPanel.canUndo).toBe(false);
		await aiPanel.send(store, 'Kurz o zlomcích');
		expect(items.size).toBe(2);
		aiPanel.follow(first);
		expect(aiPanel.draft!.lessons.map((l) => l.name)).toEqual(['Moje lekce']);
		expect(aiPanel.draft!.original).toBeUndefined();
		aiPanel.discard();
		expect(items.size).toBe(1);
		aiPanel.follow(other);
		expect(aiPanel.draft!.lessons.map((l) => l.name)).toEqual(['První lekce', 'Druhá lekce']);
	});

	it('a request still running when the course changes is forgotten', async () => {
		const { store } = setup();
		server();
		storage();
		aiPanel.follow(course());
		const pending = aiPanel.send(store, 'Kurz o zlomcích');
		aiPanel.follow(course());
		await pending;
		expect(aiPanel.draft).toBeNull();
		expect(aiPanel.asking).toBe(false);
	});

	it('one stored that no longer parses is dropped, quietly', () => {
		const items = storage();
		const id = course();
		items.set(`edu-editor:outline:v1:${id}`, '{"format":1,"draft":{"scope":"nope"}}');
		aiPanel.follow(id);
		expect(aiPanel.draft).toBeNull();
		expect(items.size).toBe(0);
	});

	it('undoing „Zahodit návrh“ brings back its first prompt too', async () => {
		const { store } = setup();
		const seen = server();
		await aiPanel.send(store, 'Kurz o zlomcích');
		aiPanel.discard();
		aiPanel.undo();
		await aiPanel.send(store, 'přidej kvíz');
		expect(seen.at(-1)!.body.original).toBe('Kurz o zlomcích');
		aiPanel.create(store);
		expect((store.source as Record<string, unknown>)[REQUEST_KEY]).toBe('Kurz o zlomcích');
		await done();
	});
});

describe('sending with files only', () => {
	const file = {
		hash: 'abcdef01',
		name: 'Učebnice.docx',
		pages: 1,
		unread: [],
		sections: [
			{ key: 'abcdef01.0', file: 'Učebnice.docx', title: 'Zlomky', text: 'Polovina je 1/2.' }
		]
	};
	afterEach(() => {
		materials.files = [];
	});

	it('asks for a course from the materials with an empty box, and keeps that request on the course', async () => {
		const { store } = setup();
		const seen = server();
		expect(aiPanel.fromMaterials).toBe(false);
		await aiPanel.send(store, '  ');
		expect(seen).toHaveLength(0);

		materials.files = [file];
		expect(aiPanel.fromMaterials).toBe(true);
		await aiPanel.send(store, '');
		expect(seen).toHaveLength(1);
		expect(seen[0].body.prompt).toBe(FROM_MATERIALS);
		expect(seen[0].body.materials).toContain('Polovina je 1/2.');
		// With an outline on screen an empty box is nothing to send.
		expect(aiPanel.fromMaterials).toBe(false);
		await aiPanel.send(store, '');
		expect(seen).toHaveLength(1);
		aiPanel.create(store);
		expect((store.source as Record<string, unknown>)[REQUEST_KEY]).toBe(FROM_MATERIALS);
		await done();
	});
});

describe('cards made by hand get sources when the materials do not all fit', () => {
	const sections = (chars: number) =>
		[0, 1].map((i) => ({
			key: `abcdef01.${i}`,
			file: 'Učebnice.pdf',
			title: `Kapitola ${i}`,
			text: 'x'.repeat(chars)
		}));
	const file = (chars: number) => ({
		hash: 'abcdef01',
		name: 'Učebnice.pdf',
		pages: 2,
		unread: [],
		sections: sections(chars)
	});
	afterEach(() => {
		materials.files = [];
	});

	/** The fake server, with `/ai/sources` held until `answer` is called. */
	function sourcesServer(reply: () => Response) {
		const seen: { route: string; body: any }[] = [];
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		vi.stubGlobal(
			'fetch',
			vi.fn(async (route: string, init?: RequestInit) => {
				if (init?.body === undefined) return Response.json({ files: [] });
				const body = JSON.parse(String(init.body));
				seen.push({ route, body });
				if (route === '/ai/sources') {
					await held;
					return reply();
				}
				return (await answerAi(route, body)) ?? Response.json({ status: 'ok', cards: [] });
			})
		);
		return { seen, answer };
	}

	async function handMade(store: DocStore) {
		aiPanel.start('lessons');
		const lessonKey = aiPanel.typing!.key;
		aiPanel.amend(renameDraftLesson(aiPanel.draft!, lessonKey, 'Moje lekce'));
		for (const name of ['Úvod', 'Příklady']) {
			const key = aiPanel.key();
			aiPanel.change(addDraftCard(aiPanel.draft!, lessonKey, key));
			aiPanel.amend(renameDraftCard(aiPanel.draft!, key, name));
		}
		const before = store.undoStack.length;
		aiPanel.create(store);
		return before;
	}

	it('asks once, holds the cards until then, keeps the sources with no undo step of their own', async () => {
		const { store } = setup();
		materials.files = [file(100_000)];
		const { seen, answer } = sourcesServer(() =>
			Response.json({
				status: 'ok',
				cards: [
					{ id: '1', sources: ['abcdef01.1', 'made.up'] },
					{ id: '2', sources: ['made.up'] }
				]
			})
		);
		const before = await handMade(store);
		await new Promise((r) => setTimeout(r, 5));
		const asked = seen.filter((s) => s.route === '/ai/sources');
		expect(asked).toHaveLength(1);
		expect(asked[0].body.cards.map((c: { name: string }) => c.name)).toEqual(['Úvod', 'Příklady']);
		// Held: waiting, not written.
		expect(only(seen, '/ai/lesson')).toHaveLength(0);
		expect(only(seen, '/ai/plan')).toHaveLength(0);
		expect(aiPanel.queue.rows.map((r) => r.state)).toEqual(['waiting', 'waiting']);
		answer();
		await done();
		const [uvod, priklady] = aiPanel.queue.rows.map((r) =>
			store.source.blocks.find((b) => b.block_id === r.blockId)!
		);
		expect(sourceRefsOf(uvod)).toEqual(['abcdef01.1']);
		expect(sourceRefsOf(priklady)).toEqual([]);
		// The two cards are one lesson: one request.
		expect(only(seen, '/ai/lesson')).toHaveLength(1);
		expect(only(seen, '/ai/lesson')[0].body.cards).toHaveLength(2);
		// The insert and two cards written: the sources are no step of their own.
		expect(store.undoStack.length).toBe(before + 3);
		store.undo();
		store.undo();
		expect(sourceRefsOf(store.source.blocks.find((b) => b.block_id === uvod.block_id))).toEqual([
			'abcdef01.1'
		]);
		store.undo();
		expect(store.source.blocks.some((b) => b.block_id === uvod.block_id)).toBe(false);
		store.redo();
		expect(sourceRefsOf(store.source.blocks.find((b) => b.block_id === uvod.block_id))).toEqual([
			'abcdef01.1'
		]);
	});

	it('asks for the sources before the plan, and writes no card before both have finished', async () => {
		const { store } = setup();
		materials.files = [file(100_000)];
		const { seen, answer } = sourcesServer(() =>
			Response.json({ status: 'ok', cards: [{ id: '1', sources: ['abcdef01.1'] }] })
		);
		await handMade(store);
		await new Promise((r) => setTimeout(r, 5));
		expect(only(seen, '/ai/sources')).toHaveLength(1);
		expect(only(seen, '/ai/plan')).toHaveLength(0);
		expect(only(seen, '/ai/lesson')).toHaveLength(0);
		expect(aiPanel.planning).toBe(false);
		answer();
		await done();
		const order = routes(seen);
		expect(order.indexOf('/ai/sources')).toBeLessThan(order.indexOf('/ai/plan'));
		expect(order.indexOf('/ai/plan')).toBeLessThan(order.indexOf('/ai/lesson'));
		// The plan's request already has the sources.
		const planned = only(seen, '/ai/plan')[0].body;
		expect(planned.lessons[0].cards[0].sources).toEqual(['abcdef01.1']);
		expect(only(seen, '/ai/lesson')[0].body.plan).toBeDefined();
	});

	it('writes the cards anyway, without sources, when the request fails', async () => {
		const { store } = setup();
		materials.files = [file(100_000)];
		const { seen, answer } = sourcesServer(() => new Response('busy', { status: 503 }));
		await handMade(store);
		answer();
		await done();
		expect(only(seen, '/ai/lesson')).toHaveLength(1);
		expect(aiPanel.queue.rows.every((r) => r.state === 'done')).toBe(true);
		expect(aiPanel.problem).toBe('');
	});

	it('asks nothing when the materials fit, or there are none', async () => {
		for (const files of [[file(100)], []]) {
			const { store } = setup();
			materials.files = files;
			const { seen, answer } = sourcesServer(() => Response.json({ status: 'ok', cards: [] }));
			answer();
			await handMade(store);
			await done();
			expect(seen.filter((s) => s.route === '/ai/sources')).toHaveLength(0);
			expect(only(seen, '/ai/lesson')).toHaveLength(1);
			aiPanel.queue.clear();
		}
	});
});
