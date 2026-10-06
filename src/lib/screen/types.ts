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
import type { CourseVersionState } from '$lib/domain/versions';
import type { BlockType } from '$lib/domain/schema';
import type { Mode } from '$lib/ui/fields';
import type { Touched } from '$lib/ui/issue-visibility';

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

export interface UiInput {
	validationOpen: boolean;
	reviewOpen: boolean;
	sidebarCollapsed: boolean;
	/** The issues hidden by hand in the open validation panel (`issueKey`s of the panel). */
	dismissedIssues: ReadonlySet<string>;
	/** Whether this browser has been shown the Pokročilý parts note; null until it is read. */
	partsNoteSeen: boolean | null;
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
	versionState: CourseVersionState;
	/** Text typed into number fields that is no number, by `refKey`. */
	drafts: Readonly<Record<string, string>>;
	save: { draftStatus: DraftStatus | null; backedUp: boolean; dirty: boolean };
	canUndo: boolean;
	canRedo: boolean;
	preview: PreviewInput;
	/** Already limited to its lifetime: null once any later edit has happened. */
	cutOff: CutOffInput | null;
	ui: UiInput;
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
}

export interface UiRegion {
	validation_panel_open: boolean;
	review_open: boolean;
	sidebar_collapsed: boolean;
	/** The Pokročilý note about cards split into parts: whether it is on screen now. */
	parts_note: { eligible: boolean; shown: boolean };
}

export interface Screen {
	topbar: TopbarRegion;
	tree: TreeRegion;
	issues: IssuesRegion;
	preview: PreviewRegion;
	notices: NoticesRegion;
	ui: UiRegion;
}

export type ScreenRegion = keyof Screen;
