/**
 * Whether the app tells the pupil how an answer came out (OPEN-PROBLEMS #25).
 *
 * A `quiz_v2` course without `quiz_evaluate: true` is a test with the marking hidden:
 * `lesson_detail_page.dart` passes `hideEvaluation: exportMode == quizV2 &&
 * !course.quizEvaluate` (and `quiz_page.dart` `hideEvaluation: !widget.evaluate`) to
 * `BlockStepEngine`, which then
 *  - lands on `showingStep`, never `showingSolution` (`_deriveState`),
 *  - skips the solution pause for every answer (`_shouldSkipSolutionFor`, "shows
 *    nothing at all, feedback included"),
 *  - hands `hideFeedback` and `hideResults` to `StepContentRenderer`, which drops the
 *    solution text and image, the picked option's feedback, and the right/wrong
 *    highlighting (`showSolution`/`hideFeedback`, `hideResults` in
 *    `step_content_renderer.dart`).
 * The hint and help stay (`_buildStepActionButtons` keeps the hint button in quiz mode).
 *
 * Every other course type shows it, whatever `quiz_evaluate` says.
 */
import type { CourseV2 } from './schema';

export function appShowsFeedback(doc: Pick<CourseV2, 'export_type' | 'quiz_evaluate'>): boolean {
	return doc.export_type !== 'quiz_v2' || doc.quiz_evaluate === true;
}

/**
 * The fields (`level.path`, as `ui/fields.ts` names them) the app never reads in a
 * course that shows no evaluation: the solution and the per-option explanation, and the
 * two switches that only decide whether the pupil is shown them. Their values stay in
 * the file; the teacher is simply not asked.
 */
export const EVALUATION_ONLY_FIELDS: readonly string[] = [
	'question.solution',
	'question.solution_image',
	'question.show_solution',
	'question.show_answers',
	'option.feedback',
	'option.feedback_image'
];

/** Whether the app reads `level.path` of this course (false: do not ask the teacher). */
export function appReadsField(
	doc: Pick<CourseV2, 'export_type' | 'quiz_evaluate'>,
	level: string,
	path: string
): boolean {
	if (appShowsFeedback(doc)) return true;
	return !EVALUATION_ONLY_FIELDS.some((key) => key === `${level}.${path}`);
}
