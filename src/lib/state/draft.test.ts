import { describe, expect, it } from 'vitest';
import { emptyCourse } from '$lib/domain/document';
import { readDraft, type Draft } from './draft';

const draft = (extra: Record<string, unknown> = {}): string =>
	JSON.stringify({
		format: 1,
		savedAt: '2026-09-29T08:00:00.000Z',
		doc: emptyCourse('NEW', 'Nový kurz'),
		mode: 'teacher',
		selection: null,
		reserved: { blocks: [], lessons: [], steps: [] },
		...extra
	});

describe('the draft record', () => {
	it('reads a draft from before the Zpětná vazba toggle as feedback visible', () => {
		const read = readDraft(draft());
		expect(read.format).toBe(1);
		expect(read.feedbackVisible ?? true).toBe(true);
	});

	it('round-trips feedback switched off, and switched on', () => {
		for (const feedbackVisible of [false, true]) {
			const text = JSON.stringify(readDraft(draft({ feedbackVisible })) satisfies Draft);
			expect(readDraft(text).feedbackVisible).toBe(feedbackVisible);
		}
	});

	it('refuses a feedback flag that is not a boolean', () => {
		expect(() => readDraft(draft({ feedbackVisible: 'no' }))).toThrow();
	});
});
