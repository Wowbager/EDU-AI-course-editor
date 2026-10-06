/**
 * The pupil simulator: a pure state machine over the exported course that plays a lesson
 * the way the student's app does — which step is on screen, what an answer does, where
 * `go_to` leads, when a card and the lesson end.
 *
 * Why it exists: an agent (and a teacher) wants to "walk the lesson as a pupil" and to
 * see every way through it without driving the Flutter player. The player stays the
 * authority; this file mirrors it, rule by rule, and every rule cites the Dart code it
 * copies. `e2e/preview-simulator-parity.spec.ts` plays scripted paths in the real
 * player and compares the step sequence, which is what catches drift
 * (OPEN-PROBLEMS, "The pupil simulator can drift from the player").
 *
 * Shape: `SimState` is JSON (no Maps, no functions), every function takes the document
 * and the state and returns a new state — nothing is mutated and nothing throws on a
 * bad course. A course the player cannot get through ends in an explicit `error`
 * state (a dangling `go_to`, a question with no answers), because that is what the
 * pupil would meet.
 *
 * Not simulated: the AI tutor (`CHAT` / `LECTURE` stop the run with a label), saved
 * progress, XP caps, bookmarks. Headless on purpose: no Svelte, no DOM.
 *
 * Player files cited (fork checkout of `EDU-AI-asistent-APP`, the commit `PLAYER_REF`
 * pins): `lib/models/step_navigation.dart` (`GoToResolver`),
 * `lib/widgets/block_step_engine.dart` (`_BlockStepEngineState`),
 * `lib/pages/lesson_detail_page.dart` (`_confirmBlock`, `_navigateToBlock`),
 * `lib/models/block_model.dart` (`ContentBlock`, `BlockStep`, `EvaluationConfig`),
 * `lib/models/block_model.dart` `BlockLoader.loadBlocksForLesson`.
 */
import type { BlockStep, BlockV2, CourseV2, ExportType, LessonV2, QuestionConfig } from './schema';
import { blockPreview, optionOutcomesApply, plainFirstLine, stepSummary } from './derive';
import { isGoToKeyword } from './index-doc';

// ───────────────────────────── Types ─────────────────────────────

/**
 * Where in a card the pupil is.
 *  - `show`     a step with nothing to answer (or an answered question the engine shows again)
 *  - `await`    a question waiting for an answer
 *  - `solution` answered, feedback on screen, "Pokračovat"
 *  - `retry`    answered with `go_to: AGAIN`, "Zkusit znovu"
 *  - `ended`    the run is over; see `SimState.end`
 */
export type SimPhase = 'show' | 'await' | 'solution' | 'retry' | 'ended';

/** What the player remembers of one answered step (`StepAnswerState`). */
export interface SimAnswer {
	optionId?: string;
	optionIds?: string[];
	text?: string;
	correct: boolean;
	/** The `go_to` the answer carries — only a single pick has one (`optionOutcomesApply`). */
	goTo: string | null;
	/** `StepAnswerState.scoreKoef`: the option's koef when right, 0 when wrong. */
	scoreKoef: number;
	mark?: string;
}

/** `_completeBlock`: what a finished card hands to the lesson. */
export interface SimBlockResult {
	blockId: string;
	earnedXp: number;
	scoreKoef: number;
	mark: string | null;
}

export type SimErrorCode =
	'unknown_lesson' | 'empty_lesson' | 'dangling_go_to' | 'question_without_config' | 'no_options';

export type SimEnd =
	| {
			kind: 'lesson_end';
			/** Every card was completed. A forward `go_to` that skips cards leaves this false. */
			complete: boolean;
			/** Cards the pupil never completed (ids, for the agent). */
			skippedBlockIds: string[];
			label: string;
	  }
	| { kind: 'chat'; keyword: 'CHAT' | 'LECTURE'; label: string }
	| { kind: 'error'; code: SimErrorCode; target?: string; label: string };

export interface SimState {
	lessonId: string;
	/** Index into the lesson's cards in the player's order. */
	blockIndex: number;
	blockId: string;
	/** Index of the step on screen. */
	stepIndex: number;
	/** `_visited`: steps shown in this card, ascending. */
	visited: number[];
	phase: SimPhase;
	/** `_stepAnswers`, by step id, for the current card. */
	answers: Record<string, SimAnswer>;
	/** `_bestScoreKoef`; null until a question was answered. */
	bestScoreKoef: number | null;
	mark: string | null;
	/** Cards completed in this visit of the lesson (`_contentBlocks[i].isCompleted`). */
	completedBlockIds: string[];
	results: SimBlockResult[];
	/** `quiz_v2` with `quizEvaluate` off: no feedback at all. */
	hideEvaluation: boolean;
	end: SimEnd | null;
}

export type SimInput =
	{ optionId: string } | { optionIds: string[] } | { text: string } | { number: number };

/** Where a `go_to` leads, as `GoToResolver.resolve` decides it. */
export type SimTarget =
	| { kind: 'next_step'; stepId?: string }
	| { kind: 'step'; stepId: string }
	| { kind: 'again'; stepId: string }
	| { kind: 'card_end' }
	| { kind: 'card'; blockId: string; inLesson: boolean; known: boolean }
	| { kind: 'chat'; keyword: 'CHAT' | 'LECTURE' };

export interface SimFeedback {
	correct: boolean;
	/** An option's own feedback; several for a multi-select. Czech or authored text, as written. */
	optionFeedback: string[];
	solution: string | null;
	/** Ids of the right options, when the player reveals them (`show_answers`, not on a retry). */
	revealedCorrectOptionIds: string[] | null;
}

export interface SimOutcome {
	/** False when the input did not fit the question; the state is unchanged. */
	accepted: boolean;
	rejected?: string;
	correct: boolean;
	/** Whether the player stops on the answer (feedback / "Zkusit znovu") or moves on at once. */
	paused: boolean;
	feedback: SimFeedback | null;
	/** The hint the "?" would open on the answered step (it is never shown by itself). */
	hint: string | null;
	scoreKoef: number | null;
	mark: string | null;
	/** Where this answer leads. */
	target: SimTarget | null;
	/** Czech sentence for the agent: what happened. */
	message: string;
	/** Set when the answer made the player complete a card. */
	blockResult: SimBlockResult | null;
	/** A rule of the app the document does not follow, or the simulator cannot judge. */
	notes: string[];
}

export interface SimStepView {
	id: string;
	index: number;
	kind: BlockStep['type'];
	/** One plain line (`stepSummary`). */
	summary: string;
	/** The step's text as authored (Markdown, LaTeX). */
	text: string;
	media: { imageUrl?: string; imageAlt?: string; videoUrl?: string; audioUrl?: string };
	hint: string | null;
}

export interface SimQuestionView {
	type: QuestionConfig['type'];
	prompt: string;
	/** No correctness flags, no feedback, no targets. */
	options: { id: string; text: string }[];
	/** How the pupil answers. */
	answerKind: 'option' | 'options' | 'text' | 'number';
	/** The check button stays disabled until the pupil has picked or typed something. */
	answerRequired: true;
}

export interface SimView {
	status: 'running' | 'ended';
	lesson: { id: string; name: string };
	card: { id: string; name: string; position: number; count: number } | null;
	step: SimStepView | null;
	/** `_stepsOnScreen`: the steps of this card on screen now, in order. */
	shown: { id: string; index: number; kind: BlockStep['type']; summary: string }[];
	question: SimQuestionView | null;
	/** What the main button does. */
	action: 'advance' | 'answer' | 'continue' | 'retry' | 'none';
	/** The button's Czech label, as the player prints it. */
	actionLabel: string | null;
	feedback: SimFeedback | null;
	end: SimEnd | null;
	/** One Czech sentence saying where the pupil is. */
	label: string;
}

export interface SimOptions {
	fromBlockId?: string;
	/** `quiz_v2` and the course's `quizEvaluate` is off. */
	hideEvaluation?: boolean;
}

// ─────────────────────── What the player reads ────────────────────

/**
 * `EvaluationConfig.fromJson` reads `correct_number` and `tolerance`, but the V2
 * question branch of `BlockStep.fromJsonWithId` (`block_model.dart`, "V2 question
 * steps: parse evaluation config") builds its `EvaluationConfig` without them. So at
 * the pinned player commit `correctNumber` is null for every V2 numeric question and
 * `_confirmAnswer` (`block_step_engine.dart:602-608`) grades every answer wrong. The
 * simulator follows the player, and reports what the document means in `notes`. Flip
 * this when `PLAYER_REF` moves to a player that reads the fields.
 */
export const PLAYER_GRADES_NUMERIC = false;

const step_go_to = (step: BlockStep): string | undefined => {
	const value = (step as Record<string, unknown>).go_to;
	return typeof value === 'string' ? value : undefined;
};

/**
 * `BlockLoader.loadBlocksForLesson` (`block_model.dart`): the lesson's bindings sorted by
 * `order` (absent counts as 0, the sort is stable), each resolved to the first block with
 * that id; a binding with no block is dropped.
 */
export function lessonBlocks(doc: CourseV2, lesson: LessonV2): BlockV2[] {
	const bindings = lesson.blocks
		.map((binding, i) => ({ binding, i }))
		.sort((a, b) => (a.binding.order ?? 0) - (b.binding.order ?? 0) || a.i - b.i);
	const out: BlockV2[] = [];
	for (const { binding } of bindings) {
		if (binding.block_id === '') continue;
		const block = doc.blocks.find((b) => b.block_id === binding.block_id);
		if (block !== undefined) out.push(block);
	}
	return out;
}

const findLesson = (doc: CourseV2, lessonId: string) =>
	doc.lessons.find((l) => l.lesson_id === lessonId);

/** `CourseModel.findLessonForBlock`: the first lesson that binds the block. */
const findLessonForBlock = (doc: CourseV2, blockId: string) =>
	doc.lessons.find((lesson) => lessonBlocks(doc, lesson).some((b) => b.block_id === blockId));

const exportMode = (doc: CourseV2): ExportType => doc.export_type;

/** `ContentBlock._filled` / `currentHint`: the step's hint, else the block's; blank is absent. */
function hintOf(block: BlockV2, step: BlockStep | undefined): string | null {
	const own = step?.hint;
	if (typeof own === 'string' && own.trim() !== '') return own;
	const blockHint = block.hint;
	return typeof blockHint === 'string' && blockHint.trim() !== '' ? blockHint : null;
}

const isQuestionStep = (step: BlockStep | undefined) => step?.type === 'question';

const filled = (text: string | undefined) => (text ?? '').trim() !== '';

// ──────────────────────────── Navigation ───────────────────────────

/**
 * `GoToResolver.resolve` (`step_navigation.dart`). Only an *exercise block* ignores
 * `go_to` — not the `exercise_v2` export mode, and not a display block (see the
 * disagreements in OPEN-PROBLEMS: `stepSuccessors` only branches in question blocks).
 */
export function resolveGoTo(
	block: BlockV2,
	stepIndex: number,
	goTo: string | null | undefined
): SimTarget {
	const at = block.steps[stepIndex];
	const here = at?.id ?? '';
	if (block.type === 'exercise') return nextStepTarget(block, stepIndex);
	if (goTo === null || goTo === undefined || goTo === '' || goTo === 'NEXT_STEP') {
		return nextStepTarget(block, stepIndex);
	}
	if (goTo === 'AGAIN') return { kind: 'again', stepId: here };
	if (goTo === 'END') return { kind: 'card_end' };
	if (goTo === 'CHAT' || goTo === 'LECTURE') return { kind: 'chat', keyword: goTo };
	if (block.steps.some((s) => s.id === goTo)) return { kind: 'step', stepId: goTo };
	// `crossBlockJump`: anything else is taken for another card; whether it exists is
	// the lesson's business (`_navigateToBlock`).
	return { kind: 'card', blockId: goTo, inLesson: false, known: false };
}

function nextStepTarget(block: BlockV2, stepIndex: number): SimTarget {
	const next = block.steps[stepIndex + 1];
	return next === undefined ? { kind: 'card_end' } : { kind: 'next_step', stepId: next.id };
}

/** `_resolveAndNavigate` for a `card` target needs the document: is it in this lesson, anywhere? */
function withKnownCard(doc: CourseV2, lessonId: string, target: SimTarget): SimTarget {
	if (target.kind !== 'card') return target;
	const lesson = findLesson(doc, lessonId);
	const here = lesson
		? lessonBlocks(doc, lesson).some((b) => b.block_id === target.blockId)
		: false;
	if (here) return { kind: 'card', blockId: target.blockId, inLesson: true, known: true };
	return {
		kind: 'card',
		blockId: target.blockId,
		inLesson: false,
		known: findLessonForBlock(doc, target.blockId) !== undefined
	};
}

// ───────────────────────── Context and helpers ─────────────────────

interface Ctx {
	doc: CourseV2;
	lesson: LessonV2;
	blocks: BlockV2[];
	mode: ExportType;
}

function contextOf(doc: CourseV2, lessonId: string): Ctx | null {
	const lesson = findLesson(doc, lessonId);
	if (lesson === undefined) return null;
	return { doc, lesson, blocks: lessonBlocks(doc, lesson), mode: exportMode(doc) };
}

const cloneState = (state: SimState): SimState => structuredClone(state);

function endWith(state: SimState, end: SimEnd): SimState {
	return { ...state, phase: 'ended', end };
}

const errorEnd = (code: SimErrorCode, label: string, target?: string): SimEnd => ({
	kind: 'error',
	code,
	label,
	...(target === undefined ? {} : { target })
});

/** The cards-left label shared by the lesson-end messages. */
const LESSON_COMPLETE = 'Lekce je dokončena.';
const LESSON_SKIPPED =
	'Poslední karta je hotová, ale některé karty žák přeskočil. Aplikace lekci nepovažuje za dokončenou.';

// ───────────────────────────── Start ─────────────────────────────

/**
 * `LessonDetailPage.initState`: the first card, or `initialBlockId` when the lesson has
 * it (an unknown id is ignored, as in `PreviewLessonPlayer._startId`).
 */
export function startLesson(doc: CourseV2, lessonId: string, opts: SimOptions = {}): SimState {
	const base: SimState = {
		lessonId,
		blockIndex: 0,
		blockId: '',
		stepIndex: 0,
		visited: [],
		phase: 'ended',
		answers: {},
		bestScoreKoef: null,
		mark: null,
		completedBlockIds: [],
		results: [],
		hideEvaluation: opts.hideEvaluation === true,
		end: null
	};
	const ctx = contextOf(doc, lessonId);
	if (ctx === null) {
		return endWith(base, errorEnd('unknown_lesson', 'Taková lekce v kurzu není.', lessonId));
	}
	if (ctx.blocks.length === 0) {
		return endWith(base, errorEnd('empty_lesson', 'Lekce nemá žádné karty, žák nemá co hrát.'));
	}
	const from =
		opts.fromBlockId === undefined
			? 0
			: Math.max(
					0,
					ctx.blocks.findIndex((b) => b.block_id === opts.fromBlockId)
				);
	return enterBlock(ctx, base, from);
}

/**
 * A card becomes current: `_restoreOrInitState` with no saved progress. Step 0 is shown,
 * and exercise / question cards go straight to their first question (`_skipToNextQuestion`).
 */
function enterBlock(ctx: Ctx, state: SimState, blockIndex: number): SimState {
	const block = ctx.blocks[blockIndex];
	const next: SimState = {
		...state,
		blockIndex,
		blockId: block.block_id,
		stepIndex: 0,
		visited: block.steps.length > 0 ? [0] : [],
		answers: {},
		bestScoreKoef: null,
		mark: null,
		end: null
	};
	next.phase = derivePhase(ctx, next);
	return skipToNextQuestion(ctx, next);
}

/**
 * `_deriveState`: the phase for the step the index points at. An already answered question
 * is shown as its solution, or as a plain step when there is no solution to show
 * (`show_solution: false`, or a quiz without evaluation) — which is how a jump back to
 * an answered question behaves in the player.
 */
function derivePhase(ctx: Ctx, state: SimState): SimPhase {
	const block = ctx.blocks[state.blockIndex];
	const step = block.steps[state.stepIndex];
	if (step === undefined) return 'show';
	if (!isQuestionStep(step)) return 'show';
	const answer = state.answers[step.id];
	if (answer !== undefined) {
		if (ctx.mode === 'quiz_v2' && state.hideEvaluation) return 'show';
		if (step.question?.show_solution === false) return 'show';
		return 'solution';
	}
	return 'await';
}

/**
 * `_skipToNextQuestion`: exercise and question cards are one bubble; display steps are
 * context, and the engine moves past them to the next question.
 */
function skipToNextQuestion(ctx: Ctx, state: SimState): SimState {
	const block = ctx.blocks[state.blockIndex];
	if (block.type !== 'exercise' && block.type !== 'question') return stuckCheck(ctx, state);
	if (state.phase === 'ended') return state;
	let index = state.stepIndex;
	const visited = new Set(state.visited);
	while (index < block.steps.length && !isQuestionStep(block.steps[index])) {
		index++;
		if (index < block.steps.length) visited.add(index);
	}
	if (index >= block.steps.length) {
		return completeBlock(ctx, { ...state, visited: sorted(visited) }, true).state;
	}
	const moved = { ...state, stepIndex: index, visited: sorted(visited) };
	moved.phase = derivePhase(ctx, moved);
	return stuckCheck(ctx, moved);
}

const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

/**
 * A question the pupil cannot answer: no `question` object (`_confirmAnswer` returns at
 * `config == null`), or a choice question without options.
 */
function stuckCheck(ctx: Ctx, state: SimState): SimState {
	if (state.phase !== 'await') return state;
	const step = ctx.blocks[state.blockIndex].steps[state.stepIndex];
	const config = step?.question;
	if (config === undefined) {
		return endWith(
			state,
			errorEnd(
				'question_without_config',
				'Otázka nemá nastavení, žák ji nemůže zodpovědět a nikam se nedostane.'
			)
		);
	}
	const needsOptions = config.type === 'multiple_choice' || config.type === 'true_false';
	if (needsOptions && (config.options ?? []).length === 0) {
		return endWith(
			state,
			errorEnd('no_options', 'Otázka nemá žádné možnosti, žák nemá co vybrat a nikam se nedostane.')
		);
	}
	return state;
}

// ───────────────────────────── Completion ─────────────────────────────

/**
 * `_completeBlock` XP: +1 per display step, +8 per question answered with koef >= 1,
 * +5 per other question (`block_step_engine.dart`). The editor's `derivedBlockXp` is
 * the spec's +1 / +8 and does not know the 5.
 */
function blockResult(block: BlockV2, state: SimState): SimBlockResult {
	let xp = 0;
	for (const step of block.steps) {
		if (isQuestionStep(step)) {
			const answer = state.answers[step.id];
			xp += answer !== undefined && answer.scoreKoef >= 1 ? 8 : 5;
		} else {
			xp += 1;
		}
	}
	return {
		blockId: block.block_id,
		earnedXp: xp,
		scoreKoef: state.bestScoreKoef ?? 0,
		mark: state.mark
	};
}

/**
 * `_completeBlock`, and — when `advance` — the lesson's `_confirmBlock`, which only acts
 * for the card that is current: it marks it completed and opens the next card, or ends the
 * lesson. A card left by a jump (`crossBlockJump`) does not advance, because by the time
 * the deferred completion arrives another card is current.
 */
function completeBlock(
	ctx: Ctx,
	state: SimState,
	advance: boolean
): { state: SimState; result: SimBlockResult } {
	const block = ctx.blocks[state.blockIndex];
	const result = blockResult(block, state);
	const done: SimState = { ...state, results: [...state.results, result] };
	if (!advance) return { state: done, result };

	if (!done.completedBlockIds.includes(block.block_id)) {
		done.completedBlockIds = [...done.completedBlockIds, block.block_id];
	}
	if (state.blockIndex < ctx.blocks.length - 1) {
		return { state: enterBlock(ctx, done, state.blockIndex + 1), result };
	}
	const skipped = ctx.blocks
		.map((b) => b.block_id)
		.filter((id) => !done.completedBlockIds.includes(id));
	const complete = skipped.length === 0;
	return {
		state: endWith(done, {
			kind: 'lesson_end',
			complete,
			skippedBlockIds: skipped,
			label: complete ? LESSON_COMPLETE : LESSON_SKIPPED
		}),
		result
	};
}

// ─────────────────────────── Navigating ───────────────────────────

/**
 * `_resolveAndNavigate`: act on a resolved `go_to`. Returns the new state and the card
 * result when a card was completed on the way.
 */
function navigate(
	ctx: Ctx,
	state: SimState,
	goTo: string | null | undefined
): { state: SimState; target: SimTarget; result: SimBlockResult | null } {
	const block = ctx.blocks[state.blockIndex];
	const target = withKnownCard(ctx.doc, state.lessonId, resolveGoTo(block, state.stepIndex, goTo));
	let next = state;
	let result: SimBlockResult | null = null;

	switch (target.kind) {
		case 'next_step': {
			// `_isLastStep` is false here by construction: the target was computed from the order.
			next = { ...state, stepIndex: state.stepIndex + 1 };
			next.visited = sorted(new Set([...state.visited, next.stepIndex]));
			next.phase = derivePhase(ctx, next);
			break;
		}
		case 'again': {
			// `_stepAnswers.remove(_currentStep.stepId)`, `_state = _deriveState()`.
			const answers = { ...state.answers };
			delete answers[block.steps[state.stepIndex].id];
			next = { ...state, answers };
			next.phase = derivePhase(ctx, next);
			break;
		}
		case 'step': {
			const index = block.steps.findIndex((s) => s.id === target.stepId);
			next = { ...state, stepIndex: index };
			next.visited = sorted(new Set([...state.visited, index]));
			next.phase = derivePhase(ctx, next);
			break;
		}
		case 'card_end': {
			const done = completeBlock(ctx, state, true);
			return { state: done.state, target, result: done.result };
		}
		case 'chat': {
			const done = completeBlock(ctx, state, false);
			const completedIds = done.state.completedBlockIds.includes(block.block_id)
				? done.state.completedBlockIds
				: [...done.state.completedBlockIds, block.block_id];
			return {
				state: endWith(
					{ ...done.state, completedBlockIds: completedIds },
					{
						kind: 'chat',
						keyword: target.keyword,
						label:
							'Odpověď otevře AI tutora. Ten se v simulaci nehraje, takže běh končí; v aplikaci by žák po rozhovoru pokračoval další kartou.'
					}
				),
				target,
				result: done.result
			};
		}
		case 'card': {
			const done = completeBlock(ctx, state, false);
			return { ...jumpToCard(ctx, done.state, target), target, result: done.result };
		}
	}

	// `_resolveAndNavigate`, last lines: exercise and question cards skip display steps.
	next = skipToNextQuestion(ctx, next);
	return { state: next, target, result };
}

/** `_navigateToBlock` (`lesson_detail_page.dart`). */
function jumpToCard(
	ctx: Ctx,
	state: SimState,
	target: Extract<SimTarget, { kind: 'card' }>
): { state: SimState } {
	const index = ctx.blocks.findIndex((b) => b.block_id === target.blockId);
	if (index >= 0) {
		// Backward: reset the target through the current card. Forward: only the target.
		const from = index;
		const to = index < state.blockIndex ? state.blockIndex : index;
		const reset = new Set(ctx.blocks.slice(from, to + 1).map((b) => b.block_id));
		const completed = state.completedBlockIds.filter((id) => !reset.has(id));
		return { state: enterBlock(ctx, { ...state, completedBlockIds: completed }, index) };
	}
	// Another lesson of the course: the page is replaced and starts at that card.
	const other = findLessonForBlock(ctx.doc, target.blockId);
	if (other === undefined) {
		return {
			state: endWith(
				state,
				errorEnd(
					'dangling_go_to',
					'Odpověď vede na kartu, která v kurzu neexistuje. Žák by po ní zůstal stát na dokončené kartě.',
					target.blockId
				)
			)
		};
	}
	const otherCtx = contextOf(ctx.doc, other.lesson_id)!;
	const at = otherCtx.blocks.findIndex((b) => b.block_id === target.blockId);
	return {
		state: enterBlock(
			otherCtx,
			{ ...state, lessonId: other.lesson_id, completedBlockIds: [] },
			Math.max(at, 0)
		)
	};
}

// ───────────────────────────── Answering ─────────────────────────────

const numericText = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** `double.tryParse(text.trim().replaceAll(',', '.'))`. */
export function parseNumericAnswer(text: string): number | null {
	const cleaned = text.trim().replace(/,/g, '.');
	return numericText.test(cleaned) ? Number(cleaned) : null;
}

/** `(user - correctNumber).abs() <= tolerance` (`_confirmAnswer`, numeric branch). */
export function numericMatches(user: number, correct: number, tolerance = 0): boolean {
	return Math.abs(user - correct) <= tolerance;
}

const reject = (state: SimState, reason: string): { state: SimState; outcome: SimOutcome } => ({
	state,
	outcome: {
		accepted: false,
		rejected: reason,
		correct: false,
		paused: false,
		feedback: null,
		hint: null,
		scoreKoef: null,
		mark: null,
		target: null,
		message: reason,
		blockResult: null,
		notes: []
	}
});

function answerKind(question: QuestionConfig): SimQuestionView['answerKind'] {
	if (question.allow_multiple === true) return 'options';
	if (question.type === 'numeric') return 'number';
	if (question.type === 'open') return 'text';
	return 'option';
}

/**
 * The pupil picks or types an answer and presses "Zkontrolovat": `_onOptionSelected` /
 * `_onMultipleOptionsSelected` / `_onTextAnswerChanged`, then `_confirmAnswer`.
 */
export function answer(
	doc: CourseV2,
	state: SimState,
	input: SimInput
): { state: SimState; outcome: SimOutcome } {
	const ctx = contextOf(doc, state.lessonId);
	if (ctx === null || state.phase !== 'await') {
		return reject(state, 'Teď není na co odpovídat.');
	}
	const block = ctx.blocks[state.blockIndex];
	const step = block.steps[state.stepIndex];
	const config = step?.question;
	if (step === undefined || config === undefined) {
		return reject(state, 'Tento krok nemá otázku.');
	}
	const options = config.options ?? [];
	const kind = answerKind(config);
	const notes: string[] = [];

	// ── the pick ──
	const picked: Partial<SimAnswer> = {};
	if (kind === 'option' || kind === 'options') {
		const ids =
			'optionIds' in input ? input.optionIds : 'optionId' in input ? [input.optionId] : [];
		const known = ids.filter((id) => options.some((o) => o.id === id));
		if (known.length === 0 || known.length !== new Set(ids).size) {
			return reject(state, 'Žák musí vybrat některou z nabízených možností.');
		}
		if (kind === 'option') {
			if (known.length !== 1) return reject(state, 'Tady jde vybrat jen jednu možnost.');
			picked.optionId = known[0];
		} else {
			picked.optionIds = [...new Set(known)];
		}
	} else {
		const text = 'text' in input ? input.text : 'number' in input ? String(input.number) : '';
		if (text === '') return reject(state, 'Žák musí nejdřív něco napsat.');
		picked.text = text;
	}

	// ── `_confirmAnswer`: evaluate ──
	let correct = false;
	let scoreKoef = 1;
	let mark: string | undefined;
	let goTo: string | null = null;

	if (config.allow_multiple === true) {
		// `:597-601` all correct options, and only those.
		const chosen = new Set(picked.optionIds ?? []);
		const right = new Set(options.filter((o) => o.is_correct === true).map((o) => o.id));
		correct = chosen.size === right.size && [...right].every((id) => chosen.has(id));
	} else if (config.type === 'numeric') {
		// `:602-608` numeric, see PLAYER_GRADES_NUMERIC.
		const user = parseNumericAnswer(picked.text ?? '');
		const intended =
			user !== null &&
			config.correct_number !== undefined &&
			numericMatches(user, config.correct_number, config.tolerance ?? 0);
		correct = PLAYER_GRADES_NUMERIC ? intended : false;
		if (!PLAYER_GRADES_NUMERIC) {
			notes.push(
				intended
					? 'Odpověď by podle kurzu byla správně, ale přehrávač v této verzi číselné odpovědi nevyhodnocuje (správné číslo a toleranci ve V2 nečte) a uzná ji jako špatnou.'
					: 'Přehrávač v této verzi číselné odpovědi nevyhodnocuje (správné číslo a toleranci ve V2 nečte), každá je špatně.'
			);
		}
	} else if (config.type === 'open') {
		// `:609-619` open answers are compared here, not by the AI tutor.
		const typed = (picked.text ?? '').trim().toLowerCase();
		const expected = (config.correct_answer ?? '').trim().toLowerCase();
		if (expected !== '') correct = typed === expected;
		if (!correct && options.length > 0) {
			correct = options.some((o) => o.is_correct === true && o.text.trim().toLowerCase() === typed);
		}
		scoreKoef = correct ? 1 : 0;
	} else {
		// `:620-633` single select / true_false — the only branch an option's own outcome counts in.
		const option = options.find((o) => o.id === picked.optionId);
		if (option !== undefined) {
			correct = option.is_correct === true;
			scoreKoef = option.score_koef ?? 1;
			mark = option.mark;
			if (optionOutcomesApply(config)) goTo = option.go_to ?? null;
		}
	}

	// `final effectiveScoreKoef = isCorrect ? scoreKoef : 0.0`
	const effective = correct ? scoreKoef : 0;
	const stored: SimAnswer = {
		...picked,
		correct,
		goTo,
		scoreKoef: effective,
		...(mark === undefined ? {} : { mark })
	};

	const next = cloneState(state);
	next.answers[step.id] = stored;
	if (next.bestScoreKoef === null || effective > next.bestScoreKoef) next.bestScoreKoef = effective;
	next.mark = mark ?? next.mark;

	// ── pause or move on ──
	const preResolved = resolveGoTo(block, state.stepIndex, goTo);
	const selected =
		picked.optionId === undefined ? undefined : options.find((o) => o.id === picked.optionId);
	const hasFeedbackContent =
		filled(config.solution) || config.solution_image !== undefined || filled(selected?.feedback);
	const quiz = ctx.mode === 'quiz_v2';
	const isQuizEvaluating = quiz && !state.hideEvaluation;
	const showAnswers = config.show_answers !== false;
	const showSolution = config.show_solution !== false;
	const skipSolution =
		(quiz && state.hideEvaluation) ||
		(!isQuizEvaluating && (!showAnswers || !showSolution || !hasFeedbackContent));

	let after: SimState;
	let target: SimTarget | null;
	let result: SimBlockResult | null = null;
	let paused: boolean;

	if (preResolved.kind === 'again') {
		// `if (preResolved.type == NavActionType.again)`: any answer, right or wrong.
		after = { ...next, phase: 'retry' };
		target = preResolved;
		paused = true;
		if (correct) {
			notes.push(
				'Správná odpověď vede na AGAIN: žák musí „Zkusit znovu“ a tím se vrací na tutéž otázku, správná odpověď ho nikam neposune.'
			);
		}
	} else if (skipSolution) {
		const moved = navigate(ctx, next, goTo);
		after = moved.state;
		target = moved.target;
		result = moved.result;
		paused = false;
	} else {
		after = { ...next, phase: 'solution' };
		target = withKnownCard(doc, state.lessonId, preResolved);
		paused = true;
	}

	const retry = after.phase === 'retry';
	const feedback = hideFeedbackFor(ctx, state)
		? null
		: feedbackOf(config, stored, options, retry, !paused);
	const outcome: SimOutcome = {
		accepted: true,
		correct,
		paused,
		feedback: paused ? feedback : null,
		hint: hintOf(block, step),
		scoreKoef: effective,
		mark: mark ?? null,
		target,
		message: outcomeMessage(correct, paused, retry, feedback),
		blockResult: result,
		notes
	};
	return { state: after, outcome };
}

const hideFeedbackFor = (ctx: Ctx, state: SimState) =>
	ctx.mode === 'quiz_v2' && state.hideEvaluation;

/**
 * What `StepContentRenderer` shows after an answer (`step_content_renderer.dart`, the
 * feedback and solution blocks of `_buildQuestion`): the picked option's feedback (every
 * picked one for a multi-select), the solution when `show_solution` is not off and the
 * player is not on a retry, and the right options when `show_answers` is not off.
 */
function feedbackOf(
	config: QuestionConfig,
	answered: SimAnswer,
	options: NonNullable<QuestionConfig['options']>,
	retry: boolean,
	skipped: boolean
): SimFeedback {
	const picks = new Set([
		...(answered.optionIds ?? []),
		...(answered.optionId ? [answered.optionId] : [])
	]);
	const optionFeedback = options
		.filter((o) => picks.has(o.id) && typeof o.feedback === 'string')
		.map((o) => o.feedback as string);
	const solution =
		!retry && config.show_solution !== false && filled(config.solution) ? config.solution! : null;
	const reveals = !retry && !skipped && config.show_answers !== false;
	return {
		correct: answered.correct,
		optionFeedback,
		solution,
		revealedCorrectOptionIds: reveals
			? options.filter((o) => o.is_correct === true).map((o) => o.id)
			: null
	};
}

function outcomeMessage(
	correct: boolean,
	paused: boolean,
	retry: boolean,
	feedback: SimFeedback | null
): string {
	const verdict = correct ? 'Správná odpověď.' : 'Špatná odpověď.';
	if (retry) return `${verdict} Žák vidí svůj výběr označený a tlačítko „Zkusit znovu“.`;
	if (!paused) return `${verdict} Přehrávač nic neukazuje a jde rovnou dál.`;
	const shows =
		feedback !== null && (feedback.optionFeedback.length > 0 || feedback.solution !== null);
	return `${verdict} ${shows ? 'Žák vidí zpětnou vazbu' : 'Žák vidí výsledek'} a tlačítko „Pokračovat“.`;
}

// ───────────────────────────── Advancing ─────────────────────────────

/**
 * The main button on a step that takes no answer (the check circle, `_advanceDisplayStep`), on a
 * solution ("Pokračovat", `_continueAfterSolution`) or on a retry ("Zkusit znovu",
 * `_retryAgain`).
 */
export function advance(
	doc: CourseV2,
	state: SimState
): { state: SimState; target: SimTarget | null; blockResult: SimBlockResult | null } {
	const ctx = contextOf(doc, state.lessonId);
	if (ctx === null || state.phase === 'ended' || state.phase === 'await') {
		return { state, target: null, blockResult: null };
	}
	const block = ctx.blocks[state.blockIndex];
	const step = block.steps[state.stepIndex];

	if (state.phase === 'retry') {
		// `_retryAgain`: clear the pick, answer again.
		const answers = { ...state.answers };
		delete answers[step.id];
		const next: SimState = { ...state, answers, phase: 'await' };
		return { state: next, target: { kind: 'again', stepId: step.id }, blockResult: null };
	}

	if (step === undefined) {
		// A card without steps: its fallback card has only the confirm button.
		const done = completeBlock(ctx, state, true);
		return { state: done.state, target: { kind: 'card_end' }, blockResult: done.result };
	}

	if (state.phase === 'solution') {
		// `_continueAfterSolution`: the go_to of the picked option.
		const moved = navigate(ctx, state, state.answers[step.id]?.goTo ?? null);
		return { state: moved.state, target: moved.target, blockResult: moved.result };
	}

	// `_advanceDisplayStep`: the step's own go_to, else the next step.
	const moved = navigate(ctx, state, step_go_to(step) ?? null);
	return { state: moved.state, target: moved.target, blockResult: moved.result };
}

// ─────────────────────────────── View ───────────────────────────────

/** `_stepsOnScreen` for a card still being worked on. */
export function stepsOnScreen(state: SimState): number[] {
	const out = state.visited.filter((i) => i < state.stepIndex);
	return [...out, state.stepIndex];
}

/** What the pupil sees now. */
export function view(doc: CourseV2, state: SimState): SimView {
	const lesson = findLesson(doc, state.lessonId);
	const lessonInfo = { id: state.lessonId, name: lesson?.name ?? 'Lekce' };
	const ctx = contextOf(doc, state.lessonId);
	const block = ctx?.blocks[state.blockIndex];
	const card =
		ctx === null || block === undefined
			? null
			: {
					id: block.block_id,
					name: blockPreview(block, 70, state.blockIndex + 1),
					position: state.blockIndex + 1,
					count: ctx.blocks.length
				};

	if (state.phase === 'ended' || block === undefined) {
		return {
			status: 'ended',
			lesson: lessonInfo,
			card,
			step: null,
			shown: [],
			question: null,
			action: 'none',
			actionLabel: null,
			feedback: null,
			end: state.end,
			label: state.end?.label ?? 'Běh skončil.'
		};
	}

	const step = block.steps[state.stepIndex];
	const stepView: SimStepView | null =
		step === undefined
			? null
			: {
					id: step.id,
					index: state.stepIndex,
					kind: step.type,
					summary: stepSummary(step),
					text: step.content ?? '',
					media: {
						...(step.image?.url ? { imageUrl: step.image.url } : {}),
						...(step.image?.alt ? { imageAlt: step.image.alt } : {}),
						...(step.video?.url ? { videoUrl: step.video.url } : {}),
						...(step.audio?.url ? { audioUrl: step.audio.url } : {})
					},
					hint: hintOf(block, step)
				};

	const config = step?.question;
	const question: SimQuestionView | null =
		step !== undefined && isQuestionStep(step) && config !== undefined
			? {
					type: config.type,
					prompt: step.content ?? '',
					options: (config.options ?? []).map((o) => ({ id: o.id, text: o.text })),
					answerKind: answerKind(config),
					answerRequired: true
				}
			: null;

	const answered = step === undefined ? undefined : state.answers[step.id];
	const feedback =
		(state.phase === 'solution' || state.phase === 'retry') &&
		config !== undefined &&
		answered !== undefined &&
		!hideFeedbackFor(ctx!, state)
			? feedbackOf(config, answered, config.options ?? [], state.phase === 'retry', false)
			: null;

	const [action, actionLabel] = ((): [SimView['action'], string | null] => {
		switch (state.phase) {
			case 'await':
				return ['answer', config?.show_answers === false ? 'Další' : 'Zkontrolovat'];
			case 'solution':
				return ['continue', 'Pokračovat'];
			case 'retry':
				return ['retry', 'Zkusit znovu'];
			default:
				// `BlockMainButton` with no label: the check circle, named "Pokračovat" for assistive tech.
				return ['advance', 'Pokračovat'];
		}
	})();

	const shown = stepsOnScreen(state)
		.filter((i) => i < block.steps.length)
		.map((i) => ({
			id: block.steps[i].id,
			index: i,
			kind: block.steps[i].type,
			summary: stepSummary(block.steps[i])
		}));

	return {
		status: 'running',
		lesson: lessonInfo,
		card,
		step: stepView,
		shown,
		question,
		action,
		actionLabel,
		feedback,
		end: null,
		label: positionLabel(card!, state, step, question !== null)
	};
}

function positionLabel(
	card: NonNullable<SimView['card']>,
	state: SimState,
	step: BlockStep | undefined,
	isQuestion: boolean
): string {
	const where = `Karta ${card.position} z ${card.count} („${card.name}“)`;
	if (step === undefined) return `${where}: prázdná karta.`;
	const what = isQuestion ? 'otázka' : 'krok';
	const summary = plainFirstLine(stepSummary(step));
	return `${where}, ${what} ${state.stepIndex + 1}${summary === '' ? '' : `: ${summary}`}`;
}

/** Where the run is, in the shape the player reports (`stepChanged`). Null once it ended. */
export function position(
	doc: CourseV2,
	state: SimState
): { blockId: string; stepId: string; shownStepIds: string[] } | null {
	if (state.phase === 'ended') return null;
	const ctx = contextOf(doc, state.lessonId);
	const block = ctx?.blocks[state.blockIndex];
	const step = block?.steps[state.stepIndex];
	if (block === undefined || step === undefined) return null;
	return {
		blockId: block.block_id,
		stepId: step.id,
		shownStepIds: stepsOnScreen(state)
			.filter((i) => i < block.steps.length)
			.map((i) => block.steps[i].id)
	};
}

// ────────────────────────────── Explore ──────────────────────────────

export interface ExploreOptions {
	/** Stop after this many distinct paths. Default 200. */
	maxPaths?: number;
	/** Stop a path after this many steps shown. Default 200. */
	maxSteps?: number;
	/** A step shown more than this many times on one path is a loop. Default 2. */
	maxRepeat?: number;
	hideEvaluation?: boolean;
}

export type PathEnd =
	| { kind: 'lesson_end'; complete: boolean }
	| { kind: 'chat'; keyword: 'CHAT' | 'LECTURE' }
	| { kind: 'error'; code: SimErrorCode; target?: string }
	| { kind: 'loop' }
	| { kind: 'too_long' };

export interface SimPath {
	/** Steps in the order the player shows them (`stepChanged`). */
	steps: { blockId: string; stepId: string }[];
	length: number;
	/** What the pupil did to get this way, in Czech. */
	choices: string[];
	end: PathEnd;
	/** How many answer combinations give this same path. */
	variants: number;
}

export interface ExploreReport {
	lessonId: string;
	paths: SimPath[];
	/** True when `maxPaths` or `maxSteps` cut the search short: the lists below are incomplete. */
	truncated: boolean;
	minLength: number | null;
	maxLength: number | null;
	/** Paths that end with the pupil unable to move (question without answers, empty lesson). */
	deadEnds: SimPath[];
	/** Paths that end in a `go_to` to nowhere. */
	errors: SimPath[];
	loops: SimPath[];
	/** Steps no path shows, and cards no path enters; null when the search was truncated. */
	unreachable: { blockId: string; stepId?: string; label: string }[] | null;
	summary: string;
}

const DEAD_END_CODES = new Set<SimErrorCode>([
	'question_without_config',
	'no_options',
	'empty_lesson',
	'unknown_lesson'
]);

/** The answers worth trying for a question: each option, or right-and-wrong for the rest. */
function candidateInputs(config: QuestionConfig): { input: SimInput; label: string }[] {
	const options = config.options ?? [];
	const label = (text: string) => plainFirstLine(text) || 'možnost';
	if (config.allow_multiple === true) {
		const right = options.filter((o) => o.is_correct === true);
		const wrong = options.filter((o) => o.is_correct !== true);
		const out: { input: SimInput; label: string }[] = [];
		if (right.length > 0) {
			out.push({
				input: { optionIds: right.map((o) => o.id) },
				label: `správné možnosti (${right.map((o) => label(o.text)).join(', ')})`
			});
		}
		if (wrong.length > 0) {
			out.push({
				input: { optionIds: wrong.map((o) => o.id) },
				label: `špatné možnosti (${wrong.map((o) => label(o.text)).join(', ')})`
			});
		}
		return out;
	}
	if (config.type === 'numeric') {
		const out: { input: SimInput; label: string }[] = [];
		if (config.correct_number !== undefined) {
			out.push({
				input: { number: config.correct_number },
				label: `číslo ${config.correct_number}`
			});
			const off = config.correct_number + (config.tolerance ?? 0) + 1;
			out.push({ input: { number: off }, label: `jiné číslo (${off})` });
		} else {
			out.push({ input: { number: 0 }, label: 'číslo 0' });
		}
		return out;
	}
	if (config.type === 'open') {
		const right =
			(config.correct_answer ?? '').trim() !== ''
				? config.correct_answer!
				: options.find((o) => o.is_correct === true)?.text;
		const out: { input: SimInput; label: string }[] = [];
		if (right !== undefined)
			out.push({ input: { text: right }, label: `správná odpověď „${right}“` });
		out.push({ input: { text: '—' }, label: 'jiná odpověď' });
		return out;
	}
	return options.map((o) => ({ input: { optionId: o.id }, label: `„${label(o.text)}“` }));
}

/**
 * What a state makes of the future: the position and everything later moves read.
 * Answers count only by whether they were right and where they send the pupil, so two
 * wrong options that both go on are one branch.
 */
function signature(state: SimState): string {
	const answers = Object.entries(state.answers)
		.map(([id, a]) => `${id}:${a.correct ? 1 : 0}:${a.goTo ?? ''}:${a.scoreKoef}`)
		.sort();
	return JSON.stringify([
		state.lessonId,
		state.blockIndex,
		state.stepIndex,
		state.visited,
		state.phase,
		answers,
		[...state.completedBlockIds].sort(),
		state.end
	]);
}

interface Frame {
	state: SimState;
	steps: { blockId: string; stepId: string }[];
	choices: string[];
	counts: Record<string, number>;
	last: string | null;
}

/**
 * Every distinct way through a lesson, bounded. It branches on each answer (or on right
 * versus wrong where the pupil types), follows each `go_to` as the player does, and reports
 * what the lesson does to a pupil: where it ends, where it loops, where it strands them.
 */
export function explore(doc: CourseV2, lessonId: string, opts: ExploreOptions = {}): ExploreReport {
	const maxPaths = opts.maxPaths ?? 200;
	const maxSteps = opts.maxSteps ?? 200;
	const maxRepeat = opts.maxRepeat ?? 2;
	const ctx = contextOf(doc, lessonId);
	const paths = new Map<string, SimPath>();
	const reached = new Set<string>();
	let truncated = false;

	const first = startLesson(doc, lessonId, { hideEvaluation: opts.hideEvaluation });
	const stack: Frame[] = [{ state: first, steps: [], choices: [], counts: {}, last: null }];

	const finish = (frame: Frame, end: PathEnd) => {
		const key = JSON.stringify([frame.steps.map((s) => `${s.blockId}/${s.stepId}`), end]);
		const existing = paths.get(key);
		if (existing) existing.variants++;
		else {
			paths.set(key, {
				steps: frame.steps,
				length: frame.steps.length,
				choices: frame.choices,
				end,
				variants: 1
			});
		}
	};

	/** Record where a state is: the step list, the reach set, the loop counters. */
	const arrive = (frame: Frame, countArrival: boolean): PathEnd | null => {
		const state = frame.state;
		if (state.phase === 'ended') return null;
		const here = position(doc, state);
		if (here === null) return null;
		const block = ctx?.blocks[state.blockIndex];
		for (const i of state.visited) {
			const id = block?.steps[i]?.id;
			if (id !== undefined) reached.add(`${state.blockId}/${id}`);
		}
		reached.add(`${here.blockId}/${here.stepId}`);
		const shownKey = `${here.blockId}/${here.stepId}/${here.shownStepIds.join(',')}`;
		const moved = shownKey !== frame.last;
		if (moved) {
			frame.steps = [...frame.steps, { blockId: here.blockId, stepId: here.stepId }];
			frame.last = shownKey;
		}
		if (countArrival || moved) {
			const key = `${here.blockId}/${here.stepId}`;
			frame.counts = { ...frame.counts, [key]: (frame.counts[key] ?? 0) + 1 };
			if (frame.counts[key] > maxRepeat) return { kind: 'loop' };
		}
		if (frame.steps.length > maxSteps) return { kind: 'too_long' };
		return null;
	};

	arrive(stack[0], true);

	// A lesson of answered questions that send the pupil round in circles has more
	// branches than paths; the budget keeps the search bounded whatever it looks like.
	let budget = maxPaths * (maxSteps + 5) * 4;
	while (stack.length > 0) {
		if (paths.size >= maxPaths || budget-- <= 0) {
			truncated = true;
			break;
		}
		const frame = stack.pop()!;
		const state = frame.state;

		if (state.phase === 'ended') {
			const end = state.end!;
			finish(
				frame,
				end.kind === 'lesson_end'
					? { kind: 'lesson_end', complete: end.complete }
					: end.kind === 'chat'
						? { kind: 'chat', keyword: end.keyword }
						: {
								kind: 'error',
								code: end.code,
								...(end.target === undefined ? {} : { target: end.target })
							}
			);
			continue;
		}
		if (state.lessonId !== lessonId) {
			// A jump into another lesson: where that goes is that lesson's report.
			finish(frame, { kind: 'lesson_end', complete: false });
			continue;
		}

		const step = ctx!.blocks[state.blockIndex]?.steps[state.stepIndex];
		const moves: { state: SimState; label: string | null }[] = [];

		if (state.phase === 'await' && step?.question !== undefined) {
			const seen = new Set<string>();
			for (const candidate of candidateInputs(step.question)) {
				const result = answer(doc, state, candidate.input);
				if (!result.outcome.accepted) continue;
				const key = signature(result.state);
				if (seen.has(key)) continue;
				seen.add(key);
				moves.push({
					state: result.state,
					label: `${candidate.label} → ${result.outcome.correct ? 'správně' : 'špatně'}`
				});
			}
			if (moves.length === 0) {
				finish(frame, { kind: 'error', code: 'no_options' });
				continue;
			}
		} else {
			moves.push({ state: advance(doc, state).state, label: null });
		}

		// The first move continues this path; the rest wait on the stack, in order.
		for (let i = moves.length - 1; i >= 0; i--) {
			const move = moves[i];
			const child: Frame = {
				state: move.state,
				steps: frame.steps,
				choices: move.label === null ? frame.choices : [...frame.choices, move.label],
				counts: frame.counts,
				last: frame.last
			};
			const countArrival = move.state.phase === 'show' || move.state.phase === 'await';
			const stop = arrive(child, countArrival);
			if (stop !== null) finish(child, stop);
			else stack.push(child);
		}
	}

	const list = [...paths.values()];
	const lengths = list.filter((p) => p.end.kind === 'lesson_end').map((p) => p.length);
	const errors = list.filter((p) => p.end.kind === 'error');
	const report: ExploreReport = {
		lessonId,
		paths: list,
		truncated: truncated || list.some((p) => p.end.kind === 'too_long'),
		minLength: lengths.length ? Math.min(...lengths) : null,
		maxLength: lengths.length ? Math.max(...lengths) : null,
		deadEnds: errors.filter((p) => p.end.kind === 'error' && DEAD_END_CODES.has(p.end.code)),
		errors: errors.filter((p) => p.end.kind === 'error' && !DEAD_END_CODES.has(p.end.code)),
		loops: list.filter((p) => p.end.kind === 'loop'),
		unreachable: null,
		summary: ''
	};
	if (!report.truncated && ctx !== null) {
		report.unreachable = unreachableOf(ctx, reached);
	}
	report.summary = exploreSummary(report);
	return report;
}

function unreachableOf(ctx: Ctx, reached: Set<string>) {
	const out: { blockId: string; stepId?: string; label: string }[] = [];
	ctx.blocks.forEach((block, i) => {
		const name = blockPreview(block, 50, i + 1);
		const seen = block.steps.filter((s) => reached.has(`${block.block_id}/${s.id}`));
		if (seen.length === 0) {
			out.push({ blockId: block.block_id, label: `Karta „${name}“ se žákovi nikdy nezobrazí.` });
			return;
		}
		block.steps.forEach((s, at) => {
			if (!reached.has(`${block.block_id}/${s.id}`)) {
				out.push({
					blockId: block.block_id,
					stepId: s.id,
					label: `Karta „${name}“: krok ${at + 1} se žákovi nikdy nezobrazí.`
				});
			}
		});
	});
	return out;
}

function exploreSummary(report: ExploreReport): string {
	const parts = [
		`Cest: ${report.paths.length}${report.truncated ? ' (prohledávání bylo zkráceno)' : ''}.`
	];
	if (report.minLength !== null) {
		parts.push(`Nejkratší cesta má ${report.minLength} kroků, nejdelší ${report.maxLength}.`);
	}
	if (report.deadEnds.length > 0) parts.push(`Slepých uliček: ${report.deadEnds.length}.`);
	if (report.errors.length > 0)
		parts.push(`Cest do nikam (go_to na neexistující cíl): ${report.errors.length}.`);
	if (report.loops.length > 0) parts.push(`Cest, které se točí dokola: ${report.loops.length}.`);
	if (report.unreachable !== null && report.unreachable.length > 0) {
		parts.push(`Nedosažitelných míst: ${report.unreachable.length}.`);
	}
	return parts.join(' ');
}

// `isGoToKeyword` is re-exported for callers that describe a target without resolving it.
export { isGoToKeyword };
