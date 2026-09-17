/**
 * Parse and serialise. The pair must round-trip: a document imported and exported
 * without an edit comes back value-identical (§7 golden round-trips).
 *
 * Serialisation writes known keys in a canonical order and then any key the editor
 * does not model, in its original order, so an unmodelled field is never lost.
 * Key order is deterministic, which makes the publish diff readable.
 */
import { z } from 'zod';
import { courseSchema, KEY_ORDER, type CourseV2 } from './schema';
import { normaliseDocument, type ImportReport } from './legacy';

export class ParseError extends Error {
	constructor(
		message: string,
		readonly issues: { path: string; message: string }[]
	) {
		super(message);
		this.name = 'ParseError';
	}
}

/** Parse an already-V2 document. Throws `ParseError` when the shape is unusable. */
export function parseCourse(raw: unknown): CourseV2 {
	const result = courseSchema.safeParse(raw);
	if (!result.success) {
		const issues = result.error.issues.map((i: z.core.$ZodIssue) => ({
			path: i.path.join('.'),
			message: i.message
		}));
		throw new ParseError(`Dokument nelze načíst (${issues.length} problém(ů)).`, issues);
	}
	return result.data;
}

/**
 * Import anything the editor accepts (§15): V2 documents, a single block, legacy
 * flat blocks, `lesson.block_ids`, V1 `course` / `lecture`. Legacy shapes are
 * converted here and never written back.
 */
export function importCourse(raw: unknown): { doc: CourseV2; report: ImportReport } {
	const { doc, report } = normaliseDocument(raw);
	return { doc: parseCourse(doc), report };
}

export function importCourseJson(text: string): { doc: CourseV2; report: ImportReport } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		throw new ParseError(`Soubor není platný JSON: ${(e as Error).message}`, []);
	}
	return importCourse(raw);
}

type Json = Record<string, unknown>;
type OrderKey = keyof typeof KEY_ORDER;

/** Emit a node with known keys first, in canonical order, then unmodelled keys. */
function ordered(node: unknown, order: OrderKey, children: Record<string, (v: unknown) => unknown> = {}): unknown {
	if (typeof node !== 'object' || node === null || Array.isArray(node)) return node;
	const source = node as Json;
	const known = KEY_ORDER[order] as readonly string[];
	const out: Json = {};

	for (const key of known) {
		const value = source[key];
		if (value === undefined) continue;
		out[key] = children[key] ? children[key](value) : value;
	}
	for (const key of Object.keys(source)) {
		if (known.includes(key)) continue;
		const value = source[key];
		if (value === undefined) continue;
		out[key] = value;
	}
	return out;
}

const mapArray = (fn: (v: unknown) => unknown) => (value: unknown) =>
	Array.isArray(value) ? value.map(fn) : value;

const image = (v: unknown) => ordered(v, 'image');
const video = (v: unknown) => ordered(v, 'video');
const audio = (v: unknown) => ordered(v, 'audio');
const option = (v: unknown) => ordered(v, 'option', { feedback_image: image });
const question = (v: unknown) =>
	ordered(v, 'question', { solution_image: image, options: mapArray(option) });
const step = (v: unknown) =>
	ordered(v, 'step', { image, video, audio, question });
const prerequisite = (v: unknown) => ordered(v, 'prerequisite');
const learning = (v: unknown) => ordered(v, 'learning', { prerequisites: mapArray(prerequisite) });
const gpf = (v: unknown) => ordered(v, 'gpf');
const fsrs = (v: unknown) => ordered(v, 'fsrs');
const adaptation = (v: unknown) => ordered(v, 'adaptation');
const block = (v: unknown) =>
	ordered(v, 'block', { gpf, learning, fsrs, adaptation, steps: mapArray(step) });
const binding = (v: unknown) => ordered(v, 'binding');
const lesson = (v: unknown) =>
	ordered(v, 'lesson', { header_image: image, blocks: mapArray(binding) });

/** The document as plain JSON, ready for `JSON.stringify` or the API. */
export function serialise(doc: CourseV2): Record<string, unknown> {
	return ordered(doc, 'course', {
		header_image: image,
		lessons: mapArray(lesson),
		blocks: mapArray(block)
	}) as Record<string, unknown>;
}

export function serialiseToJson(doc: CourseV2, indent = 2): string {
	return JSON.stringify(serialise(doc), null, indent);
}

/** A minimal valid course — the starting point for "new course". */
export function emptyCourse(courseId: string, name: string): CourseV2 {
	return {
		export_type: 'course_v2',
		course_id: courseId,
		version: 1,
		name,
		language: 'cs',
		status: 'draft',
		lessons: [],
		blocks: []
	};
}
