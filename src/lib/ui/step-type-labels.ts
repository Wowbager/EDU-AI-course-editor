import type { StepType } from '$lib/domain/schema';

/**
 * The names of the five step types. Plain data, so the screen model can say them
 * without importing the icons that `lang.ts` draws them with.
 */
export const STEP_TYPE_LABELS: Record<StepType, string> = {
	text: 'Text',
	question: 'Otázka',
	image: 'Obrázek',
	video: 'Video',
	audio: 'Audio'
};
