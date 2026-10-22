/**
 * Which steps of a card the app's "?" can open (GitHub issue 12).
 *
 * The "?" reads `BlockModel.hintForStep(step)` for the step the engine is on
 * (`BlockStepEngine._currentStep`):
 *  - a display card walks through its steps, so every step is offered;
 *  - an exercise or question card stops only on its question steps
 *    (`_skipToNextQuestion`), so text between them is never offered;
 *  - a block with several questions and none of them open is a batch
 *    (`_isMultiQuestionBlock`, `_isBatchBlock`, BR-E4H835). All questions sit on screen
 *    and one tap grades them (`_confirmAllAnswers`). The engine is on the first
 *    question until then (`_skipToNextQuestion`) and on the last one afterwards
 *    (`_currentStepIndex = _steps.indexOf(questions.last)`), so only those two are
 *    offered. A middle question's hint is never shown.
 *    An open question is an AI round trip, so a card holding one is not a batch and
 *    stops on each question in turn.
 */
import { checksQuestionsInOneTap, membersOf } from './groups';
import type { BlockStep, BlockV2 } from './schema';

/**
 * `block` is a block as the editor holds it. A view card (`membersOf`) is several
 * exported blocks shown as one: each of those has one question, so none is a batch and
 * every question is offered. Only a block that really holds several questions
 * (`multi_question`, or any block in Pokročilý) is judged by `checksQuestionsInOneTap`,
 * the one copy of the app's `_isBatchBlock`.
 */
export function hintOfferedSteps(block: BlockV2): BlockStep[] {
	if (block.type === 'display') return block.steps;
	const questions = block.steps.filter((step) => step.type === 'question');
	if (membersOf(block) !== undefined || !checksQuestionsInOneTap(block)) return questions;
	return [questions[0], questions[questions.length - 1]];
}
