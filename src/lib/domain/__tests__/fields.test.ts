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
import { SECTION_ICONS } from '$lib/ui/section-icons';
import { describe, expect, it } from 'vitest';
import { KEY_ORDER } from '../schema';
import {
	FIELDS,
	MODES,
	MODE_RANK,
	NOT_EDITABLE,
	SECTIONS as LEVEL_SECTIONS,
	allows,
	cardSettingsSummary,
	fieldsFor,
	hintFor,
	isFeedbackRef,
	sectionsFor,
	listsSections,
	matchSections,
	matchHigherModes,
	modeGain,
	specOf,
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
					level === undefined ? [`${node}.${key}`] : [`${level}.${key}`, `${node}.${key}`];
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

		expect(
			homeless,
			`these schema keys have no mode and no reason: ${homeless.join(', ')}`
		).toEqual([]);
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

	it('tells a teacher what the card settings hold, from the table', () => {
		const line = cardSettingsSummary('teacher');
		// The open fields by name, the folds by heading.
		expect(line).toContain('délka');
		for (const section of sectionsFor('block', 'teacher').filter((s) => s.id !== 'main')) {
			expect(line.toLowerCase(), section.id).toContain(section.label.toLowerCase());
		}
		// Nothing of the machinery, and a hidden feedback field is not promised.
		expect(line).not.toContain('identifikátor');
		expect(line).not.toContain('zařadit do cvičení');
		expect(cardSettingsSummary('teacher', false)).not.toContain('nápověda pro celou kartu');
		expect(cardSettingsSummary('teacher', true)).toContain('nápověda pro celou kartu');
	});

	it('lists folds in the card summary, not thirty field names', () => {
		const line = cardSettingsSummary('advanced');
		expect(line).toContain('opakování');
		expect(line).toContain('návaznost');
		expect(line).not.toContain('počáteční stabilita');
		expect(line.split(',').length).toBeLessThan(15);
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
			expect(
				spec.custom,
				`${spec.path} is custom and should not be rendered generically`
			).toBeUndefined();
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
describe('segmented selects', () => {
	const segmented = FIELDS.filter((spec) => spec.display === 'segmented');

	it('are the short choices, by name, and nothing else', () => {
		expect(segmented.map((spec) => spec.path).sort()).toEqual([
			'gpf.level',
			'image.position',
			'learning.difficulty',
			'video.position'
		]);
	});

	it('are selects with at most five options', () => {
		for (const spec of segmented) {
			expect(spec.kind).toBe('select');
			expect(spec.options?.length ?? 99).toBeLessThanOrEqual(5);
		}
	});

	it('leave the long lists as selects', () => {
		for (const path of ['gpf.grade', 'learning.bloom_level']) {
			expect(FIELDS.find((spec) => spec.path === path)?.display).toBeUndefined();
		}
	});
});

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

	it("found the spec's inert keys", () => {
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
		expect({ flaggedButRead, inertButUnflagged }).toEqual({
			flaggedButRead: [],
			inertButUnflagged: []
		});
	});

	it('offers nothing inert in teacher mode', () => {
		expect(FIELDS.filter((f) => f.mode === 'teacher' && f.unread).map(key)).toEqual([]);
	});

	it('does not say so on screen: an inert field is offered as if it worked', () => {
		// The owner plans to make them take effect (OPEN-PROBLEMS #41), so the line
		// under them is the hint like any other's. The flag stays, and so does the
		// spec cross-check above.
		for (const f of FIELDS.filter((f) => f.unread)) {
			expect(hintFor(f), key(f)).toBe(f.hint);
			expect(hintFor(f) ?? '', key(f)).not.toMatch(/Zatím bez účinku/);
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
		parseCourse(
			JSON.parse(
				readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
			)
		);

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

/**
 * The Zpětná vazba toggle hides what the pupil is told aside from the question.
 * Which fields those are is declared once (`feedback: true`); this pins the set, so a
 * new field cannot land in it, or a needed one cross into it, by accident.
 */
describe('feedback fields', () => {
	const key = (f: FieldSpec) => `${f.level}.${f.path}`;
	const MARKED = [
		'block.hint',
		'block.help',
		'step.hint',
		'step.help',
		'question.solution',
		'question.show_solution',
		'question.solution_image',
		'option.feedback',
		'option.feedback_image'
	];
	const NEEDED_TO_AUTHOR = [
		'option.is_correct',
		'option.text',
		'option.go_to',
		'option.mark',
		'question.options',
		'question.correct_answer',
		'question.correct_number',
		'question.tolerance',
		'question.allow_multiple',
		'question.show_answers'
	];

	it('marks exactly the explanations, hints and solution', () => {
		expect(
			FIELDS.filter((f) => f.feedback)
				.map(key)
				.sort()
		).toEqual([...MARKED].sort());
	});

	it('never marks a field a question needs to be correct', () => {
		const marked = new Set(FIELDS.filter((f) => f.feedback).map(key));
		expect(NEEDED_TO_AUTHOR.filter((path) => marked.has(path))).toEqual([]);
		for (const path of NEEDED_TO_AUTHOR) {
			expect(
				FIELDS.some((f) => key(f) === path),
				`${path} is not in the registry`
			).toBe(true);
		}
	});

	it('hides a marked field in every mode when feedback is off, and changes nothing else', () => {
		for (const mode of MODES) {
			for (const spec of FIELDS) {
				expect(visible(spec, mode), key(spec)).toBe(MODE_RANK[mode] >= MODE_RANK[spec.mode]);
				expect(visible(spec, mode, true), key(spec)).toBe(visible(spec, mode));
				expect(visible(spec, mode, false), `${key(spec)} in ${mode}`).toBe(
					spec.feedback ? false : visible(spec, mode)
				);
				const [level, ...rest] = key(spec).split('.');
				expect(allows(level as FieldLevel, rest.join('.'), mode, false), key(spec)).toBe(
					visible(spec, mode, false)
				);
			}
		}
	});

	it('leaves fieldsFor unchanged by default and drops marked fields when off', () => {
		for (const mode of MODES) {
			for (const level of ['block', 'step', 'question', 'option'] as const) {
				const on = fieldsFor(level, mode);
				expect(fieldsFor(level, mode, true)).toEqual(on);
				expect(fieldsFor(level, mode, false)).toEqual(on.filter((f) => !f.feedback));
			}
		}
		expect(fieldsFor('step', 'teacher', false).map((f) => f.path)).not.toContain('hint');
		expect(fieldsFor('step', 'teacher').map((f) => f.path)).toContain('hint');
	});

	it('recognises a ref to a feedback field, however deep, and no other', () => {
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'hint' })).toBe(true);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'help' })).toBe(true);
		expect(isFeedbackRef({ blockId: 'b', field: 'hint' })).toBe(true);
		expect(isFeedbackRef({ blockId: 'b', field: 'help' })).toBe(true);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'question.solution' })).toBe(true);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'question.solution_image.url' })).toBe(
			true
		);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'question.show_solution' })).toBe(
			true
		);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', optionId: 'o', field: 'feedback' })).toBe(
			true
		);
		expect(
			isFeedbackRef({ blockId: 'b', stepId: 's', optionId: 'o', field: 'feedback_image.url' })
		).toBe(true);

		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'question.options' })).toBe(false);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'question.correct_answer' })).toBe(
			false
		);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'content' })).toBe(false);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', optionId: 'o', field: 'is_correct' })).toBe(
			false
		);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', optionId: 'o', field: 'go_to' })).toBe(false);
		// A prefix match is on whole path segments: `hint` must not match `hints`.
		expect(isFeedbackRef({ blockId: 'b', stepId: 's', field: 'hints' })).toBe(false);
		expect(isFeedbackRef({ blockId: 'b', stepId: 's' })).toBe(false);
		expect(isFeedbackRef({})).toBe(false);
		// A lesson has no hint of its own.
		expect(isFeedbackRef({ lessonId: 'l', field: 'hint' })).toBe(false);
	});
});

/**
 * Where a field sits in its dialog is declared beside who sees it, so a mode can add
 * a fold but never leak a heading, and no heading is named after a mode.
 */
describe('sections', () => {
	const key = (f: FieldSpec) => `${f.level}.${f.path}`;
	const DIALOGS: FieldLevel[] = ['course', 'lesson', 'binding', 'block'];

	it('gives every field a section that exists for its level', () => {
		const lost = FIELDS.filter(
			(f) => !LEVEL_SECTIONS[f.level].some((section) => section.id === f.section)
		).map((f) => `${key(f)} → ${f.section}`);
		expect(lost).toEqual([]);
	});

	it('opens the first section of a level, and only that one', () => {
		for (const [level, list] of Object.entries(LEVEL_SECTIONS)) {
			if (level === 'binding') continue;
			expect(list[0].id, level).toBe('main');
			expect(list[0].label, level).toBe('Základní');
			expect(list[0].open, level).toBe(true);
			expect(
				list.slice(1).filter((s) => s.open),
				level
			).toEqual([]);
		}
	});

	it('names every section and gives it a known icon', () => {
		for (const [level, list] of Object.entries(LEVEL_SECTIONS)) {
			for (const section of list) {
				expect(section.label, `${level}.${section.id}`).not.toBe('');
				expect(Object.keys(SECTION_ICONS), `${level}.${section.id}`).toContain(section.icon);
			}
		}
	});

	it('lists the sections from Metodik up, whatever their number', () => {
		expect(listsSections('teacher')).toBe(false);
		expect(listsSections('metodik')).toBe(true);
		expect(listsSections('advanced')).toBe(true);
	});

	it('keeps a teacher out of the folds, but for the card-wide hint and help', () => {
		for (const f of FIELDS.filter((f) => DIALOGS.includes(f.level) && f.mode === 'teacher')) {
			const main = f.section === 'main';
			const ladder = f.feedback === true && f.section === 'ladder';
			expect(main || ladder, `${key(f)} is in ${f.section}`).toBe(true);
		}
	});

	it('never returns a section with nothing visible in it', () => {
		for (const mode of MODES) {
			for (const feedback of [true, false]) {
				for (const level of Object.keys(LEVEL_SECTIONS) as FieldLevel[]) {
					for (const section of sectionsFor(level, mode, feedback)) {
						const holds = FIELDS.some(
							(f) => f.level === level && f.section === section.id && visible(f, mode, feedback)
						);
						const derived =
							section.mode !== undefined && MODE_RANK[mode] >= MODE_RANK[section.mode];
						expect(holds || derived, `${level}.${section.id} in ${mode}/${feedback}`).toBe(true);
					}
				}
			}
		}
	});

	it('only adds sections as the mode rises', () => {
		for (const level of Object.keys(LEVEL_SECTIONS) as FieldLevel[]) {
			const ids = MODES.map((mode) => sectionsFor(level, mode).map((s) => s.id));
			expect(ids[1], level).toEqual(expect.arrayContaining(ids[0]));
			expect(ids[2], level).toEqual(expect.arrayContaining(ids[1]));
		}
	});

	it('shows a teacher the open card section and the card-wide hint, nothing else', () => {
		expect(sectionsFor('block', 'teacher').map((s) => s.id)).toEqual(['main', 'ladder']);
		expect(sectionsFor('block', 'teacher', false).map((s) => s.id)).toEqual(['main']);
		expect(sectionsFor('block', 'metodik').map((s) => s.id)).toEqual(['main', 'ladder', 'topics']);
		expect(sectionsFor('block', 'advanced').map((s) => s.id)).toEqual([
			'main',
			'ladder',
			'topics',
			'review',
			'followup',
			'meta'
		]);
		expect(sectionsFor('course', 'teacher').map((s) => s.id)).toEqual(['main']);
		expect(sectionsFor('lesson', 'teacher').map((s) => s.id)).toEqual(['main']);
		expect(sectionsFor('lesson', 'metodik').map((s) => s.id)).toEqual(['main', 'didactics', 'ai']);
	});

	it('finds a section by a field in it, without diacritics, and marks the field', () => {
		const found = matchSections(['block'], 'odstup', 'advanced');
		expect([...found.sections]).toEqual(['review']);
		expect(found.fields.has('block.fsrs.min_interval')).toBe(true);
		expect(found.fields.has('block.fsrs.max_interval')).toBe(true);
		expect([...matchSections(['block'], 'opakovani', 'advanced').sections]).toContain('review');
		// How a teacher who was told what to change would put it.
		expect([...matchSections(['block'], 'jak často', 'advanced').sections]).toContain('review');
	});

	it('finds a hand-written section by its keywords, and only what the mode shows', () => {
		expect([...matchSections(['block'], 'dovednost', 'advanced').sections]).toContain('topics');
		expect(matchSections(['block'], 'odstup', 'metodik').sections.size).toBe(0);
		expect(matchSections(['block'], '  ', 'advanced').sections.size).toBe(0);
	});

	it('needs every word typed', () => {
		expect([...matchSections(['block'], 'nejdelší odstup', 'advanced').fields]).toEqual([
			'block.fsrs.max_interval'
		]);
	});

	it('names no section after a mode', () => {
		const labels = Object.values(LEVEL_SECTIONS).flatMap((list) => list.map((s) => s.label));
		for (const label of labels) {
			expect(label, label).not.toMatch(/^(Didaktika|Technické|Pokročilé|Metodik|Učitel)$/);
		}
	});

	it('finds the section a ref points into, by the longest field path', () => {
		const at = (ref: Parameters<typeof specOf>[0]) => specOf(ref)?.section;
		expect(at({ blockId: 'b', field: 'hint' })).toBe('ladder');
		expect(at({ blockId: 'b', field: 'help' })).toBe('ladder');
		expect(at({ blockId: 'b', stepId: 's', field: 'hint' })).toBe('main');
		expect(at({ blockId: 'b', field: 'fsrs.weight' })).toBe('review');
		expect(at({ blockId: 'b', field: 'learning.competencies.0.weight' })).toBe('topics');
		expect(at({ blockId: 'b', field: 'learning.prerequisites.1.block_id' })).toBe('followup');
		expect(at({ lessonId: 'l', blockId: 'b', field: 'bg_color' })).toBe('lesson');
		expect(at({ field: 'only_once' })).toBe('run');
		expect(at({ lessonId: 'l', field: 'ai_context' })).toBe('ai');
		expect(at({ blockId: 'b', field: 'nothing.here' })).toBeUndefined();
	});
});

describe('field defaults', () => {
	it('every field whose hint names a default shows it when empty', () => {
		const missing = FIELDS.filter(
			(spec) => /výchozí/i.test(spec.hint ?? '') && spec.default === undefined
		).map((spec) => `${spec.level}.${spec.path}`);
		expect(missing).toEqual([]);
	});
});

describe('what a higher mode adds', () => {
	it('names the next mode that adds something, in teacher words', () => {
		expect(modeGain(['block'], 'teacher')).toEqual({
			mode: 'metodik',
			section: 'topics',
			text: 'Dovednosti, pojmy a zařazení do cvičení najdeš v režimu Metodik'
		});
		expect(modeGain(['block'], 'metodik')).toMatchObject({
			mode: 'advanced',
			section: 'review',
			text: 'Opakování, návaznost a údaje o kartě najdeš v režimu Pokročilý'
		});
		expect(modeGain(['lesson'], 'teacher')).toMatchObject({
			mode: 'metodik',
			section: 'didactics'
		});
		expect(modeGain(['course'], 'metodik')?.text).toBe(
			'Průběh kurzu a údaje o kurzu najdeš v režimu Pokročilý'
		);
	});

	it('says nothing in Pokročilý, where everything is shown', () => {
		for (const level of ['course', 'lesson', 'block', 'binding'] as const) {
			expect(modeGain([level], 'advanced')).toBeUndefined();
		}
	});

	it('names only what is really not shown yet', () => {
		// A card in a lesson also gains the lesson's own section (its colours).
		expect(modeGain(['block', 'binding'], 'teacher')?.mode).toBe('metodik');
		expect(modeGain(['block', 'binding'], 'metodik')?.text).toContain('barvu karty');
	});

	it('finds what only a higher mode has, with the mode that has it', () => {
		const found = matchHigherModes(['block'], 'nejdelší odstup', 'teacher');
		expect(found).toEqual([
			{ mode: 'advanced', level: 'block', section: 'review', label: 'Nejdelší odstup' }
		]);
		expect(matchHigherModes(['block'], 'nejdelší odstup', 'advanced')).toEqual([]);
		expect(matchHigherModes(['block'], 'dovednost', 'teacher')[0]).toMatchObject({
			mode: 'metodik',
			section: 'topics'
		});
		expect(matchHigherModes(['block'], '  ', 'teacher')).toEqual([]);
	});
});
