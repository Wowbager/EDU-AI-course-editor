/**
 * Validation issues arranged the way a teacher looks for them: by the card (or
 * lesson, or the course itself) they are about, in the order those appear.
 *
 * The export review lists every problem at once, so a flat list of thirty messages
 * would be the same wall of red the inline markers were moved away from. Grouped,
 * it reads as "these four cards need finishing", and each row only has to say
 * which step or answer inside the card it means.
 *
 * Nothing here decides severity — that is `validate.ts`, and errors still block
 * export whatever this module does with them (§3 invariant 5).
 */
import type { CourseV2 } from './schema';
import type { DocIndex } from './index-doc';
import type { Ref } from './ref';
import type { Issue } from './validate';
import { blockLabel, capitalize, lessonLabelById, optionLabelById, stepLabel } from './naming';

export interface IssueRow {
	issue: Issue;
	/** Step and answer inside the group, e.g. "Krok 2 › „Čitatel je 5“"; empty for the group itself. */
	detail: string;
	/** Where "Přejít" lands — the issue's ref, with the lesson that shows it filled in. */
	target: Ref;
}

export interface IssueGroup {
	key: string;
	kind: 'course' | 'lesson' | 'card';
	title: string;
	/** For a card: the lesson it is in, or that it is in none. */
	context?: string;
	rows: IssueRow[];
}

/**
 * The lesson an issue should be shown in. A ref carrying a block addresses the
 * block definition, which can be bound to several lessons or to none; the first
 * lesson that binds it is where the editor can actually open it.
 */
export function issueLessonId(index: DocIndex, ref: Ref): string | undefined {
	if (ref.lessonId !== undefined) return ref.lessonId;
	if (ref.blockId === undefined) return undefined;
	return index.lessonsByBlock.get(ref.blockId)?.[0];
}

/** "Krok 2 › „odpověď“" — the part of a ref below the card. */
function detailOf(doc: CourseV2, ref: Ref): string {
	const block = ref.blockId !== undefined ? doc.blocks.find((b) => b.block_id === ref.blockId) : undefined;
	const step = block !== undefined && ref.stepId !== undefined
		? block.steps.find((s) => s.id === ref.stepId)
		: undefined;
	const parts: string[] = [];
	if (ref.stepId !== undefined) {
		parts.push(block !== undefined && step !== undefined ? capitalize(stepLabel(block, step)) : ref.stepId);
	}
	if (ref.optionId !== undefined) {
		parts.push(optionLabelById(step?.question, ref.optionId, { max: 30 }) ?? `odpověď ${ref.optionId}`);
	}
	return parts.join(' › ');
}

/**
 * Full breadcrumb — lesson › card › step › answer. Ids appear only where nothing in
 * the document resolves (a dangling reference), because then the id is the only
 * thing left to name it by.
 */
export function issuePlace(doc: CourseV2, ref: Ref): string {
	const { lessonId, blockId } = ref;
	const block = blockId !== undefined ? doc.blocks.find((b) => b.block_id === blockId) : undefined;
	const parts: string[] = [];
	if (lessonId !== undefined) parts.push(lessonLabelById(doc, lessonId) ?? lessonId);
	if (blockId !== undefined) {
		parts.push(block !== undefined ? blockLabel(doc, block, { lessonId, max: 30 }) : blockId);
	}
	const detail = detailOf(doc, ref);
	if (detail !== '') parts.push(detail);
	return parts.length === 0 ? 'kurz' : parts.join(' › ');
}

export function groupIssues(doc: CourseV2, index: DocIndex, issues: readonly Issue[]): IssueGroup[] {
	const groups = new Map<string, IssueGroup>();

	for (const issue of issues) {
		const { ref } = issue;
		const lessonId = issueLessonId(index, ref);
		const target: Ref = { ...ref, lessonId };

		let key: string;
		let make: () => IssueGroup;
		if (ref.blockId !== undefined) {
			key = `card:${ref.blockId}`;
			const block = doc.blocks.find((b) => b.block_id === ref.blockId);
			make = () => ({
				key,
				kind: 'card',
				title: block !== undefined ? blockLabel(doc, block, { lessonId, max: 50 }) : ref.blockId!,
				context: lessonId !== undefined
					? (lessonLabelById(doc, lessonId) ?? lessonId)
					: block !== undefined ? 'mimo lekce' : undefined,
				rows: []
			});
		} else if (ref.lessonId !== undefined) {
			key = `lesson:${ref.lessonId}`;
			make = () => ({
				key,
				kind: 'lesson',
				title: lessonLabelById(doc, ref.lessonId!) ?? ref.lessonId!,
				rows: []
			});
		} else {
			key = 'course';
			make = () => ({ key, kind: 'course', title: 'Celý kurz', rows: [] });
		}

		let group = groups.get(key);
		if (group === undefined) {
			group = make();
			groups.set(key, group);
		}
		group.rows.push({ issue, detail: detailOf(doc, ref), target });
	}

	return [...groups.values()];
}
