import { describe, expect, it, vi } from 'vitest';
import {
	outlineRequestSchema,
	applyEvent,
	outlineSchema,
	type Outline,
	type OutlineEvent,
	type OutlineRequest
} from '$lib/domain/outline';
import { fakeOutline, fakeStream } from '../fake';
import {
	MATERIALS_LABEL,
	outlineEvents,
	outlineMessage,
	OUTLINE_SYSTEM_PROMPT,
	onlyKnownSources
} from '../outline';
import {
	buildBody,
	ProviderError,
	sseReader,
	streamer,
	type Message,
	type Stream
} from '../provider';
import { readAiConfig } from '../config';

const request = (over: Partial<OutlineRequest> = {}): OutlineRequest => ({
	schema: 'eduai.outline-request/1',
	prompt: 'Kurz o zlomcích pro 5. třídu, 3 lekce',
	course: { title: 'Zlomky', language: 'cs', audience: { grade: 5 } },
	target: { lessons: 0 },
	context: 'Kurz: Zlomky',
	...over
});

/** A model that answers with the given texts, one per call, cut into pieces of `cut` characters. */
const scripted = (cut: number, ...answers: string[]) => {
	const seen: Message[][] = [];
	let calls = 0;
	const stream: Stream = async (messages, onText) => {
		seen.push([...messages]);
		const text = answers[Math.min(calls++, answers.length - 1)];
		for (let i = 0; i < text.length; i += cut) onText(text.slice(i, i + cut));
		return { tokens: 7 };
	};
	return Object.assign(stream, { seen, calls: () => calls });
};

const run = async (r: OutlineRequest, stream: Stream, spent?: (n: number) => void) => {
	const events: OutlineEvent[] = [];
	for await (const e of outlineEvents(r, stream, spent)) events.push(e);
	return events;
};

const L = (name: string, ...cards: [string, string][]) =>
	JSON.stringify({ name, cards: cards.map(([kind, n]) => ({ kind, name: n })) });
const GOOD = [
	'{"scope":"lessons"}',
	L('Půlka', ['display', 'Co je půlka'], ['exercise', 'Příklady']),
	L('Třetina', ['display', 'Co je třetina'])
].join('\n');

describe('outlineEvents', () => {
	it('passes each lesson on as it arrives, however the text is cut, then says done', async () => {
		for (const cut of [1, 7, 1000]) {
			const spent = vi.fn();
			const events = await run(request(), scripted(cut, GOOD), spent);
			expect(events.map((e) => e.type)).toEqual(['scope', 'lesson', 'lesson', 'done']);
			expect(spent).toHaveBeenCalledWith(7);
		}
	});

	it('sends a lesson before the model has finished', async () => {
		const order: string[] = [];
		const stream: Stream = async (_m, onText) => {
			onText('{"scope":"lessons"}\n');
			onText(`${L('A', ['display', 'B'])}\n`);
			// Nothing has been awaited yet: the first lesson is handed on while the model goes on.
			await new Promise((r) => setTimeout(r, 20));
			order.push('model finished');
			return { tokens: 0 };
		};
		for await (const e of outlineEvents(request(), stream)) order.push(e.type);
		expect(order.indexOf('lesson')).toBeLessThan(order.indexOf('model finished'));
	});

	it('works for cards, one per line, and without a final newline', async () => {
		const answer =
			'{"scope":"cards"}\n{"kind":"exercise","name":"A"}\n{"kind":"question","name":"B"}';
		const events = await run(request({ target: { lesson: 'X', lessons: 1 } }), scripted(5, answer));
		expect(events.map((e) => e.type)).toEqual(['scope', 'card', 'card', 'done']);
	});

	it('infers the scope when the model leaves the line out', async () => {
		const events = await run(request(), scripted(9, `${L('A', ['display', 'B'])}\n`));
		expect(events.map((e) => e.type)).toEqual(['scope', 'lesson', 'done']);
	});

	it('asks again for the bad lines only, and sends the repaired ones after the good ones', async () => {
		const bad = '{"name":"Zlom","cards":[]}';
		const first = [
			'{"scope":"lessons"}',
			L('A', ['display', 'B']),
			bad,
			L('C', ['display', 'D'])
		].join('\n');
		const model = scripted(11, first, L('Zlom', ['display', 'E']));
		const events = await run(request(), model);
		expect(events.map((e) => (e.type === 'lesson' ? e.lesson.name : e.type))).toEqual([
			'scope',
			'A',
			'C',
			'Zlom',
			'done'
		]);
		expect(model.calls()).toBe(2);
		const last = model.seen[1].at(-1)!.content;
		expect(last).toContain(bad);
		expect(last).toMatch(/only corrected versions/);
	});

	it('reports a damaged line and recovers it', async () => {
		const model = scripted(
			50,
			`{"scope":"lessons"}\n{"name":"A","cards":[{"kind":"disp\n${L('B', ['display', 'C'])}\n`,
			`${L('A', ['display', 'Z'])}\n`
		);
		const events = await run(request(), model);
		expect(events.filter((e) => e.type === 'lesson')).toHaveLength(2);
		expect(events.at(-1)).toEqual({ type: 'done' });
	});

	it('refuses a name with a $ sign, with the reason', async () => {
		const model = scripted(
			50,
			`{"scope":"lessons"}\n${L('Součet', ['display', '$\\frac{1}{2}$'])}\n`,
			L('Součet', ['display', 'Poloviny'])
		);
		const events = await run(request(), model);
		expect(events.map((e) => e.type)).toEqual(['scope', 'lesson', 'done']);
		expect(model.seen[1].at(-1)!.content).toMatch(/plain text/);
	});

	it('asks for everything again when the scope cannot be used, and sends nothing of the bad round', async () => {
		const cards = '{"scope":"cards"}\n{"kind":"display","name":"A"}\n';
		const model = scripted(50, cards, GOOD);
		const events = await run(request({ target: { lessons: 0 } }), model);
		expect(events.map((e) => e.type)).toEqual(['scope', 'lesson', 'lesson', 'done']);
		expect(model.seen[1].at(-1)!.content).toMatch(/no lesson/);
	});

	it('fails after three rounds with nothing usable, and logs no course text', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const model = scripted(50, 'nothing here');
		const events = await run(request({ prompt: 'TAJNÉ ZADÁNÍ' }), model);
		expect(events).toEqual([{ type: 'failed' }]);
		expect(model.calls()).toBe(3);
		expect(JSON.stringify(log.mock.calls)).not.toMatch(/TAJNÉ|Zlomky/);
		log.mockRestore();
	});

	it('lets what was good stand when a line stays bad after the retries', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const model = scripted(
			50,
			`{"scope":"lessons"}\n${L('A', ['display', 'B'])}\n{"name":"X","cards":[]}\n`
		);
		const events = await run(request(), model);
		expect(events.at(-1)).toEqual({ type: 'done' });
		expect(model.calls()).toBe(3);
		log.mockRestore();
	});

	it('puts the system prompt first, the dossier second and the request last', async () => {
		const model = scripted(50, GOOD);
		await run(request(), model);
		const [system, dossier, last] = model.seen[0];
		expect(system.content).toBe(OUTLINE_SYSTEM_PROMPT);
		expect(dossier.content).toContain('Kurz: Zlomky');
		expect(JSON.parse(last.content)).not.toHaveProperty('context');
		expect(JSON.parse(last.content).prompt).toContain('zlomcích');
	});

	it('asks for names only and for plain-text names', () => {
		expect(OUTLINE_SYSTEM_PROMPT).toMatch(/Write nothing else about a card or lesson/);
		expect(OUTLINE_SYSTEM_PROMPT).toMatch(/Names of cards and lessons: plain text/);
		expect(OUTLINE_SYSTEM_PROMPT).not.toMatch(/takeaway|"brief"/);
	});
});

describe('the fake provider', () => {
	it('streams a valid proposal, the same every time, with a pause between lessons', async () => {
		const pieces: { at: number; text: string }[] = [];
		const t0 = Date.now();
		await fakeStream([{ role: 'user', content: JSON.stringify(request()) }], (text) =>
			pieces.push({ at: Date.now() - t0, text })
		);
		const text = pieces.map((p) => p.text).join('');
		expect(text.split('\n').filter(Boolean)).toHaveLength(3);
		expect(pieces.at(-1)!.at).toBeGreaterThan(pieces[1].at + 50);
		const events = await run(request(), scripted(1000, text));
		expect(events.at(-1)).toEqual({ type: 'done' });
	});

	it('answers a change with the proposal and one more card', () => {
		const first = fakeOutline(request());
		const next = fakeOutline(request({ prompt: 'přidej kvíz', current: first }));
		expect(outlineSchema.safeParse(next).success).toBe(true);
		expect(JSON.stringify(next)).toContain('Změna: přidej kvíz');
		expect(outlineRequestSchema.safeParse(request({ current: first })).success).toBe(true);
	});
});

describe('the provider stream', () => {
	it('reads text and usage out of event-stream lines cut anywhere', () => {
		const got: string[] = [];
		const reader = sseReader((p) => got.push(p));
		const text =
			': OPENROUTER PROCESSING\n\n' +
			'data: {"choices":[{"delta":{"content":"{\\"sc"}}]}\n\n' +
			'data: {"choices":[{"delta":{"content":"ope\\":1}\\n"}}]}\n\n' +
			'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":10}}\n\n' +
			'data: [DONE]\n\n';
		for (let i = 0; i < text.length; i += 13) reader.feed(text.slice(i, i + 13));
		expect(got.join('')).toBe('{"scope":1}\n');
		expect(reader.end()).toEqual({ tokens: 110, finished: true });
	});

	it('asks for a stream without the JSON-object mode, keeping the host rules', () => {
		const body = buildBody(readAiConfig({ AI_API_KEY: 'k' }), [], { stream: true });
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
		expect(body.response_format).toBeUndefined();
		expect(body.provider).toMatchObject({ data_collection: 'deny', max_price: { prompt: 0.5 } });
	});

	it('knows a stream that ended without a finish, or with an error event, was cut', () => {
		const run = (text: string) => {
			const reader = sseReader(() => {});
			reader.feed(text);
			return reader.end();
		};
		const piece = 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n';
		expect(run(piece)).toMatchObject({ finished: false });
		expect(
			run(`${piece}data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n`)
		).toMatchObject({
			finished: true
		});
		expect(run(`${piece}data: [DONE]\n`)).toMatchObject({ finished: true });
		expect(run(`${piece}data: {"error":{"message":"upstream failed"}}\n\n`)).toMatchObject({
			error: 'upstream failed'
		});
	});

	const reply = (text: string) =>
		(async () =>
			new Response(text, {
				headers: { 'content-type': 'text/event-stream' }
			})) as unknown as typeof fetch;
	const config = readAiConfig({ AI_API_KEY: 'k' });
	const piece = 'data: {"choices":[{"delta":{"content":"{\\"scope\\":\\"cards\\"}\\n"}}]}\n\n';

	it('fails a stream that stops without a finish, after handing on what it had', async () => {
		const got: string[] = [];
		await expect(streamer(config, reply(piece))([], (t) => got.push(t))).rejects.toMatchObject({
			kind: 'network'
		});
		expect(got).toEqual(['{"scope":"cards"}\n']);
	});

	it('fails a stream with an error event in it', async () => {
		const text = `${piece}data: {"error":{"message":"boom"}}\n\ndata: [DONE]\n\n`;
		await expect(streamer(config, reply(text))([], () => {})).rejects.toBeInstanceOf(ProviderError);
	});

	it('takes a stream that finishes, with its usage', async () => {
		const text = `${piece}data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\ndata: [DONE]\n\n`;
		await expect(streamer(config, reply(text))([], () => {})).resolves.toEqual({ tokens: 15 });
	});

	it('hands the abort signal to the host call', async () => {
		let seen: AbortSignal | null | undefined;
		const fetcher = (async (_url: string, init: RequestInit) => {
			seen = init.signal;
			return new Response('data: [DONE]\n\n');
		}) as unknown as typeof fetch;
		const controller = new AbortController();
		await streamer(config, fetcher)([], () => {}, controller.signal);
		controller.abort();
		expect(seen?.aborted).toBe(true);
	});
});

describe('every ending is counted', () => {
	it('counts a call that failed after two lessons, by what had arrived', async () => {
		const spent = vi.fn();
		const stream: Stream = async (_m, onText) => {
			onText('{"scope":"lessons"}\n');
			onText(`${L('A', ['display', 'B'])}\n`);
			throw new ProviderError('network', 'cut');
		};
		const seen: string[] = [];
		await expect(
			(async () => {
				for await (const e of outlineEvents(request(), stream, spent)) seen.push(e.type);
			})()
		).rejects.toBeInstanceOf(ProviderError);
		expect(seen).toEqual(['scope', 'lesson']);
		expect(spent).toHaveBeenCalledTimes(1);
		expect(spent.mock.calls[0][0]).toBeGreaterThan(0);
	});

	it('counts the reported usage once for a call that finished, and estimates one that was abandoned', async () => {
		const spent = vi.fn();
		await run(request(), scripted(50, GOOD), spent);
		expect(spent.mock.calls).toEqual([[7]]);

		const abandoned = vi.fn();
		const stream: Stream = async (_m, onText) => {
			onText('{"scope":"lessons"}\n');
			onText(`${L('A', ['display', 'B'])}\n`);
			await new Promise((r) => setTimeout(r, 30));
			return { tokens: 99 };
		};
		const gen = outlineEvents(request(), stream, abandoned);
		await gen.next();
		await gen.return(undefined);
		expect(abandoned).toHaveBeenCalledTimes(1);
	});

	it('passes the abort signal to the stream', async () => {
		let seen: AbortSignal | undefined;
		const stream: Stream = async (_m, onText, signal) => {
			seen = signal;
			onText(`${GOOD}\n`);
			return { tokens: 1 };
		};
		const controller = new AbortController();
		await run(request(), stream);
		for await (const _ of outlineEvents(request(), stream, undefined, controller.signal)) void _;
		expect(seen).toBe(controller.signal);
	});
});

describe('lines asked for again', () => {
	const order = (events: OutlineEvent[]) => {
		let so: Outline | null = null;
		for (const e of events) so = applyEvent(so, e);
		return so?.scope === 'lessons' ? so.lessons.map((l) => l.name) : [];
	};

	it('go back to their own place, however many are mended', async () => {
		const first = [
			'{"scope":"lessons"}',
			L('A', ['display', 'a']),
			'{"name":"B","cards":[]}',
			L('C', ['display', 'c']),
			'{"name":"D","cards":[]}',
			L('E', ['display', 'e'])
		].join('\n');
		const model = scripted(50, first, `${L('B', ['display', 'b'])}\n${L('D', ['display', 'd'])}\n`);
		const events = await run(request(), model);
		expect(order(events)).toEqual(['A', 'B', 'C', 'D', 'E']);
		expect(events.at(-1)).toEqual({ type: 'done' });
		const mended = events.filter((e) => e.type === 'lesson' && e.at !== undefined);
		expect(mended).toHaveLength(2);
	});

	it('are placed by what is still there when only some of them are mended', async () => {
		const first = [
			'{"scope":"lessons"}',
			L('A', ['display', 'a']),
			'{"name":"B","cards":[]}',
			L('C', ['display', 'c']),
			'{"name":"D","cards":[]}',
			L('E', ['display', 'e'])
		].join('\n');
		// The retry mends only the second asked-for line, the first stays bad.
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const model = scripted(
			50,
			first,
			`{"name":"B","cards":[]}\n${L('D', ['display', 'd'])}\n`,
			'{"name":"B","cards":[]}\n'
		);
		const events = await run(request(), model);
		expect(order(events)).toEqual(['A', 'C', 'D', 'E']);
		log.mockRestore();
	});

	it('take only the lines that were asked for: a whole proposal again is refused', async () => {
		const first = ['{"scope":"lessons"}', L('A', ['display', 'a']), '{"name":"B","cards":[]}'].join(
			'\n'
		);
		const whole = `{"scope":"lessons"}\n${L('A', ['display', 'a'])}\n${L('B', ['display', 'b'])}\n`;
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const model = scripted(50, first, whole, `${L('B', ['display', 'b'])}\n`);
		const events = await run(request(), model);
		expect(order(events)).toEqual(['A', 'B']);
		expect(model.seen[2].at(-1)!.content).toMatch(/only 1 were asked for/);
		log.mockRestore();
	});

	it('does not take a line of the other kind as a mended one', async () => {
		const first = [
			'{"scope":"lessons"}',
			L('A', ['display', 'a']),
			'{"name":"B","cards":[]}',
			L('C', ['display', 'c'])
		].join('\n');
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		// The retry answers with a card line, which a lessons proposal cannot hold.
		const model = scripted(50, first, '{"kind":"display","name":"B"}\n');
		const events = await run(request(), model);
		expect(events.some((e) => e.type === 'card')).toBe(false);
		expect(order(events)).toEqual(['A', 'C']);
		// A later, right answer is still placed at the right index.
		const again = scripted(
			50,
			first,
			'{"kind":"display","name":"B"}\n',
			`${L('B', ['display', 'b'])}\n`
		);
		const later = await run(request(), again);
		expect(order(later)).toEqual(['A', 'B', 'C']);
		log.mockRestore();
	});
});

describe('materials in a proposal', () => {
	const keys = ['aaaaaaaa.0', 'aaaaaaaa.1'];
	const withMaterials = () =>
		request({ materials: 'Index of the materials:\n- [aaaaaaaa.0] x', material_keys: keys });
	const card = (name: string, sources?: string[]) =>
		JSON.stringify({ kind: 'display', name, ...(sources ? { sources } : {}) });

	it('sends the materials after the dossier and before the request, labelled, and keeps them out of the request', async () => {
		const model = scripted(1000, GOOD);
		await run(withMaterials(), model);
		const messages = model.seen[0];
		expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user']);
		expect(messages[1].content).toContain('Course dossier');
		expect(messages[2].content.startsWith(MATERIALS_LABEL)).toBe(true);
		expect(messages[2].content).toContain('[aaaaaaaa.0]');
		expect(messages[3].content.startsWith('{')).toBe(true);
		expect(messages[3].content).not.toContain('Index of the materials');
		expect(messages[3].content).not.toContain('material_keys');
		expect(outlineMessage(withMaterials())).not.toContain('aaaaaaaa');
		expect(OUTLINE_SYSTEM_PROMPT).toContain('"sources"');
	});

	it('sends no materials message when there are none', async () => {
		const model = scripted(1000, GOOD);
		await run(request(), model);
		expect(model.seen[0].map((m) => m.role)).toEqual(['system', 'user', 'user']);
	});

	it('passes the sources of a card on, and drops a key that is not among the materials', async () => {
		const answer = [
			'{"scope":"cards"}',
			card('A', ['aaaaaaaa.1', 'made.up', 'aaaaaaaa.1']),
			card('B', ['nothing.9']),
			card('C')
		].join('\n');
		const events = await run(
			{ ...withMaterials(), target: { lessons: 1 } },
			scripted(1000, answer),
			undefined
		);
		const cards = events.flatMap((e) => (e.type === 'card' ? [e.card] : []));
		expect(cards).toEqual([
			{ kind: 'display', name: 'A', sources: ['aaaaaaaa.1'] },
			{ kind: 'display', name: 'B' },
			{ kind: 'display', name: 'C' }
		]);
	});

	it('does the same for the cards inside a lesson, and for every key when there were no materials', async () => {
		const lesson = JSON.stringify({
			name: 'L',
			cards: [{ kind: 'display', name: 'A', sources: ['aaaaaaaa.0', 'zzz'] }]
		});
		const events = await run(
			withMaterials(),
			scripted(1000, `{"scope":"lessons"}\n${lesson}`),
			undefined
		);
		const lessons = events.flatMap((e) => (e.type === 'lesson' ? [e.lesson] : []));
		expect(lessons[0].cards[0].sources).toEqual(['aaaaaaaa.0']);
		expect(onlyKnownSources({ type: 'done' }, new Set())).toEqual({ type: 'done' });
		// Sources the teacher's request had are not trusted without materials either.
		const bare = await run(request(), scripted(1000, `{"scope":"lessons"}\n${lesson}`));
		const kept = bare.flatMap((e) => (e.type === 'lesson' ? [e.lesson] : []));
		expect(kept[0].cards[0]).toEqual({ kind: 'display', name: 'A' });
	});

	it('the fake gives its first card the first section when there are materials', async () => {
		const outline = fakeOutline(withMaterials());
		expect(outline.scope === 'lessons' && outline.lessons[0].cards[0].sources).toEqual([
			'aaaaaaaa.0'
		]);
		const none = fakeOutline(request());
		expect(none.scope === 'lessons' && none.lessons[0].cards[0].sources).toBeUndefined();
	});
});
