import { describe, expect, it } from 'vitest';
import { mediaHidden, mediaPosition, mediaPositionApplies, positionField } from '../media';
import type { BlockStep, CourseV2 } from '../schema';
import { validate } from '../validate';

const step = (fields: Partial<BlockStep> & Record<string, unknown>): BlockStep =>
	({ id: 's1', type: 'text', content: 'Text', ...fields }) as BlockStep;
const image = (position?: 'above' | 'below' | 'inline') => ({ url: 'https://x/a.png', position });

describe('W_MEDIA_HIDDEN', () => {
	it('is one warning for an image and a video placed inline together', () => {
		const doc = {
			export_type: 'course_v2',
			course_id: 'c',
			name: 'Kurz',
			lessons: [{ lesson_id: 'l', name: 'Lekce', blocks: [{ block_id: 'b' }] }],
			blocks: [
				{
					block_id: 'b',
					type: 'display',
					steps: [step({ image: image('inline'), video: { url: 'https://x/v.mp4' } })]
				}
			]
		} as unknown as CourseV2;
		const hidden = validate(doc).warnings.filter((i) => i.code === 'W_MEDIA_HIDDEN');
		expect(hidden).toHaveLength(1);
		expect(hidden[0].message).toMatch(/^Obrázek a video/);
	});
});

describe('media position (block_model.dart, step_content_renderer.dart)', () => {
	it("reads the step's position, then the image's, then the video's", () => {
		expect(mediaPosition(step({ image: image('below') }))).toBe('below');
		expect(
			mediaPosition(step({ image: image('below'), video: { url: 'v', position: 'above' } }))
		).toBe('below');
		expect(mediaPosition(step({ video: { url: 'v', position: 'above' } }))).toBe('above');
		expect(mediaPosition(step({ position: 'above', image: image('below') }))).toBe('above');
	});

	it('applies only around the text of a text step', () => {
		expect(mediaPositionApplies(step({ image: image() }), 'image')).toBe(true);
		expect(mediaPositionApplies(step({ type: 'image', image: image() }), 'image')).toBe(false);
		expect(mediaPositionApplies(step({}), 'image')).toBe(false);
	});

	it('hides a text step’s picture placed inline, and only that', () => {
		expect(mediaHidden(step({ image: image('inline') }), 'image')).toBe(true);
		expect(mediaHidden(step({ image: image('above') }), 'image')).toBe(false);
		expect(mediaHidden(step({ image: image() }), 'image')).toBe(false);
		expect(mediaHidden(step({ type: 'image', image: image('inline') }), 'image')).toBe(false);
	});

	it('points a warning at the field the app reads', () => {
		expect(positionField(step({ position: 'inline', image: image('above') }))).toBe('position');
		expect(positionField(step({ image: image('inline') }))).toBe('image.position');
		expect(positionField(step({ video: { url: 'v', position: 'inline' } }))).toBe('video.position');
	});
});
