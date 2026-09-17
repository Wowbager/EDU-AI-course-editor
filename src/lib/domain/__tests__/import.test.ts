import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCourse, serialise } from '../document';
import { validate } from '../validate';
import { UNKNOWN_SKILL_CONFIG } from '../skill-config';

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));
const corpus = readdirSync(corpusDir).filter((f) => f.endsWith('.json'));
const load = (name: string): unknown => JSON.parse(readFileSync(`${corpusDir}/${name}`, 'utf8'));

/** Keys the editor reads on import and must never write back (§3 invariant 7). */
const LEGACY_KEYS = new Set([
	'block_ids', 'step_id', 'modes', 'expected_output_format', 'evaluation_config',
	'duration_minutes', 'correct_option_ids', 'next_actions', 'user_options',
	'gpf_domain', 'gpf_construct', 'gpf_subconstruct'
]);

function findLegacyKeys(node: unknown, path = '$', found: string[] = []): string[] {
	if (Array.isArray(node)) {
		node.forEach((v, i) => findLegacyKeys(v, `${path}[${i}]`, found));
	} else if (typeof node === 'object' && node !== null) {
		for (const [key, value] of Object.entries(node)) {
			if (LEGACY_KEYS.has(key)) found.push(`${path}.${key}`);
			findLegacyKeys(value, `${path}.${key}`, found);
		}
	}
	return found;
}

describe.each(corpus)('corpus: %s', (name) => {
	const raw = load(name);

	it('imports without throwing', () => {
		const { doc } = importCourse(raw);
		expect(doc.export_type).toBeDefined();
		expect(Array.isArray(doc.blocks)).toBe(true);
	});

	it('writes no legacy fields back', () => {
		const { doc } = importCourse(raw);
		expect(findLegacyKeys(serialise(doc))).toEqual([]);
	});

	it('converts every block to steps', () => {
		const { doc } = importCourse(raw);
		for (const block of doc.blocks) {
			expect(Array.isArray(block.steps), block.block_id).toBe(true);
			for (const step of block.steps) {
				expect(step.id, block.block_id).toMatch(/^\S+$/);
				expect(['text', 'image', 'video', 'audio', 'question']).toContain(step.type);
			}
		}
	});

	it('is a fixed point: re-importing the export changes nothing', () => {
		const first = serialise(importCourse(raw).doc);
		const second = serialise(importCourse(first).doc);
		expect(second).toEqual(first);
	});

	it('validates without crashing', () => {
		const { doc } = importCourse(raw);
		expect(() => validate(doc, UNKNOWN_SKILL_CONFIG)).not.toThrow();
	});
});

describe('already-V2 documents round-trip unchanged', () => {
	// The golden rule of §7: import, no-op edit, export must equal the input. Only
	// documents already in the V2 step shape qualify — the rest of the corpus uses
	// steps-as-a-map, `modes.static` or flat blocks, which import deliberately rewrites.
	const alreadyV2 = ['zlomky-5-trida.json'];

	it.each(alreadyV2)('%s', (name) => {
		const raw = load(name) as Record<string, unknown>;
		expect(serialise(importCourse(raw).doc)).toEqual(raw);
	});
});

describe('legacy shapes', () => {
	it('migrates a flat block to steps and reports it', () => {
		const { doc, report } = importCourse({
			export_type: 'course_v2',
			course_id: 'C',
			version: 1,
			lessons: [{ lesson_id: 'L1', blocks: [{ block_id: 'B1', order: 1 }] }],
			blocks: [
				{
					block_id: 'B1',
					type: 'display',
					content: 'Zlomek je část celku.',
					image: { url: 'https://cdn.edu-ai.eu/a.png', alt: 'Pizza' }
				}
			]
		});

		expect(doc.blocks[0].steps.map((s) => [s.id, s.type])).toEqual([
			['s1', 'text'],
			['s2', 'image']
		]);
		expect(doc.blocks[0].steps[0].content).toBe('Zlomek je část celku.');
		expect(serialise(doc)).not.toHaveProperty('blocks.0.content');
		expect(report.notes.map((n) => n.code)).toContain('IMPORT_FLAT_BLOCK');
	});

	it('converts steps written as a map, in numeric order', () => {
		const { doc } = importCourse({
			export_type: 'course_v2',
			course_id: 'C',
			version: 1,
			lessons: [],
			blocks: [
				{
					block_id: 'B1',
					type: 'display',
					default_practice: true,
					steps: {
						s10: { type: 'text', content: 'desátý' },
						s2: { type: 'text', content: 'druhý' },
						s1: { type: 'text', content: 'první' }
					}
				}
			]
		});
		expect(doc.blocks[0].steps.map((s) => s.id)).toEqual(['s1', 's2', 's10']);
		expect(doc.blocks[0].steps.map((s) => s.order)).toEqual([1, 2, 3]);
	});

	it('converts lesson.block_ids into bindings', () => {
		const { doc, report } = importCourse({
			export_type: 'course_v2',
			course_id: 'C',
			version: 1,
			lessons: [{ lesson_id: 'L1', block_ids: ['B1', 'B2'] }],
			blocks: [
				{ block_id: 'B1', type: 'display', steps: [{ id: 's1', type: 'text', content: 'a' }] },
				{ block_id: 'B2', type: 'display', steps: [{ id: 's1', type: 'text', content: 'b' }] }
			]
		});
		expect(doc.lessons[0].blocks).toEqual([
			{ block_id: 'B1', order: 1 },
			{ block_id: 'B2', order: 2 }
		]);
		expect(report.notes.map((n) => n.code)).toContain('IMPORT_BLOCK_IDS');
	});

	it('wraps a single block_v2 file in a course', () => {
		const { doc, report } = importCourse(load('pedf-block-v3.json'));
		expect(report.sourceKind).toBe('block_v2');
		expect(doc.blocks).toHaveLength(1);
		expect(doc.lessons[0].blocks[0].block_id).toBe(doc.blocks[0].block_id);
	});

	it('maps legacy block and step type names onto the V2 three', () => {
		const { doc } = importCourse({
			export_type: 'course_v2',
			course_id: 'C',
			version: 1,
			lessons: [],
			blocks: [
				{ block_id: 'B1', type: 'motivation', steps: [{ id: 's1', type: 'display', text: 'ahoj' }] },
				{
					block_id: 'B2',
					type: 'quiz',
					steps: [
						{
							id: 's1',
							type: 'evaluation',
							evaluation_config: {
								type: 'single_select',
								options: [{ id: 'a', text: 'A', is_correct: true }]
							}
						}
					]
				}
			]
		});
		expect(doc.blocks[0].type).toBe('display');
		expect(doc.blocks[0].steps[0].type).toBe('text');
		expect(doc.blocks[0].steps[0].content).toBe('ahoj');
		expect(doc.blocks[1].type).toBe('question');
		expect(doc.blocks[1].steps[0].type).toBe('question');
		expect(doc.blocks[1].steps[0].question?.type).toBe('multiple_choice');
	});

	it('moves next_actions branching onto the options', () => {
		const { doc } = importCourse({
			export_type: 'course_v2',
			course_id: 'C',
			version: 1,
			lessons: [],
			blocks: [
				{
					block_id: 'B1',
					type: 'question',
					steps: [
						{
							id: 's1',
							type: 'question',
							next_actions: [
								{ result: { is_correct: true }, go_to: 's3' },
								{ result: { is_correct: false }, go_to: 's2' }
							],
							question: {
								type: 'multiple_choice',
								options: [
									{ id: 'a', text: 'A', is_correct: true },
									{ id: 'b', text: 'B' }
								]
							}
						},
						{ id: 's2', type: 'text', content: 'oprava' },
						{ id: 's3', type: 'text', content: 'výborně' }
					]
				}
			]
		});
		const options = doc.blocks[0].steps[0].question?.options ?? [];
		expect(options[0].go_to).toBe('s3');
		expect(options[1].go_to).toBe('s2');
	});

	it('imports a V1 course, one lecture per lesson, and keeps its branching', () => {
		const { doc, report } = importCourse(load('v1-course-79.json'));
		expect(report.sourceKind).toBe('v1_course');
		expect(doc.lessons.length).toBeGreaterThan(1);
		expect(doc.lessons.length).toBe(doc.blocks.length);

		// Every cross-lecture jump became a cross-block `go_to` that resolves.
		const blockIds = new Set(doc.blocks.map((b) => b.block_id));
		const stepIds = new Map(doc.blocks.map((b) => [b.block_id, new Set(b.steps.map((s) => s.id))]));
		for (const block of doc.blocks) {
			for (const step of block.steps) {
				for (const option of step.question?.options ?? []) {
					const target = option.go_to;
					if (target === undefined || target === null) continue;
					const resolves =
						['NEXT_STEP', 'AGAIN', 'END', 'CHAT', 'LECTURE'].includes(target) ||
						stepIds.get(block.block_id)?.has(target) === true ||
						blockIds.has(target);
					expect(resolves, `${block.block_id}/${step.id} → ${target}`).toBe(true);
				}
			}
		}
	});

	it('tells the author what a V1 import could not carry over', () => {
		const { report } = importCourse(load('v1-course-79.json'));
		const codes = new Set(report.notes.map((n) => n.code));
		expect(codes).toContain('IMPORT_V1');
		// Nested sub-answers and inline base64 images have no V2 equivalent — the
		// author has to be told, not left to discover it in front of a class.
		expect(codes).toContain('IMPORT_V1_SUBANSWERS_DROPPED');
		expect(codes).toContain('IMPORT_V1_INLINE_IMAGE');
	});
});
