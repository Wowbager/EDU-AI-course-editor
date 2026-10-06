/**
 * When a validation issue is allowed to show up inline.
 *
 * `validate()` says what is wrong; this says when it is worth saying so. Most errors
 * on a draft mean "not written yet" — an empty text, no correct answer marked — and
 * painting those red while the teacher is still typing turns every new card into a
 * wall of complaints before they have done anything wrong. So each code has a
 * timing:
 *
 *  - `immediate` a real contradiction the author just caused (a YouTube link in a
 *                video field, a branch to a step that is gone). The context is fresh,
 *                so it is shown at once.
 *  - `onLeave`   unfinished content. Silent until the author has left the field or
 *                the card it belongs to — then it is plainly something they skipped.
 *  - `review`    didactic advice. Never shown while editing; it is listed in the
 *                export review, and inline only once a review has happened.
 *
 * Once the author has looked at the export review, what that review listed is shown
 * (`reviewed`, the keys of those issues): they are now fixing, not writing. An issue
 * that comes up afterwards, on a card they have just added, keeps its own timing.
 * A fourth case sits beside the three: a thing the author's own change has just
 * stopped reaching. `W_UNREACHABLE_STEP` and `W_ORPHAN_BLOCK` stay `review` — listed
 * in the export review and never nagging while a card is built — but the answer table
 * says so once, under the answer that was changed, right after the change
 * (`madeUnreachable`), and says nothing on the next edit. It is the same check as the
 * review's, run on the document before and after, so there is no second rule.
 * None of this touches severity — errors still block the
 * file whether or not they are on screen (§3 invariant 5), and the export review
 * and validation panel always list every issue.
 */
import type { Ref } from '$lib/domain/ref';
import type { CourseV2 } from '$lib/domain/schema';
import { validate, type Issue } from '$lib/domain/validate';
import { isFeedbackRef } from '$lib/ui/fields';

export type Timing = 'immediate' | 'onLeave' | 'review';

export const TIMING: Record<string, Timing> = {
	// Identity and references — nothing the author can "still be writing".
	E_DUPLICATE_LESSON_ID: 'immediate',
	E_DUPLICATE_BLOCK_ID: 'immediate',
	E_DUPLICATE_STEP_ID: 'immediate',
	W_DUPLICATE_OPTION_ID: 'immediate',
	E_BINDING_UNRESOLVED: 'immediate',
	E_GOTO_UNRESOLVED: 'immediate',
	W_GOTO_IN_EXERCISE: 'immediate',
	E_PREREQ_UNRESOLVED: 'immediate',
	E_PREREQ_CYCLE: 'immediate',
	// A value that is present and wrong.
	E_MEDIA_NOT_DIRECT: 'immediate',
	// A value that is present and is not a number: only a damaged import has one.
	E_NOT_A_NUMBER: 'immediate',
	// Text the author is typing into a field no student will ever read — said while
	// it is typed, like a YouTube link in the video field, not at export.
	W_HINT_UNREACHABLE: 'immediate',
	E_MEDIA_NOT_HTTPS: 'immediate',
	E_VECTOR_LENGTH: 'immediate',
	E_RELATION_VECTOR_VALUE: 'immediate',
	E_ELO_VECTOR_RANGE: 'immediate',

	// Something not written yet.
	E_DISPLAY_NO_TEXT: 'onLeave',
	E_QUESTION_NO_QUESTION_STEP: 'onLeave',
	E_QUESTION_STEP_NO_CONFIG: 'onLeave',
	E_OPEN_NO_CORRECT_ANSWER: 'onLeave',
	E_NUMERIC_NO_CORRECT_NUMBER: 'onLeave',
	E_TF_OPTION_COUNT: 'onLeave',
	E_TF_CORRECT_COUNT: 'onLeave',
	E_MC_TOO_FEW_OPTIONS: 'onLeave',
	E_MC_NO_CORRECT: 'onLeave',
	E_MC_EMPTY_OPTION_TEXT: 'onLeave',
	E_IMAGE_NO_URL: 'onLeave',
	E_VIDEO_NO_URL: 'onLeave',
	E_AUDIO_NO_URL: 'onLeave',

	// Advice.
	W_LESSON_TOO_LONG: 'review',
	W_EMPTY_LESSON: 'review',
	W_PARTIAL_DURATION: 'review',
	W_BLOCK_TOO_MANY_STEPS: 'review',
	W_ORPHAN_BLOCK: 'review',
	W_UNREACHABLE_STEP: 'review',
	W_NO_WRONG_OPTION_FEEDBACK: 'review',
	W_PARTIAL_CREDIT_ON_WRONG: 'review',
	W_OPTION_OUTCOMES_IGNORED: 'review',
	W_IMAGE_NO_ALT: 'review',
	W_TOO_MANY_STRONG_RELATIONS: 'review',
	W_RELATION_VECTOR_ALL_ZERO: 'review',
	W_ELO_OUTLIER: 'review',
	W_PREREQ_MIN_LEVEL_HIGH: 'review',
	W_VERSION_NOT_BUMPED: 'review',
	W_ONLY_ONCE_WITH_PRACTICE: 'review'
};

/** A code nobody classified still surfaces: an error once left, a warning in review. */
export function timingOf(issue: Pick<Issue, 'code' | 'severity'>): Timing {
	return TIMING[issue.code] ?? (issue.severity === 'error' ? 'onLeave' : 'review');
}

/**
 * Warnings whose only fix is a feedback field, though their ref does not say so
 * (`W_NO_WRONG_OPTION_FEEDBACK` points at the option list). While the Zpětná vazba
 * toggle hides those fields, these are held back too, as is any warning whose ref
 * is a feedback field (`heldBack`).
 */
export const HELD_WITH_FEEDBACK: ReadonlySet<string> = new Set([
	'W_HINT_UNREACHABLE',
	'W_NO_WRONG_OPTION_FEEDBACK'
]);

/**
 * Whether an issue is left out of the topbar count, the validation panel and the
 * inline markers because the field that fixes it is hidden. Only warnings: an error
 * blocks the file, and a teacher must be told whether or not the field is on screen.
 * The export review and the banner read the full `validation`.
 */
export function heldBack(
	issue: Pick<Issue, 'code' | 'severity' | 'ref'>,
	feedbackVisible: boolean
): boolean {
	if (feedbackVisible || issue.severity !== 'warning') return false;
	return HELD_WITH_FEEDBACK.has(issue.code) || isFeedbackRef(issue.ref);
}

/** What the author has finished with: whole cards they left, single fields they left. */
export interface Touched {
	cards: ReadonlySet<string>;
	fields: ReadonlySet<string>;
}

/** The identity of a field for `Touched.fields` — every part of the ref, in order. */
export const fieldKey = (ref: Ref): string =>
	[ref.lessonId, ref.blockId, ref.stepId, ref.optionId, ref.field].map((p) => p ?? '').join('|');

/**
 * The identity of an issue across edits: what it is and where. Its message is not
 * part of it, since a message can carry a count that changes while the problem stays.
 */
export const issueKey = (issue: Pick<Issue, 'code' | 'ref'>): string =>
	`${issue.code}|${fieldKey(issue.ref)}`;

/**
 * Whether an issue may be on screen. `reviewed` holds the keys of the issues the
 * export review listed when it was opened, or is `null` while no review is pending.
 */
export function isVisible(
	issue: Issue,
	touched: Touched,
	reviewed: ReadonlySet<string> | null
): boolean {
	if (reviewed?.has(issueKey(issue))) return true;
	switch (timingOf(issue)) {
		case 'immediate':
			return true;
		case 'review':
			return false;
		case 'onLeave': {
			const { blockId } = issue.ref;
			if (blockId !== undefined && touched.cards.has(blockId)) return true;
			return touched.fields.has(fieldKey(issue.ref));
		}
	}
}

/** The warnings that say "nothing leads here": a step no path reaches, a card no one links to. */
export const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
	'W_UNREACHABLE_STEP',
	'W_ORPHAN_BLOCK'
]);

/**
 * What the change from `before` to `after` made unreachable: the "nothing leads here"
 * warnings of `after` that `before` did not have, in document order. Something that
 * was already unreachable is not new, and something that became reachable is not
 * listed. Both are `validate()`'s own findings, so the rule is the review's.
 */
export function madeUnreachable(before: CourseV2, after: CourseV2): Issue[] {
	const was = new Set(
		validate(before)
			.warnings.filter((i) => UNREACHABLE_CODES.has(i.code))
			.map(issueKey)
	);
	return validate(after).warnings.filter(
		(i) => UNREACHABLE_CODES.has(i.code) && !was.has(issueKey(i))
	);
}
