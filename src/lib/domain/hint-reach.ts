/**
 * Which steps of a card the app's "?" can open (GitHub issue 12).
 *
 * The "?" reads `BlockModel.hintForStep(step)` for the step the engine is on
 * (`BlockStepEngine._currentStep`):
 *  - a display card walks through its steps, so every step is offered;
 *  - an exercise or question card stops only on its question steps
 *    (`_skipToNextQuestion`), so text between them is never offered;
 *  - a card with several questions and none of them open is a batch
 *    (`_isMultiQuestionBlock`, `_isBatchBlock`, BR-E4H835). All questions sit on screen
 *    and one tap grades them (`_confirmAllAnswers`). The engine is on the first
 *    question until then (`_skipToNextQuestion`) and on the last one afterwards
 *    (`_currentStepIndex = _steps.indexOf(questions.last)`), so only those two are
 *    offered. A middle question's hint is never shown.
 *    An open question is an AI round trip, so a card holding one is not a batch and
 *    stops on each question in turn.
 */
import type { BlockStep, BlockV2 } from './schema';

export function hintOfferedSteps(block: Pick<BlockV2, 'type' | 'steps'>): BlockStep[] {
	if (block.type === 'display') return block.steps;
	const questions = block.steps.filter((step) => step.type === 'question');
	const batch = questions.length > 1 && !questions.some((s) => s.question?.type === 'open');
	return batch ? [questions[0], questions[questions.length - 1]] : questions;
}
