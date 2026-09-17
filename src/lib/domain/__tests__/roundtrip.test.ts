import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCourse, parseCourse, serialise, serialiseToJson } from '../document';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

describe('spec §16 worked course', () => {
	const raw = fixture('spec-16-course.json') as Record<string, unknown>;

	it('parses', () => {
		const doc = parseCourse(raw);
		expect(doc.course_id).toBe('ZLOMKY5TR');
		expect(doc.blocks).toHaveLength(3);
		expect(doc.lessons[0].blocks).toHaveLength(3);
	});

	it('round-trips value-identically through parse → serialise', () => {
		// Byte-stability at the raw-text level is not a property JSON has (whitespace
		// and key order are the source file's own choices), so the invariant we hold
		// is: no value is added, dropped or changed.
		expect(serialise(parseCourse(raw))).toEqual(raw);
	});

	it('serialises deterministically — a second pass is byte-identical', () => {
		const once = serialiseToJson(parseCourse(raw));
		const twice = serialiseToJson(parseCourse(JSON.parse(once)));
		expect(twice).toBe(once);
	});

	it('does not invent defaults for absent fields', () => {
		const doc = parseCourse(raw);
		// The fixture sets neither of these; parsing must leave them absent so that
		// import → no-op edit → export does not grow the document.
		expect(doc.only_once).toBeUndefined();
		expect(doc.blocks[0].fsrs).toBeUndefined();
		expect(serialise(doc)).not.toHaveProperty('only_once');
	});

	it('preserves keys the editor does not model', () => {
		const withExtra = { ...raw, _comment_structure: 'poznámka autora', house_flag: 7 };
		const out = serialise(parseCourse(withExtra));
		expect(out._comment_structure).toBe('poznámka autora');
		expect(out.house_flag).toBe(7);
	});

	it('imports cleanly with no migration notes', () => {
		const { report } = importCourse(raw);
		expect(report.sourceKind).toBe('course_v2');
		expect(report.notes).toEqual([]);
	});
});
