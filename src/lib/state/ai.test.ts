import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocStore } from './doc-store.svelte';
import { ai } from './ai.svelte';
import { notices } from './notice.svelte';
import { addBlock, addLesson } from '$lib/domain/commands';
import { emptyCourse } from '$lib/domain/document';
import { ORIGIN_KEY, type GeneratedCard } from '$lib/domain/authoring';

vi.mock('$lib/state/versions/server', () => ({ workspaceKey: () => 'k'.repeat(43) }));

const answer = (card: GeneratedCard) =>
	vi.fn(async () => Response.json({ status: 'ok', card })) as unknown as typeof fetch;

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

afterEach(() => vi.unstubAllGlobals());

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
		const sent = JSON.parse(
			(fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1]
				.body as string
		);
		expect(sent.schema).toBe('eduai.gen-request/2');
		expect(sent.card.steps.map((s: { id: string }) => s.id)).toEqual(['s1']);
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
});
