/**
 * The `pickers` region: the `ChoicePicker` that is open, as the teacher sees it. What a
 * picker lists is a `PickerStep` built by the rule of whatever it picks (`goto.ts` for
 * "Kam dál", `settings.ts` for prerequisites, `dialogs.ts` for the repair dialog); this
 * walks it by the path in `ui.picker`, applies the search, and says what is drawn.
 */
import { jsonPathToRef } from '$lib/domain/ref';
import { allows } from '$lib/ui/fields';
import {
	filterGroups,
	followPath,
	needsSearch,
	type PickerItem,
	type PickerStep
} from '$lib/ui/choice-picker';
import { goToChoice } from './goto';
import { prerequisiteStep } from './prerequisites';
import { repairStep } from './repair';
import type { PickerItemView, PickersRegion, PickerView, ScreenInput } from './types';

/** What the picker `id` picks from, or null when nothing by that id is on screen. */
export function pickerSource(
	input: ScreenInput,
	id: string
): { label: string; root: PickerStep } | null {
	if (id.startsWith('goto:')) {
		const ref = jsonPathToRef(id.slice('goto:'.length));
		const block = input.doc.blocks.find((b) => b.block_id === ref.blockId);
		const step = block?.steps.find((s) => s.id === ref.stepId);
		const option = step?.question?.options?.find((o) => o.id === ref.optionId);
		if (block === undefined || step === undefined || option === undefined) return null;
		const showIds = allows('step', 'id', input.mode);
		return {
			label: 'Kam pokračovat po této odpovědi',
			root: goToChoice(input.doc, input.index, block, step.id, option.go_to, showIds).root
		};
	}
	if (id.startsWith('repair:')) {
		const root = repairStep(input, id.slice('repair:'.length));
		return root === null ? null : { label: 'Kam odkaz povede', root };
	}
	if (id === 'prerequisite') {
		const block = input.open.card;
		if (block === undefined) return null;
		return {
			label: 'Na co karta čeká?',
			root: prerequisiteStep(input, block, input.ui.prerequisite.editing)
		};
	}
	return null;
}

const itemView = (item: PickerItem): PickerItemView => ({
	id: item.id,
	name: item.name,
	detail: item.detail ?? null,
	hint: item.hint ?? null,
	disabled_reason: item.disabledReason ?? null,
	current: item.current === true,
	next: item.next !== undefined
});

export function buildPickers(input: ScreenInput): PickersRegion {
	const state = input.ui.picker;
	if (state === null) return { open: null };
	const source = pickerSource(input, state.id);
	if (source === null) return { open: null };
	const trail = followPath(source.root, state.path);
	const step = trail[trail.length - 1];
	const searchable = needsSearch(step.groups);
	const shown = filterGroups(step.groups, searchable ? state.query : '');
	const view: PickerView = {
		id: state.id,
		label: source.label,
		title: step.title,
		subject: step.subject ?? null,
		can_go_back: trail.length > 1,
		searchable,
		query: state.query,
		groups: shown.map((group) => ({
			heading: group.heading ?? null,
			items: group.items.map(itemView)
		})),
		empty_text:
			state.query.trim() !== '' ? 'Nic takového tu není.' : (step.empty ?? 'Není z čeho vybírat.')
	};
	return { open: view };
}
