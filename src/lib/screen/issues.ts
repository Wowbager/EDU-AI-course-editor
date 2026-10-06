/**
 * Which issues the editor lists and shows, and the `issues` region.
 *
 * `issueSets` is the one place the three questions are answered — what `validate()`
 * found, what the top bar and the panel list (every error, and the warnings not held
 * back by the Zpětná vazba toggle), what may be marked inline now (listed, and then
 * only once its timing allows, `ui/issue-visibility.ts`). `DocStore.listed` and
 * `DocStore.shown` are this, and so is every `visibility` the model reports.
 */
import type { Ref } from '$lib/domain/ref';
import type { Issue, ValidationResult } from '$lib/domain/validate';
import { issueLessonId, issuePlace } from '$lib/domain/issue-groups';
import { heldBack, isVisible, type Touched } from '$lib/ui/issue-visibility';
import { plural } from '$lib/ui/plural';
import { uniqueKeys } from '$lib/ui/keys';
import type { IssueItem, IssuesRegion, ScreenInput, SkillConfigStatus } from './types';

export interface IssueSets {
	listed: { errors: Issue[]; warnings: Issue[] };
	shown: { errors: Issue[]; warnings: Issue[] };
}

export function issueSets(
	validation: ValidationResult,
	showFeedback: boolean,
	touched: Touched,
	reviewed: ReadonlySet<string> | null
): IssueSets {
	const listed = {
		errors: validation.errors,
		warnings: validation.warnings.filter((issue) => !heldBack(issue, showFeedback))
	};
	const visible = (issue: Issue) => isVisible(issue, touched, reviewed);
	return {
		listed,
		shown: { errors: listed.errors.filter(visible), warnings: listed.warnings.filter(visible) }
	};
}

/**
 * Whether an issue addressed at `at` is about `ref`: every id `ref` names must be the
 * issue's own, and it must name at least one. A ref of just a card matches everything
 * in the card; one with a step, only that step's.
 */
export function matchesRef(at: Ref, ref: Ref): boolean {
	let matched = false;
	for (const key of ['lessonId', 'blockId', 'stepId', 'optionId', 'field'] as const) {
		if (!ref[key]) continue;
		if (ref[key] !== at[key]) return false;
		matched = true;
	}
	return matched;
}

/** What may be marked inline at `ref` now, as the shown issues of the place. */
export function shownAt(
	shown: { errors: Issue[]; warnings: Issue[] },
	ref: Ref
): { errors: Issue[]; warnings: Issue[] } {
	return {
		errors: shown.errors.filter((issue) => matchesRef(issue.ref, ref)),
		warnings: shown.warnings.filter((issue) => matchesRef(issue.ref, ref))
	};
}

/** The identity the validation panel dismisses an issue by. */
export const panelKey = (issue: Pick<Issue, 'code' | 'ref'>): string =>
	`${issue.code}|${JSON.stringify(issue.ref)}`;

/** What `validate()` leaves unchecked while the skill list is not known, said once. */
export function skippedChecks(status: SkillConfigStatus): string | null {
	if (status === 'loading') return 'Dovednosti se načítají — vektory se zatím nekontrolují.';
	if (status === 'failed') {
		return 'Seznam dovedností se nepodařilo načíst — vektory se nekontrolují.';
	}
	return null;
}

export function buildIssues(input: ScreenInput): IssuesRegion {
	const { validation } = input;
	const sets = issueSets(validation, input.showFeedback, input.touched, input.reviewed);
	const shown = new Set<Issue>([...sets.shown.errors, ...sets.shown.warnings]);
	const listed = new Set<Issue>([...sets.listed.errors, ...sets.listed.warnings]);

	const all = [...validation.errors, ...validation.warnings];
	const keys = uniqueKeys(all.map(panelKey));
	const items = new Map<Issue, IssueItem>();
	all.forEach((issue, i) => {
		items.set(issue, {
			key: keys[i],
			code: issue.code,
			severity: issue.severity,
			message: issue.message,
			where: issuePlace(input.doc, issue.ref),
			visibility: shown.has(issue) ? 'shown' : listed.has(issue) ? 'pending_timing' : 'held_back',
			ref: issue.ref,
			target: { ...issue.ref, lessonId: issueLessonId(input.index, issue.ref) }
		});
	});
	const item = (issue: Issue) => items.get(issue)!;

	const dismissed = input.ui.dismissedIssues;
	const errors = sets.listed.errors.map(item);
	const warnings = sets.listed.warnings.filter((w) => !dismissed.has(panelKey(w))).map(item);
	const held = validation.warnings.filter(
		(w) => heldBack(w, input.showFeedback) && !dismissed.has(panelKey(w))
	).length;

	return {
		counts: {
			errors: validation.errors.length,
			warnings: validation.warnings.length,
			listed_errors: sets.listed.errors.length,
			listed_warnings: sets.listed.warnings.length,
			held_back: validation.warnings.length - sets.listed.warnings.length
		},
		items: all.map(item),
		skipped_checks: skippedChecks(input.skillConfigStatus),
		panel: {
			open: input.ui.validationOpen,
			clean: errors.length === 0 && warnings.length === 0,
			clean_text: 'Kurz je v pořádku. Můžeš publikovat.',
			errors_heading: errors.length > 0 ? `Chyby — brání publikaci (${errors.length})` : null,
			errors,
			warnings_heading:
				warnings.length > 0 ? `Upozornění — publikaci nebrání (${warnings.length})` : null,
			warnings,
			held_text:
				held > 0
					? `${plural(held, 'Skryto', 'Skryta', 'Skryto')} ${held} doporučení ke zpětné vazbě.`
					: null
		}
	};
}
