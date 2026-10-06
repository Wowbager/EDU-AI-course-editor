import {
	AudioLines,
	Image,
	MessageCircleQuestionMark,
	MonitorPlay,
	SquareText
} from '@lucide/svelte';
import type { StepType } from './domain/schema';
import { STEP_TYPE_LABELS } from '$lib/ui/step-type-labels';

interface StepTypes {
	type: StepType;
	label: string;
	icon: typeof SquareText;
}

export const STEP_TYPES: StepTypes[] = [
	{ type: 'text', label: STEP_TYPE_LABELS.text, icon: SquareText },
	{ type: 'question', label: STEP_TYPE_LABELS.question, icon: MessageCircleQuestionMark },
	{ type: 'image', label: STEP_TYPE_LABELS.image, icon: Image },
	{ type: 'video', label: STEP_TYPE_LABELS.video, icon: MonitorPlay },
	{ type: 'audio', label: STEP_TYPE_LABELS.audio, icon: AudioLines }
];
