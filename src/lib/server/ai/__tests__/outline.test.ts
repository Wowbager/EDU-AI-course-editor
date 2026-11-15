import { describe, expect, it, vi } from 'vitest';
import {
	outlineRequestSchema,
	outlineSchema,
	type OutlineEvent,
	type OutlineRequest
} from '$lib/domain/outline';
import { fakeOutline, fakeStream } from '../fake';
import { outlineEvents, OUTLINE_SYSTEM_PROMPT } from '../outline';
import { buildBody, sseReader, type Message, type Stream } from '../provider';
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
		expect(reader.end()).toEqual({ tokens: 110 });
	});

	it('asks for a stream without the JSON-object mode, keeping the host rules', () => {
		const body = buildBody(readAiConfig({ AI_API_KEY: 'k' }), [], { stream: true });
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
		expect(body.response_format).toBeUndefined();
		expect(body.provider).toMatchObject({ data_collection: 'deny', max_price: { prompt: 0.5 } });
	});
});
