/**
 * OPEN-PROBLEMS / Round 14 H3. The editor validates what it shows (`store.doc`, a
 * question card as one card) while export, publish and the player work on the course
 * as exported (`store.source`, one block per question). A rule that counts blocks,
 * steps or durations may then say one thing on screen and another to the app.
 *
 * This holds the two to each other over every fixture: `validate(view)` and
 * `validate(source)` give the same codes in the same numbers, at the same places once
 * a card's ref is mapped to its block, except for the differences listed in
 * `DIFFERENCES`, each with the reason it is by design.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCourse, parseCourse } from '../document';
import { validate, type Issue } from '../validate';
import { blockOfStep, splitQuestionCards, toView } from '../groups';
import { courseTotals, lessonTotals } from '../derive';
import { buildIndex } from '../index-doc';
import type { BlockV2, CourseV2 } from '../schema';

/** Codes whose view and source results differ on purpose. */
const DIFFERENCES: Record<string, string> = {
	W_PARTIAL_DURATION:
		'A card keeps its `duration` on its first block only (groups.ts FIRST_ONLY), so the ' +
		'exported blocks of a split card read "1 of 3 filled" while the card is complete and ' +
		'the app adds up the right time. The warning is about cards that have no duration, ' +
		'which is what the view counts.'
};

const dir = fileURLToPath(new URL('./fixtures', import.meta.url));
const corpus = readdirSync(`${dir}/corpus`).map((f) => `corpus/${f}`);
const specs = ['spec-16-course.json', 'spec-16-course-broken.json'];

function load(name: string): CourseV2 {
	const raw = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
	return name.startsWith('corpus/') ? importCourse(raw).doc : parseCourse(raw);
}

const pair = (doc: CourseV2) => {
	const source = splitQuestionCards(doc).doc;
	return { source, view: toView(source) };
};

/** An issue as a comparable string, its view ref mapped onto the source's blocks. */
function key(issue: Issue, source: CourseV2, mapped: boolean): string {
	const ref = issue.ref;
	const blockId =
		mapped && ref.blockId !== undefined
			? blockOfStep(source, ref.blockId, ref.stepId)
			: ref.blockId;
	return [issue.code, ref.lessonId, blockId, ref.stepId, ref.optionId, ref.field].join('|');
}

function compare(view: CourseV2, source: CourseV2) {
	const a = validate(view);
	const b = validate(source);
	const all = (r: typeof a) => [...r.errors, ...r.warnings];
	const keep = (issues: Issue[]) => issues.filter((i) => !(i.code in DIFFERENCES));
	return {
		viewCodes: tally(keep(all(a))),
		sourceCodes: tally(keep(all(b))),
		viewKeys: keep(all(a))
			.map((i) => key(i, source, true))
			.sort(),
		sourceKeys: keep(all(b))
			.map((i) => key(i, source, false))
			.sort()
	};
}

const tally = (issues: Issue[]) => {
	const out: Record<string, number> = {};
	for (const issue of issues) out[issue.code] = (out[issue.code] ?? 0) + 1;
	return out;
};

describe.each([...corpus, ...specs])('%s: validate(view) vs validate(source)', (name) => {
	const { source, view } = pair(load(name));

	it('gives the same codes in the same numbers', () => {
		const r = compare(view, source);
		expect(r.viewCodes).toEqual(r.sourceCodes);
	});

	it('puts them at the same places', () => {
		const r = compare(view, source);
		expect(r.viewKeys).toEqual(r.sourceKeys);
	});

	it('totals blocks, XP and the estimated time as the app does', () => {
		const vi = buildIndex(view);
		const si = buildIndex(source);
		for (const lesson of view.lessons) {
			const sourceLesson = source.lessons.find((l) => l.lesson_id === lesson.lesson_id)!;
			const v = lessonTotals(lesson, vi);
			const s = lessonTotals(sourceLesson, si);
			expect(v.blockCount, lesson.lesson_id).toBe(s.blockCount);
			expect(v.xp, lesson.lesson_id).toBe(s.xp);
			expect(v.durationMinutes, lesson.lesson_id).toBe(s.durationMinutes);
			expect(v.durationEstimated, lesson.lesson_id).toBe(s.durationEstimated);
			expect(s.cardCount).toBe(sourceLesson.blocks.length);
		}
		const vt = courseTotals(view, vi);
		const st = courseTotals(source, si);
		expect(vt.blockCount).toBe(st.blockCount);
		expect(vt.xp).toBe(st.xp);
		expect(vt.durationMinutes).toBe(st.durationMinutes);
	});
});

/** A hand-made course, for the rules the corpus has no case for. */
function made(cards: number, questionsEach: number, stepsEach = 0): CourseV2 {
	const blocks: BlockV2[] = [];
	for (let c = 1; c <= cards; c++) {
		const steps: BlockV2['steps'] = [];
		for (let q = 1; q <= questionsEach; q++) {
			steps.push({ id: `s${steps.length + 1}`, type: 'text', content: `Text ${c}.${q}` });
			steps.push({
				id: `s${steps.length + 1}`,
				type: 'question',
				question: {
					type: 'multiple_choice',
					options: [
						{ id: 'a', text: 'ano', is_correct: true },
						{ id: 'b', text: 'ne', is_correct: false }
					]
				}
			});
		}
		for (let i = 0; i < stepsEach; i++) {
			steps.push({ id: `s${steps.length + 1}`, type: 'text', content: `Další ${i}` });
		}
		blocks.push({ block_id: `B${c}`, type: 'question', steps });
	}
	return {
		export_type: 'course_v2',
		course_id: 'C',
		version: 1,
		name: 'Kurz',
		language: 'cs',
		status: 'draft',
		lessons: [
			{
				lesson_id: 'L1',
				name: 'Lekce',
				order: 1,
				blocks: blocks.map((b, i) => ({ block_id: b.block_id, order: i + 1 }))
			}
		],
		blocks
	} as CourseV2;
}

describe('rules the corpus has no case for', () => {
	it('W_LESSON_TOO_LONG counts the blocks the app receives, not the cards', () => {
		// 7 cards of two questions: 7 on screen, 14 in the app.
		const { source, view } = pair(made(7, 2));
		expect(view.lessons[0].blocks).toHaveLength(7);
		expect(source.lessons[0].blocks).toHaveLength(14);
		const codes = (d: CourseV2) => validate(d).warnings.map((w) => w.code);
		expect(codes(view)).toContain('W_LESSON_TOO_LONG');
		expect(codes(source)).toContain('W_LESSON_TOO_LONG');
		const r = compare(view, source);
		expect(r.viewKeys).toEqual(r.sourceKeys);
		// And 5 such cards are 10 blocks: neither warns.
		const small = pair(made(5, 2));
		expect(validate(small.view).warnings.map((w) => w.code)).not.toContain('W_LESSON_TOO_LONG');
		expect(validate(small.source).warnings.map((w) => w.code)).not.toContain('W_LESSON_TOO_LONG');
	});

	it('W_BLOCK_TOO_MANY_STEPS is a block of the app having more than 10 steps', () => {
		// A card of 3 questions with their texts is 6 steps of 2 per block: 6 in all.
		// Four of them are 8 steps; make a card whose pieces are short but whole is long.
		const short = pair(made(1, 6)); // 12 steps in the card, 2 per block
		expect(short.view.blocks[0].steps).toHaveLength(12);
		expect(validate(short.view).warnings.map((w) => w.code)).not.toContain(
			'W_BLOCK_TOO_MANY_STEPS'
		);
		expect(validate(short.source).warnings.map((w) => w.code)).not.toContain(
			'W_BLOCK_TOO_MANY_STEPS'
		);
		// One question and eleven texts after it: one block of 13 steps.
		const long = pair(made(1, 1, 11));
		expect(validate(long.view).warnings.map((w) => w.code)).toContain('W_BLOCK_TOO_MANY_STEPS');
		expect(validate(long.source).warnings.map((w) => w.code)).toContain('W_BLOCK_TOO_MANY_STEPS');
	});

	it('a lesson is estimated at 4 minutes per exported block, as the app does', () => {
		const { source, view } = pair(made(3, 2));
		const v = lessonTotals(view.lessons[0], buildIndex(view));
		const s = lessonTotals(source.lessons[0], buildIndex(source));
		expect(v.blockCount).toBe(6);
		expect(v.durationMinutes).toBe(24);
		expect(s.durationMinutes).toBe(24);
	});

	it('a card’s own XP does not change what the app shows as the lesson reward', () => {
		// course_model.dart `_calculateBlockMaxXp` counts steps and never reads `xp`.
		const doc = made(1, 1);
		const plain = lessonTotals(doc.lessons[0], buildIndex(doc)).xp;
		const rich = { ...doc, blocks: [{ ...doc.blocks[0], xp: 99 }] };
		expect(lessonTotals(rich.lessons[0], buildIndex(rich)).xp).toBe(plain);
		expect(plain).toBe(9);
	});
});

describe('the one difference', () => {
	it('W_PARTIAL_DURATION is on cards in the view, because a card’s duration is on its first block', () => {
		const doc = made(1, 2);
		const withDuration = { ...doc, blocks: [{ ...doc.blocks[0], duration: '5 min' }] };
		const { source, view } = pair(withDuration);
		expect(validate(view).warnings.map((w) => w.code)).not.toContain('W_PARTIAL_DURATION');
		// The exported blocks: the first has the time, the second has none.
		expect(validate(source).warnings.map((w) => w.code)).toContain('W_PARTIAL_DURATION');
		expect(Object.keys(DIFFERENCES)).toEqual(['W_PARTIAL_DURATION']);
	});
});
