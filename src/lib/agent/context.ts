/**
 * What a tool may touch, and nothing else: the `AgentContext`.
 *
 * Every tool reads the screen through it and writes through `transact`, so the rules
 * that make an AI edit safe sit in one place (the revision, the mode, one undo entry,
 * the confirmation) and a tool cannot forget them. `createHeadlessContext` is the
 * implementation over a `DocStore`: the tests run on it, and the browser's wrapper is
 * the same with a dialog behind `confirm` and the preview column behind `showPreview`.
 *
 * The context hands a tool the screen model's regions as plain JSON and the pieces a
 * simulator or a delete needs (`doc`, `source`). A read tool answers from the first
 * only: what the agent is told is what `store.screen` says.
 */
import type { CourseV2 } from '$lib/domain/schema';
import type { CommandResult } from '$lib/domain/commands';
import type { Reservations } from '$lib/domain/ids';
import type { Ref } from '$lib/domain/ref';
import type { SimState } from '$lib/domain/simulate';
import type { SkillConfig } from '$lib/domain/skill-config';
import type { ValidationResult } from '$lib/domain/validate';
import { buildScreen, resolveOpen, type Screen } from '$lib/screen';
import type { Mode } from '$lib/ui/fields';
import type { AiAction, DocStore } from '$lib/state/doc-store.svelte';
import type { ConfirmRequest } from './tool';

/** The numbers the safeguards are made of, in one place so a test can name them. */
export interface AgentLimits {
	/** The longest text a tool may write into one field, in characters. */
	maxText: number;
	/** The most operations in one `apply_batch`. */
	maxBatch: number;
	/** A batch of more operations than this asks the teacher first. */
	confirmBatchOver: number;
	/** Hits `search_text` returns. */
	maxSearchResults: number;
	/** Paths and issues a list tool returns before it says it cut the list. */
	maxListed: number;
	/** Open simulator sessions; the oldest is dropped past this. */
	maxSimSessions: number;
	/** Tool rounds the chat loop allows for one teacher message. */
	maxToolRounds: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
	maxText: 20_000,
	maxBatch: 50,
	confirmBatchOver: 20,
	maxSearchResults: 20,
	maxListed: 40,
	maxSimSessions: 5,
	maxToolRounds: 40
};

/** A walk through a lesson as a pupil, kept between simulator calls. */
export interface SimSession {
	id: string;
	state: SimState;
	/** The revision the walk began at: the course has changed since if it differs. */
	revision: number;
}

/** What a write may do inside a transaction: the view as it stands, and commands on it. */
export interface AgentWriter {
	/** The course as the editor shows it, now, after the commands so far. */
	readonly doc: CourseV2;
	readonly mode: Mode;
	readonly showFeedback: boolean;
	readonly skillConfig: SkillConfig | null;
	/** Run a command on the view, as the teacher's own edit does (`DocStore.apply`). */
	apply(command: (doc: CourseV2, reserved: Reservations) => CommandResult): CommandResult;
}

export interface AgentContext {
	/** Grows with every change to the course or the mode; a write names the one it read. */
	readonly revision: number;
	readonly mode: Mode;
	readonly showFeedback: boolean;
	/** The view: what the editor shows and edits. Paths address this. */
	readonly doc: CourseV2;
	/** The course as exported, one block per question: what the simulator plays. */
	readonly source: CourseV2;
	readonly validation: ValidationResult;
	readonly skillConfig: SkillConfig | null;
	readonly limits: AgentLimits;

	/** The screen as the teacher has it now, every region. Not to be mutated. */
	screen(): Screen;
	/**
	 * The screen as it would be with `ref` open instead: the same builders, a different
	 * selection. For a lesson or card that is not the one open; the tool says so.
	 */
	screenAt(ref: Ref): Screen;
	/** A ref into the source, for one into the view. */
	toSource(ref: Ref): Ref;

	/**
	 * Run `fn` as one AI action: one undo entry, all or nothing. Anything `fn` throws
	 * rolls the change back and reaches the caller.
	 */
	transact<T>(meta: { description: string }, fn: (writer: AgentWriter) => T): T;
	/** Ask the teacher. Resolves false when they decline. */
	confirm(request: ConfirmRequest): Promise<boolean>;
	/** Bring a place into view for the teacher, without counting what they left as touched. */
	follow(ref: Ref): void;
	/** Switch the preview to Náhled or Vyzkoušet. */
	showPreview(view: 'expanded' | 'play'): void;

	/** Simulator sessions, by id. */
	readonly sims: Map<string, SimSession>;
	/** The AI's changes this session. */
	readonly aiActions: readonly AiAction[];
	/** Whether the last undo entry is the AI's. */
	readonly lastChangeIsAi: boolean;
	undoLastAiAction(): AiAction | undefined;
	revertAiSession(): boolean;
}

export interface HeadlessOptions {
	/** The teacher's answer to a question. The tests answer without a dialog. */
	confirm: (request: ConfirmRequest) => boolean | Promise<boolean>;
	limits?: Partial<AgentLimits>;
	follow?: (ref: Ref) => void;
	showPreview?: (view: 'expanded' | 'play') => void;
}

/** An `AgentContext` over a `DocStore`, with the teacher's answers supplied by the caller. */
export function createHeadlessContext(store: DocStore, options: HeadlessOptions): AgentContext {
	const limits: AgentLimits = { ...DEFAULT_LIMITS, ...options.limits };
	const sims = new Map<string, SimSession>();
	const regions = (): Screen => ({
		topbar: store.screen.topbar,
		tree: store.screen.tree,
		issues: store.screen.issues,
		preview: store.screen.preview,
		notices: store.screen.notices,
		ui: store.screen.ui
	});
	const writer: AgentWriter = {
		get doc() {
			return store.doc;
		},
		get mode() {
			return store.mode;
		},
		get showFeedback() {
			return store.showFeedback;
		},
		get skillConfig() {
			return store.skillConfig;
		},
		apply: (command) => store.apply(command)
	};
	return {
		get revision() {
			return store.revision;
		},
		get mode() {
			return store.mode;
		},
		get showFeedback() {
			return store.showFeedback;
		},
		get doc() {
			return store.doc;
		},
		get source() {
			return store.source;
		},
		get validation() {
			return store.validation;
		},
		get skillConfig() {
			return store.skillConfig;
		},
		limits,
		screen: regions,
		screenAt: (ref) =>
			buildScreen({
				...store.screen.input,
				open: resolveOpen(store.doc, store.index, ref)
			}),
		toSource: (ref) => store.toSource(ref),
		transact: (meta, fn) =>
			store.transaction(() => fn(writer), { origin: 'ai', description: meta.description }),
		confirm: async (request) => Boolean(await options.confirm(request)),
		follow: options.follow ?? ((ref) => store.follow(ref)),
		showPreview:
			options.showPreview ??
			((view) => {
				store.preview.view = view;
			}),
		sims,
		get aiActions() {
			return store.aiActions;
		},
		get lastChangeIsAi() {
			return store.undoStack.at(-1)?.origin === 'ai';
		},
		undoLastAiAction: () => store.undoLastAiAction(),
		revertAiSession: () => store.revertAiSession()
	};
}
