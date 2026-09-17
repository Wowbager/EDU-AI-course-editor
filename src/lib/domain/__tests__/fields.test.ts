/**
 * The field registry is only useful if it is complete. These tests hold the two
 * properties the three-mode split rests on:
 *
 *  1. every key the format can carry has a declared home — a mode, or a written
 *     reason for having none;
 *  2. the advanced mode is a superset of the other two, so nothing becomes
 *     unreachable by switching up a level.
 *
 * Without (1), adding a field to `schema.ts` silently produces a field no editor
 * shows and no author can fix. The test is the thing that makes the promise
 * "Pokročilý ukáže všechno ostatní" true rather than aspirational.
 */
import { describe, expect, it } from 'vitest';
import { KEY_ORDER } from '../schema';
import {
	FIELDS,
	MODES,
	MODE_RANK,
	NOT_EDITABLE,
	allows,
	fieldsFor,
	visible,
	type FieldLevel,
	type FieldSpec
} from '$lib/ui/fields';

/** `KEY_ORDER` is keyed by node name; these are the ones a `FieldSpec` addresses. */
const NODE_TO_LEVEL: Partial<Record<keyof typeof KEY_ORDER, FieldLevel>> = {
	course: 'course',
	lesson: 'lesson',
	binding: 'binding',
	block: 'block',
	step: 'step',
	question: 'question',
	option: 'option'
};

/** Sub-objects of a block, addressed as `block.<node>.<key>` in the registry. */
const BLOCK_SUBNODES = ['gpf', 'learning', 'fsrs', 'adaptation'] as const;

describe('field registry coverage', () => {
	it('gives every key in the schema a mode or a written reason', () => {
		const declared = new Set(FIELDS.map((spec) => `${spec.level}.${spec.path}`));
		const homeless: string[] = [];

		for (const [node, keys] of Object.entries(KEY_ORDER)) {
			const level = NODE_TO_LEVEL[node as keyof typeof KEY_ORDER];
			for (const key of keys) {
				// A block sub-object's keys are declared with their prefix, e.g.
				// `block.fsrs.weight`, so check that spelling before the bare one.
				const candidates =
					level === undefined
						? [`${node}.${key}`]
						: [`${level}.${key}`, `${node}.${key}`];
				if (BLOCK_SUBNODES.includes(node as (typeof BLOCK_SUBNODES)[number])) {
					candidates.unshift(`block.${node}.${key}`);
				}

				// A container key (`block.gpf`, `step.image`) is covered when its leaves
				// are: there is nothing to edit about the object itself.
				const covered = candidates.some(
					(path) =>
						declared.has(path) ||
						path in NOT_EDITABLE ||
						[...declared].some((declaredPath) => declaredPath.startsWith(`${path}.`))
				);
				if (!covered) homeless.push(candidates[0]);
			}
		}

		expect(homeless, `these schema keys have no mode and no reason: ${homeless.join(', ')}`)
			.toEqual([]);
	});

	it('states a real reason for every field it refuses to edit', () => {
		for (const [path, reason] of Object.entries(NOT_EDITABLE)) {
			expect(reason.length, `${path} has no reason`).toBeGreaterThan(20);
		}
	});

	it('declares each field exactly once', () => {
		const seen = new Map<string, number>();
		for (const spec of FIELDS) {
			const key = `${spec.level}.${spec.path}`;
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
		const duplicated = [...seen].filter(([, count]) => count > 1).map(([key]) => key);
		expect(duplicated).toEqual([]);
	});

	it('never declares a field as both editable and not editable', () => {
		const both = FIELDS.map((spec) => `${spec.level}.${spec.path}`).filter(
			(key) => key in NOT_EDITABLE
		);
		expect(both).toEqual([]);
	});
});

describe('modes are cumulative', () => {
	it('shows in advanced everything the lower modes show', () => {
		for (const spec of FIELDS) {
			expect(visible(spec, 'advanced'), `${spec.level}.${spec.path}`).toBe(true);
		}
	});

	it('shows in metodik everything teacher mode shows', () => {
		const teacherFields = FIELDS.filter((spec) => visible(spec, 'teacher'));
		for (const spec of teacherFields) {
			expect(visible(spec, 'metodik'), `${spec.level}.${spec.path}`).toBe(true);
		}
	});

	it('orders the modes by how much they expose', () => {
		const counts = MODES.map((mode) => FIELDS.filter((spec) => visible(spec, mode)).length);
		expect(counts[0]).toBeLessThan(counts[1]);
		expect(counts[1]).toBeLessThan(counts[2]);
	});

	it('ranks the modes in the order they are listed', () => {
		expect(MODES.map((mode) => MODE_RANK[mode])).toEqual([0, 1, 2]);
	});
});

describe('what each mode is for', () => {
	it('keeps every id out of teacher and metodik mode (plan §8)', () => {
		const idFields = FIELDS.filter(
			(spec: FieldSpec) => spec.path === 'id' || spec.path.endsWith('_id')
		);
		expect(idFields.length).toBeGreaterThan(0);
		for (const spec of idFields) {
			expect(allows(spec.level, spec.path, 'teacher'), `${spec.level}.${spec.path}`).toBe(false);
			expect(allows(spec.level, spec.path, 'metodik'), `${spec.level}.${spec.path}`).toBe(false);
		}
	});

	it('leaves teacher mode a surface a teacher can hold in their head', () => {
		// Plan §1 asks for "roughly fifteen fields". Generously bounded: the point
		// is that it stays a short list, not that it is exactly fifteen. Raised from
		// 30 when `block.help` and `step.help` moved down from advanced mode — the
		// app's hint sheet escalates to them, so a course written without them has a
		// dead "Nerozumím tomu" button.
		const teacher = FIELDS.filter((spec) => visible(spec, 'teacher'));
		expect(teacher.length).toBeLessThanOrEqual(32);
	});

	it('puts practice enrolment and the knowledge vector in metodik mode', () => {
		for (const path of ['default_practice', 'gpf.relation_vector', 'gpf.elo_vector']) {
			expect(allows('block', path, 'teacher'), path).toBe(false);
			expect(allows('block', path, 'metodik'), path).toBe(true);
		}
	});

	it('puts the machinery in advanced mode only', () => {
		for (const path of ['fsrs.weight', 'adaptation.scaffolded', 'learning.prerequisites', 'xp']) {
			expect(allows('block', path, 'metodik'), path).toBe(false);
			expect(allows('block', path, 'advanced'), path).toBe(true);
		}
	});

	it('hands the generic renderer only the fields no component owns', () => {
		for (const spec of fieldsFor('block', 'advanced')) {
			expect(spec.custom, `${spec.path} is custom and should not be rendered generically`)
				.toBeUndefined();
		}
	});

	it('writes every hint as a consequence, not a field name', () => {
		for (const spec of FIELDS) {
			if (spec.hint === undefined) continue;
			expect(spec.hint.length, `${spec.level}.${spec.path}`).toBeGreaterThan(10);
			expect(spec.hint.trim().endsWith('.'), `${spec.level}.${spec.path}: ${spec.hint}`).toBe(true);
		}
	});
});
