import type { QuestionConfig } from './schema';

/** The attempts a guided question grants before the solution (`kDefaultGuidedAttempts`). */
export const GUIDED_ATTEMPTS_DEFAULT = 3;
/** `parseGuidedAttempts` clamps to this range. */
export const GUIDED_ATTEMPTS_MIN = 1;
export const GUIDED_ATTEMPTS_MAX = 10;
/** `QuestionCriterion.listFromJson` keeps the first four named criteria. */
export const AI_CRITERIA_MAX = 4;

const OPEN_ONLY = new Set([
	'allow_photo',
	'ai_evaluation',
	'ai_guided',
	'ai_guided_attempts',
	'ai_criteria',
	'ai_criteria_list'
]);

/**
 * Whether a question setting changes anything for this question, so the editor offers
 * it only there (`block_model.dart`, `EvaluationConfig`; `block_step_engine.dart`):
 *
 * - photo and AI settings: only an open answer goes to the AI (`_confirmOpenAnswerWithAi`);
 * - `ai_guided` only with `ai_evaluation`: guiding is formative feedback
 *   (`step_content_renderer.dart`: `guided = formative && config.aiGuided`), and its
 *   attempt count only with `ai_guided`;
 * - `shuffle_options` only for a choice question: Ano/Ne never shuffles
 *   (`resolveShuffleOptions`), numeric and open have no options.
 */
export function questionSettingApplies(question: QuestionConfig, path: string): boolean {
	if (OPEN_ONLY.has(path) && question.type !== 'open') return false;
	if (path === 'ai_guided') return question.ai_evaluation === true;
	if (path === 'ai_guided_attempts')
		return question.ai_evaluation === true && question.ai_guided === true;
	if (path === 'shuffle_options') return question.type === 'multiple_choice';
	return true;
}
