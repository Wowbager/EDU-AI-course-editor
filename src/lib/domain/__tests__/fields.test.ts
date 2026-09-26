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
	hintFor,
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

/**
 * A field must have a consumer, or say that it has none.
 *
 * `docs/spec/COURSE-EDITOR-SPEC.md` is the code-verified record of who reads each key:
 * ✅ the app, 🟡 the API, ⚪ / ❌ / "Inert" nothing at all. `block.status` was offered
 * with a hint promising that a draft card is skipped for the student, and nothing
 * anywhere read it — which is how every new card came to carry a warning the teacher
 * could not clear. This reads the spec's tables and holds the registry to them:
 * nothing inert in teacher mode, and wherever an inert field is offered, its hint
 * admits that it changes nothing for the student today.
 */
describe('every offered field has a consumer, or says it has none', async () => {
	const { readFileSync } = await import('node:fs');
	const { fileURLToPath } = await import('node:url');
	const spec = readFileSync(
		fileURLToPath(new URL('../../../../docs/spec/COURSE-EDITOR-SPEC.md', import.meta.url)),
		'utf8'
	);

	// Which table a row is in decides which level and prefix its keys belong to.
	const SECTIONS: [RegExp, FieldLevel, string][] = [
		[/^### 3\.\d/, 'course', ''],
		[/^## 4\. /, 'lesson', ''],
		[/^## 5\. /, 'binding', ''],
		[/^### 6\.1 /, 'block', ''],
		[/^### 6\.3 /, 'block', 'gpf.'],
		[/^### 6\.4 /, 'block', 'learning.'],
		[/^### 6\.5 /, 'block', 'fsrs.'],
		[/^## 7\. /, 'step', ''],
		[/^### 8\.1 /, 'question', ''],
		[/^### 8\.2 /, 'option', '']
	];
	const inert = new Set<string>();
	let section: [FieldLevel, string] | null = null;
	for (const line of spec.split('\n')) {
		if (/^#{2,4} /.test(line)) {
			const hit = SECTIONS.find(([pattern]) => pattern.test(line));
			section = hit ? [hit[1], hit[2]] : null;
			continue;
		}
		if (section === null || !line.startsWith('| `')) continue;
		const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
		const keys = [...cells[1].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
		// The marker is the first cell after the key that carries one.
		const marker = cells.slice(2).find((c) => /[✅🟡⚪❌]|Inert/.test(c)) ?? '';
		if (/⚪|❌|Inert/.test(marker) && !/✅|🟡/.test(marker)) {
			for (const key of keys) inert.add(`${section[0]}.${section[1]}${key}`);
		}
	}

	it('found the spec\'s inert keys', () => {
		// A sanity floor, so a reformatted spec cannot make this test vacuous.
		expect(inert.size).toBeGreaterThan(15);
		expect(inert.has('block.status')).toBe(true);
	});

	const key = (f: FieldSpec) => `${f.level}.${f.path}`;

	it('flags exactly the fields the spec says nothing reads', () => {
		// Both ways: a field nothing reads must say so, and a field the platform starts
		// reading must lose the flag — the spec is updated, this fails, the flag goes.
		const flaggedButRead = FIELDS.filter((f) => f.unread && !inert.has(key(f))).map(key);
		const inertButUnflagged = FIELDS.filter((f) => !f.unread && inert.has(key(f))).map(key);
		expect({ flaggedButRead, inertButUnflagged }).toEqual({ flaggedButRead: [], inertButUnflagged: [] });
	});

	it('offers nothing inert in teacher mode', () => {
		expect(FIELDS.filter((f) => f.mode === 'teacher' && f.unread).map(key)).toEqual([]);
	});

	it('says so wherever an inert field is shown', () => {
		for (const f of FIELDS.filter((f) => f.unread)) {
			expect(hintFor(f), key(f)).toMatch(/^Zatím bez účinku/);
		}
	});
});

/**
 * Every issue points at something the author can reach — in the mode that draws it.
 * The review switches to that mode on "Přejít" (`fixModeOf`), so this only has to hold
 * that the registry knows every field an issue can name.
 */
describe('every issue can be fixed somewhere', async () => {
	const { readFileSync } = await import('node:fs');
	const { fileURLToPath } = await import('node:url');
	const { parseCourse } = await import('../document');
	const { validate } = await import('../validate');
	const { fixModeOf } = await import('$lib/ui/fields');
	const load = (name: string) =>
		parseCourse(JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')));

	it('names only fields the registry knows', () => {
		const unknown: string[] = [];
		for (const name of ['spec-16-course-broken.json', 'spec-16-course.json']) {
			const result = validate(load(name), null);
			for (const issue of [...result.errors, ...result.warnings]) {
				if (fixModeOf(issue.ref) === undefined) unknown.push(`${issue.code} → ${issue.ref.field}`);
			}
		}
		expect(unknown).toEqual([]);
	});
});
