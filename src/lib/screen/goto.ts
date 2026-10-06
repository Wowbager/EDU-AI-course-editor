/**
 * Where an answer leads, in the words a teacher reads: the line under an answer, the
 * button of the "Kam dál" picker and the picker's own list. These used to be functions
 * in the `<script module>` of `GoToPicker.svelte`; they are rules of the screen and live
 * here, so the component draws them and the AI is told the same names.
 */
import type { BlockStep, BlockV2, CourseV2 } from '$lib/domain/schema';
import type { DocIndex } from '$lib/domain/index-doc';
import { stepSummary } from '$lib/domain/derive';
import { cardGroups, pickerCardLabel, stepName } from '$lib/domain/naming';
import type { PickerGroup, PickerStep } from '$lib/ui/choice-picker';
import { STEP_TYPE_LABELS } from '$lib/ui/step-type-labels';

/** The keywords every answer can lead to; `''` is the default, carry on. */
export const GO_TO_KEYWORDS = [
	{ value: '', label: 'Pokračovat dál' },
	{ value: 'AGAIN', label: 'Zkusit tuto otázku znovu' },
	{ value: 'END', label: 'Ukončit blok' },
	{ value: 'CHAT', label: 'Otevřít chat s AI lektorem' }
] as const;

/** The names the picker and the answer's summary line share (§8: "Krok 3", not "s3"). */
export function stepOptionLabel(block: BlockV2, step: BlockStep, showIds: boolean): string {
	const name = stepName(block, step, { showIds });
	const text = stepSummary(step);
	const shortened = text.length > 40 ? `${text.slice(0, 40)}…` : text;
	if (shortened !== '') return `${name}: ${shortened}`;
	return `${name} (${STEP_TYPE_LABELS[step.type].toLowerCase()})`;
}

/**
 * Where an answer leads, in a few words, for a row that is not being edited. Empty for
 * the default (carry on), so only a choice the author made is shown.
 */
export function goToSummary(
	doc: CourseV2,
	block: BlockV2,
	value: string | undefined | null,
	showIds: boolean,
	index: DocIndex
): string {
	if (value === undefined || value === null || value === '' || value === 'NEXT_STEP') return '';
	if (value === 'AGAIN') return 'znovu tuto otázku';
	if (value === 'END') return 'konec bloku';
	if (value === 'CHAT') return 'chat s lektorem';
	const step = block.steps.find((s) => s.id === value);
	if (step !== undefined) return stepName(block, step, { showIds });
	const target = doc.blocks.find((b) => b.block_id === value) ?? index.blocksById.get(value);
	return target === undefined
		? showIds
			? value
			: 'neplatný cíl'
		: pickerCardLabel(doc, target, showIds);
}

export interface GoToChoice {
	/** `NEXT_STEP` and an absent value mean the same; the picker shows one option for both. */
	current: string;
	/** What the closed button says: the same words the list uses. */
	shown: string;
	root: PickerStep;
}

/**
 * The "Kam dál" picker of one answer: „Průběh“ and the steps of this card first, then
 * the other cards grouped by lesson. A jump into a later question of another card
 * (`domain/groups.ts`) names a block the card is made of; the index resolves it to the
 * card, and the picker names it as such so the teacher sees where it goes.
 */
export function goToChoice(
	doc: CourseV2,
	index: DocIndex,
	block: BlockV2,
	stepId: string,
	value: string | undefined | null,
	showIds: boolean
): GoToChoice {
	const steps = block.steps.filter((s) => s.id !== stepId);
	const blocks = doc.blocks.filter((b) => b.block_id !== block.block_id);
	const label = (step: BlockStep) => stepOptionLabel(block, step, showIds);
	const blockLabel = (b: BlockV2) => pickerCardLabel(doc, b, showIds);
	const current = value === 'NEXT_STEP' || value === null ? '' : (value ?? '');

	const into = (() => {
		if (
			current === '' ||
			steps.some((s) => s.id === current) ||
			blocks.some((b) => b.block_id === current)
		) {
			return undefined;
		}
		const card = index.blocksById.get(current);
		if (card === undefined || card.block_id === current || card.block_id === block.block_id) {
			return undefined;
		}
		return { value: current, label: `${blockLabel(card)} (od jedné z dalších otázek)` };
	})();

	const shown = (() => {
		const keyword = GO_TO_KEYWORDS.find((k) => k.value === current);
		if (keyword) return keyword.label;
		const step = steps.find((s) => s.id === current);
		if (step) return label(step);
		const target = blocks.find((b) => b.block_id === current);
		if (target) return blockLabel(target);
		return into?.label ?? 'Neplatný cíl';
	})();

	const groups: PickerGroup[] = [
		{
			heading: 'Průběh',
			items: GO_TO_KEYWORDS.map((k) => ({
				id: k.value,
				name: k.label,
				current: k.value === current
			}))
		}
	];
	if (steps.length > 0) {
		groups.push({
			heading: 'Krok v tomto bloku',
			items: steps.map((s) => ({ id: s.id, name: label(s), current: s.id === current }))
		});
	}
	for (const group of cardGroups(doc, { exclude: block.block_id, max: 40 })) {
		groups.push({
			heading: group.title,
			items: group.cards.map((card) => ({
				id: card.id,
				name: card.name,
				detail: card.collides ? card.place : undefined,
				hint: showIds ? card.id : undefined,
				current: card.id === current
			}))
		});
	}
	if (into !== undefined) {
		groups.push({
			heading: 'Jiný blok v kurzu',
			items: [{ id: into.value, name: into.label, current: true }]
		});
	}
	return { current, shown, root: { title: 'Kam dál', groups } };
}
