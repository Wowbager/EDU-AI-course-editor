import { describe, expect, it, vi } from 'vitest';
import { outlineRequestSchema, outlineSchema, type OutlineRequest } from '$lib/domain/outline';
import { fakeComplete, fakeOutline } from '../fake';
import { generateOutline, OUTLINE_SYSTEM_PROMPT } from '../outline';
import type { Complete, Message } from '../provider';

const request = (over: Partial<OutlineRequest> = {}): OutlineRequest => ({
	schema: 'eduai.outline-request/1',
	prompt: 'Kurz o zlomcích pro 5. třídu, 3 lekce',
	course: { title: 'Zlomky', language: 'cs', audience: { grade: 5 } },
	target: { lessons: 0 },
	context: 'Kurz: Zlomky',
	...over
});

const scripted = (...answers: unknown[]) => {
	const seen: Message[][] = [];
	let calls = 0;
	const fn: Complete = async (messages) => {
		seen.push([...messages]);
		const answer = answers[Math.min(calls++, answers.length - 1)];
		return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), tokens: 7 };
	};
	return Object.assign(fn, { seen, calls: () => calls });
};

const GOOD = {
	scope: 'lessons',
	lessons: [
		{
			name: 'Půlka',
			takeaway: 'Poznám půlku',
			cards: [{ kind: 'display', name: 'Co je půlka', brief: 'Zavede půlku.' }]
		}
	]
};

describe('generateOutline', () => {
	it('returns the proposal and counts tokens', async () => {
		const spent = vi.fn();
		const { response, tokens } = await generateOutline(request(), scripted(GOOD), spent);
		expect(response).toEqual({ status: 'ok', outline: GOOD });
		expect(tokens).toBe(7);
		expect(spent).toHaveBeenCalledWith(7);
	});

	it('reads JSON wrapped in a code fence', async () => {
		const { response } = await generateOutline(
			request(),
			scripted('```json\n' + JSON.stringify(GOOD) + '\n```')
		);
		expect(response.status).toBe('ok');
	});

	it('sends the reason back, then accepts the repaired answer', async () => {
		const model = scripted({ scope: 'lessons', lessons: [] }, 'not json', GOOD);
		const { response, tokens } = await generateOutline(request(), model);
		expect(response.status).toBe('ok');
		expect(model.calls()).toBe(3);
		expect(tokens).toBe(21);
		const last = model.seen[2];
		expect(last.at(-1)!.role).toBe('user');
		expect(last.at(-1)!.content).toMatch(/not valid JSON/);
		expect(last.at(-3)!.content).toMatch(/expected shape/);
	});

	it('gives up after three bad answers and logs no course text', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const model = scripted({ scope: 'cards', cards: [] });
		const { response } = await generateOutline(request({ prompt: 'TAJNÉ ZADÁNÍ' }), model);
		expect(response).toEqual({ status: 'failed' });
		expect(model.calls()).toBe(3);
		expect(JSON.stringify(log.mock.calls)).not.toMatch(/TAJNÉ|Zlomky/);
		log.mockRestore();
	});

	it('refuses cards when the course has no lesson, and says why', async () => {
		const cards = { scope: 'cards', cards: [{ kind: 'display', name: 'A', brief: 'b' }] };
		const model = scripted(cards, GOOD);
		const { response } = await generateOutline(request({ target: { lessons: 0 } }), model);
		expect(response.status).toBe('ok');
		expect(model.seen[1].at(-1)!.content).toMatch(/no lesson/);
	});

	it('puts the system prompt first, the dossier second and the request last', async () => {
		const model = scripted(GOOD);
		await generateOutline(request(), model);
		const [system, dossier, last] = model.seen[0];
		expect(system.content).toBe(OUTLINE_SYSTEM_PROMPT);
		expect(dossier.content).toContain('Kurz: Zlomky');
		expect(JSON.parse(last.content)).not.toHaveProperty('context');
		expect(JSON.parse(last.content).prompt).toContain('zlomcích');
	});
});

describe('the fake provider', () => {
	it('answers an outline request with a valid proposal, the same every time', async () => {
		const ask = async (r: OutlineRequest) =>
			(await fakeComplete([{ role: 'user', content: JSON.stringify(r) }])).text;
		const a = await ask(request());
		expect(outlineSchema.safeParse(JSON.parse(a)).success).toBe(true);
		expect(JSON.parse(a).scope).toBe('lessons');
		expect(await ask(request())).toBe(a);
		const cards = JSON.parse(
			await ask(request({ prompt: 'Dej mi karty', target: { lesson: 'X', lessons: 1 } }))
		);
		expect(cards.scope).toBe('cards');
	});

	it('answers a change with the proposal and one more card', () => {
		const first = fakeOutline(request());
		const next = fakeOutline(request({ prompt: 'přidej kvíz', current: first }));
		expect(outlineSchema.safeParse(next).success).toBe(true);
		expect(JSON.stringify(next)).toContain('Změna: přidej kvíz');
		expect(outlineRequestSchema.safeParse(request({ current: first })).success).toBe(true);
	});
});
