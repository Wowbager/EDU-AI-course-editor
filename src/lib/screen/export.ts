/**
 * What „Stáhnout“ opens when the course is not finished yet: every problem grouped by
 * the card (or lesson, or the course) it is about, with the way to each place. The
 * errors still keep the file from being written and warnings never do (§3 invariant 5);
 * this only says it. `ExportDialog` draws it and decides nothing.
 */
import { groupIssues, type IssueGroup } from '$lib/domain/issue-groups';
import { fixModeOf, MODE_LABELS, MODE_RANK } from '$lib/ui/fields';
import { counted, warningsCount } from '$lib/ui/plural';
import type { ExportGroupView, ExportView, ScreenInput } from './types';

export function buildExport(input: ScreenInput): ExportView | null {
	if (!input.ui.reviewOpen) return null;
	const { doc, index, validation, mode } = input;
	const view = (groups: IssueGroup[]): ExportGroupView[] =>
		groups.map((group) => ({
			key: group.key,
			title: group.title,
			context: group.context ?? null,
			rows: group.rows.map((row) => {
				const need = fixModeOf(row.target) ?? 'advanced';
				const higher = MODE_RANK[need] > MODE_RANK[mode] ? need : null;
				return {
					message: row.issue.message,
					detail: row.detail,
					target: row.target,
					needs_mode: higher,
					mode_note:
						higher === null
							? null
							: `Opravíš v režimu ${MODE_LABELS[higher].label} — Přejít na něj přepne.`
				};
			})
		}));
	const errorGroups = groupIssues(doc, index, validation.errors);
	const warningGroups = groupIssues(doc, index, validation.warnings);
	const blocked = errorGroups.length > 0;
	const cards = errorGroups.filter((g) => g.kind === 'card').length;
	const total = validation.warnings.length;
	const lead = blocked
		? `${
				cards > 0
					? `Ještě je potřeba dokončit ${counted(cards, 'kartu', 'karty', 'karet')}${
							errorGroups.length > cards ? ' a pár věcí v kurzu' : ''
						}.`
					: 'Ještě je potřeba dokončit pár věcí v kurzu.'
			} Bez nich by žák narazil na lekci, která nefunguje, a proto se kurz zatím nedá stáhnout.`
		: `Kurz je hotový a dá se stáhnout. Našlo se k němu ${warningsCount(total)} — nic z toho žákovi lekci nerozbije, ale stojí za to se na ně podívat.`;
	return {
		title: blocked ? 'Než kurz stáhneš' : 'Stáhnout kurz',
		blocked,
		lead,
		errors: view(errorGroups),
		warnings: view(warningGroups),
		advice_heading: blocked && total > 0 ? `Doporučení (${total}) — stažení nebrání` : null,
		can_download: !blocked
	};
}
