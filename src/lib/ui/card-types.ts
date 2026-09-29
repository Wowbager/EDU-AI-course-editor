import { BookOpenText, Dumbbell, MessageCircleQuestionMark } from '@lucide/svelte';
import type { BlockType } from '$lib/domain/schema';

export interface CardTypeInfo {
	type: BlockType;
	label: string;
	icon: typeof BookOpenText;
	/** What choosing this type means for the student, for the "add card" button. */
	title: string;
}

/**
 * The three card types: their name, icon and what each one does to the student.
 * The tree, the add buttons and the card heading all read from here, so a label
 * changes in one place.
 *
 * The titles describe what the *student* does — because from the author's side all
 * three scaffold nearly identically and the names do not say what changes. The
 * difference is real and it is in `block_step_engine.dart`:
 *
 *  - `display` renders one step per card and only up to `_currentStepIndex`, so
 *    the student is shown a step at a time and taps to continue;
 *  - `question` and `exercise` go through `_buildExerciseCard()` — one bubble
 *    that grows question by question — and `_skipToNextQuestion()` runs on mount and after every
 *    answer, so the cursor lands straight on the question and the text around it
 *    is passive context that is never a stop;
 *  - `exercise` additionally has `go_to` ignored (`step_navigation.dart`:
 *    `if (blockType == BlockType.exercise) return nextStep`).
 *
 * "Cvičení" is also the name of a whole course type in Nastavení kurzu and of the
 * daily practice queue, so this one says which of the three it is.
 */
export const CARD_TYPES: readonly CardTypeInfo[] = [
	{
		type: 'display',
		label: 'Výklad',
		icon: BookOpenText,
		title: "Karta typu Výklad — čtení po krocích. Žák vidí jeden krok, klikne Pokračovat a teprve pak se objeví další; hotové kroky mu zůstanou nad tím. Otázka vložená dovnitř výkladu je zastávka: dokud na ni neodpoví, další krok neuvidí."
	},
	{
		type: 'question',
		label: 'Otázka',
		icon: MessageCircleQuestionMark,
		title: "Karta typu Otázka — jedna bublina, ve které je žák rovnou u otázky. Text, který napíšeš před ni, čte jako zadání, ne jako samostatnou zastávku. Podle zvolené odpovědi ho umí poslat na jiný krok nebo na jinou kartu. Použij, když má odpověď rozhodnout, co bude dál."
	},
	{
		type: 'exercise',
		label: 'Cvičení',
		icon: Dumbbell,
		title: "Karta typu Cvičení (jedna karta v lekci — ne typ celého kurzu v Nastavení kurzu ani zařazení do denního opakování). Chová se jako Otázka, ale větvení se ignoruje: žák projde úlohy vždy ve stejném pořadí. Pro drilování postupu, který už zná."
	}
];

const byType = new Map(CARD_TYPES.map((info) => [info.type, info]));

export const cardTypeLabel = (type: BlockType): string => byType.get(type)!.label;
export const cardTypeIcon = (type: BlockType) => byType.get(type)!.icon;
