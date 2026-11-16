import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocStore } from './doc-store.svelte';
import { ai } from './ai.svelte';
import { materials } from './materials.svelte';
import { sectionsOf } from '$lib/domain/materials';
import { SOURCE_REFS_KEY } from '$lib/domain/authoring';
import { notices } from './notice.svelte';
import { addBlock, addLesson } from '$lib/domain/commands';
import { emptyCourse } from '$lib/domain/document';
import { ORIGIN_KEY, type GeneratedCard } from '$lib/domain/authoring';
import { MARKER_OPEN } from '$lib/domain/dossier';
import { lessonEvents } from '$lib/server/ai/lesson';
import { fakeChat } from '$lib/server/ai/fake';
import type { Chat } from '$lib/server/ai/provider';

vi.mock('$lib/state/versions/server', () => ({ workspaceKey: () => 'k'.repeat(43) }));

/** A model that answers every card turn with `card`, as the tool call it was asked for. */
const cardChat =
	(card: GeneratedCard): Chat =>
	async (messages, { tool }) => ({
		turn: {
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: `c${messages.length}`,
					type: 'function',
					function: { name: tool, arguments: JSON.stringify(card) }
				}
			]
		},
		tokens: 0
	});

const ndjson = (events: unknown[]) =>
	new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(''));

/**
 * The server behind `fetch`: the real lesson route's events with a model that writes
 * `card`, or, with no card, the fake provider's own.
 */
const answer = (card?: GeneratedCard) =>
	vi.fn(async (url: string, init?: RequestInit) => {
		// The course's materials are asked for first: it has none.
		if (url.startsWith('/materials/')) return Response.json({ files: [] });
		if (url === '/ai/block') return Response.json({ configured: true });
		const body = JSON.parse(String(init?.body));
		const events: unknown[] = [];
		for await (const e of lessonEvents(body, card === undefined ? fakeChat : cardChat(card)))
			events.push(e);
		return ndjson(events);
	}) as unknown as typeof fetch;

/** A server that says these events (or this status) to a lesson request. */
const says = (events: unknown[] | Response) =>
	vi.fn(async (url: string) => {
		if (url.startsWith('/materials/')) return Response.json({ files: [] });
		if (url === '/ai/block') return Response.json({ configured: true });
		return events instanceof Response ? events.clone() : ndjson(events);
	}) as unknown as typeof fetch;

/** The calls made to `route`, parsed. */
const sentTo = (fetcher: typeof fetch, route: string) =>
	(fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
		.filter(([url]) => url === route)
		.map(([, init]) => JSON.parse(init.body as string));

/** The body of the request that asked for a card. */
const sentCard = (fetcher: typeof fetch) => sentTo(fetcher, '/ai/lesson')[0];

function setup() {
	const store = new DocStore();
	let doc = addLesson(emptyCourse('KURZ', 'Zlomky'), 'Polovina').doc;
	const lessonId = doc.lessons[0].lesson_id;
	const added = addBlock(doc, lessonId, 'exercise');
	doc = added.doc;
	store.load(doc);
	return { store, lessonId, blockId: added.ref!.blockId! };
}

const question = (n: number) =>
	({
		kind: 'question',
		content_md: `Úloha ${n}`,
		question: { type: 'open', answer: 'x' },
		hint_md: 'h',
		help_md: 'p',
		solution_md: 's'
	}) as const;

afterEach(() => {
	vi.unstubAllGlobals();
	ai.available = false;
	notices.dismiss();
});

describe('writing a card with AI', () => {
	it('writes several steps as one undo step, says what was written, and splits the questions', async () => {
		const { store, lessonId, blockId } = setup();
		const fetcher = answer({
			steps: [
				{
					keep: 's1',
					fill: {
						content_md: 'První',
						question: { type: 'open', answer: 'a' },
						hint_md: 'h',
						help_md: 'p',
						solution_md: 's'
					}
				},
				{ kind: 'text', content_md: 'Mezitím' },
				question(2),
				question(3)
			]
		});
		vi.stubGlobal('fetch', fetcher);
		const undoBefore = store.undoStack.length;
		await ai.write(store, blockId, lessonId);

		expect(store.undoStack.length).toBe(undoBefore + 1);
		expect(notices.current?.text).toBe('Dopsáno: 4 kroky, 3 otázky.');
		const sent = sentCard(fetcher);
		expect(sent.schema).toBe('eduai.lesson-request/1');
		expect(sent.cards).toHaveLength(1);
		expect(sent.cards[0].steps.map((s: { id: string }) => s.id)).toEqual(['s1']);
		expect(typeof sent.context).toBe('string');

		// The view has one card of four steps; the document has one block per question.
		expect(store.doc.blocks.find((b) => b.block_id === blockId)!.steps).toHaveLength(4);
		expect(
			store.source.blocks.filter((b) => b.steps.some((s) => s.type === 'question'))
		).toHaveLength(3);
		expect(store.source.blocks.some((b) => ORIGIN_KEY in b)).toBe(true);

		store.undo();
		expect(store.doc.blocks.find((b) => b.block_id === blockId)!.steps).toHaveLength(1);
		expect(store.source.blocks).toHaveLength(1);
	});

	it('offers the button on a card that already has several questions, and fills it', async () => {
		const { store, lessonId, blockId } = setup();
		vi.stubGlobal(
			'fetch',
			answer({
				steps: [
					{
						keep: 's1',
						fill: {
							content_md: 'x',
							question: { type: 'open', answer: 'a' },
							hint_md: 'h',
							help_md: 'p',
							solution_md: 's'
						}
					},
					question(2)
				]
			})
		);
		await ai.write(store, blockId, lessonId);
		// Two questions in one card now; the second has a hint the teacher cleared.
		const second = store.doc.blocks.find((b) => b.block_id === blockId)!.steps[1];
		store.apply((d) => ({
			doc: {
				...d,
				blocks: d.blocks.map((b) =>
					b.block_id === blockId
						? { ...b, steps: b.steps.map((s) => (s.id === second.id ? { ...s, hint: '' } : s)) }
						: b
				)
			},
			description: 'x'
		}));
		const fetcher = answer({
			steps: [{ keep: 's1' }, { keep: second.id, fill: { hint_md: 'nová' } }]
		});
		vi.stubGlobal('fetch', fetcher);
		await ai.write(store, blockId, lessonId);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(store.doc.blocks.find((b) => b.block_id === blockId)!.steps[1].hint).toBe('nová');
		expect(notices.current?.text).toBe('Dopsáno: 1 krok, 1 otázka.');
	});

	it('writes a card with its sections in full and the others by what fits, from the course\u2019s materials', async () => {
		const { store, lessonId, blockId } = setup();
		const hash = 'abcdef0123456789';
		const file = (text: string) => ({
			hash,
			name: 'Sešit.docx',
			pages: 2,
			unread: [],
			sections: sectionsOf(hash, 'Sešit.docx', [
				{ title: 'První', text: 'Fakta o půlce.' },
				{ title: 'Druhá', text }
			])
		});
		await materials.ready('KURZ');
		try {
			materials.files = [file('Fakta o třetině.')];
			store.apply((d) => ({
				doc: {
					...d,
					blocks: d.blocks.map((b) =>
						b.block_id === blockId ? { ...b, [SOURCE_REFS_KEY]: ['abcdef01.1'] } : b
					)
				},
				description: 'x'
			}));
			const fetcher = answer({ steps: [{ keep: 's1', fill: {} }] });
			vi.stubGlobal('fetch', fetcher);
			await ai.write(store, blockId, lessonId);
			const sent = sentCard(fetcher);
			// They fit, so both are in full, and the one this card draws on is named last.
			expect(sent.materials).toContain('Fakta o půlce.');
			expect(sent.materials).toContain('Fakta o třetině.');
			// Which sections the card draws on is said in its own turn, not in the shared materials.
			expect(sent.materials).not.toContain('draws mainly');
			expect(sent.cards[0].draws_on).toEqual(['abcdef01.1']);
			expect(JSON.stringify(sent.cards)).not.toContain('Fakta');

			// A course without materials sends none.
			materials.files = [];
			const bare = answer({ steps: [{ keep: 's1', fill: {} }] });
			vi.stubGlobal('fetch', bare);
			await ai.write(store, blockId, lessonId);
			expect(sentCard(bare).materials).toBeUndefined();
		} finally {
			materials.files = [];
		}
	});

	it('asks /ai/lesson for a lesson of one card, with that card marked in the dossier and no plan', async () => {
		const { store, lessonId, blockId } = setup();
		const fetcher = answer();
		vi.stubGlobal('fetch', fetcher);
		await ai.write(store, blockId, lessonId);
		const calls = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
		expect(calls.filter(([url]) => url === '/ai/lesson')).toHaveLength(1);
		expect(calls.some(([url, init]) => url === '/ai/block' && init?.method === 'POST')).toBe(false);
		const sent = sentCard(fetcher);
		expect(sent.cards).toHaveLength(1);
		expect(sent.context).toContain(MARKER_OPEN);
		expect(sent.plan).toBeUndefined();
		expect(sent.lesson.name).toBe('Polovina');
		// The fake provider wrote it.
		expect(store.doc.blocks.find((b) => b.block_id === blockId)!.steps.length).toBeGreaterThan(1);
	});

	it('says the card could not be written when the lesson reports it failed', async () => {
		const { store, lessonId, blockId } = setup();
		vi.stubGlobal(
			'fetch',
			says([{ type: 'writing', card: 0 }, { type: 'card-failed', card: 0 }, { type: 'done' }])
		);
		const result = await ai.write(store, blockId, lessonId);
		expect(result).toEqual({ status: 'problem', problem: 'failed' });
		expect(notices.current?.text).toBe('Kartu se nepodařilo dopsat. Zkus to znovu.');
		expect(store.doc.blocks.find((b) => b.block_id === blockId)!.steps).toHaveLength(1);
		expect(ai.writing.has(blockId)).toBe(false);
	});

	it('keeps the card as it was when the stream is cut', async () => {
		const { store, lessonId, blockId } = setup();
		vi.stubGlobal('fetch', says([{ type: 'writing', card: 0 }]));
		const result = await ai.write(store, blockId, lessonId);
		expect(result).toEqual({ status: 'problem', problem: 'offline' });
	});

	describe('what the server refuses with', () => {
		const refuse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
			says(Response.json(body, { status, headers }));

		it('a spent day is said as such, and a rate limit as too many requests, with the wait', async () => {
			const { store, lessonId, blockId } = setup();
			ai.available = true;
			vi.stubGlobal('fetch', refuse(429, { reason: 'budget' }));
			expect(await ai.write(store, blockId, lessonId)).toEqual({
				status: 'problem',
				problem: 'budget'
			});
			expect(notices.current?.text).toBe(
				'Dnešní příděl pro AI je vyčerpaný. Zítra to půjde znovu.'
			);

			vi.stubGlobal('fetch', refuse(429, { reason: 'rate' }, { 'retry-after': '12' }));
			expect(await ai.write(store, blockId, lessonId)).toEqual({
				status: 'problem',
				problem: 'rate',
				retryAfter: 12
			});
			expect(notices.current?.text).toBe('To bylo moc požadavků najednou. Zkus to za chvíli.');
		});

		it('a 503 is AI being busy, or just a failure once AI is gone', async () => {
			const { store, lessonId, blockId } = setup();
			ai.available = true;
			vi.stubGlobal('fetch', refuse(503, {}));
			expect(await ai.write(store, blockId, lessonId)).toMatchObject({ problem: 'busy' });
			expect(notices.current?.text).toBe('AI je teď přetížená. Zkus to za chvíli.');
		});

		it('a quiet write says nothing, and the result carries the problem', async () => {
			const { store, lessonId, blockId } = setup();
			ai.available = true;
			vi.stubGlobal('fetch', refuse(429, { reason: 'budget' }));
			const result = await ai.write(store, blockId, lessonId, { quiet: true });
			expect(result).toMatchObject({ status: 'problem', problem: 'budget' });
			expect(notices.current).toBeNull();
		});

		it('a lesson stopped by the limits after the request began is the same problem', async () => {
			const { store, lessonId, blockId } = setup();
			ai.available = true;
			vi.stubGlobal(
				'fetch',
				says([
					{ type: 'writing', card: 0 },
					{ type: 'stopped', reason: 'rate', retryAfter: 9 }
				])
			);
			expect(await ai.write(store, blockId, lessonId)).toEqual({
				status: 'problem',
				problem: 'rate',
				retryAfter: 9
			});
		});
	});

	it('each written card is its own undo step', async () => {
		const { store, lessonId, blockId } = setup();
		const second = addBlock(store.doc, lessonId, 'exercise');
		store.load(second.doc);
		const other = second.ref!.blockId!;
		vi.stubGlobal('fetch', answer());
		const before = store.undoStack.length;
		await ai.write(store, blockId, lessonId);
		await ai.write(store, other, lessonId);
		expect(store.undoStack.length).toBe(before + 2);
		store.undo();
		expect(store.doc.blocks.find((b) => b.block_id === other)!.steps).toHaveLength(1);
		expect(store.doc.blocks.find((b) => b.block_id === blockId)!.steps.length).toBeGreaterThan(1);
	});

	it('does not write a card that is gone', async () => {
		const { store, lessonId } = setup();
		const fetcher = answer();
		vi.stubGlobal('fetch', fetcher);
		expect(await ai.write(store, 'nope', lessonId)).toEqual({ status: 'gone' });
		expect(sentTo(fetcher, '/ai/lesson')).toHaveLength(0);
	});

	it('does not write a card twice at once', async () => {
		const { store, lessonId, blockId } = setup();
		const fetcher = answer();
		vi.stubGlobal('fetch', fetcher);
		const first = ai.write(store, blockId, lessonId);
		// Taken before the materials load: a second call in that gap is refused.
		expect(await ai.write(store, blockId, lessonId)).toEqual({ status: 'nothing' });
		await first;
		expect(sentTo(fetcher, '/ai/lesson')).toHaveLength(1);
	});
});
