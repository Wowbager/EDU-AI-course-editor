import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCourse } from '../document';
import { validate } from '../validate';
import { skillConfigFromDimensions, UNKNOWN_SKILL_CONFIG } from '../skill-config';
import type { SkillDimension } from '../skill-config';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

/**
 * The course's own dimension set, read from the app's shipped copy. Nothing here
 * assumes 35 — the count comes from the data (§3 invariant 6).
 */
const dimensions = fixture('gpf-dimensions-cs.json') as SkillDimension[];
const skillConfig = skillConfigFromDimensions(dimensions);

const tally = (issues: { code: string }[]): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const issue of issues) out[issue.code] = (out[issue.code] ?? 0) + 1;
	return out;
};

describe('the spec §16 course', () => {
	const doc = parseCourse(fixture('spec-16-course.json'));

	it('is clean — no errors and no warnings', () => {
		const result = validate(doc, skillConfig);
		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it('is still clean when the dimension set is unknown', () => {
		const result = validate(doc, UNKNOWN_SKILL_CONFIG);
		expect(result.errors).toEqual([]);
	});
});

describe('the broken variant', () => {
	const doc = parseCourse(fixture('spec-16-course-broken.json'));
	const result = validate(doc, skillConfig, { lastPublishedVersion: 3 });

	it('produces exactly the expected errors', () => {
		expect(tally(result.errors)).toEqual({
			E_DISPLAY_NO_TEXT: 1,
			E_QUESTION_NO_QUESTION_STEP: 1,
			E_QUESTION_STEP_NO_CONFIG: 1,
			E_OPEN_NO_CORRECT_ANSWER: 1,
			E_NUMERIC_NO_CORRECT_NUMBER: 1,
			E_TF_OPTION_COUNT: 1,
			E_TF_CORRECT_COUNT: 1,
			E_MC_TOO_FEW_OPTIONS: 1,
			E_MC_NO_CORRECT: 1,
			E_MC_EMPTY_OPTION_TEXT: 1,
			E_BINDING_UNRESOLVED: 1,
			E_GOTO_UNRESOLVED: 1,
			E_PREREQ_UNRESOLVED: 1,
			E_DUPLICATE_LESSON_ID: 1,
			E_DUPLICATE_BLOCK_ID: 1,
			E_DUPLICATE_STEP_ID: 1,
			// relation_vector and elo_vector are both the wrong length in that block.
			E_VECTOR_LENGTH: 2,
			E_RELATION_VECTOR_VALUE: 1,
			E_ELO_VECTOR_RANGE: 1,
			E_PREREQ_CYCLE: 1,
			E_MEDIA_NOT_DIRECT: 1,
			E_MEDIA_NOT_HTTPS: 1
		});
	});

	it('produces exactly the expected warnings', () => {
		expect(tally(result.warnings)).toEqual({
			W_VERSION_NOT_BUMPED: 1,
			W_PARTIAL_DURATION: 1,
			W_GOTO_IN_EXERCISE: 1,
			W_UNREACHABLE_STEP: 1,
			W_ORPHAN_BLOCK: 1,
			W_RELATION_VECTOR_ALL_ZERO: 1,
			W_TOO_MANY_STRONG_RELATIONS: 1,
			W_ELO_OUTLIER: 1,
			W_NO_WRONG_OPTION_FEEDBACK: 1,
			W_PARTIAL_CREDIT_ON_WRONG: 1,
			// The catch-all lesson and the deliberately long one.
			W_LESSON_TOO_LONG: 2,
			W_BLOCK_TOO_MANY_STEPS: 1,
			W_ONLY_ONCE_WITH_PRACTICE: 1,
			W_PREREQ_MIN_LEVEL_HIGH: 1,
			W_DUPLICATE_OPTION_ID: 1,
			W_IMAGE_NO_ALT: 1
		});
	});

	it('addresses every issue with a ref that names a real place', () => {
		for (const issue of [...result.errors, ...result.warnings]) {
			const { blockId, lessonId, stepId } = issue.ref;
			if (blockId !== undefined && issue.code !== 'E_BINDING_UNRESOLVED') {
				// E_BINDING_UNRESOLVED deliberately names the missing block.
				expect(doc.blocks.some((b) => b.block_id === blockId), issue.code).toBe(true);
			}
			if (lessonId !== undefined) {
				expect(doc.lessons.some((l) => l.lesson_id === lessonId), issue.code).toBe(true);
			}
			if (stepId !== undefined && blockId !== undefined) {
				const block = doc.blocks.find((b) => b.block_id === blockId);
				expect(block?.steps.some((s) => s.id === stepId), issue.code).toBe(true);
			}
		}
	});

	it('writes every message in Czech, not as a field name', () => {
		for (const issue of [...result.errors, ...result.warnings]) {
			expect(issue.message.length, issue.code).toBeGreaterThan(30);
			expect(issue.message, issue.code).toMatch(/[ěščřžýáíéúůťďň]/i);
		}
	});
});

describe('empty media steps (problem 1 — a silent, invisible card)', () => {
	// A brand-new media step is `{ url: '' }` (`addStep` in commands.ts) — the same
	// situation as an empty text step, and just as invisible to the student, so it
	// is an error for the same reason `E_DISPLAY_NO_TEXT` is one.
	const doc = parseCourse({
		export_type: 'course_v2',
		course_id: 'C_MEDIA',
		lessons: [],
		blocks: [
			{
				block_id: 'B_EMPTY_MEDIA',
				type: 'display',
				steps: [
					{ id: 's1', type: 'video', video: { url: '' } },
					{ id: 's2', type: 'audio', audio: { url: '' } },
					{ id: 's3', type: 'image', image: { url: '' } }
				]
			}
		]
	});
	const result = validate(doc);

	it('flags a video step with no url', () => {
		const issue = result.errors.find((e) => e.code === 'E_VIDEO_NO_URL');
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe('error');
		expect(issue!.message).toMatch(/kroku 1/);
	});

	it('flags an audio step with no url', () => {
		const issue = result.errors.find((e) => e.code === 'E_AUDIO_NO_URL');
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe('error');
		expect(issue!.message).toMatch(/kroku 2/);
	});

	it('flags an image step with no url the same way', () => {
		const issue = result.errors.find((e) => e.code === 'E_IMAGE_NO_URL');
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe('error');
	});

	it('does not fire E_DISPLAY_NO_TEXT — the block does have media steps, just empty ones', () => {
		expect(result.errors.map((e) => e.code)).not.toContain('E_DISPLAY_NO_TEXT');
	});
});

describe('no raw id ever reaches a message (problem 2)', () => {
	// Ids chosen so that if one leaked into a message, it could not be mistaken for
	// anything else in the sentence — they share no characters in common with any
	// Czech word or with the human names these blocks/steps/options resolve to.
	const doc = parseCourse({
		export_type: 'course_v2',
		course_id: 'C_RAWID',
		lessons: [
			{ lesson_id: 'zqf9', blocks: [{ block_id: 'xk3' }] },
			// A second lesson with the same id — E_DUPLICATE_LESSON_ID is genuinely
			// about the id, so it is exempt below.
			{ lesson_id: 'zqf9', blocks: [] }
		],
		blocks: [
			// No text and no name at all — E_DISPLAY_NO_TEXT, named only by position.
			{ block_id: 'xk3', type: 'display', steps: [] },
			{
				block_id: 'mpr7',
				type: 'question',
				steps: [
					{
						id: 's7q',
						type: 'question',
						question: {
							type: 'multiple_choice',
							options: [
								{ id: 'op1', text: 'Ano' },
								// A duplicate option id — W_DUPLICATE_OPTION_ID is exempt below.
								{ id: 'op1', text: 'Ne' }
							]
						}
					},
					// A duplicate step id — E_DUPLICATE_STEP_ID is exempt below.
					{ id: 's7q', type: 'text', content: 'Vysvětlení' }
				]
			}
		]
	});
	const result = validate(doc);
	const rawIds = ['zqf9', 'xk3', 'mpr7', 's7q', 'op1'];
	const idIsTheSubject = new Set([
		'E_DUPLICATE_LESSON_ID',
		'E_DUPLICATE_BLOCK_ID',
		'E_DUPLICATE_STEP_ID',
		'W_DUPLICATE_OPTION_ID'
	]);

	it('produces a useful spread of issues to check', () => {
		// Sanity check on the fixture itself: if these codes stopped firing the test
		// below would pass vacuously.
		const codes = [...result.errors, ...result.warnings].map((i) => i.code);
		expect(codes).toEqual(
			expect.arrayContaining(['E_DISPLAY_NO_TEXT', 'E_MC_NO_CORRECT', 'W_ORPHAN_BLOCK'])
		);
	});

	it('never names a place by an id that looks nothing like its visible text', () => {
		for (const issue of [...result.errors, ...result.warnings]) {
			if (idIsTheSubject.has(issue.code)) continue;
			for (const id of rawIds) {
				expect(issue.message, `${issue.code}: ${issue.message}`).not.toContain(id);
			}
		}
	});
});

describe('skill configuration drives the vector length', () => {
	const doc = parseCourse(fixture('spec-16-course.json'));

	it('flags a 35-element vector when the course declares 12 dimensions', () => {
		const twelve = skillConfigFromDimensions(dimensions.slice(0, 12));
		const result = validate(doc, twelve);
		expect(result.errors.map((e) => e.code)).toContain('E_VECTOR_LENGTH');
	});

	it('cannot check length when no configuration has loaded yet', () => {
		const result = validate(doc, null);
		expect(result.errors.map((e) => e.code)).not.toContain('E_VECTOR_LENGTH');
	});
});
