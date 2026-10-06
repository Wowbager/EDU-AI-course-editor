/**
 * Which panels are open, and the little state that goes with them. It is here, and not
 * in the page or a component, so that the screen model can say it (`store.screen.ui`)
 * and an AI agent is told the same panel the teacher has open.
 *
 * Nothing here is about the course; no command reads it.
 */

import type {
	CompetencyForm,
	ConceptsForm,
	Dialog,
	PickerState,
	TopicFlow,
	VersionsInput
} from '$lib/screen/types';

/** How long an armed Smazat waits for its second click. */
export const ARMED_MS = 4000;

const noCompetencyForm = (): CompetencyForm => ({
	adding: false,
	code: '',
	weight: 50,
	problem: '',
	editing: null,
	rename: ''
});
const noConceptsForm = (): ConceptsForm => ({ draft: '', problem: '', focused: false, active: -1 });
const noTopicFlow = (): TopicFlow => ({
	editing: null,
	step: 'skill',
	skill: null,
	dimension: null,
	back: 'level',
	flashed: null,
	open: false
});
const noVersionsInput = (): VersionsInput => ({
	note: '',
	busy: false,
	message: null,
	confirming: null,
	refused: null,
	diffs: {}
});

/** Where this browser remembers that the Pokročilý parts note was read. */
export const PARTS_NOTE_KEY = 'edu-editor:parts-note-seen';

export class UiState {
	/** The Kontrola kurzu panel behind the top bar's chip. */
	#validationOpen = $state(false);
	/** The export review, opened by Stáhnout. */
	reviewOpen = $state(false);
	/** The tree folded to its rail. */
	sidebarCollapsed = $state(false);
	/** The issues hidden by hand in the open panel (`screen/issues.ts` `panelKey`). */
	dismissedIssues = $state.raw<ReadonlySet<string>>(new Set());
	/** Whether this browser has been shown the parts note: null until it has been read. */
	partsNoteSeen = $state<boolean | null>(null);

	#dialog = $state.raw<Dialog | null>(null);
	/**
	 * Which dialog is open over the editor (`screen/types.ts` `Dialog`). A dialog that
	 * opens or closes ends whatever its predecessor had half done: the two-click delete,
	 * the picker, the add rows, the destinations chosen in the repair dialog.
	 */
	get dialog(): Dialog | null {
		return this.#dialog;
	}
	set dialog(next: Dialog | null) {
		const kindChanged = this.#dialog?.kind !== next?.kind;
		this.#dialog = next;
		this.armed = null;
		if (kindChanged) {
			this.resetCardForms();
			this.repairChoices = {};
		}
	}
	/** The `ChoicePicker` that is open, with the path it has walked and its search text. */
	picker = $state.raw<PickerState | null>(null);
	/**
	 * The two-click delete that has had its first click (`lesson:<id>`, `card:<id>`).
	 * One at a time: arming another disarms the first, and so does leaving it.
	 */
	armed = $state<string | null>(null);
	/** The answers whose detail line is open, by `blockId/stepKey/answerKey`. */
	openDetails = $state.raw<ReadonlySet<string>>(new Set());
	/** An imported course with things left to finish (`screen.notices.unfinished`). */
	inherited = $state(false);
	/** The messages of what the last import converted, in the words they are said in. */
	importNotes = $state.raw<readonly string[]>([]);
	importError = $state<string | null>(null);
	competency = $state<CompetencyForm>(noCompetencyForm());
	concepts = $state<ConceptsForm>(noConceptsForm());
	prerequisite = $state<{ editing: number | null; problem: string }>({
		editing: null,
		problem: ''
	});
	topic = $state<TopicFlow>(noTopicFlow());
	repairChoices = $state.raw<Readonly<Record<string, string>>>({});
	versions = $state<VersionsInput>(noVersionsInput());

	get validationOpen(): boolean {
		return this.#validationOpen;
	}
	set validationOpen(open: boolean) {
		// A hidden warning comes back with the next opening of the panel.
		if (!open) this.dismissedIssues = new Set();
		this.#validationOpen = open;
	}

	/** The form state that belongs to the card being edited is cleared when another opens. */
	resetCardForms() {
		this.competency = noCompetencyForm();
		this.concepts = noConceptsForm();
		this.prerequisite = { editing: null, problem: '' };
		this.topic = noTopicFlow();
		this.picker = null;
		this.armed = null;
	}

	/** First click arms, the second (within `ARMED_MS`, on the same thing) is the delete. */
	arm(key: string): boolean {
		if (this.armed === key) {
			this.armed = null;
			return true;
		}
		this.armed = key;
		return false;
	}

	disarm(key?: string) {
		if (key === undefined || this.armed === key) this.armed = null;
	}

	setDetail(key: string, open: boolean) {
		const next = new Set(this.openDetails);
		if (open) next.add(key);
		else next.delete(key);
		this.openDetails = next;
	}

	resetVersions() {
		this.versions = noVersionsInput();
	}

	dismissIssue(key: string) {
		this.dismissedIssues = new Set([...this.dismissedIssues, key]);
	}

	/** The note shows until it has been dismissed once in this browser. */
	readPartsNote() {
		if (this.partsNoteSeen !== null) return;
		try {
			this.partsNoteSeen = localStorage.getItem(PARTS_NOTE_KEY) !== null;
		} catch {
			// No storage: the note shows each time the mode is switched, which is harmless.
			this.partsNoteSeen = false;
		}
	}

	/** Not eligible any more: read the browser again the next time it is. */
	forgetPartsNote() {
		this.partsNoteSeen = null;
	}

	dismissPartsNote() {
		this.partsNoteSeen = true;
		try {
			localStorage.setItem(PARTS_NOTE_KEY, '1');
		} catch {
			// Nothing to remember it in.
		}
	}
}
