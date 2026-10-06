/**
 * The shapes of the screen model (Round 14, DECISIONS "one screen model").
 *
 * What a teacher sees and what an AI agent is told come from the same objects: each
 * region below is built by one pure function of `ScreenInput` (`screen/*.ts`), read by
 * the components, and — as plain JSON, `screen/serialise.ts` — by the AI tools. A
 * component computes no displayed value; every value it shows is a field here, and
 * carries `data-screen="<region>.<path>"` so the parity test can hold it to it.
 *
 * Headless: no Svelte, no DOM. Field names are snake_case because the AI reads them
 * as they are; strings are the Czech text as it is drawn.
 */
import type { CourseV2 } from '$lib/domain/schema';
import type { DocIndex } from '$lib/domain/index-doc';
import type { Ref } from '$lib/domain/ref';
import type { ValidationResult } from '$lib/domain/validate';
import type { CourseVersionState, Visibility } from '$lib/domain/versions';
import type { BlockType, QuestionType, StepType } from '$lib/domain/schema';
import type { SkillConfig } from '$lib/domain/skill-config';
import type { FieldKind, FieldLevel, Mode } from '$lib/ui/fields';
import type { StepViewState } from '$lib/ui/step-expansion';
import type { Touched } from '$lib/ui/issue-visibility';
import type { ConfirmRequest } from '$lib/agent/tool';
import type { AiAction } from '$lib/state/doc-store.svelte';

// ───────────────────────────── what the builders are given ─────────────────────────────

/** Whether the course's skill list is known (`DocStore.skillConfigStatus`). */
export type SkillConfigStatus = 'loading' | 'loaded' | 'default' | 'failed';

/** What `DocStore.open` resolves the selection to. */
export interface OpenState {
	lesson: CourseV2['lessons'][number] | undefined;
	card: CourseV2['blocks'][number] | undefined;
	/** The card's entry in the open lesson's block list. */
	binding: CourseV2['lessons'][number]['blocks'][number] | undefined;
	/** A card in no lesson at all. */
	orphaned: boolean;
	/** 1-based place of the card in the open lesson; undefined when it is not in it. */
	position: number | undefined;
}

/** The autosave of the draft in the browser (`DraftSession.status`). */
export type DraftStatus = 'saving' | 'saved' | 'error' | 'blocked';

/**
 * The player process, as far as the editor can tell. `probing` until the player URL
 * has been asked for, `starting` while it boots, `missing` when its build is not served
 * here, `stalled` when it never announced itself even after the retries.
 */
export type PreviewBoot = 'probing' | 'starting' | 'ready' | 'missing' | 'stalled';

/**
 * Whether what the editor last sent is what the player shows: `idle` before anything
 * was sent, `syncing` from the moment a card or lesson is queued until the player has
 * answered, `in_sync` when it says it is drawing it, `player_error` when it said the
 * draft did not parse.
 */
export type PreviewSync = 'idle' | 'syncing' | 'in_sync' | 'player_error';

/** What a finished card reported in Vyzkoušet (`completed`). */
export interface PreviewCompleted {
	xp: number;
	scoreKoef: number;
	mark?: string;
}

/**
 * The status of the preview column as a whole. `empty` is "there is nothing selected to
 * show"; the rest follow the player.
 */
export type PreviewStatus = 'syncing' | 'in_sync' | 'player_error' | 'not_started' | 'empty';

export interface PreviewInput {
	view: 'expanded' | 'play';
	run: { lessonId: string | undefined; startBlockId: string | undefined } | null;
	boot: PreviewBoot;
	sync: PreviewSync;
	error: string | undefined;
	canGoBack: boolean;
	completed: PreviewCompleted | null;
}

/** What the last change cut off, said under the answer that was changed. */
export interface CutOffInput {
	text: string;
	/** The answer the change was made on; empty for a removed answer, which has no row. */
	optionId: string;
}

/**
 * The dialog that is open over the editor, if any. One variable and not one flag per
 * dialog, because they exclude each other and a stack of them is not something the
 * screen should be able to reach. (The export review and the version history keep
 * their own flags, `reviewOpen` and the history's `dialogOpen`.)
 */
export type Dialog =
	| { kind: 'course' }
	| { kind: 'lesson'; lessonId: string; focusName?: boolean }
	| { kind: 'card'; blockId: string }
	/** Delete-safety: where the pointers at a card, or at one of its steps, should go. */
	| { kind: 'repair'; blockId: string; stepId?: string }
	/** "Zařadit do lekce": which lesson is chosen so far ('' = none). */
	| { kind: 'assign_lesson'; blockId: string; lessonId: string }
	/** "Změnit typ otázky?" with what it would throw away. */
	| { kind: 'type_change'; blockId: string; stepId: string; type: QuestionType };

/**
 * A `ChoicePicker` that is open: which one (`id` names what it picks, see
 * `screen/pickers.ts`), the item ids walked through so far, and what was typed in its
 * search. The box itself is a native popover; this is the state it keeps.
 */
export interface PickerState {
	id: string;
	path: readonly string[];
	query: string;
}

/** The add row of `CompetencyEditor` and the rename of one of its codes. */
export interface CompetencyForm {
	adding: boolean;
	code: string;
	/** The weight in the add row; undefined when it was emptied. */
	weight: number | undefined;
	problem: string;
	editing: string | null;
	rename: string;
}

/** The text being typed into `ConceptsEditor`, and its suggestion list. */
export interface ConceptsForm {
	draft: string;
	problem: string;
	focused: boolean;
	active: number;
}

/** The steps of the "Přidat dovednost" box (`TopicPicker`). */
export type TopicStepName = 'skill' | 'level' | 'relation';

export interface TopicFlow {
	/** The skill row the box changes, or null when it adds one. */
	editing: number | null;
	step: TopicStepName;
	/** The skill chosen on the first step, by `area/skill`. */
	skill: string | null;
	/** The level chosen on the second step, by dimension index. */
	dimension: number | null;
	back: TopicStepName;
	/** The row just added or changed, marked for a moment. */
	flashed: number | null;
	open: boolean;
}

export interface UiInput {
	validationOpen: boolean;
	reviewOpen: boolean;
	sidebarCollapsed: boolean;
	/** The issues hidden by hand in the open validation panel (`issueKey`s of the panel). */
	dismissedIssues: ReadonlySet<string>;
	/** Whether this browser has been shown the Pokročilý parts note; null until it is read. */
	partsNoteSeen: boolean | null;
	dialog: Dialog | null;
	/** A course was imported and has things left to finish: the calm line about them. */
	inherited: boolean;
	/** What the import converted, by message; and why a file was refused. */
	importNotes: readonly string[];
	importError: string | null;
	picker: PickerState | null;
	/** The two-click delete that has had its first click: `lesson:<id>` or `card:<id>`. */
	armed: string | null;
	/** The answers whose detail line is open, by `blockId/stepKey/answerKey`. */
	openDetails: ReadonlySet<string>;
	competency: CompetencyForm;
	concepts: ConceptsForm;
	/** The prerequisite the picker is changing (null: adding), and what was refused. */
	prerequisite: { editing: number | null; problem: string };
	topic: TopicFlow;
	/** What each pointer at a deleted card or step will be given, by the pointer's key. */
	repairChoices: Readonly<Record<string, string>>;
	/** The version history dialog's own state (`VersionsDialog`). */
	versions: VersionsInput;
}

/** The version history as the model reads it (`VersionStore`, `state/versions/`). */
export interface HistoryInput {
	index: import('$lib/domain/versions').VersionIndex;
	versions: readonly (import('$lib/domain/versions').VersionMeta & { keptIn: string[] })[];
	published: import('$lib/domain/versions').Publication | null;
	backends: readonly string[];
	/** Backends that failed on the last load or write. */
	unavailable: readonly string[];
	loading: boolean;
	dialogOpen: boolean;
}

/** What the version history dialog is in the middle of (see `screen/dialogs.ts`). */
export interface VersionsInput {
	note: string;
	busy: boolean;
	message: { tone: 'ok' | 'error'; text: string } | null;
	confirming: { version: number; warnings: number } | null;
	refused: { version: number; errors: number; isWorkingCopy: boolean } | null;
	/** The comparison with the published version, by version number. */
	diffs: Readonly<Record<number, import('$lib/domain/versions').DiffSummary | 'none'>>;
}

/** One line of the conversation as the teacher reads it. */
export interface AiLine {
	id: number;
	role: 'user' | 'assistant' | 'notice' | 'error';
	text: string;
}

export interface AiInput {
	panelOpen: boolean;
	/** Whether the server has an AI set up; null until it has been asked. */
	configured: boolean | null;
	running: boolean;
	thinking: boolean;
	lines: readonly AiLine[];
	/** What the AI changed this session (`DocStore.aiActions`). */
	actions: readonly AiAction[];
	/** The question the AI is waiting on, if any. */
	confirm: ConfirmRequest | null;
}

export interface ScreenInput {
	/** What the editor shows and edits (a question card is one card). */
	doc: CourseV2;
	/** The course as exported: one block per question. */
	source: CourseV2;
	index: DocIndex;
	mode: Mode;
	showFeedback: boolean;
	open: OpenState;
	validation: ValidationResult;
	touched: Touched;
	/** `issueKey`s listed by the export review, or null while there is none. */
	reviewed: ReadonlySet<string> | null;
	skillConfigStatus: SkillConfigStatus;
	/** The skill list itself, for the pickers and the rows that name a skill. */
	skillConfig: SkillConfig | null;
	/** The ref the author or the preview last pointed at (a step, a field); see `open`. */
	selection: Ref | null;
	/** What the step list remembers: folds, a drag, the run being played. */
	steps: StepViewState;
	versionState: CourseVersionState;
	/** The history of this course, null before the page has attached one. */
	history: HistoryInput | null;
	/** Text typed into number fields that is no number, by `refKey`. */
	drafts: Readonly<Record<string, string>>;
	save: { draftStatus: DraftStatus | null; backedUp: boolean; dirty: boolean };
	canUndo: boolean;
	canRedo: boolean;
	preview: PreviewInput;
	/** Already limited to its lifetime: null once any later edit has happened. */
	cutOff: CutOffInput | null;
	ui: UiInput;
	ai: AiInput;
}

// ───────────────────────────────────── the regions ─────────────────────────────────────

export type IssueVisibility = 'shown' | 'pending_timing' | 'held_back';

export interface IssueItem {
	/** Unique in the list, so a document with two equal issues can still be drawn. */
	key: string;
	code: string;
	severity: 'error' | 'warning';
	message: string;
	/** The place in the words the editor uses: lesson › card › step › answer. */
	where: string[];
	/**
	 * `shown`: it may be marked inline now. `pending_timing`: listed, but the field or
	 * card is not finished with yet (`ui/issue-visibility.ts`). `held_back`: advice about
	 * a feedback field while Zpětná vazba is off, counted nowhere.
	 */
	visibility: IssueVisibility;
	ref: Ref;
	/** Where a jump lands: the ref, with the lesson that shows it filled in. */
	target: Ref;
}

export interface IssuesRegion {
	counts: {
		/** Everything `validate()` found. */
		errors: number;
		warnings: number;
		/** What the top bar and the panel list. */
		listed_errors: number;
		listed_warnings: number;
		held_back: number;
	};
	/** Every issue, errors first, each with its visibility. */
	items: IssueItem[];
	/** Said when `validate()` could not run a check; null when nothing was skipped. */
	skipped_checks: string | null;
	panel: {
		open: boolean;
		clean: boolean;
		clean_text: string;
		errors_heading: string | null;
		errors: IssueItem[];
		warnings_heading: string | null;
		warnings: IssueItem[];
		held_text: string | null;
	};
}

export interface TopbarRegion {
	course_name: string;
	version: { label: string; title: string; name: string | null; loaded: boolean };
	save: {
		text: string;
		tone: 'error' | 'warning' | 'faint';
		/** The accessible name: all of it, the saving state too. */
		label: string;
		backed_up: boolean;
		draft_status: DraftStatus | null;
	};
	/** The Kontrola kurzu chip. */
	check: {
		errors: number;
		warnings: number;
		chip: { tone: 'quiet' | 'error' | 'warning' | 'ok'; text: string };
		label: string;
	};
	mode: Mode;
	show_feedback: boolean;
	/** The Zpětná vazba toggle's tooltip, which says what the current state is. */
	feedback_title: string;
	can_undo: boolean;
	can_redo: boolean;
	/** What the Stáhnout button says about itself. */
	download: { title: string; can_publish: boolean };
}

export type TreeJoin = 'first' | 'middle' | 'last';

export interface TreeCard {
	key: string;
	/** A binding that resolves to no card. */
	missing: boolean;
	block_id: string;
	/** 1-based place in the lesson. */
	position: number;
	type: BlockType | null;
	type_label: string;
	/** The tree's name for the card (`cardLabel`, 44 characters). */
	name: string;
	/** Longer forms for the rail's tile label and panel. */
	name_rail: string;
	name_peek: string;
	/** "část 2/3" in Pokročilý for a part of a split card; else "N kroků". */
	steps_text: string;
	part: string | null;
	/** Where a part sits in a run of parts of one card. */
	join: TreeJoin | null;
	errors: number;
	errors_text: string | null;
	selected: boolean;
	/** The tile's accessible name on the rail. */
	rail_label: string;
	/** The line above the card's name in the rail's panel. */
	peek_overline: string;
	/** What the rail's panel is called. */
	peek_label: string;
	/** The resting line under the rail panel's actions: "1. karta z 3". */
	actions_caption: string;
}

export interface TreeLesson {
	key: string;
	lesson_id: string;
	/** 1-based. */
	index: number;
	name: string;
	/** The lesson the editor column is in. Only its cards are drawn in the tree. */
	open: boolean;
	counts: {
		cards: number;
		/** The blocks the app counts (a question card is one per question). */
		blocks: number;
		minutes: number;
		xp: number;
		duration_estimated: boolean;
	};
	/** "3 karty · 12 min · 40 XP". */
	summary: string;
	errors: number;
	errors_text: string | null;
	rail_label: string;
	peek_label: string;
	peek_overline: string;
	cards: TreeCard[];
}

export interface TreeOrphan {
	key: string;
	block_id: string;
	type: BlockType;
	name: string;
	note: string;
	selected: boolean;
}

export interface TreeRegion {
	course: { name: string };
	lessons: TreeLesson[];
	/** Cards that no lesson holds and nothing leads to. */
	orphans: TreeOrphan[];
	orphans_heading: string | null;
	footer: { duration: string; duration_title: string; xp: string; xp_title: string };
}

export interface PreviewRegion {
	view: 'expanded' | 'play';
	status: PreviewStatus;
	/** What is being previewed; `none` when nothing is selected. */
	target:
		| { kind: 'none' }
		| { kind: 'card'; card: string; lesson: string | null }
		| { kind: 'lesson'; lesson: string; start_card: string | null };
	/** The player's own complaint about the draft, when `status` is `player_error`. */
	player_error: string | null;
	/** The words in the column when there is nothing to show; null otherwise. */
	empty_text: string | null;
	/** The chip beside the mode switch: only a player that is not running has one. */
	chip: { tone: 'warning' | 'neutral'; text: string } | null;
	/** Why there is no player, when there is none. */
	fallback: 'missing' | 'stalled' | null;
	/** What the header chip and the browser suite read: `ready`, `failed` or `starting`. */
	player: 'ready' | 'failed' | 'starting';
	can_go_back: boolean;
	/**
	 * What the last finished card of a played run reported. Not drawn anywhere yet: an
	 * AI is told it as `on_screen: false`.
	 */
	last_completed: { xp: number; score_koef: number; mark: string | null; on_screen: false } | null;
}

export interface NoticesRegion {
	/** "Krok 3 teď nikam nevede — žák ho neuvidí", while that change is the last edit. */
	cut_off: { text: string; option_id: string } | null;
	/** The file could not be read. */
	import_error: { heading: string; message: string } | null;
	/** "V kurzu je ještě 23 věcí k dokončení": shown for an imported course until dealt with. */
	unfinished: { text: string } | null;
	/** What was converted on the way in, said once. */
	import_notes: { heading: string; items: string[]; more: string | null } | null;
}

export interface UiRegion {
	validation_panel_open: boolean;
	review_open: boolean;
	sidebar_collapsed: boolean;
	/** The Pokročilý note about cards split into parts: whether it is on screen now. */
	parts_note: { eligible: boolean; shown: boolean };
	/** The dialog open over the editor, if any (`dialogs` says what it holds). */
	dialog: Dialog['kind'] | null;
	/** The `ChoicePicker` that is open (`pickers.open` says what it lists). */
	picker: { id: string; path: string[]; query: string } | null;
	/** The two-click delete waiting for its second click: `lesson:<id>` or `card:<id>`. */
	armed: string | null;
	/** The answers whose detail line is open, by `blockId/stepKey/answerKey`. */
	open_answer_lines: string[];
	/** What is half done in the card's settings. */
	forms: {
		competency_adding: boolean;
		concepts_draft: string;
		prerequisite_editing: number | null;
		skill_flow: { open: boolean; step: TopicStepName; editing: number | null };
	};
}

// ─────────────────────────── the card: the editor column ───────────────────────────

/**
 * One field as it is drawn: the text in its box, what it says when empty, its hint, and
 * the text typed that is no number yet. Built from a `FieldSpec` (`field-view.ts`) or,
 * for the few fields a component owns, by hand with the same shape.
 */
export interface FieldView {
	/** `level.path`: unique in the list it is in. */
	key: string;
	level: FieldLevel;
	path: string;
	label: string;
	hint: string | null;
	kind: FieldKind;
	display: 'datetime' | 'segmented' | null;
	/** The box's text; '' while unset. A select's is the chosen option's `value`. */
	value: string;
	/** A toggle's state; null for the rest. */
	checked: boolean | null;
	/** What the empty box says: "výchozí 1 den", "nevyplněno", or a cue. */
	empty_text: string;
	/**
	 * What a select offers, as drawn: a segmented one without the numbers in front of its
	 * labels, and a value the list does not have kept as an option of its own.
	 */
	options: { value: string; label: string }[] | null;
	/** A select whose value the document stores as a number. */
	numeric: boolean;
	/** Text typed into a number box that is no number, kept out of the course. */
	draft: string | null;
	/** The line under the box for that draft. */
	error: string | null;
	/** The range of a bounded number. */
	min: number | null;
	max: number | null;
	/** A field that is shown but cannot be changed (the answers of a true/false pair). */
	disabled: boolean;
	/** Where the field writes: what drafts and issue markers are keyed by. */
	ref: Ref;
}

/** A field that exists but this mode, or Zpětná vazba, keeps off the screen. */
export interface FieldHidden {
	key: string;
	label: string;
	/** The mode that shows it ("Metodik"); null when it is hidden only by Zpětná vazba. */
	hidden_in_mode: string | null;
	hidden_by_feedback: boolean;
}

export interface ChipView {
	text: string;
	title: string;
}

export interface AnswerSummaryPart {
	text: string;
	/** Drawn with the branch icon: where the answer leads. */
	branch: boolean;
}

export interface AnswerRowView {
	key: string;
	id: string;
	correct: boolean;
	/** The accessible name of the right/wrong mark. */
	correct_label: string;
	correct_title: string;
	text: FieldView;
	/** What is set on the answer, read under it while its detail line is closed. */
	summary: AnswerSummaryPart[];
	feedback: FieldView | null;
	open: boolean;
	/** The chevron's accessible name. */
	more_label: string;
	trash: { disabled: boolean; title: string; label: string } | null;
	/** A selection or a shown issue points into its detail line: it opens by itself. */
	pointed: boolean;
	detail: {
		/** "Kam dál": the picker and what its button says. */
		branch: { picker_id: string; shown: string } | null;
		marks: { value: string; options: { value: string; label: string }[] } | null;
		order: {
			up_disabled: boolean;
			down_disabled: boolean;
			up_label: string;
			down_label: string;
		} | null;
		score: FieldView | null;
	};
}

export interface AnswersView {
	headed: boolean;
	feedback_column: boolean;
	/** The grid's column widths, so headings and rows line up. */
	tracks: string;
	/** True/false has no order to change and nothing to add. */
	fixed: boolean;
	detail_offered: boolean;
	rows: AnswerRowView[];
	/** What is wrong with the list as a whole (too few answers, none right). */
	list_issues: { severity: 'error' | 'warning'; message: string }[];
	can_add: boolean;
}

export interface QuestionView {
	type: QuestionType;
	/** `confirm`: switching to it would throw away something the teacher wrote. */
	types: { value: QuestionType; label: string; title: string; confirm: boolean }[];
	correct_answer: FieldView | null;
	correct_number: FieldView | null;
	tolerance: FieldView | null;
	answers: AnswersView | null;
	/** "Víc správných možností": its hint shows only while it is on. */
	multiple: FieldView | null;
	solution: FieldView | null;
}

export interface StepMediaView {
	kind: 'image' | 'video' | 'audio';
	url: FieldView;
	/** The image's description; only once there is a picture. */
	alt: FieldView | null;
	/** Said under a video address that is a YouTube or Vimeo page. */
	page_link_warning: string | null;
}

export interface StepView {
	key: string;
	id: string;
	/** 1-based. */
	position: number;
	/** "Krok 2", or the step's id in Pokročilý. */
	name: string;
	type: StepType;
	type_label: string;
	/** Tooltip of the name: only Pokročilý, which shows the id, says so. */
	name_title: string | null;
	/** How many answers elsewhere lead to this step. */
	inbound_branches: number;
	/** The step as one line, shown while it is folded. */
	summary: string;
	expanded: boolean;
	/** The selection points at this step. */
	targeted: boolean;
	/** A shown error is addressed to it. */
	invalid: boolean;
	grip_label: string;
	body_label: string;
	insert_label: string;
	move: { up_disabled: boolean; down_disabled: boolean };
	/** The Markdown of a text or question step. */
	content: { value: string; placeholder: string; missing_text: string | null } | null;
	media: StepMediaView | null;
	question: QuestionView | null;
	/** The hint and help rungs, when they are drawn. */
	ladder: { hint: FieldView; help: FieldView } | null;
	extras: {
		label: string;
		/** A selection or a shown issue points into the fold: it opens by itself. */
		targeted: boolean;
		fields: FieldView[];
		question_fields: FieldView[];
	} | null;
}

export interface CardView {
	block_id: string;
	type: BlockType;
	type_label: string;
	type_title: string;
	/** Said above the heading for a card no lesson holds. */
	orphan_text: string | null;
	heading: { label: string; hint: string | null; value: string; placeholder: string };
	chips: {
		practice: ChipView | null;
		shared: ChipView | null;
		minutes: ChipView | null;
		xp: ChipView;
	};
	settings_title: string;
	menu: {
		/** "Zařadit do lekce" when no lesson holds the card; null once one does. */
		assign: { disabled: boolean; title: string } | null;
		remove_from_lesson: { title: string } | null;
		move: { up_disabled: boolean; down_disabled: boolean } | null;
	};
	/** What each kind of step is for, said on the add-step menu. */
	add_step: { type: StepType; label: string; title: string }[];
	steps: StepView[];
}

export interface CardRegion {
	/** `card` while one is open; otherwise which sentence stands where it would be. */
	state: 'card' | 'no_lesson' | 'no_card';
	empty_text: string | null;
	card: CardView | null;
	/** What exists on a card and its steps but this mode keeps off the screen. */
	hidden_fields: FieldHidden[];
}

// ─────────────────────────────── the pickers ───────────────────────────────

export interface PickerItemView {
	/** What the owner gets back in the path; never drawn. */
	id: string;
	name: string;
	detail: string | null;
	/** A faint code after the name, for Pokročilý only. */
	hint: string | null;
	/** Said on the item, which then cannot be picked. */
	disabled_reason: string | null;
	/** The choice in force now: marked, and the picker opens on it. */
	current: boolean;
	/** Picking it opens another step instead of finishing. */
	next: boolean;
}

export interface PickerGroupView {
	heading: string | null;
	items: PickerItemView[];
}

/**
 * The open `ChoicePicker` as drawn: the step its path has walked to, with the search
 * applied to its groups. Built only while one is open.
 */
export interface PickerView {
	id: string;
	/** The box's accessible name. */
	label: string;
	title: string;
	subject: string | null;
	can_go_back: boolean;
	searchable: boolean;
	query: string;
	groups: PickerGroupView[];
	/** Said when there is nothing to list: the step's own line, or "Nic takového tu není." */
	empty_text: string;
}

export interface PickersRegion {
	open: PickerView | null;
}

// ───────────────────────────── the settings dialogs ─────────────────────────────

export interface SettingsSectionView {
	id: string;
	label: string;
	icon: string;
	/** An issue the author can see is in this section: a dot beside its name. */
	alert: boolean;
	/** A jump or a problem points into it: the dialog opens on it. */
	targeted: boolean;
}

/** What every settings dialog says about itself. */
export interface SettingsBaseView {
	title: string;
	/** From Metodik up the sections are listed on the left, one shown at a time. */
	list: boolean;
	sections: SettingsSectionView[];
	/** What a higher mode has in this dialog ("Dovednosti najdeš v režimu Metodik"). */
	gain: { text: string; mode: Mode; section: string } | null;
}

export interface CourseSettingsView extends SettingsBaseView {
	course_id: string;
	/** The fields of each section, by section id. */
	fields: Record<string, FieldView[]>;
	export_type: {
		value: string;
		options: { value: string; label: string; title: string }[];
	};
	/** Who sees the course, as the link to the version history says it. */
	visibility_label: string;
}

export interface LessonSettingsView extends SettingsBaseView {
	/** False when the lesson is no longer in the course: the dialog says so. */
	found: boolean;
	gone_text: string;
	lesson_id: string;
	fields: Record<string, FieldView[]>;
	order: { up_disabled: boolean; down_disabled: boolean };
	/** "3 karty · 12 min (odhad)" */
	totals: { text: string; title: string | null } | null;
	didactics: { rows: { label: string; title: string; value: string }[] } | null;
	/** The two-click Smazat. */
	delete: { armed: boolean; text: string; label: string };
}

export interface TopicRowView {
	dimension: number;
	/** The skill it belongs to, as the picker names it (`area/skill`). */
	skill_key: string | null;
	skill_name: string;
	/** "Úroveň 2", for a skill that has more than one. */
	level: string | null;
	/** The dimension's code, in Pokročilý. */
	code: string | null;
	description: string | null;
	/** The row button's accessible name. */
	label: string;
	relation: '1' | '2';
	relation_label: string;
	/** The difficulty, a bounded number, in Pokročilý. */
	elo: FieldView | null;
	remove_label: string;
	flashed: boolean;
}

export interface TopicPanelItem {
	id: string;
	name: string;
	detail: string | null;
	/** Why it cannot be picked ("už je na jiném řádku"); null when it can. */
	reason: string | null;
	current: boolean;
	/** The one free level of a skill, when adding: picking the skill takes it at once. */
	quick: number | null;
	/** The dimension a level item stands for. */
	dimension: number | null;
}

/** The box of „Přidat dovednost“ at the step its flow has reached. */
export interface TopicPanelView {
	step: TopicStepName;
	label: string;
	title: string;
	/** The way back: "Zpět", or "Jiná dovednost" while changing a row. */
	back: string | null;
	subject: string | null;
	groups: { heading: string | null; items: TopicPanelItem[] }[];
	empty: string | null;
}

export interface TopicsView {
	/** "Dovednosti se načítají", "nenastaveno", "4 silných vazeb"… and the default set. */
	chips: { tone: 'neutral' | 'warning'; text: string; title: string | null }[];
	default_note: string | null;
	/** Whether the course's skill list is known. */
	configured: boolean;
	rows: TopicRowView[];
	/** Which paragraph explains the two relations. */
	help: 'rows' | 'none' | null;
	panel: TopicPanelView;
}

export interface CompetencyEntryView {
	code: string;
	weight: FieldView;
	renaming: boolean;
	rename_label: string;
	change_label: string;
	remove_label: string;
}

export interface CompetenciesView {
	entries: CompetencyEntryView[];
	/** The sum of the weights; warns above 100. */
	total: { text: string; tone: 'neutral' | 'warning' } | null;
	adding: boolean;
	add_code: string;
	add_weight: FieldView;
	rename: string;
	problem: string;
}

export interface ConceptsView {
	terms: { term: string; remove_label: string }[];
	draft: string;
	suggestions: string[];
	/** The suggestion list is open: the field has focus and there is something to suggest. */
	listing: boolean;
	active: number;
	problem: string;
}

export interface CardSettingsView extends SettingsBaseView {
	block_id: string;
	/** The fields of each section, by section id; `lesson` is the lesson's binding. */
	fields: Record<string, FieldView[]>;
	review: { plan: FieldView[]; start: FieldView[] };
	/** The toggle that keeps a card's questions in one; null where the mode does not offer it. */
	together: {
		checked: boolean;
		label: string;
		hint: string | null;
		consequence: string;
		/** The card the questions are merged into (`domain/groups.ts`), when there is one. */
		group: string | null;
	} | null;
	/** Said to a mode that cannot change it: the questions are graded as one. */
	together_note: string | null;
	topics: TopicsView;
	concepts: ConceptsView;
	competencies: CompetenciesView;
	prerequisites: PrerequisitesView;
}

// ────────────────────────────────── the dialogs ──────────────────────────────────

export interface PrerequisiteRuleView {
	/** „Nejdřív karta „Kolik je?““ — what the rule waits for, in words. */
	text: string;
	/** The lesson of that card (or its place, when its name is not unique). */
	where: string | null;
	/** A skill's code, in Pokročilý. */
	code: string | null;
	/** Where the picker opens for this rule: on the list its current choice is in. */
	path: string[];
	/** The percentage that is required, as a number field (the document stores 0–1). */
	min_level: FieldView;
}

export interface PrerequisitesView {
	rules: PrerequisiteRuleView[];
	/** What the last action refused, said under the list. */
	problem: string;
}

export interface RepairRowView {
	/** Identifies the pointer in the dialog's choices. */
	key: string;
	/** „Lekce „Zlomky“ tuto kartu obsahuje“. */
	what: string;
	/** The destination chosen: '' clears the pointer. */
	choice: string;
	chosen_label: string;
	/** A step's few destinations, as a list; null when a card's go to the picker. */
	options: { value: string; label: string }[] | null;
	picker_id: string | null;
}

export interface RepairView {
	title: string;
	safe_text: string | null;
	lead: string | null;
	rows: RepairRowView[];
}

export interface TypeChangeView {
	title: string;
	message: string;
}

export interface AssignLessonView {
	/** The lessons that do not hold the card yet. */
	lessons: { value: string; label: string }[];
	chosen: string;
	can_assign: boolean;
}

export interface ExportRowView {
	message: string;
	/** Step and answer inside the card: "Krok 2 › „Čitatel je 5“". */
	detail: string[];
	/** Where "Přejít" lands. */
	target: Ref;
	/** The mode the fix is in, when it is above the author's: "Přejít" switches to it first. */
	needs_mode: Mode | null;
	/** "Opravíš v režimu Metodik — Přejít na něj přepne." */
	mode_note: string | null;
}

export interface ExportGroupView {
	key: string;
	title: string;
	context: string | null;
	rows: ExportRowView[];
}

/** What „Stáhnout“ opens while the course is not finished: the review of what is left. */
export interface ExportView {
	title: string;
	/** Errors keep the file from being written; warnings never do. */
	blocked: boolean;
	lead: string;
	errors: ExportGroupView[];
	warnings: ExportGroupView[];
	/** "Doporučení (4) — stažení nebrání", when errors and warnings are both there. */
	advice_heading: string | null;
	/** Whether the file can still be taken: the "Stáhnout i tak" button. */
	can_download: boolean;
}

export interface VersionItemView {
	version: number;
	/** "Verze 3". */
	name: string;
	/** When it was saved, as a teacher reads a date. */
	saved_at: string;
	/** It is the one that is out. */
	published: boolean;
	chips: { tone: 'ok' | 'quiet'; text: string }[];
	note: string | null;
	/** What changed against the published version: offered, or the answer once asked. */
	compare: { offered: boolean; text: string | null } | null;
	/** The publish button's text; null when there is nothing to publish. */
	publish: { label: string } | null;
	refused_text: string | null;
	/** "Ukázat, co chybí" or "Obnov ji…": whether the working copy is what was refused. */
	refused_is_working_copy: boolean;
	confirming_text: string | null;
}

/** Version control: save the working copy, return to a version, publish one. */
export interface VersionsView {
	working: {
		heading: string;
		status: string;
		save_label: string;
		can_save: boolean;
		note: string;
		busy: boolean;
	};
	visibility: {
		value: Visibility;
		options: { value: Visibility; label: string; title: string }[];
		published_note: string | null;
	};
	message: { tone: 'ok' | 'error'; text: string } | null;
	/** "Načítám…" or "Až verzi uložíš, objeví se tady."; null when there are versions. */
	list_text: string | null;
	items: VersionItemView[];
	/** Where the history is kept, said plainly. */
	kept: string;
}

export interface DialogsRegion {
	versions: VersionsView | null;
	export_review: ExportView | null;
	/** Which dialog is open; null when none is. */
	open: Dialog['kind'] | null;
	course_settings: CourseSettingsView | null;
	lesson_settings: LessonSettingsView | null;
	card_settings: CardSettingsView | null;
	repair: RepairView | null;
	type_change: TypeChangeView | null;
	assign_lesson: AssignLessonView | null;
}

export interface AiRegion {
	/** The top bar's button. It names the state, so an unconfigured server says so there. */
	button: { label: string; title: string; disabled: boolean; pressed: boolean };
	panel_open: boolean;
	configured: boolean | null;
	/** Said in the drawer when there is no AI; null otherwise. */
	status_text: string | null;
	running: boolean;
	/** The quiet note while the model thinks; null otherwise. */
	thinking_text: string | null;
	messages: { key: string; role: AiLine['role']; text: string }[];
	messages_count: number;
	/** What the empty drawer says; null once there is a conversation. */
	empty_text: string | null;
	actions_heading: string | null;
	/** The AI's changes this session, oldest first. `text` names places as the screen does. */
	actions: { key: string; text: string; undone: boolean; ref: Ref | null }[];
	/** Whether "Vrátit změny AI" has anything to return. */
	can_revert: boolean;
	/** The question the AI is waiting on. */
	confirm: { title: string; message: string; items: string[]; destructive: boolean } | null;
}

export interface Screen {
	topbar: TopbarRegion;
	tree: TreeRegion;
	issues: IssuesRegion;
	preview: PreviewRegion;
	notices: NoticesRegion;
	ui: UiRegion;
	card: CardRegion;
	pickers: PickersRegion;
	dialogs: DialogsRegion;
	ai: AiRegion;
}

export type ScreenRegion = keyof Screen;
