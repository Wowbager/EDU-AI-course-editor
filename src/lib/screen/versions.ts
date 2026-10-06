/**
 * Version control as the teacher sees it: save the working copy as a numbered version,
 * return to one, publish one, and say who the course is for. What the dialog says —
 * where the working copy stands, what each saved version is and may do, the words about
 * where the history is kept — is built here; `VersionsDialog` draws it and does the
 * async work (loading a version, publishing it) that the history store owns.
 */
import { allows } from '$lib/ui/fields';
import { counted, errorsCount, warningsCount } from '$lib/ui/plural';
import {
	ALL_VISIBILITIES,
	TEACHER_VISIBILITIES,
	VISIBILITY_LABEL,
	publishPlan,
	visibilityOf,
	type DiffSummary
} from '$lib/domain/versions';
import type { ScreenInput, VersionItemView, VersionsView } from './types';

const formatter = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });

/** What a comparison with the published version found, in cards. */
export function describeDiff(diff: DiffSummary): string {
	const parts = [
		diff.added > 0 ? `nové: ${counted(diff.added, 'karta', 'karty', 'karet')}` : '',
		diff.removed > 0 ? `odebrané: ${counted(diff.removed, 'karta', 'karty', 'karet')}` : '',
		diff.changed > 0 ? `upravené: ${counted(diff.changed, 'karta', 'karty', 'karet')}` : '',
		diff.lessonsChanged ? 'změněné lekce' : ''
	].filter((p) => p !== '');
	return parts.length === 0 ? 'stejné jako zveřejněná verze' : parts.join(', ');
}

/** Where the history is, said plainly — it decides what a lost browser costs. */
function keptText(backends: readonly string[], unavailable: readonly string[]): string {
	const browser = !unavailable.includes('browser');
	const server = backends.includes('server') && !unavailable.includes('server');
	if (browser && server) return 'Verze se ukládají v tomto prohlížeči a na serveru editoru.';
	if (browser) {
		return 'Verze se ukládají jen v tomto prohlížeči — server editoru je teď nedostupný.';
	}
	if (server) return 'Verze se ukládají na serveru editoru; v tomto prohlížeči se uložit nedaří.';
	return 'Verze se teď nedaří uložit nikam — historie platí jen do zavření stránky. Stáhni si důležité verze do souboru.';
}

export function buildVersions(input: ScreenInput): VersionsView | null {
	const history = input.history;
	if (history === null || !history.dialogOpen) return null;
	// Versions are of the course as exported, not of the view the editor shows.
	const doc = input.source;
	const state = input.versionState;
	const form = input.ui.versions;
	const visibility = visibilityOf(doc);
	const published = history.published;
	const newest = history.versions.reduce<number | undefined>(
		(best, v) => (best === undefined || v.version > best ? v.version : best),
		undefined
	);
	const editorial = allows('course', 'versions.visibility_editorial', input.mode);
	const compare = allows('course', 'versions.compare', input.mode);

	const items = [...history.versions].reverse().map((meta): VersionItemView => {
		const out = published?.version === meta.version;
		const diff = form.diffs[meta.version];
		const plan = publishPlan(history.index, meta.version, doc);
		return {
			version: meta.version,
			name: `Verze ${meta.version}`,
			saved_at: formatter.format(new Date(meta.savedAt)),
			published: out,
			chips: [
				...(out && published !== null
					? [
							{
								tone: 'ok' as const,
								text: `Zveřejněná · ${VISIBILITY_LABEL[published.visibility].label}`
							}
						]
					: []),
				...(meta.origin === 'import' ? [{ tone: 'quiet' as const, text: 'ze souboru' }] : []),
				...(meta.restoredFrom !== undefined
					? [{ tone: 'quiet' as const, text: `z verze ${meta.restoredFrom}` }]
					: [])
			],
			note: meta.note ? meta.note : null,
			compare:
				compare && published !== null && !out
					? {
							offered: diff === undefined,
							text:
								diff === undefined ? null : diff === 'none' ? 'Nelze porovnat.' : describeDiff(diff)
						}
					: null,
			// The version that is out has nothing to publish unless who sees it changed.
			publish:
				!out || published?.visibility !== visibility
					? {
							label:
								plan.kind === 'publish' ? 'Zveřejnit' : `Zveřejnit znovu jako verzi ${plan.version}`
						}
					: null,
			refused_text:
				form.refused?.version === meta.version
					? `Verze ${meta.version} má ${errorsCount(form.refused.errors)}, které žákovi rozbijí kurz, a tak ji nejde zveřejnit.`
					: null,
			refused_is_working_copy: form.refused?.version === meta.version && form.refused.isWorkingCopy,
			confirming_text:
				form.confirming?.version === meta.version
					? `Verze ${meta.version} má ${warningsCount(form.confirming.warnings)}.`
					: null
		};
	});

	return {
		working: {
			heading:
				state.next === undefined
					? 'Rozpracovaná verze se načítá'
					: `Rozpracovaná verze ${state.next}`,
			status: !state.loaded
				? 'Historie verzí se načítá.'
				: newest === undefined
					? 'Kurz zatím nemá uloženou žádnou verzi.'
					: state.modified
						? `Od verze ${newest} je kurz upravený.`
						: `Beze změn od verze ${newest}.`,
			save_label:
				state.next === undefined ? 'Uložit jako verzi' : `Uložit jako verzi ${state.next}`,
			can_save: !form.busy && state.loaded && state.modified,
			note: form.note,
			busy: form.busy
		},
		visibility: {
			value: visibility,
			options: (editorial ? ALL_VISIBILITIES : TEACHER_VISIBILITIES).map((v) => ({
				value: v,
				...VISIBILITY_LABEL[v]
			})),
			published_note:
				published !== null && published.visibility !== visibility
					? `Zveřejněná verze ${published.version} je zatím „${VISIBILITY_LABEL[published.visibility].label}“. Nové nastavení platí od příštího zveřejnění.`
					: null
		},
		message: form.message,
		list_text: history.loading
			? 'Načítám…'
			: items.length === 0
				? 'Až verzi uložíš, objeví se tady.'
				: null,
		items,
		kept: keptText(history.backends, history.unavailable)
	};
}
