/**
 * Does the outline prompt follow what the teacher asked for? Runs the real model, so it
 * is skipped unless EVAL is set and it is not part of `npm test`'s result:
 *
 *   set -a; source <the .env with AI_API_KEY>; set +a
 *   npm run eval:ai
 *
 * The provider comes from the environment the way the server reads it (`config.ts`). Each
 * prompt is sent once; the report says pass or fail per prompt and what the model gave.
 * A model's answer varies, so a single failure is a signal, not a verdict: run it twice.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
	applyEvent,
	cardCount,
	type Outline,
	type OutlineEvent,
	type OutlineKind,
	type OutlineRequest
} from '$lib/domain/outline';
import { readAiConfig } from '../config';
import { outlineEvents } from '../outline';
import { streamer } from '../provider';

const ON = !!process.env.EVAL;

const base = (over: Partial<OutlineRequest> & { prompt: string }): OutlineRequest => ({
	schema: 'eduai.outline-request/1',
	course: { title: 'Zlomky', language: 'cs', audience: { grade: 5 } },
	target: { lessons: 0 },
	context: 'Kurz: Zlomky\nPro 5. třídu.',
	...over
});

/** A teacher in the lesson „Sčítání zlomků“, with two lessons in the course. */
const inLesson = (prompt: string, over: Partial<OutlineRequest> = {}) =>
	base({
		prompt,
		target: { lesson: 'Sčítání zlomků', card: 'Úvod', lessons: 2 },
		context:
			'Kurz: Zlomky\nPro 5. třídu.\nLekce 1: Co je zlomek (Výklad: Půlka a čtvrtina)\nLekce 2: Sčítání zlomků (Výklad: Úvod)',
		...over
	});
/** A course with lessons but none selected. */
const noneSelected = (prompt: string, over: Partial<OutlineRequest> = {}) =>
	base({ prompt, target: { lessons: 2 }, ...over });

const MATERIALS = `Index of the materials:\n[aaaa1111.0] Sčítání zlomků se stejným jmenovatelem\n[aaaa1111.1] Příklady na sčítání\n[bbbb2222.0] Krácení zlomků\n\nThe materials in full:\n\n[aaaa1111.0] Sčítání zlomků se stejným jmenovatelem\nPři sčítání zlomků se stejným jmenovatelem sečteme čitatele a jmenovatel opíšeme. 1/5 + 2/5 = 3/5.\n\n[aaaa1111.1] Příklady na sčítání\n2/7 + 3/7 = ?  1/9 + 4/9 = ?  3/8 + 2/8 = ?\n\n[bbbb2222.0] Krácení zlomků\nZlomek zkrátíme tak, že čitatele i jmenovatele vydělíme stejným číslem. 4/6 = 2/3.`;
const withMaterials = (r: OutlineRequest): OutlineRequest => ({
	...r,
	materials: MATERIALS,
	material_keys: ['aaaa1111.0', 'aaaa1111.1', 'bbbb2222.0']
});

const TEST_KINDS: OutlineKind[] = ['question', 'exercise'];

type Expect = {
	/** Every card is one of these kinds. */
	kinds?: OutlineKind[];
	/** Cards in all: a number, or [min, max]. */
	cards?: number | [number, number];
	lessons?: number | [number, number];
	/** At least one card of each of these kinds. */
	has?: OutlineKind[];
	/** Every one of these card names is still in the proposal. */
	keeps?: string[];
	/** Card sources of the whole proposal reach each of these files. */
	files?: string[];
};

const within = (n: number, want: number | [number, number]) =>
	typeof want === 'number' ? n === want : n >= want[0] && n <= want[1];

const cardsOf = (o: Outline) => (o.scope === 'cards' ? o.cards : o.lessons.flatMap((l) => l.cards));

function judge(o: Outline | null, want: Expect): string[] {
	if (o === null) return ['no proposal'];
	const fails: string[] = [];
	const cards = cardsOf(o);
	if (want.kinds) {
		const bad = cards.filter((c) => !want.kinds!.includes(c.kind));
		if (bad.length)
			fails.push(`kinds outside ${want.kinds.join('/')}: ${bad.map((c) => c.kind).join(',')}`);
	}
	if (want.cards !== undefined && !within(cardCount(o), want.cards))
		fails.push(`${cardCount(o)} cards, wanted ${JSON.stringify(want.cards)}`);
	if (want.lessons !== undefined) {
		const n = o.scope === 'lessons' ? o.lessons.length : 0;
		if (!within(n, want.lessons))
			fails.push(`${n} lessons, wanted ${JSON.stringify(want.lessons)}`);
	}
	for (const k of want.has ?? [])
		if (!cards.some((c) => c.kind === k)) fails.push(`no "${k}" card`);
	for (const name of want.keeps ?? [])
		if (!cards.some((c) => c.name === name)) fails.push(`lost card "${name}"`);
	for (const file of want.files ?? [])
		if (!cards.some((c) => c.sources?.some((s) => s.startsWith(file))))
			fails.push(`file ${file} not used`);
	return fails;
}

interface Case {
	name: string;
	request: OutlineRequest;
	want: Expect;
}

const LESSONS_NOW: Outline = {
	scope: 'lessons',
	lessons: [
		{
			name: 'Co je zlomek',
			cards: [
				{ kind: 'display', name: 'Půlka a čtvrtina' },
				{ kind: 'exercise', name: 'Poznej zlomek' }
			]
		},
		{
			name: 'Sčítání zlomků',
			cards: [
				{ kind: 'display', name: 'Sčítání se stejným jmenovatelem' },
				{ kind: 'exercise', name: 'Příklady na sčítání' }
			]
		}
	]
};
const TEST_NOW: Outline = {
	scope: 'cards',
	cards: [
		{ kind: 'question', name: 'Která část je půlka' },
		{ kind: 'exercise', name: 'Příklady na zlomky' },
		{ kind: 'question', name: 'Větší zlomek' }
	]
};

const CASES: Case[] = [
	{
		name: 'narrow, nothing selected: just a test',
		request: base({ prompt: 'Vytvoř jen test o zlomcích' }),
		want: { kinds: TEST_KINDS, lessons: [0, 1] }
	},
	{
		name: 'narrow, lessons but none selected: just a test',
		request: noneSelected('Chci jen test na zlomky'),
		want: { kinds: TEST_KINDS, lessons: [0, 1] }
	},
	{
		name: 'narrow, lesson selected: a test',
		request: inLesson('Udělej test na sčítání zlomků'),
		want: { kinds: TEST_KINDS }
	},
	{
		name: 'narrow, nothing selected: one exercise card',
		request: base({ prompt: 'Jedna karta s příklady na sčítání zlomků' }),
		want: { cards: 1, kinds: ['exercise'] }
	},
	{
		name: 'narrow, lesson selected: one explanation',
		request: inLesson('Přidej jedno vysvětlení, co je společný jmenovatel'),
		want: { cards: 1, kinds: ['display'] }
	},
	{
		name: 'count, lesson selected: 5 questions',
		request: inLesson('Přidej 5 otázek na krácení zlomků'),
		want: { cards: 5, kinds: ['question'] }
	},
	{
		name: 'count, lesson selected: 3 exercise cards',
		request: inLesson('Cvičení na převod zlomků na desetinná čísla, tři karty'),
		want: { cards: 3, kinds: ['exercise'] }
	},
	{
		name: 'narrow, lesson selected: only explanation',
		request: inLesson('Jen výklad o společném jmenovateli'),
		want: { kinds: ['display'] }
	},
	{
		name: 'count, nothing selected: test of 8 tasks',
		request: base({ prompt: 'Test na zlomky, 8 úloh' }),
		want: { cards: 8, kinds: TEST_KINDS, lessons: [0, 1] }
	},
	{
		name: 'count, lesson selected: quiz of 10 questions at the end',
		request: inLesson('Udělej kvíz na závěr lekce, 10 otázek'),
		want: { cards: 10, kinds: TEST_KINDS }
	},
	{
		name: 'narrow, lesson selected: one yes/no question',
		request: inLesson('Přidej kartu s jednou otázkou ano/ne o půlce'),
		want: { cards: 1, kinds: ['question'] }
	},
	{
		name: 'narrow, lesson selected: add an exercise',
		request: inLesson('Přidej cvičení'),
		want: { kinds: ['exercise'] }
	},
	{
		name: 'count, lesson selected: revision of 4 cards',
		request: inLesson('Zopakuj učivo, 4 karty'),
		want: { cards: 4 }
	},
	{
		name: 'narrow, nothing selected: three lessons, only practice',
		request: base({ prompt: 'Tři lekce o zlomcích, každá jen s cvičením' }),
		want: { lessons: 3, kinds: ['exercise'] }
	},
	{
		name: 'broad, nothing selected: a course',
		request: base({ prompt: 'Kurz o zlomcích pro 5. třídu, 3 lekce' }),
		want: { lessons: 3, has: ['display', 'exercise'] }
	},
	{
		name: 'broad, nothing selected: a lesson in general',
		request: base({ prompt: 'Sestav lekci o desetinných číslech' }),
		want: { lessons: [1, 2], cards: [3, 12], has: ['display', 'exercise'] }
	},
	{
		name: 'materials, broad: a course from two files',
		request: withMaterials(base({ prompt: 'Vytvoř kurz podle mých materiálů' })),
		want: { has: ['display'], files: ['aaaa1111', 'bbbb2222'] }
	},
	{
		name: 'materials, narrow: one exercise card from one section',
		request: withMaterials(
			inLesson('Z materiálů udělej jen jednu kartu s cvičením na sčítání zlomků')
		),
		want: { cards: 1, kinds: ['exercise'] }
	},
	{
		name: 'materials, narrow: just a test from them',
		request: withMaterials(base({ prompt: 'Z materiálů udělej jen test' })),
		want: { kinds: TEST_KINDS, lessons: [0, 1] }
	},
	{
		name: 'rework: one more question at the end of a lesson proposal',
		request: base({
			prompt: 'Přidej na konec poslední lekce ještě jednu otázku',
			original: 'Kurz o zlomcích, 2 lekce',
			current: LESSONS_NOW
		}),
		want: {
			lessons: 2,
			cards: cardCount(LESSONS_NOW) + 1,
			keeps: ['Půlka a čtvrtina', 'Příklady na sčítání']
		}
	},
	{
		name: 'rework: remove the last card of a test',
		request: inLesson('Odstraň poslední kartu', { original: 'Test na zlomky', current: TEST_NOW }),
		want: { cards: 2, kinds: TEST_KINDS, keeps: ['Která část je půlka', 'Příklady na zlomky'] }
	},
	{
		name: 'rework: one more task in a test, no explanation',
		request: inLesson('Ještě jednu úlohu', { original: 'Test na zlomky', current: TEST_NOW }),
		want: { cards: cardCount(TEST_NOW) + 1, kinds: TEST_KINDS }
	},
	{
		name: 'rework: a hand-made lesson with no cards gets some',
		request: base({
			prompt: 'Dopiš karty',
			current: {
				scope: 'lessons',
				lessons: [{ name: 'Porovnávání zlomků', cards: [] }]
			}
		}),
		want: { lessons: 1, cards: [1, 12] }
	}
];

const results: { name: string; ok: boolean; why: string; got: string }[] = [];

describe.skipIf(!ON)('outline prompt against the real model', () => {
	const config = readAiConfig(process.env);
	afterAll(() => {
		const passed = results.filter((r) => r.ok).length;
		const lines = results.map(
			(r) =>
				`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}\n      got: ${r.got}`}`
		);
		process.stdout.write(
			`\n${lines.join('\n')}\n\n${passed}/${results.length} passed (${config.model})\n`
		);
	});

	it.concurrent.each(CASES)('$name', { timeout: 240_000 }, async ({ name, request, want }) => {
		expect(config.provider === 'fake' || config.apiKey !== '', 'AI_API_KEY is not set').toBe(true);
		let outline: Outline | null = null;
		let failed = false;
		for await (const e of outlineEvents(request, streamer(config)) as AsyncIterable<OutlineEvent>) {
			if (e.type === 'failed') failed = true;
			outline = applyEvent(outline, e);
		}
		const fails = failed && outline === null ? ['the call failed'] : judge(outline, want);
		const got =
			outline === null
				? 'nothing'
				: outline.scope === 'cards'
					? `cards: ${outline.cards.map((c) => `${c.kind}:${c.name}`).join(' | ')}`
					: `lessons: ${outline.lessons.map((l) => `${l.name} [${l.cards.map((c) => c.kind[0]).join('')}]`).join(' | ')}`;
		results.push({ name, ok: fails.length === 0, why: fails.join('; '), got });
		expect(fails).toEqual([]);
	});
});
