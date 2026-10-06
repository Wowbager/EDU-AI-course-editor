/**
 * The `notices` region: what the editor says about the edit just made.
 *
 * The cut-off line — "Krok 3 teď nikam nevede" — is the one that is not a toast: it
 * sits under the answer whose "Kam dál" was changed and lives as long as that change
 * is the last edit (`DocStore.cutOff`). Its text is made here, from what the change
 * left unreachable, in the words the picker uses.
 */
import type { CourseV2 } from '$lib/domain/schema';
import { capitalize, pickerCardLabel, stepName } from '$lib/domain/naming';
import type { Issue } from '$lib/domain/validate';
import type { NoticesRegion, ScreenInput } from './types';

/** "Krok 3", the card's name: the words the summary line and the picker use. */
function lostName(doc: CourseV2, issue: Issue, showIds: boolean): string {
	const target = doc.blocks.find((b) => b.block_id === issue.ref.blockId);
	if (target === undefined) return '';
	if (issue.ref.stepId === undefined) return `karta „${pickerCardLabel(doc, target, showIds)}“`;
	const step = target.steps.find((s) => s.id === issue.ref.stepId);
	return step === undefined ? issue.ref.stepId : stepName(target, step, { showIds });
}

/**
 * The sentence for what a change made unreachable (`madeUnreachable`), or null when
 * nothing nameable was lost. `doc` is the document after the change.
 */
export function cutOffText(doc: CourseV2, lost: Issue[], showIds: boolean): string | null {
	const names = lost.map((issue) => lostName(doc, issue, showIds)).filter((n) => n !== '');
	if (names.length === 0) return null;
	const shown = names.length > 3 ? [...names.slice(0, 3), 'další'] : names;
	const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} a ${shown.at(-1)}`;
	const many = lost.length > 1;
	// A step is "ho", a card "ji", several "je".
	const pronoun = many ? 'je' : lost[0].ref.stepId === undefined ? 'ji' : 'ho';
	const head = showIds ? list : capitalize(list);
	return `${head} teď ${many ? 'nikam nevedou' : 'nikam nevede'} — žák ${pronoun} neuvidí`;
}

export function buildNotices(input: ScreenInput): NoticesRegion {
	return {
		cut_off:
			input.cutOff === null ? null : { text: input.cutOff.text, option_id: input.cutOff.optionId }
	};
}
