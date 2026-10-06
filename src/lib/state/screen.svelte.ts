/**
 * `store.screen`: the regions of the screen model, each a `$derived` of the store's
 * own state. The builders are pure functions of `ScreenInput` (`$lib/screen`); this is
 * only the place that reads the store and hands them what they need, so a component
 * and an AI tool read one and the same object.
 */
import { buildCard } from '$lib/screen/card';
import { buildDialogs } from '$lib/screen/dialogs';
import { buildIssues } from '$lib/screen/issues';
import { buildNotices } from '$lib/screen/notices';
import { buildPickers } from '$lib/screen/pickers';
import { buildPreview } from '$lib/screen/preview';
import { buildTopbar } from '$lib/screen/topbar';
import { buildTree } from '$lib/screen/tree';
import { buildUi } from '$lib/screen/ui';
import type {
	CardRegion,
	DialogsRegion,
	IssuesRegion,
	NoticesRegion,
	PickersRegion,
	PreviewRegion,
	Screen,
	ScreenInput,
	TopbarRegion,
	TreeRegion,
	UiRegion
} from '$lib/screen/types';
import type { DocStore } from './doc-store.svelte';

export class ScreenModel implements Screen {
	#store: DocStore;

	constructor(store: DocStore) {
		this.#store = store;
	}

	/** Everything the builders read, in one place. */
	input = $derived.by<ScreenInput>(() => {
		const s = this.#store;
		const last = s.undoStack.at(-1);
		return {
			doc: s.doc,
			source: s.source,
			index: s.index,
			mode: s.mode,
			showFeedback: s.showFeedback,
			open: s.open,
			validation: s.validation,
			touched: { cards: s.touchedCards, fields: s.touchedFields },
			reviewed: s.reviewedKeys,
			skillConfigStatus: s.skillConfigStatus,
			skillConfig: s.skillConfig,
			selection: s.selection,
			steps: s.steps.state,
			versionState: s.versionState,
			history: s.historyInput,
			drafts: s.drafts,
			save: { draftStatus: s.draftStatus, backedUp: s.backedUp, dirty: s.dirty },
			canUndo: s.canUndo,
			canRedo: s.canRedo,
			preview: {
				view: s.preview.view,
				run: s.preview.run,
				boot: s.preview.boot,
				sync: s.preview.sync,
				error: s.preview.error,
				canGoBack: s.preview.canGoBack,
				completed: s.preview.completed
			},
			// The line is only true while its change is the last edit.
			cutOff:
				s.cutOff !== null && last === s.cutOff.entry
					? { text: s.cutOff.text, optionId: s.cutOff.optionId }
					: null,
			ui: {
				validationOpen: s.ui.validationOpen,
				reviewOpen: s.ui.reviewOpen,
				sidebarCollapsed: s.ui.sidebarCollapsed,
				dismissedIssues: s.ui.dismissedIssues,
				partsNoteSeen: s.ui.partsNoteSeen,
				dialog: s.ui.dialog,
				picker: s.ui.picker,
				armed: s.ui.armed,
				openDetails: s.ui.openDetails,
				competency: s.ui.competency,
				concepts: s.ui.concepts,
				prerequisite: s.ui.prerequisite,
				topic: s.ui.topic,
				repairChoices: s.ui.repairChoices,
				versions: s.ui.versions
			}
		};
	});

	topbar = $derived<TopbarRegion>(buildTopbar(this.input));
	tree = $derived<TreeRegion>(buildTree(this.input));
	issues = $derived<IssuesRegion>(buildIssues(this.input));
	preview = $derived<PreviewRegion>(buildPreview(this.input));
	notices = $derived<NoticesRegion>(buildNotices(this.input));
	ui = $derived<UiRegion>(buildUi(this.input));
	card = $derived<CardRegion>(buildCard(this.input));
	pickers = $derived<PickersRegion>(buildPickers(this.input));
	dialogs = $derived<DialogsRegion>(buildDialogs(this.input));
}
