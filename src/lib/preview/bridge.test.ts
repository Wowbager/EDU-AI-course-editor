import { describe, expect, it, vi } from 'vitest';
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

		// Nothing is selected, so nothing is outlined — least of all s3.
		expect(sent(bridge)?.stepId).toBeUndefined();
	});

	it('outlines nothing when no step is focused', () => {
		// It used to fall back to the "nearest surviving" step and outline step 1 of
		// every card nobody had focused.
		const bridge = new PreviewBridge();
		bridge.showBlock(card('s1', 's2'), 'course_v2', asIs, 'expanded', 's2');
		bridge.showBlock(card('s1', 's3'), 'course_v2', asIs, 'expanded');

		expect(sent(bridge)?.stepId).toBeUndefined();
	});

	it('lands on the step the editor has selected, not the one the run ended on', () => {
		const bridge = new PreviewBridge();
		bridge.showLesson({} as CourseV2, 'L1', 'course_v2', asIs);
		bridge.receive({ type: 'stepChanged', stepId: 's3', blockId: 'B1' });
		bridge.showBlock(card('s1', 's2', 's3'), 'course_v2', asIs, 'expanded', 's2');

		expect(sent(bridge)?.stepId).toBe('s2');
	});

	it('ignores a selection that names a step of some other card', () => {
		const bridge = new PreviewBridge();
		bridge.showBlock(card('s1', 's2'), 'course_v2', asIs, 'expanded', 'a_step_of_another_card');

		expect(sent(bridge)?.stepId).toBeUndefined();
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

describe('following a played run', () => {
	it('passes on every position the player reports, with its card', () => {
		const seen: string[] = [];
		const bridge = new PreviewBridge({ onstepChanged: (stepId, blockId) => seen.push(`${blockId}/${stepId}`) });
		bridge.receive({ type: 'stepChanged', stepId: 's1', blockId: 'B1' });
		bridge.receive({ type: 'stepChanged', stepId: 's1', blockId: 'B2' });
		expect(seen).toEqual(['B1/s1', 'B2/s1']);
	});

	it('passes on which steps the pupil can see, when the player says', () => {
		const seen: (string[] | undefined)[] = [];
		const bridge = new PreviewBridge({ onstepChanged: (_s, _b, shown) => seen.push(shown) });
		bridge.receive({ type: 'stepChanged', stepId: 's2', blockId: 'B1', shownStepIds: ['s1', 's2'] });
		bridge.receive({ type: 'stepChanged', stepId: 's1', blockId: 'B1' });
		bridge.receive({ type: 'stepChanged', stepId: 's1', blockId: 'B1', shownStepIds: ['s1', 7] } as never);
		expect(seen).toEqual([['s1', 's2'], undefined, ['s1']]);
	});

	it('ignores a position that does not say which card it is in', () => {
		// Step ids repeat across cards: without the card it is not a position.
		const seen: string[] = [];
		const bridge = new PreviewBridge({ onstepChanged: (stepId) => seen.push(stepId) });
		bridge.receive({ type: 'stepChanged', stepId: 's1' } as never);
		expect(seen).toEqual([]);
	});
});

describe("the tests' own question", () => {
	it('is answered to them and moves nothing in the editor', () => {
		// `inspected` is the reply to the e2e suite's `inspect`. A position in it is
		// not a move: the editor follows a run from `stepChanged` alone.
		const calls: string[] = [];
		const bridge = new PreviewBridge({
			onready: () => calls.push('ready'),
			onstepChanged: () => calls.push('stepChanged'),
			onnavState: () => calls.push('navState'),
			onclicked: () => calls.push('clicked'),
			oncompleted: () => calls.push('completed')
		});
		bridge.receive({
			type: 'inspected',
			view: 'play',
			content: 'lesson',
			blockId: 'B1',
			stepId: 's2',
			shownStepIds: ['s1', 's2'],
			canGoBack: true
		});
		expect(calls).toEqual([]);
		expect(bridge.pending).toBeNull();
	});
});

describe('a player that announces itself again', () => {
	it('is given the last content again instead of staying empty', () => {
		vi.useFakeTimers();
		const posted: string[] = [];
		const frame = { contentWindow: { postMessage: (data: string) => posted.push(data) } } as unknown as HTMLIFrameElement;
		const original = (globalThis as { window?: unknown }).window;
		// The bridge only needs listeners and `location.origin` from the page.
		(globalThis as { window?: unknown }).window = {
			addEventListener: () => {},
			removeEventListener: () => {},
			location: { origin: 'http://localhost' }
		};
		try {
			const bridge = new PreviewBridge();
			bridge.attach(frame);
			bridge.receive({ type: 'ready' });
			bridge.showBlock(card('s1'), 'course_v2', asIs);
			vi.advanceTimersByTime(300);
			expect(posted).toHaveLength(1);

			// The frame reloaded: it comes up empty and says so.
			bridge.receive({ type: 'ready' });
			expect(posted).toHaveLength(2);
			expect(JSON.parse(posted[1])).toMatchObject({ type: 'setBlock', remount: true });
		} finally {
			(globalThis as { window?: unknown }).window = original;
			vi.useRealTimers();
		}
	});
});
