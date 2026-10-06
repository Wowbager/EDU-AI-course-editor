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
import { cardsCount, counted } from '$lib/ui/plural';
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

/** What splitting an imported course's questions did, said once and calmly. */
export function splitNotes(split: string[], keptTogether: string[]): string[] {
	return [
		...(split.length > 0
			? [
					`${cardsCount(split.length)} s více otázkami: každá otázka se teď žákovi hodnotí zvlášť. V editoru vypadají stejně.`
				]
			: []),
		...(keptTogether.length > 0
			? [
					`${cardsCount(keptTogether.length)} s větvením mezi vlastními otázkami ${keptTogether.length === 1 ? 'zůstává celá' : 'zůstávají celé'} a hodnotí se jako celek, aby se nezměnila cesta žáka.`
				]
			: [])
	];
}

/** What loading a skill list in place of a course says. */
export const skillListNote = (file: string, dimensions: number | undefined): string =>
	`Načtena sada dovedností „${file}“ — ${dimensions} dovedností. Vektory se nově kontrolují proti ní.`;

const NOTES_SHOWN = 8;

export function buildNotices(input: ScreenInput): NoticesRegion {
	const { ui } = input;
	const open = input.reviewed !== null;
	const errors = input.validation.errors.length;
	return {
		cut_off:
			input.cutOff === null ? null : { text: input.cutOff.text, option_id: input.cutOff.optionId },
		import_error:
			ui.importError === null
				? null
				: { heading: 'Soubor se nepodařilo načíst.', message: ui.importError },
		unfinished:
			ui.inherited && !ui.validationOpen && !open && errors > 0
				? { text: `V kurzu je ještě ${counted(errors, 'věc', 'věci', 'věcí')} k dokončení.` }
				: null,
		import_notes:
			ui.importNotes.length === 0
				? null
				: {
						heading: `Při načtení se něco převedlo (${ui.importNotes.length}):`,
						items: ui.importNotes.slice(0, NOTES_SHOWN),
						more:
							ui.importNotes.length > NOTES_SHOWN
								? `…a dalších ${ui.importNotes.length - NOTES_SHOWN}.`
								: null
					}
	};
}
