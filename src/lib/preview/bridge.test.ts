import { describe, expect, it } from 'vitest';
import { nearestSurviving, PreviewBridge } from './bridge';
import type { BlockV2, CourseV2 } from '$lib/domain/schema';

/**
 * After the step graph changes the engine has to be re-mounted, and the author must
 * land where they were working — not back at step one of a ten-step block.
 */
describe('restoring the preview after a re-mount', () => {
	it('stays on the same step when it survived', () => {
		expect(nearestSurviving('s3', ['s1', 's2', 's3'], ['s1', 's2', 's3', 's4'])).toBe('s3');
	});

	it('falls back to the step before when the current one was deleted', () => {
		expect(nearestSurviving('s3', ['s1', 's2', 's3', 's4'], ['s1', 's2', 's4'])).toBe('s2');
	});

	it('falls forward when nothing before it survived', () => {
		expect(nearestSurviving('s2', ['s1', 's2', 's3'], ['s3'])).toBe('s3');
	});

	it('starts at the beginning when there is no current step', () => {
		expect(nearestSurviving(undefined, [], ['s1', 's2'])).toBe('s1');
	});

	it('starts at the beginning when the whole block was replaced', () => {
		expect(nearestSurviving('s3', ['s1', 's2', 's3'], ['s7', 's8'])).toBe('s7');
	});
});


/**
 * The two preview modes share one channel, and for a while they shared one piece of
 * state they should not have: the played run wrote where it had got to, and the
 * expanded view read it back as the step to sit on. Step ids are unique per block,
 * not per course, so a run that ended on the third step of card seven sent the
 * expanded view to the third step of whatever card was open.
 *
 * The bridge never touches `window` until `attach`, so the whole contract can be
 * driven here: `pending` is what would go on the wire, `receive` is what the player
 * said.
 */
const card = (...stepIds: string[]) =>
	({ block_id: 'B1', steps: stepIds.map((id) => ({ id })) }) as unknown as BlockV2;
const asIs = (value: unknown) => value;
const sent = (bridge: PreviewBridge) =>
	bridge.pending as { type: string; stepId?: string; remount?: boolean } | null;

describe('a played run never decides what the expanded view shows', () => {
	it('forgets where Vyzkoušet got to when it goes back to the card', () => {
		const bridge = new PreviewBridge();
		bridge.showBlock(card('s1', 's2', 's3'), 'course_v2', asIs);
		bridge.showLesson({} as CourseV2, 'L1', 'course_v2', asIs, 'B1');
		bridge.receive({ type: 'stepChanged', stepId: 's3', blockId: 'B7' });
		bridge.showBlock(card('s1', 's2', 's3'), 'course_v2', asIs);

		expect(sent(bridge)?.stepId).toBe('s1');
	});

	it('lands on the step the editor has selected, not the one the run ended on', () => {
		const bridge = new PreviewBridge();
		bridge.showLesson({} as CourseV2, 'L1', 'course_v2', asIs);
		bridge.receive({ type: 'stepChanged', stepId: 's3' });
		bridge.showBlock(card('s1', 's2', 's3'), 'course_v2', asIs, 'expanded', 's2');

		expect(sent(bridge)?.stepId).toBe('s2');
	});

	it('ignores a selection that names a step of some other card', () => {
		const bridge = new PreviewBridge();
		bridge.showBlock(card('s1', 's2'), 'course_v2', asIs, 'expanded', 'a_step_of_another_card');

		expect(sent(bridge)?.stepId).toBe('s1');
	});

	it('keeps the outline where it is while the author types', () => {
		const bridge = new PreviewBridge();
		bridge.showBlock(card('s1', 's2'), 'course_v2', asIs, 'expanded', 's2');
		bridge.showBlock(card('s1', 's2'), 'course_v2', asIs, 'expanded', 's2');

		expect(sent(bridge)).toMatchObject({ remount: false, stepId: 's2' });
	});

	it('re-mounts when the view changes even though the steps did not', () => {
		const bridge = new PreviewBridge();
		bridge.showBlock(card('s1', 's2'), 'course_v2', asIs, 'expanded');
		bridge.showBlock(card('s1', 's2'), 'course_v2', asIs, 'play');

		expect(sent(bridge)?.remount).toBe(true);
	});

	it('does not move because the author clicked something', () => {
		const bridge = new PreviewBridge();
		bridge.showBlock(card('s1', 's2', 's3'), 'course_v2', asIs, 'expanded', 's1');
		bridge.receive({ type: 'clicked', ref: { blockId: 'B1', stepId: 's3' } });
		bridge.showBlock(card('s1', 's2', 's3'), 'course_v2', asIs, 'expanded', 's1');

		expect(sent(bridge)?.stepId).toBe('s1');
	});
});

describe('the outgoing queue', () => {
	it('does not let a pre-boot jump drop the card queued behind it', () => {
		const bridge = new PreviewBridge();
		bridge.showBlock(card('s1'), 'course_v2', asIs);
		bridge.highlight({ blockId: 'B1', stepId: 's1' });

		expect(sent(bridge)?.type).toBe('setBlock');
	});
});
