import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importCourseJson } from '../document';
import { toView } from '../groups';
import type { BlockStep, BlockV2, CourseV2 } from '../schema';
import {
	DOSSIER_BUDGET_TOKENS,
	MARKER_CLOSE,
	MARKER_OPEN,
	TRUNCATED_NOTE,
	buildDossier,
	estimateTokens
} from '../dossier';

const text = (id: string, content: string): BlockStep => ({ id, type: 'text', content });
const question = (id: string, content: string, q: object): BlockStep =>
	({ id, type: 'question', content, question: q }) as BlockStep;

const block = (id: string, type: BlockV2['type'], steps: BlockStep[], more = {}): BlockV2 =>
	({ block_id: id, type, steps, xp: 77, ...more }) as BlockV2;

/** `lessons` lessons of `perLesson` display cards each, with `size` characters of text. */
function bulky(lessons: number, perLesson: number, size: number): CourseV2 {
	const blocks: BlockV2[] = [];
	const ls = [];
	for (let l = 0; l < lessons; l++) {
		const bindings = [];
		for (let c = 0; c < perLesson; c++) {
			const id = `B${l}_${c}`;
			blocks.push(
				block(id, 'display', [text(`${id}_s`, `L${l}C${c} ` + 'x'.repeat(size))], {
					name: `Karta ${l}-${c}`
				})
			);
			bindings.push({ block_id: id });
		}
		ls.push({ lesson_id: `LES${l}`, name: `Lekce ${l}`, blocks: bindings });
	}
	return {
		export_type: 'course_v2',
		course_id: 'K',
		name: 'Velký',
		lessons: ls,
		blocks
	} as CourseV2;
}

const small = (): CourseV2 =>
	({
		export_type: 'course_v2',
		course_id: 'KURZ_ID',
		name: 'Zlomky',
		description: 'Kurz o zlomcích',
		language: 'cs',
		ai_context: 'Používej desetinnou čárku.',
		audience: { grade: 6, purpose: 'intro' },
		lessons: [
			{
				lesson_id: 'LES_ONE',
				name: 'Úvod',
				description: 'Co je zlomek',
				ai_context: 'Jen názorně.',
				blocks: [{ block_id: 'B_VYKLAD' }, { block_id: 'B_Q' }]
			},
			{
				lesson_id: 'LES_TWO',
				name: 'Sčítání',
				description: 'Sčítání zlomků',
				blocks: [{ block_id: 'B_T1' }, { block_id: 'B_MERGED' }, { block_id: 'B_EMPTY' }]
			},
			{
				lesson_id: 'LES_THREE',
				name: 'Krácení',
				blocks: [{ block_id: 'B_LATE' }]
			}
		],
		blocks: [
			block(
				'B_VYKLAD',
				'display',
				[
					text('s_a', 'Zlomek má čitatele.\n\n![půlka](https://img.example/pic.png)'),
					{ id: 's_b', type: 'image', image: { url: 'https://img.example/x.png', alt: 'koláč' } },
					{ id: 's_c', type: 'video', video: { url: 'https://v.example/v.mp4' } },
					{ id: 's_d', type: 'audio', audio: { url: 'https://v.example/a.mp3' } }
				] as BlockStep[],
				{ name: 'Co je zlomek' }
			),
			block(
				'B_Q',
				'question',
				[
					question('s_q', 'Kolik je půlka z 8?', {
						type: 'multiple_choice',
						options: [
							{ id: 'o1', text: '4', is_correct: true, feedback: 'Správně', go_to: 'B_LATE' },
							{ id: 'o2', text: '2', is_correct: false }
						],
						solution: '8 : 2 = 4'
					})
				],
				{ hint: 'Dělíš dvěma', brief: 'Procvičit polovinu' }
			),
			block('B_T1', 'display', [text('s_t', 'Společný jmenovatel')], { name: 'Jmenovatel' }),
			block(
				'B_MERGED',
				'exercise',
				[
					text('s_m0', 'Úvod ke cvičení'),
					question('s_m1', 'Kolik je 1/2 + 1/2?', {
						type: 'numeric',
						correct_number: 1,
						tolerance: 0.1
					}),
					question('s_m2', 'Je 1/3 menší než 1/2?', {
						type: 'true_false',
						options: [
							{ id: 'true', text: 'Ano', is_correct: true },
							{ id: 'false', text: 'Ne' }
						]
					}),
					question('s_m3', 'Vysvětli krácení.', { type: 'open', correct_answer: 'Dělení obou' })
				],
				{ name: 'Cvičení sčítání', _members: ['B_M_a', 'B_M_b'] }
			),
			block('B_EMPTY', 'display', [text('s_e', '')]),
			block('B_LATE', 'display', [text('s_l1', 'První řádek pozdní\nDruhý řádek pozdní')], {
				name: 'Pozdní výklad'
			})
		]
	}) as unknown as CourseV2;

describe('buildDossier', () => {
	it('has the sections in order, with the card marked', () => {
		const out = buildDossier(small(), 'B_T1');
		const at = (s: string) => out.indexOf(s);
		const order = [
			'## Course',
			'Zlomky',
			'Používej desetinnou čárku.',
			'grade: 6',
			'## Outline',
			'# Earlier lessons',
			'Zlomek má čitatele.',
			'# Current lesson',
			MARKER_OPEN,
			'Společný jmenovatel',
			MARKER_CLOSE,
			'# Later lessons',
			'První řádek pozdní'
		].map(at);
		expect(order.every((n) => n >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(out).toContain('Cvičení:');
		expect(out).toContain('Výklad: Co je zlomek');
		expect(out).toContain('Jen názorně.');
	});

	it('marks the right card only, and only once', () => {
		const out = buildDossier(small(), 'B_MERGED', 'LES_TWO');
		expect(out.split(MARKER_OPEN)).toHaveLength(2);
		const inside = out.slice(out.indexOf(MARKER_OPEN), out.indexOf(MARKER_CLOSE));
		expect(inside).toContain('Cvičení sčítání');
		expect(inside).not.toContain('Jmenovatel');
	});

	it('renders a merged multi-question card as one card', () => {
		const out = buildDossier(small(), 'B_T1');
		const mergedAt = out.indexOf('### Cvičení: Cvičení sčítání');
		expect(mergedAt).toBeGreaterThan(0);
		expect(out.split('### Cvičení: Cvičení sčítání')).toHaveLength(2);
		const card = out.slice(mergedAt);
		expect(card).toContain('Krok 4:');
		expect(card).toContain('Správná odpověď: 1 (tolerance 0.1)');
		expect(card).toContain('Typ: ano / ne');
		expect(card).toContain('Vzorová odpověď: Dělení obou');
	});

	it('renders questions readably and media as placeholders', () => {
		const out = buildDossier(small(), 'B_T1');
		expect(out).toContain('- [✓] 4 — reakce: Správně');
		expect(out).toContain('- [ ] 2');
		expect(out).toContain('Řešení: 8 : 2 = 4');
		expect(out).toContain('Nápověda ke kartě: Dělíš dvěma');
		expect(out).toContain('Záměr karty: Procvičit polovinu');
		expect(out).toContain('[obrázek: půlka]');
		expect(out).toContain('[obrázek: koláč]');
		expect(out).toContain('[video]');
		expect(out).toContain('[zvuk]');
	});

	it('leaks no ids, URLs or app settings', () => {
		const doc = small();
		const out = buildDossier(doc, 'B_T1');
		const ids = [
			doc.course_id,
			...doc.lessons.map((l) => l.lesson_id),
			...doc.blocks.map((b) => b.block_id),
			...doc.blocks.flatMap((b) => b.steps.map((s) => s.id)),
			'o1',
			'o2',
			'http',
			'xp',
			'go_to'
		];
		for (const id of ids) expect(out).not.toContain(id);
	});

	it('drops every link target, not only web addresses', () => {
		const doc = small();
		const card = doc.blocks.find((b) => b.block_id === 'B_T1')!;
		card.steps[0].content =
			'Viz [tabulka](img/a.png), [napiš](mailto:a@b.cz) nebo mailto:c@d.cz a [x](javascript:alert(1)).';
		const out = buildDossier(doc, 'B_T1');
		expect(out).toContain('Viz tabulka, napiš nebo [odkaz] a x.');
		for (const leak of ['img/a.png', 'mailto', 'javascript', '@']) expect(out).not.toContain(leak);
	});

	it('skips empty cards in the outline, but shows the current empty card', () => {
		const out = buildDossier(small(), 'B_EMPTY');
		expect(out.split('## Outline')[1].split('# Earlier')[0]).not.toContain('Výklad:\n');
		expect(out).toContain(`${MARKER_OPEN}\n### Výklad\n(zatím prázdná)\n${MARKER_CLOSE}`);
	});

	it('uses the first text line as the name of an unnamed card, cut to 70 characters', () => {
		const doc = small();
		doc.blocks.find((b) => b.block_id === 'B_EMPTY')!.steps = [text('s_e', 'x'.repeat(100))];
		const outline = buildDossier(doc, 'B_T1').split('## Outline')[1].split('# Earlier')[0];
		expect(outline).toContain(`Výklad: ${'x'.repeat(70)}…`);
	});

	it('shows later lessons as outline and first lines only', () => {
		const out = buildDossier(small(), 'B_T1');
		const later = out.slice(out.indexOf('# Later lessons'));
		expect(later).toContain('První řádek pozdní');
		expect(later).not.toContain('Druhý řádek pozdní');
	});

	it('picks the first lesson with the card when no lesson is given, and honours lessonId', () => {
		const doc = small();
		doc.lessons[2].blocks.push({ block_id: 'B_T1' });
		const first = buildDossier(doc, 'B_T1');
		expect(first.slice(first.indexOf('# Current lesson'))).toContain('Lekce 2: Sčítání');
		const third = buildDossier(doc, 'B_T1', 'LES_THREE');
		expect(third.slice(third.indexOf('# Current lesson'))).toContain('Lekce 3: Krácení');
	});

	it('returns just the course and the outline when the card is not found', () => {
		const out = buildDossier(small(), 'NOPE');
		expect(out).toContain('## Course');
		expect(out).toContain('## Outline');
		expect(out).not.toContain('# Current lesson');
		expect(out).not.toContain(MARKER_OPEN);
	});

	it('is deterministic', () => {
		expect(buildDossier(small(), 'B_T1')).toBe(buildDossier(small(), 'B_T1'));
		const big = bulky(8, 3, 3000);
		expect(buildDossier(big, 'B4_1', undefined, 3000)).toBe(
			buildDossier(big, 'B4_1', undefined, 3000)
		);
	});
});

describe('buildDossier budget', () => {
	// 9 lessons, current = 4 (index), each lesson about 3 * 1500 chars.
	const doc = bulky(9, 3, 1500);
	const full = buildDossier(doc, 'B4_1');
	const fullTokens = estimateTokens(full);
	const has = (out: string, l: number) => out.includes(`L${l}C0 ` + 'x'.repeat(1500));

	it('keeps everything under budget', () => {
		for (let l = 0; l < 9; l++) if (l !== 5 && l < 5) expect(has(full, l)).toBe(true);
	});

	it('shrinks the farthest lessons first, and never the current or previous one', () => {
		const out = buildDossier(doc, 'B4_1', undefined, fullTokens - 1500);
		expect(estimateTokens(out)).toBeLessThanOrEqual(fullTokens - 1500);
		expect(has(out, 0)).toBe(false);
		expect(has(out, 1)).toBe(true);
		expect(has(out, 3)).toBe(true);
		expect(has(out, 4)).toBe(true);
		expect(out).toContain('Karta 0-0');

		const tighter = buildDossier(doc, 'B4_1', undefined, fullTokens - 2600);
		expect(has(tighter, 0)).toBe(false);
		expect(has(tighter, 1)).toBe(false);
		expect(has(tighter, 2)).toBe(true);
		expect(has(tighter, 3)).toBe(true);
	});

	it('never shrinks the current lesson, even with a tiny budget', () => {
		const out = buildDossier(doc, 'B4_1', undefined, 4000);
		for (let l = 0; l < 3; l++) expect(has(out, l)).toBe(false);
		expect(has(out, 3)).toBe(true);
		expect(has(out, 4)).toBe(true);
		expect(out).toContain(MARKER_OPEN);
	});

	it('truncates the outline, then the earliest content, as a last resort', () => {
		const out = buildDossier(doc, 'B4_1', undefined, 2500);
		expect(out).toContain(TRUNCATED_NOTE);
		expect(estimateTokens(out)).toBeLessThanOrEqual(2500);
		expect(out).toContain(MARKER_CLOSE);
		const tiny = buildDossier(doc, 'B4_1', undefined, 1500);
		expect(tiny).toContain(TRUNCATED_NOTE);
		expect(estimateTokens(tiny)).toBeLessThanOrEqual(1500);
	});
});

const A2 = '/home/ben/edu-editor/A2-Rovnice_c1-v168.json';
describe.skipIf(!existsSync(A2))('buildDossier on the A2 Rovnice course', () => {
	it('fits whole under the budget for a card in lesson 4', () => {
		const { doc: source } = importCourseJson(readFileSync(A2, 'utf8'));
		const doc = toView(source);
		const lesson = doc.lessons[3];
		const card = lesson.blocks[Math.min(2, lesson.blocks.length - 1)].block_id;
		const out = buildDossier(doc, card, lesson.lesson_id);
		const tokens = estimateTokens(out);
		console.log(`A2 Rovnice dossier: ${out.length} chars, about ${tokens} tokens`);
		expect(tokens).toBeLessThan(DOSSIER_BUDGET_TOKENS);
		expect(out).not.toContain(TRUNCATED_NOTE);
		expect(out).not.toMatch(/https?:/);
		expect(out).toContain(MARKER_OPEN);
	});
});
