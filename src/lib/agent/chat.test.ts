import { describe, expect, it } from 'vitest';
import { storeFor } from '$lib/screen/__tests__/fixtures';
import { createHeadlessContext } from './context';
import { runTool } from './handlers';
import { ChatSession, LENGTH_NOTE, ROUNDS_NOTE, STALE_NOTICE } from './chat.svelte';
import { sseData, httpTransport, type Transport } from './chat-transport';
import type { ChatMessage, StreamEvent, ToolCall } from './protocol';

const CARD = '$.blocks[block_id=L1_B3_poznej]';
const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

type Turn = {
	text?: string;
	calls?: Omit<ToolCall, 'id'>[];
	finish?: 'stop' | 'tool_calls' | 'length';
	reasoning?: unknown;
	error?: string;
};

/** A model that plays the scripted turns, one per request, and records what it was sent. */
function script(turns: Turn[], revision: () => number) {
	const sent: ChatMessage[][] = [];
	let n = 0;
	const transport: Transport = async function* (messages, signal) {
		sent.push(structuredClone([...messages]));
		const turn = turns[Math.min(n++, turns.length - 1)];
		if (signal.aborted) return;
		if (typeof turn.error === 'string') {
			yield { type: 'error', message: turn.error, code: 'unknown' };
			return;
		}
		for (const word of (turn.text ?? '').split(/(?<= )/).filter(Boolean)) {
			yield { type: 'text_delta', text: word };
		}
		const toolCalls = (turn.calls ?? []).map((c, i) => ({
			...c,
			arguments: c.arguments.replace('"__REV__"', String(revision())),
			id: `call_${n}_${i}`
		}));
		yield {
			type: 'done',
			finishReason: turn.finish ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
			assistant: {
				role: 'assistant',
				text: turn.text ?? '',
				toolCalls,
				...(turn.reasoning === undefined ? {} : { reasoning: turn.reasoning })
			},
			usage
		};
	};
	return { transport, sent };
}

function setup(turns: Turn[], answer = true) {
	const store = storeFor('corpus/zlomky-5-trida.json', 'teacher');
	const ctx = createHeadlessContext(store, { confirm: () => answer });
	const model = script(turns, () => store.revision);
	const session = new ChatSession({ store, ctx, transport: model.transport });
	return { store, ctx, session, ...model };
}

const setName = (value: string): Omit<ToolCall, 'id'> => ({
	name: 'set_field',
	arguments: JSON.stringify({ expected_revision: '__REV__', path: `${CARD}.name`, value })
});
const texts = (store: ReturnType<typeof setup>['store']) =>
	store.ai.lines.map((l) => `${l.role}:${l.text}`);

describe('ChatSession', () => {
	it('streams a plain answer into one bubble', async () => {
		const t = setup([{ text: 'Ahoj, jsem tu.' }]);
		await t.session.send('Ahoj');
		expect(texts(t.store)).toEqual(['user:Ahoj', 'assistant:Ahoj, jsem tu.']);
		expect(t.session.history.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(t.store.ai.running).toBe(false);
		expect(t.session.usage.totalTokens).toBe(15);
	});

	it('runs a tool, answers every call with one tool message, and goes on', async () => {
		const t = setup([{ calls: [setName('Nové jméno')] }, { text: 'Hotovo.' }]);
		await t.session.send('Přejmenuj kartu');
		const card = t.store.doc.blocks.find((b) => b.block_id === 'L1_B3_poznej');
		expect(card?.name).toBe('Nové jméno');
		const roles = t.session.history.map((m) => m.role);
		expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
		const call = (t.session.history[1] as Extract<ChatMessage, { role: 'assistant' }>).toolCalls[0];
		const reply = t.session.history[2] as Extract<ChatMessage, { role: 'tool' }>;
		expect(reply.toolCallId).toBe(call.id);
		expect(JSON.parse(reply.content).ok).toBe(true);
		expect(t.store.aiActions).toHaveLength(1);
		expect(texts(t.store)).toEqual(['user:Přejmenuj kartu', 'assistant:Hotovo.']);
	});

	it('sends the reasoning back verbatim on every later turn', async () => {
		const reasoning = [{ type: 'reasoning.encrypted', data: 'x', index: 0 }];
		const t = setup([{ calls: [setName('A')], reasoning }, { text: 'Ok.' }]);
		await t.session.send('Udělej to');
		const second = t.sent[1];
		expect((second[1] as { reasoning?: unknown }).reasoning).toEqual(reasoning);
		await t.session.send('A ještě něco');
		const third = t.sent[2];
		expect((third[1] as { reasoning?: unknown }).reasoning).toEqual(reasoning);
		// Append-only: what was sent before is a prefix of what is sent next.
		expect(third.slice(0, second.length)).toEqual(second.slice(0, second.length));
	});

	it('answers a call with bad JSON or bad arguments with an error result, not a crash', async () => {
		const t = setup([
			{
				calls: [
					{ name: 'set_field', arguments: '{"path": ' },
					{ name: 'get_card', arguments: '{"nonsense": 1}' }
				]
			},
			{ text: 'Zkusím to jinak.' }
		]);
		await t.session.send('x');
		const tools = t.session.history.filter((m) => m.role === 'tool') as Extract<
			ChatMessage,
			{ role: 'tool' }
		>[];
		expect(tools).toHaveLength(2);
		for (const m of tools) expect(JSON.parse(m.content).error.code).toBe('bad_arguments');
	});

	it('never keeps a call to a tool that does not exist', async () => {
		const t = setup([{ calls: [{ name: 'format_disk', arguments: '{}' }] }, { text: 'Ok.' }]);
		await t.session.send('x');
		const assistant = t.session.history[1] as Extract<ChatMessage, { role: 'assistant' }>;
		expect(assistant.toolCalls).toEqual([]);
		expect(t.session.history[2].role).toBe('notice');
		expect(t.sent).toHaveLength(2);
	});

	it('puts a notice before the next message when the teacher changed the course', async () => {
		const t = setup([{ text: 'První.' }, { text: 'Druhá.' }, { text: 'Třetí.' }]);
		await t.session.send('Jedna');
		await t.session.send('Dva');
		expect(t.sent[1].some((m) => m.role === 'notice')).toBe(false);
		t.store.mode = 'advanced'; // any change to the course or the mode moves the revision
		await t.session.send('Tři');
		const last = t.sent[2];
		expect(last.at(-2)).toEqual({ role: 'notice', content: STALE_NOTICE });
		expect(last.at(-1)).toEqual({ role: 'user', content: 'Tři' });
	});

	it('stops after the round limit with a Czech note, history still valid', async () => {
		const t = setup([{ calls: [{ name: 'get_course_totals', arguments: '{}' }] }]);
		await t.session.send('Pořád čti');
		expect(t.sent).toHaveLength(t.ctx.limits.maxToolRounds);
		expect(t.store.ai.lines.at(-1)).toMatchObject({ role: 'notice', text: ROUNDS_NOTE });
		const last = t.session.history.at(-1) as ChatMessage;
		expect(last.role).toBe('tool');
	});

	it('Stop ends the loop: no further request, unanswered calls get a result', async () => {
		const store = storeFor('corpus/zlomky-5-trida.json', 'teacher');
		const ctx = createHeadlessContext(store, { confirm: () => true });
		const model = script(
			[{ calls: [setName('Jedna'), setName('Dva')] }, { text: 'nikdy' }],
			() => store.revision
		);
		// Stop arrives while the first tool runs: it finishes, nothing starts after it.
		const session: ChatSession = new ChatSession({
			store,
			ctx,
			transport: model.transport,
			run: async (name, args, c) => {
				const result = await runTool(name, args, c);
				session.stop();
				return result;
			}
		});
		await session.send('Přejmenuj dvakrát');
		expect(model.sent).toHaveLength(1);
		const card = store.doc.blocks.find((b) => b.block_id === 'L1_B3_poznej');
		expect(card?.name).toBe('Jedna');
		const tools = session.history.filter((m) => m.role === 'tool') as Extract<
			ChatMessage,
			{ role: 'tool' }
		>[];
		expect(tools).toHaveLength(2);
		expect(JSON.parse(tools[0].content).ok).toBe(true);
		expect(JSON.parse(tools[1].content).ok).toBe(false);
		expect(store.ai.lines.at(-1)?.text).toBe('Zastaveno.');
		expect(session.running).toBe(false);
	});

	it('Stop while the teacher is being asked answers no', async () => {
		const store = storeFor('corpus/zlomky-5-trida.json', 'teacher');
		const ctx = createHeadlessContext(store, { confirm: (r) => store.ai.ask(r) });
		const model = script(
			[
				{
					calls: [
						{
							name: 'delete',
							arguments: JSON.stringify({
								expected_revision: '__REV__',
								path: '$.blocks[block_id=L1_B3_poznej]',
								repairs: []
							})
						}
					]
				},
				{ text: 'nikdy' }
			],
			() => store.revision
		);
		const session = new ChatSession({ store, ctx, transport: model.transport });
		const before = JSON.stringify(store.source);
		const running = session.send('Smaž kartu');
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
		expect(store.ai.confirm).not.toBeNull();
		session.stop();
		await running;
		expect(store.ai.confirm).toBeNull();
		expect(JSON.stringify(store.source)).toBe(before);
		expect(model.sent).toHaveLength(1);
	});

	it('notes a reply cut off at the length limit, and shows an error as the server worded it', async () => {
		const a = setup([{ text: 'Začátek', finish: 'length' }]);
		await a.session.send('x');
		expect(a.store.ai.lines.at(-1)).toMatchObject({ role: 'notice', text: LENGTH_NOTE });
		const b = setup([{ error: 'Denní limit AI je vyčerpán. Zkus to zítra.' }]);
		await b.session.send('x');
		expect(b.store.ai.lines.at(-1)).toEqual({
			id: expect.any(Number),
			role: 'error',
			text: 'Denní limit AI je vyčerpán. Zkus to zítra.'
		});
		expect(b.store.ai.running).toBe(false);
	});
});

describe('sseData and httpTransport', () => {
	async function* chunks(...parts: string[]) {
		for (const p of parts) yield p;
	}
	it('joins events split across chunks', async () => {
		const out: string[] = [];
		for await (const d of sseData(chunks('data: {"a"', ':1}\n\ndata: 2\n', '\ndata: 3\r\n\r\n')))
			out.push(d);
		expect(out).toEqual(['{"a":1}', '2', '3']);
	});

	it('posts the conversation with the owner header and yields the events', async () => {
		const seen: RequestInit[] = [];
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				const enc = new TextEncoder();
				c.enqueue(enc.encode('data: {"type":"text_delta","text":"Ah"}\n\n'));
				c.enqueue(
					enc.encode(
						'data: {"type":"done","finishReason":"stop","assistant":{"role":"assistant","text":"Ah","toolCalls":[]},"usage":{"promptTokens":1,"completionTokens":1,"totalTokens":2}}\n\n'
					)
				);
				c.close();
			}
		});
		const transport = httpTransport({
			fetcher: async (_url, init) => {
				seen.push(init ?? {});
				return new Response(body);
			},
			workspace: () => ({ header: 'x-editor-workspace', key: 'K' })
		});
		const events: StreamEvent[] = [];
		for await (const e of transport(
			[{ role: 'user', content: 'Ahoj' }],
			new AbortController().signal
		))
			events.push(e);
		expect(events.map((e) => e.type)).toEqual(['text_delta', 'done']);
		expect((seen[0].headers as Record<string, string>)['x-editor-workspace']).toBe('K');
		expect(JSON.parse(seen[0].body as string)).toEqual({
			messages: [{ role: 'user', content: 'Ahoj' }]
		});
	});

	it('turns a refusal into an error event with the server message', async () => {
		const transport = httpTransport({
			fetcher: async () =>
				new Response(JSON.stringify({ message: 'AI není nastavena.', code: 'not_configured' }), {
					status: 503
				})
		});
		const events: StreamEvent[] = [];
		for await (const e of transport([], new AbortController().signal)) events.push(e);
		expect(events).toEqual([
			{ type: 'error', message: 'AI není nastavena.', code: 'not_configured' }
		]);
	});
});
