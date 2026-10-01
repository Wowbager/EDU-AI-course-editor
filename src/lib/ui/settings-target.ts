import type { Ref } from '$lib/domain/ref';
import type { DocStore } from '$lib/state/doc-store.svelte';
import { specOf, type FieldLevel } from './fields';

/**
 * Whether the selection, or an issue the author can see, points at a field of one
 * section of a settings dialog. Such a section opens by itself: a jump from the
 * preview's question mark or from the review must land on the field, not on a fold.
 *
 * `scope` is the thing the dialog is about (`{ blockId }`, `{ lessonId }`, `{}` for
 * the course): every id it names must be the ref's own, and the field's level decides
 * the rest, so a step's hint is never taken for its card's.
 */
export function sectionTargeted(
	store: Pick<DocStore, 'selection' | 'shown'>,
	levels: readonly FieldLevel[],
	section: string,
	scope: Ref
): boolean {
	const refs: Ref[] = [
		...(store.selection === null ? [] : [store.selection]),
		...store.shown.errors.map((issue) => issue.ref),
		...store.shown.warnings.map((issue) => issue.ref)
	];
	return refs.some((ref) => pointsInto(ref, levels, section, scope));
}

/**
 * Whether an issue the author can see is about a field of this section — the dot
 * beside its name in the dialog's list. The selection alone is not a problem.
 */
export function sectionHasIssue(
	store: Pick<DocStore, 'shown'>,
	levels: readonly FieldLevel[],
	section: string,
	scope: Ref
): boolean {
	return [...store.shown.errors, ...store.shown.warnings].some((issue) =>
		pointsInto(issue.ref, levels, section, scope)
	);
}

function pointsInto(ref: Ref, levels: readonly FieldLevel[], section: string, scope: Ref): boolean {
	for (const key of ['lessonId', 'blockId', 'stepId', 'optionId'] as const) {
		if (scope[key] !== undefined && ref[key] !== scope[key]) return false;
	}
	const spec = specOf(ref);
	return spec !== undefined && levels.includes(spec.level) && spec.section === section;
}
