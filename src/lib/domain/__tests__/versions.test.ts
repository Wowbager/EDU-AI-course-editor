import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCourse, serialise } from '../document';
import {
	applyVisibility,
	contentHash,
	emptyIndex,
	nextVersion,
	publishPlan,
	publishedDocument,
	snapshot,
	summariseDiff,
	visibilityOf,
	ALL_VISIBILITIES,
	type VersionIndex
} from '../versions';

const course = () =>
	parseCourse(
		JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/spec-16-course.json', import.meta.url)), 'utf8'))
	);
const now = new Date('2026-09-26T10:00:00Z');
const indexWith = (...versions: number[]): VersionIndex => ({
	courseId: 'C',
	versions: versions.map((version) => ({ courseId: 'C', version, savedAt: now.toISOString(), hash: 'x' }))
});

describe('visibility', () => {
	it('is written as the two keys the platform reads, and read back the same', () => {
		for (const v of ALL_VISIBILITIES) expect(visibilityOf(applyVisibility(course(), v))).toBe(v);
	});

	it('maps the teacher\'s three onto status and logged_only', () => {
		expect(applyVisibility(course(), 'public')).toMatchObject({ status: 'published' });
		expect(applyVisibility(course(), 'logged_only')).toMatchObject({ status: 'published', logged_only: true });
		expect(applyVisibility(course(), 'private')).toMatchObject({ status: 'private' });
	});

	it('removes logged_only rather than writing false, and touches nothing else', () => {
		const signedIn = applyVisibility(course(), 'logged_only');
		const open = applyVisibility(signedIn, 'public');
		expect('logged_only' in open).toBe(false);
		const { status: _a, logged_only: _b, ...rest } = serialise(open);
		const { status: _c, logged_only: _d, ...original } = serialise(course());
		expect(rest).toEqual(original);
	});
});

describe('version numbers', () => {
	it('start at the document\'s own number and only grow', () => {
		expect(nextVersion(emptyIndex('C'), { version: 1 })).toBe(1);
		expect(nextVersion(indexWith(1, 2), { version: 1 })).toBe(3);
	});

	it('never go below a number an imported file was already published as', () => {
		expect(nextVersion(emptyIndex('C'), { version: 6 })).toBe(6);
		expect(nextVersion(indexWith(6), { version: 6 })).toBe(7);
	});

	it('freeze the document under its number', () => {
		const doc = course();
		const v = snapshot(doc, 4, now, { note: '  po revizi ' });
		expect(v.doc.version).toBe(4);
		expect(v.note).toBe('po revizi');
		doc.name = 'changed later';
		expect(v.doc.name).not.toBe('changed later');
	});
});

describe('publishing', () => {
	it('publishes a newer version under its own number', () => {
		const index = { ...indexWith(1, 2, 3), published: { version: 2, visibility: 'public' as const, at: '' } };
		expect(publishPlan(index, 3, { version: 1 })).toEqual({ kind: 'publish', version: 3 });
	});

	it('puts an older version out again as a new number, because the app only updates upwards', () => {
		const index = { ...indexWith(1, 2, 3, 4, 5), published: { version: 5, visibility: 'public' as const, at: '' } };
		expect(publishPlan(index, 3, { version: 5 })).toEqual({ kind: 'republish', from: 3, version: 6 });
		// Re-publishing the one that is out (to change who sees it) also needs a number.
		expect(publishPlan(index, 5, { version: 5 })).toEqual({ kind: 'republish', from: 5, version: 6 });
	});

	it('hands the platform a numbered document with its visibility', () => {
		const v = snapshot(course(), 3, now);
		const out = publishedDocument(v, 6, 'logged_only');
		expect(out).toMatchObject({ version: 6, status: 'published', logged_only: true });
		expect(contentHash(out)).toBe(v.hash);
	});
});

describe('content identity', () => {
	it('ignores the number and the visibility', () => {
		const doc = course();
		expect(contentHash({ ...doc, version: 9, status: 'published' })).toBe(contentHash(doc));
	});

	it('notices a changed word', () => {
		const doc = course();
		const edited = structuredClone(doc);
		edited.blocks[0].steps[0].content += ' Navíc.';
		expect(contentHash(edited)).not.toBe(contentHash(doc));
		expect(summariseDiff(doc, edited)).toEqual({ added: 0, removed: 0, changed: 1, lessonsChanged: false });
	});
});

describe('the version commands', () => {
	it('restore content but keep who the course is for', async () => {
		const { restoreVersion, setVisibility } = await import('../commands');
		const working = setVisibility(course(), 'logged_only').doc;
		const old = structuredClone(course());
		old.name = 'Stará verze';
		old.status = 'draft';
		const restored = restoreVersion(working, old, 2).doc;
		expect(restored.name).toBe('Stará verze');
		expect(visibilityOf(restored)).toBe('logged_only');
		expect(restored.course_id).toBe(working.course_id);
	});

	it('change nothing when the visibility is the same', async () => {
		const { setVisibility } = await import('../commands');
		const doc = course();
		expect(setVisibility(doc, visibilityOf(doc)).doc).toBe(doc);
	});
});
