import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCourse } from '../document';
import { validate } from '../validate';
import { buildIndex } from '../index-doc';
import { groupIssues, issueLessonId, issuePlace } from '../issue-groups';
import { skillConfigFromDimensions } from '../skill-config';
import type { SkillDimension } from '../skill-config';
import type { Issue } from '../validate';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const skillConfig = skillConfigFromDimensions(fixture('gpf-dimensions-cs.json') as SkillDimension[]);

describe('grouping the broken variant for the export review', () => {
	const doc = parseCourse(fixture('spec-16-course-broken.json'));
	const index = buildIndex(doc);
	const { errors, warnings } = validate(doc, skillConfig, { lastPublishedVersion: 3 });
	const groups = groupIssues(doc, index, errors);

	it('loses and duplicates nothing', () => {
		const rows = groups.flatMap((g) => g.rows.map((r) => r.issue));
		expect(rows).toHaveLength(errors.length);
		expect(new Set(rows)).toEqual(new Set(errors));
		expect(groupIssues(doc, index, warnings).flatMap((g) => g.rows)).toHaveLength(warnings.length);
	});

	it('gives each card one group, keyed by the card', () => {
		const keys = groups.map((g) => g.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const group of groups.filter((g) => g.kind === 'card')) {
			const blockIds = new Set(group.rows.map((r) => r.issue.ref.blockId));
			expect(blockIds.size).toBe(1);
		}
	});

	it('keeps the order in which validation found them', () => {
		const firstSeen = groups.map((g) => errors.indexOf(g.rows[0].issue));
		expect(firstSeen).toEqual([...firstSeen].sort((a, b) => a - b));
	});

	it('sends every row somewhere the editor can open', () => {
		for (const row of groups.flatMap((g) => g.rows)) {
			const { blockId, lessonId } = row.target;
			// A card bound to a lesson opens in that lesson; the ref's own fields survive.
			if (blockId !== undefined && (index.lessonsByBlock.get(blockId) ?? []).length > 0) {
				expect(lessonId).toBeDefined();
			}
			expect(row.target).toMatchObject({ ...row.issue.ref, lessonId });
		}
	});

	it('names a step by its position, never by its id', () => {
		const stepRows = groups.flatMap((g) => g.rows).filter((r) => r.issue.ref.stepId !== undefined);
		expect(stepRows.length).toBeGreaterThan(0);
		for (const row of stepRows) {
			// E_DUPLICATE_STEP_ID is about the id itself, and a step that resolves is named.
			expect(row.detail).toMatch(/^Krok \d+/);
		}
	});
});

describe('issueLessonId and issuePlace', () => {
	const doc = parseCourse(fixture('spec-16-course.json'));
	const index = buildIndex(doc);
	const block = doc.blocks[0];
	const lesson = doc.lessons[0];

	it('finds the lesson that binds a block when the ref does not name one', () => {
		expect(issueLessonId(index, { blockId: block.block_id })).toBe(lesson.lesson_id);
		expect(issueLessonId(index, { lessonId: 'X', blockId: block.block_id })).toBe('X');
		expect(issueLessonId(index, { field: 'version' })).toBeUndefined();
	});

	it('names the course when a ref points at nothing smaller', () => {
		expect(issuePlace(doc, { field: 'version' })).toBe('kurz');
	});

	it('puts course-level issues in one "Celý kurz" group', () => {
		const issue = (code: string): Issue => ({ code, severity: 'warning', ref: { field: code }, message: code });
		const groups = groupIssues(doc, index, [issue('A'), issue('B')]);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ kind: 'course', title: 'Celý kurz' });
		expect(groups[0].rows.map((r) => r.detail)).toEqual(['', '']);
	});

	it('says a card in no lesson is in none', () => {
		const orphan = { ...doc, lessons: [] };
		const groups = groupIssues(orphan, buildIndex(orphan), [
			{ code: 'X', severity: 'error', ref: { blockId: block.block_id }, message: 'x' }
		]);
		expect(groups[0]).toMatchObject({ kind: 'card', context: 'mimo lekce' });
	});
});
