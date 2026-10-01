import { describe, expect, it } from 'vitest';
import type { Ref } from '$lib/domain/ref';
import { sectionTargeted } from './settings-target';

const store = (selection: Ref | null, ...issues: Ref[]) => ({
	selection,
	shown: { errors: issues.map((ref) => ({ ref })), warnings: [] }
});
// The helper only reads these two fields of the store.
const target = (
	s: ReturnType<typeof store>,
	...args: Parameters<typeof sectionTargeted> extends [unknown, ...infer R] ? R : never
) => sectionTargeted(s as never, ...args);

describe('sectionTargeted', () => {
	const scope = { blockId: 'b1' };

	it('opens the card-wide hint fold for the preview question mark and for a jump', () => {
		expect(target(store({ blockId: 'b1', field: 'hint' }), ['block'], 'ladder', scope)).toBe(true);
		expect(target(store({ blockId: 'b1', field: 'help' }), ['block'], 'ladder', scope)).toBe(true);
	});

	it('opens the fold that holds an invalid field', () => {
		const issue = { blockId: 'b1', field: 'learning.prerequisites.0.block_id' };
		expect(target(store(null, issue), ['block'], 'followup', scope)).toBe(true);
		expect(target(store(null, issue), ['block'], 'topics', scope)).toBe(false);
	});

	it('ignores other cards, steps with the same field name, and unknown fields', () => {
		expect(target(store({ blockId: 'b2', field: 'hint' }), ['block'], 'ladder', scope)).toBe(false);
		const step = { blockId: 'b1', stepId: 's1', field: 'hint' };
		expect(target(store(step), ['block'], 'ladder', scope)).toBe(false);
		expect(target(store({ blockId: 'b1', field: 'x.y' }), ['block'], 'ladder', scope)).toBe(false);
		expect(target(store(null), ['block'], 'ladder', scope)).toBe(false);
	});

	it('tells the course, a lesson and a card apart', () => {
		expect(target(store({ field: 'only_once' }), ['course'], 'run', {})).toBe(true);
		expect(target(store({ lessonId: 'l1', field: 'only_once' }), ['course'], 'run', {})).toBe(
			false
		);
		expect(
			target(store({ lessonId: 'l1', field: 'ai_context' }), ['lesson'], 'ai', { lessonId: 'l1' })
		).toBe(true);
		expect(
			target(store({ lessonId: 'l2', field: 'ai_context' }), ['lesson'], 'ai', { lessonId: 'l1' })
		).toBe(false);
	});

	it('finds a lesson binding field from the card dialog', () => {
		const ref = { lessonId: 'l1', blockId: 'b1', field: 'bg_color' };
		expect(target(store(ref), ['binding'], 'lesson', scope)).toBe(true);
	});
});
