import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCourse } from '../document';
import type { CourseV2 } from '../schema';
import { buildIndex, isGoToKeyword } from '../index-doc';
import {
	addBlock,
	addOption,
	addStep,
	bindBlock,
	CommandError,
	deleteBlock,
	deleteStep,
	duplicateBlock,
	duplicateStep,
	moveBlockToLesson,
	planDeleteBlock,
	planDeleteStep,
	renameBlock,
	reorderBindings,
	reorderSteps,
	setField,
	setQuestionType,
	unbindBlock,
	setTopics,
	blockTopics,
	type Repair
} from '../commands';
import { stepReservation, type Reservations } from '../ids';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const base = () => parseCourse(fixture('spec-16-course.json'));

// ────────────────────────────── invariant checks ──────────────────────────────

function expectNoDanglingGoTo(doc: CourseV2) {
	const index = buildIndex(doc);
	for (const block of doc.blocks) {
		const ownSteps = index.stepsByBlock.get(block.block_id)!;
		for (const step of block.steps) {
			for (const option of step.question?.options ?? []) {
				const target = option.go_to;
				if (typeof target !== 'string' || target === '') continue;
				if (isGoToKeyword(target)) continue;
				const resolves = ownSteps.has(target) || index.blocksById.has(target);
				expect(resolves, `${block.block_id}/${step.id}/${option.id} → ${target}`).toBe(true);
			}
		}
	}
}

function expectUniqueIds(doc: CourseV2) {
	expect(new Set(doc.blocks.map((b) => b.block_id)).size).toBe(doc.blocks.length);
	expect(new Set(doc.lessons.map((l) => l.lesson_id)).size).toBe(doc.lessons.length);
	for (const block of doc.blocks) {
		expect(new Set(block.steps.map((s) => s.id)).size, block.block_id).toBe(block.steps.length);
	}
}

function expectOrderIsDense(doc: CourseV2) {
	doc.lessons.forEach((lesson, i) => {
		expect(lesson.order).toBe(i + 1);
		lesson.blocks.forEach((binding, j) => expect(binding.order).toBe(j + 1));
	});
	for (const block of doc.blocks) {
		block.steps.forEach((step, i) => expect(step.order).toBe(i + 1));
	}
}

/** Mirrors what the document store keeps: every id this session has handed out. */
function reservations() {
	const blocks = new Set<string>();
	const lessons = new Set<string>();
	const steps = new Set<string>();
	const record = (doc: CourseV2) => {
		for (const lesson of doc.lessons) lessons.add(lesson.lesson_id);
		for (const block of doc.blocks) {
			blocks.add(block.block_id);
			for (const step of block.steps) steps.add(stepReservation(block.block_id, step.id));
		}
	};
	return { value: { blocks, lessons, steps } as Reservations, record };
}

// ────────────────────────────────── unit behaviour ──────────────────────────────────

describe('step ids', () => {
	it('are minted as s{max+1} and never reuse a deleted id', () => {
		const reserved = reservations();
		let doc = base();
		reserved.record(doc);
		const blockId = 'L1_B1_uvod';

		doc = addStep(doc, blockId, 'text', undefined, reserved.value).doc; // s3
		reserved.record(doc);
		expect(doc.blocks.find((b) => b.block_id === blockId)!.steps.map((s) => s.id))
			.toEqual(['s1', 's2', 's3']);

		doc = deleteStep(doc, blockId, 's3').doc;
		doc = addStep(doc, blockId, 'text', undefined, reserved.value).doc;
		// s3 is gone for good: the next id is s4, not a reused s3. A student's saved
		// answer is keyed by (block_id, step id), so a reused id would inherit it.
		expect(doc.blocks.find((b) => b.block_id === blockId)!.steps.map((s) => s.id))
			.toEqual(['s1', 's2', 's4']);
	});

	it('do not restart even when every step of a block is deleted', () => {
		const reserved = reservations();
		let doc = base();
		reserved.record(doc);
		const blockId = 'L1_B1_uvod';

		for (const stepId of ['s1', 's2']) doc = deleteStep(doc, blockId, stepId).doc;
		doc = addStep(doc, blockId, 'text', undefined, reserved.value).doc;
		expect(doc.blocks.find((b) => b.block_id === blockId)!.steps.map((s) => s.id)).toEqual(['s3']);
	});

	it('survive a reorder untouched — only `order` moves', () => {
		let doc = base();
		const blockId = 'L1_B3_poznej';
		doc = reorderSteps(doc, blockId, ['s4', 's1', 's3', 's2']).doc;
		const steps = doc.blocks.find((b) => b.block_id === blockId)!.steps;
		expect(steps.map((s) => s.id)).toEqual(['s4', 's1', 's3', 's2']);
		expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4]);
		// The branch that pointed at s4 still points at s4.
		const options = steps.find((s) => s.id === 's2')!.question!.options!;
		expect(options.find((o) => o.id === 'a')!.go_to).toBe('s4');
		expectNoDanglingGoTo(doc);
	});
});

describe('duplicating a block', () => {
	it('mints a fresh id, restarts step ids and drops inward `go_to`', () => {
		const doc = duplicateBlock(base(), 'L1_B3_poznej', 'L1_INTRO').doc;
		const copy = doc.blocks.find((b) => b.block_id === 'L1_B3_poznej_copy')!;

		expect(copy.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
		const options = copy.steps.find((s) => s.id === 's2')!.question!.options!;
		// Internal targets are remapped onto the copy's own steps…
		expect(options.find((o) => o.id === 'a')!.go_to).toBe('s4');
		expect(options.find((o) => o.id === 'b')!.go_to).toBe('s3');
		// …a cross-block target and a keyword still mean the same thing.
		expect(options.find((o) => o.id === 'c')!.go_to).toBe('L1_B2_casti');
		expect(options.find((o) => o.id === 'd')!.go_to).toBe('CHAT');
		expectNoDanglingGoTo(doc);
		expectUniqueIds(doc);
	});

	it('drops a target that the copy cannot have', () => {
		let doc = base();
		// Point an option at a step id that exists in the original but will not exist
		// in a copy whose ids restart at s1: add s5, then point at it, then trim.
		doc = addStep(doc, 'L1_B3_poznej', 'text').doc; // s5
		doc = setField(doc, { blockId: 'L1_B3_poznej', stepId: 's2', optionId: 'd', field: 'go_to' }, 's5').doc;
		doc = deleteStep(doc, 'L1_B3_poznej', 's5', [
			{
				reference: planDeleteStep(doc, 'L1_B3_poznej', 's5')[0],
				action: 'clear'
			}
		]).doc;

		const copy = duplicateBlock(doc, 'L1_B3_poznej').doc.blocks.at(-1)!;
		expect(copy.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
		expect(copy.steps.find((s) => s.id === 's2')!.question!.options!.find((o) => o.id === 'd')!.go_to)
			.toBeUndefined();
	});

	it('inserts the copy right after the original in the lesson', () => {
		const doc = duplicateBlock(base(), 'L1_B1_uvod', 'L1_INTRO').doc;
		expect(doc.lessons[0].blocks.map((b) => b.block_id)).toEqual([
			'L1_B1_uvod',
			'L1_B1_uvod_copy',
			'L1_B2_casti',
			'L1_B3_poznej'
		]);
	});
});

describe('delete safety', () => {
	it('refuses to delete a step that a branch points at', () => {
		const doc = base();
		expect(planDeleteStep(doc, 'L1_B3_poznej', 's3')).toHaveLength(1);
		expect(() => deleteStep(doc, 'L1_B3_poznej', 's3')).toThrow(CommandError);
	});

	it('deletes once each pointer is repaired', () => {
		const doc = base();
		const references = planDeleteStep(doc, 'L1_B3_poznej', 's3');
		const repairs: Repair[] = references.map((reference) => ({ reference, action: 'redirect', to: 'AGAIN' }));
		const next = deleteStep(doc, 'L1_B3_poznej', 's3', repairs).doc;

		expect(next.blocks.find((b) => b.block_id === 'L1_B3_poznej')!.steps.map((s) => s.id))
			.toEqual(['s1', 's2', 's4']);
		const options = next.blocks.find((b) => b.block_id === 'L1_B3_poznej')!
			.steps.find((s) => s.id === 's2')!.question!.options!;
		expect(options.find((o) => o.id === 'b')!.go_to).toBe('AGAIN');
		expectNoDanglingGoTo(next);
	});

	it('refuses to delete a block that a lesson binds or a branch targets', () => {
		const doc = base();
		const references = planDeleteBlock(doc, 'L1_B2_casti');
		// One lesson binding, one cross-block `go_to`, one prerequisite.
		expect(references.map((r) => r.kind).sort()).toEqual(['binding', 'go_to', 'prerequisite']);
		expect(() => deleteBlock(doc, 'L1_B2_casti')).toThrow(CommandError);
	});

	it('clears binding, branch and prerequisite together', () => {
		const doc = base();
		const repairs: Repair[] = planDeleteBlock(doc, 'L1_B2_casti').map((reference) => ({
			reference,
			action: 'clear'
		}));
		const next = deleteBlock(doc, 'L1_B2_casti', repairs).doc;

		expect(next.blocks.some((b) => b.block_id === 'L1_B2_casti')).toBe(false);
		expect(next.lessons[0].blocks.map((b) => b.block_id)).toEqual(['L1_B1_uvod', 'L1_B3_poznej']);
		expect(next.blocks.find((b) => b.block_id === 'L1_B3_poznej')!.learning!.prerequisites)
			.toEqual([]);
		expectNoDanglingGoTo(next);
		expectOrderIsDense(next);
	});
});

describe('renaming a block', () => {
	it('rewrites every pointer at it', () => {
		const doc = renameBlock(base(), 'L1_B2_casti', 'L1_B2_nove').doc;
		expect(doc.lessons[0].blocks.map((b) => b.block_id)).toContain('L1_B2_nove');
		expect(doc.blocks.find((b) => b.block_id === 'L1_B3_poznej')!.learning!.prerequisites![0].block_id)
			.toBe('L1_B2_nove');
		const options = doc.blocks.find((b) => b.block_id === 'L1_B3_poznej')!
			.steps.find((s) => s.id === 's2')!.question!.options!;
		expect(options.find((o) => o.id === 'c')!.go_to).toBe('L1_B2_nove');
		expectNoDanglingGoTo(doc);
	});

	it('is refused through setField, which cannot repair references', () => {
		expect(() => setField(base(), { blockId: 'L1_B1_uvod', field: 'block_id' }, 'X')).toThrow(CommandError);
	});
});

describe('setField', () => {
	it('writes a nested path', () => {
		const doc = setField(base(), { blockId: 'L1_B3_poznej', field: 'learning.difficulty' }, 4).doc;
		expect(doc.blocks.find((b) => b.block_id === 'L1_B3_poznej')!.learning!.difficulty).toBe(4);
	});

	it('removes a field when given undefined', () => {
		const doc = setField(base(), { blockId: 'L1_B1_uvod', field: 'xp' }, undefined).doc;
		expect(doc.blocks.find((b) => b.block_id === 'L1_B1_uvod')).not.toHaveProperty('xp');
	});

	it('leaves the rest of the document untouched', () => {
		const before = base();
		const after = setField(before, { field: 'name' }, 'Nový název').doc;
		expect(after.name).toBe('Nový název');
		expect(after.blocks).toBe(before.blocks);
	});
});

describe('switching question type', () => {
	it('seeds true/false with exactly two options and one correct', () => {
		const doc = setQuestionType(base(), 'L1_B3_poznej', 's2', 'true_false').doc;
		const question = doc.blocks.find((b) => b.block_id === 'L1_B3_poznej')!
			.steps.find((s) => s.id === 's2')!.question!;
		expect(question.options!.map((o) => o.id)).toEqual(['true', 'false']);
		expect(question.options!.filter((o) => o.is_correct).length).toBe(1);
	});

	it('drops options a numeric question must not carry', () => {
		const doc = setQuestionType(base(), 'L1_B3_poznej', 's2', 'numeric').doc;
		const question = doc.blocks.find((b) => b.block_id === 'L1_B3_poznej')!
			.steps.find((s) => s.id === 's2')!.question!;
		expect(question.options).toBeUndefined();
	});
});

describe('moving a block between lessons', () => {
	it('keeps its per-lesson presentation and renumbers both lessons', () => {
		let doc = base();
		doc = { ...doc, lessons: [...doc.lessons, { lesson_id: 'L2', name: 'Druhá', order: 2, blocks: [] }] };
		doc = moveBlockToLesson(doc, 'L1_B2_casti', 'L1_INTRO', 'L2').doc;

		expect(doc.lessons[0].blocks.map((b) => b.block_id)).toEqual(['L1_B1_uvod', 'L1_B3_poznej']);
		expect(doc.lessons[1].blocks[0]).toEqual({ block_id: 'L1_B2_casti', order: 1, bg_color: '#FFF7E6' });
		expectOrderIsDense(doc);
	});
});

// ─────────────────────────────── property test ───────────────────────────────

/** Small deterministic PRNG, so a failure is reproducible from its seed. */
function rng(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

describe('random command sequences keep the invariants', () => {
	const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

	it.each(seeds)('seed %i', (seed) => {
		const random = rng(seed);
		const pick = <T>(xs: T[]): T | undefined =>
			xs.length === 0 ? undefined : xs[Math.floor(random() * xs.length)];

		let doc = base();
		const reserved = reservations();
		reserved.record(doc);

		// An id, once handed out, belongs to that thing for the rest of the session —
		// even after it is deleted. Reusing one would silently inherit a student's
		// completion state, practice card and saved answers (§3 invariants 1 and 2).
		const stepIdentity = new Map<string, string>();
		const observe = (d: CourseV2) => {
			for (const block of d.blocks) {
				for (const step of block.steps) {
					const key = stepReservation(block.block_id, step.id);
					const identity = JSON.stringify([step.type, step.content ?? null]);
					const known = stepIdentity.get(key);
					if (known === undefined) stepIdentity.set(key, identity);
					else expect(identity, `${key} was handed to a different step`).toBe(known);
				}
			}
			reserved.record(d);
		};
		observe(doc);

		for (let i = 0; i < 60; i++) {
			const lesson = pick(doc.lessons);
			const block = pick(doc.blocks);
			const operation = Math.floor(random() * 10);

			try {
				switch (operation) {
					case 0:
						if (lesson)
							doc = addBlock(
								doc,
								lesson.lesson_id,
								random() < 0.5 ? 'display' : 'question',
								undefined,
								reserved.value
							).doc;
						break;
					case 1:
						if (block) doc = duplicateBlock(doc, block.block_id, lesson?.lesson_id, reserved.value).doc;
						break;
					case 2: {
						if (!block) break;
						const repairs: Repair[] = planDeleteBlock(doc, block.block_id).map((reference) => ({
							reference,
							action: 'clear'
						}));
						doc = deleteBlock(doc, block.block_id, repairs).doc;
						break;
					}
					case 3:
						if (block)
							doc = addStep(
								doc,
								block.block_id,
								random() < 0.5 ? 'text' : 'question',
								undefined,
								reserved.value
							).doc;
						break;
					case 4: {
						if (!block) break;
						const step = pick(block.steps);
						if (step) doc = duplicateStep(doc, block.block_id, step.id, reserved.value).doc;
						break;
					}
					case 5: {
						if (!block) break;
						const step = pick(block.steps);
						if (!step) break;
						const repairs: Repair[] = planDeleteStep(doc, block.block_id, step.id).map((reference) => ({
							reference,
							action: 'clear'
						}));
						doc = deleteStep(doc, block.block_id, step.id, repairs).doc;
						break;
					}
					case 6: {
						if (!block) break;
						const ids = block.steps.map((s) => s.id).sort(() => random() - 0.5);
						doc = reorderSteps(doc, block.block_id, ids).doc;
						break;
					}
					case 7: {
						if (!lesson) break;
						const ids = lesson.blocks.map((b) => b.block_id).sort(() => random() - 0.5);
						doc = reorderBindings(doc, lesson.lesson_id, ids).doc;
						break;
					}
					case 8: {
						if (!lesson || !block) break;
						const bound = lesson.blocks.some((b) => b.block_id === block.block_id);
						doc = bound
							? unbindBlock(doc, lesson.lesson_id, block.block_id).doc
							: bindBlock(doc, lesson.lesson_id, block.block_id).doc;
						break;
					}
					case 9: {
						if (!block) break;
						const step = pick(block.steps.filter((s) => s.question !== undefined));
						if (step) doc = addOption(doc, block.block_id, step.id).doc;
						break;
					}
				}
			} catch (error) {
				// A command may legitimately refuse (deleting a block that a repair plan
				// did not cover because the document moved on). It must never corrupt.
				expect(error).toBeInstanceOf(CommandError);
			}

			expectUniqueIds(doc);
			expectNoDanglingGoTo(doc);
			expectOrderIsDense(doc);
			observe(doc);
		}
	});
});

describe('knowledge vector: many topics', () => {
	const DIMENSIONS = 35;
	const naming = (index: number) => ({
		domain: `D${index}`,
		construct: `C${index}`,
		subconstruct: `N${index} téma`
	});
	const base = (): CourseV2 => ({
		export_type: 'course_v2',
		course_id: 'C',
		lessons: [{ lesson_id: 'L1', blocks: [{ block_id: 'B1', order: 1 }] }],
		blocks: [{ block_id: 'B1', type: 'question', steps: [] }]
	});
	const gpfOf = (doc: CourseV2) => doc.blocks[0].gpf;

	it('carries more than one topic at a time', () => {
		const { doc } = setTopics(
			base(),
			'B1',
			[
				{ dimensionIndex: 2, relation: 2, elo: 4.5 },
				{ dimensionIndex: 7, relation: 1, elo: 7 }
			],
			DIMENSIONS,
			naming
		);
		expect(gpfOf(doc)?.relation_vector?.[2]).toBe(2);
		expect(gpfOf(doc)?.relation_vector?.[7]).toBe(1);
		expect(gpfOf(doc)?.elo_vector?.[2]).toBe(4.5);
		expect(gpfOf(doc)?.elo_vector?.[7]).toBe(7);
	});

	it('gives every live relation a difficulty, or the engine ignores it', () => {
		// EloEngine.updateTask skips any dimension whose elo is null or <= 0, so a
		// relation without a difficulty is a card that measures nothing.
		const { doc } = setTopics(
			base(),
			'B1',
			[{ dimensionIndex: 3, relation: 2, elo: 6 }],
			DIMENSIONS,
			naming
		);
		const relation = gpfOf(doc)?.relation_vector ?? [];
		const elo = gpfOf(doc)?.elo_vector ?? [];
		relation.forEach((value, index) => {
			if (value > 0) expect(elo[index]).toBeGreaterThan(0);
		});
	});

	it('names the card after its strongest topic, not the last one picked', () => {
		const { doc } = setTopics(
			base(),
			'B1',
			[
				{ dimensionIndex: 9, relation: 1, elo: 6 },
				{ dimensionIndex: 4, relation: 2, elo: 6 }
			],
			DIMENSIONS,
			naming
		);
		expect(gpfOf(doc)?.subconstruct).toBe('N4 téma');
	});

	it('never lets the classification drift from the vector', () => {
		// The old picker rewrote the name but left the previous topic's 2 behind, so
		// a card claimed one subconstruct and trained two.
		let doc = setTopics(base(), 'B1', [{ dimensionIndex: 2, relation: 2, elo: 6 }], DIMENSIONS, naming).doc;
		doc = setTopics(doc, 'B1', [{ dimensionIndex: 5, relation: 2, elo: 6 }], DIMENSIONS, naming).doc;

		expect(gpfOf(doc)?.subconstruct).toBe('N5 téma');
		expect(gpfOf(doc)?.relation_vector?.[2]).toBe(0);
		expect(gpfOf(doc)?.relation_vector?.[5]).toBe(2);
	});

	it('clears the classification when the last topic is removed', () => {
		let doc = setTopics(base(), 'B1', [{ dimensionIndex: 2, relation: 2, elo: 6 }], DIMENSIONS, naming).doc;
		doc = setTopics(doc, 'B1', [], DIMENSIONS, naming).doc;

		expect(gpfOf(doc)?.subconstruct).toBeUndefined();
		expect(gpfOf(doc)?.domain).toBeUndefined();
		expect(gpfOf(doc)?.relation_vector).toBeUndefined();
		expect(gpfOf(doc)?.elo_vector).toBeUndefined();
	});

	it('keeps a difficulty the author tuned on a dimension they did not touch', () => {
		let doc = setTopics(
			base(),
			'B1',
			[
				{ dimensionIndex: 2, relation: 2, elo: 8.5 },
				{ dimensionIndex: 6, relation: 1, elo: 3 }
			],
			DIMENSIONS,
			naming
		).doc;
		doc = setTopics(doc, 'B1', [{ dimensionIndex: 2, relation: 2, elo: 8.5 }], DIMENSIONS, naming).doc;
		expect(gpfOf(doc)?.elo_vector?.[2]).toBe(8.5);
		expect(gpfOf(doc)?.relation_vector?.[6]).toBe(0);
	});

	it('round-trips through blockTopics', () => {
		const topics = [
			{ dimensionIndex: 1, relation: 2 as const, elo: 5 },
			{ dimensionIndex: 8, relation: 1 as const, elo: 7.5 }
		];
		const { doc } = setTopics(base(), 'B1', topics, DIMENSIONS, naming);
		expect(blockTopics(doc.blocks[0])).toEqual(topics);
	});
});
