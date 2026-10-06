/**
 * The `topbar` region: the course's name, the version button, the save line, the
 * Kontrola kurzu chip and the switches.
 */
import { errorsCount, warningsCount } from '$lib/ui/plural';
import { issueSets } from './issues';
import type { DraftStatus, ScreenInput, TopbarRegion } from './types';

/** Whether saving works, and whether the work has left the browser. */
function saveLine(
	status: DraftStatus | null,
	backedUp: boolean,
	canPublish: boolean,
	dirty: boolean
): { text: string; tone: 'error' | 'warning' | 'faint' } {
	if (status === 'error') return { text: 'Koncept se nepodařilo uložit', tone: 'error' };
	if (status === 'blocked') return { text: 'Ukládání pozastaveno', tone: 'warning' };
	if (backedUp) return { text: 'Staženo do souboru', tone: 'faint' };
	// "Bez zálohy" only helps a teacher who can act on it. While the course cannot be
	// downloaded (Stáhnout shows what is left instead), the line says what is true and
	// calm.
	if (!canPublish) return { text: 'Uloženo v tomto prohlížeči', tone: 'faint' };
	// Nothing to lose yet on a course nobody has touched.
	return { text: 'Bez zálohy v souboru', tone: dirty ? 'warning' : 'faint' };
}

/** The button's name carries all of it, the saving state too. */
function saveLabel(status: DraftStatus | null, backedUp: boolean): string {
	const backup = backedUp ? 'Staženo do souboru.' : 'Bez zálohy v souboru.';
	switch (status) {
		case 'saved':
			return `Koncept uložen v tomto prohlížeči. ${backup}`;
		case 'error':
			return `Koncept se nepodařilo uložit. ${backup}`;
		case 'blocked':
			return `Ukládání pozastaveno. ${backup}`;
		default:
			return `Koncept se ukládá do tohoto prohlížeče. ${backup}`;
	}
}

export function buildTopbar(input: ScreenInput): TopbarRegion {
	const { listed } = issueSets(input.validation, input.showFeedback, input.touched, input.reviewed);
	const errors = listed.errors.length;
	const warnings = listed.warnings.length;
	// Quiet while the course is being written: an unfinished draft is not an emergency.
	// It turns red once the author has asked to export and seen what is left, which is
	// when the count starts to mean "still to fix".
	const reviewing = input.reviewed !== null;
	const chip: TopbarRegion['check']['chip'] =
		errors > 0 && !reviewing
			? { tone: 'quiet', text: `${errors} k dokončení` }
			: errors > 0
				? { tone: 'error', text: `${errors}` }
				: warnings > 0 && !reviewing
					? { tone: 'quiet', text: `${warnings} doporučení` }
					: warnings > 0
						? { tone: 'warning', text: `${warnings}` }
						: { tone: 'ok', text: '0' };
	const canPublish = input.validation.errors.length === 0;
	const { save } = input;
	const line = saveLine(save.draftStatus, save.backedUp, canPublish, save.dirty);
	const version = input.versionState;
	return {
		course_name: input.doc.name ?? '',
		version: {
			label: version.label,
			title: version.title,
			name: version.name ?? null,
			loaded: version.loaded
		},
		save: {
			...line,
			label: saveLabel(save.draftStatus, save.backedUp),
			backed_up: save.backedUp,
			draft_status: save.draftStatus
		},
		check: {
			errors,
			warnings,
			chip,
			// The chip shows a bare number; the accessible name has to say what it counts.
			label:
				errors > 0
					? `Kontrola kurzu: ${errorsCount(errors)}`
					: warnings > 0
						? `Kontrola kurzu: ${warningsCount(warnings)}`
						: 'Kontrola kurzu: v pořádku'
		},
		mode: input.mode,
		show_feedback: input.showFeedback,
		can_undo: input.canUndo,
		can_redo: input.canRedo,
		download: {
			title: canPublish
				? 'Stáhnout kurz jako soubor JSON'
				: 'Ukáže, co je v kurzu ještě potřeba dokončit',
			can_publish: canPublish
		}
	};
}
