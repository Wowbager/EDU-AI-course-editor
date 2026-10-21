import type { BlockStep } from './schema';

type Media = 'image' | 'video';

/**
 * The one position the app reads for a step's media: the step's own `position`, else
 * the image's, else the video's (`block_model.dart`, `BlockStep.fromJsonWithId`). An
 * image and a video on one step therefore always sit together.
 */
export function mediaPosition(step: BlockStep): string | undefined {
	const own = (step as Record<string, unknown>).position;
	const position = own ?? step.image?.position ?? step.video?.position;
	return typeof position === 'string' ? position : undefined;
}

/**
 * Whether where a step's picture or video sits changes anything. Only a text step
 * draws its media around its text (`step_content_renderer.dart`, `_buildTextStep`);
 * an image or video step always draws it first, whatever `position` says.
 */
export const mediaPositionApplies = (step: BlockStep, media: Media): boolean =>
	step.type === 'text' && step[media] !== undefined;

/**
 * Whether a text step's picture or video is never drawn: `_buildTextStep` draws it
 * only with no position, `above` or `below`, so `inline` (which the format allows)
 * leaves it out.
 */
export function mediaHidden(step: BlockStep, media: Media): boolean {
	if (!mediaPositionApplies(step, media)) return false;
	const position = mediaPosition(step);
	return position !== undefined && position !== 'above' && position !== 'below';
}
