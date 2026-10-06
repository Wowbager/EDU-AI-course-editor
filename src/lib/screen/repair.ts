/**
 * Delete-safety, made visible (§3 invariant 3): before a card or a step goes away, every
 * pointer at it is listed and has to be given a destination. This is the dialog's
 * content as the teacher reads it — the title, one sentence per pointer, what each is
 * going to do — and the picker that chooses a card to redirect to.
 *
 * This is the last screen before something is destroyed, so it speaks the language the
 * rest of the editor does: every name here is the one `naming.ts` gives, and ids come
 * back only in the mode that is allowed to show them.
 */
import { planDeleteBlock, planDeleteStep } from '$lib/domain/commands';
import type { Reference } from '$lib/domain/index-doc';
import {
	capitalize,
	cardGroups,
	cardLabel,
	cardNames,
	lessonLabelById,
	optionLabelById,
	stepLabelById,
	stepPosition
} from '$lib/domain/naming';
import { allows } from '$lib/ui/fields';
import type { PickerStep } from '$lib/ui/choice-picker';
import type { CourseV2 } from '$lib/domain/schema';
import type { RepairRowView, RepairView, ScreenInput } from './types';

/** Identifies a pointer in the dialog's choices. */
export const pointerKey = (reference: Reference): string => JSON.stringify(reference.from);

const CLEAR = 'Zrušit odkaz';

/**
 * The sentence for one pointer at a card or step, as the repair dialog reads it. The AI's
 * `plan_delete` and its confirmation use this function too, so the agent and the teacher
 * are told the same words.
 */
export function describeReference(doc: CourseV2, reference: Reference): string {
	const { lessonId, blockId, stepId, optionId } = reference.from;
	switch (reference.kind) {
		case 'binding': {
			const lesson = lessonId === undefined ? undefined : lessonLabelById(doc, lessonId);
			return `Lekce „${lesson ?? lessonId}“ tuto kartu obsahuje`;
		}
		case 'go_to': {
			// The branch lives in some *other* card's step, not in the one being deleted, so
			// both ends have to be resolved against the document.
			const from =
				blockId === undefined ? undefined : doc.blocks.find((b) => b.block_id === blockId);
			const step =
				from === undefined || stepId === undefined
					? undefined
					: from.steps.find((s) => s.id === stepId);
			const option =
				step === undefined || optionId === undefined
					? undefined
					: optionLabelById(step.question, optionId, { max: 32 });
			const where = from === undefined ? '' : ` v kartě „${cardLabel(doc, from, { max: 32 })}“`;
			const which = step === undefined ? '' : `, ${stepLabelById(from!, step.id)}`;
			return `${capitalize(option ?? `odpověď „${optionId}“`)}${where}${which} sem větví`;
		}
		case 'prerequisite': {
			const name = blockId === undefined ? undefined : cardLabel(doc, blockId, { max: 46 });
			return `Karta „${name}“ ji má jako předpoklad`;
		}
	}
}

export function buildRepair(input: ScreenInput): RepairView | null {
	const dialog = input.ui.dialog;
	if (dialog === null || dialog.kind !== 'repair') return null;
	const { doc } = input;
	const showIds = allows('block', 'block_id', input.mode);
	const targetBlock = doc.blocks.find((b) => b.block_id === dialog.blockId);
	const targetStep =
		dialog.stepId === undefined
			? undefined
			: targetBlock?.steps.find((s) => s.id === dialog.stepId);
	const targetName =
		targetBlock === undefined ? dialog.blockId : cardLabel(doc, targetBlock, { max: 46 });
	const references =
		dialog.stepId === undefined
			? planDeleteBlock(doc, dialog.blockId)
			: planDeleteStep(doc, dialog.blockId, dialog.stepId);
	const choices = input.ui.repairChoices;
	const names = cardNames(doc, 46);

	/** A step's choices are few and stay a plain list; a card's are many, and go to the picker. */
	const stepTargets = [
		{ value: '', label: CLEAR },
		{ value: 'AGAIN', label: 'Místo toho: zkusit znovu' },
		{ value: 'END', label: 'Místo toho: ukončit kartu' },
		...(targetBlock?.steps
			.filter((s) => s.id !== dialog.stepId)
			.map((s) => ({
				value: s.id,
				label: `Přesměrovat na krok ${stepPosition(targetBlock, s)}${showIds ? ` (${s.id})` : ''}`
			})) ?? [])
	];

	const rows = references.map((reference): RepairRowView => {
		const key = pointerKey(reference);
		const choice = choices[key] ?? '';
		const card = names.get(choice);
		return {
			key,
			what: describeReference(input.doc, reference),
			choice,
			chosen_label: choice === '' ? CLEAR : `Přesměrovat na kartu „${card?.label ?? choice}“`,
			options: dialog.stepId === undefined ? null : stepTargets,
			picker_id: dialog.stepId === undefined ? `repair:${key}` : null
		};
	});

	return {
		title:
			dialog.stepId === undefined
				? `Smazat kartu „${targetName}“`
				: `Smazat krok ${targetBlock !== undefined && targetStep !== undefined ? stepPosition(targetBlock, targetStep) : ''} v kartě „${targetName}“`,
		safe_text:
			references.length === 0 ? 'Na tuto část nic neodkazuje — smazání je bezpečné.' : null,
		lead:
			references.length === 0
				? null
				: `Než ji smažeš, je potřeba rozhodnout, kam povede ${
						references.length === 1 ? 'odkaz' : 'těchto odkazů'
					}, které na ni míří. Jinak by žák uvízl na místě, které už neexistuje.`,
		rows
	};
}

/** The picker for one pointer's destination: clear it, or another card by lesson. */
export function repairStep(input: ScreenInput, asking: string): PickerStep | null {
	const dialog = input.ui.dialog;
	if (dialog === null || dialog.kind !== 'repair') return null;
	const showIds = allows('block', 'block_id', input.mode);
	const choice = input.ui.repairChoices[asking] ?? '';
	return {
		title: 'Kam odkaz povede',
		groups: [
			{ items: [{ id: '', name: CLEAR, current: choice === '' }] },
			...cardGroups(input.doc, { exclude: dialog.blockId, max: 46 }).map((group) => ({
				heading: group.title,
				items: group.cards.map((card) => ({
					id: card.id,
					name: card.name,
					detail: card.collides ? card.place : undefined,
					hint: showIds ? card.id : undefined,
					current: choice === card.id
				}))
			}))
		]
	};
}
