/**
 * The `dialogs` region: what is open over the editor and what it says. Each dialog's
 * content is built here, only while it is open: the repair dialog (`repair.ts`), the
 * question type change with what it would throw away, and „Zařadit do lekce“. The
 * settings dialogs and the two review dialogs follow in their own builders.
 */
import { planQuestionTypeChange, type QuestionTypeLoss } from '$lib/domain/commands';
import { lessonLabel } from '$lib/domain/naming';
import { answersCount } from '$lib/ui/plural';
import { buildExport } from './export';
import { buildRepair } from './repair';
import { buildVersions } from './versions';
import { buildCardSettings, buildCourseSettings, buildLessonSettings } from './settings';
import type { AssignLessonView, DialogsRegion, ScreenInput, TypeChangeView } from './types';

/** What switching a question's type would do, as the confirmation says it. */
export function typeChangeMessage(loss: QuestionTypeLoss): string {
	const parts: string[] = [];
	if (loss.answers > 0) {
		const extras: string[] = [];
		if (loss.withFeedback > 0) extras.push(`${loss.withFeedback} s vysvětlením pro žáka`);
		if (loss.withBranching > 0) extras.push(`${loss.withBranching} s větvením na jiný krok`);
		const suffix = extras.length > 0 ? ` (z toho ${extras.join(', ')})` : '';
		parts.push(`smaže ${answersCount(loss.answers)}${suffix}`);
	}
	if (loss.correctAnswer !== undefined) {
		parts.push(`smaže zadanou správnou odpověď „${loss.correctAnswer}“`);
	}
	if (loss.correctNumber !== undefined) {
		parts.push(`smaže zadaný správný výsledek ${loss.correctNumber}`);
	}
	return `Tato změna ${parts.join(' a ')}. Zpět se dá vrátit tlačítkem Zpět v liště.`;
}

function typeChange(input: ScreenInput): TypeChangeView | null {
	const dialog = input.ui.dialog;
	if (dialog === null || dialog.kind !== 'type_change') return null;
	const step = input.doc.blocks
		.find((b) => b.block_id === dialog.blockId)
		?.steps.find((s) => s.id === dialog.stepId);
	const loss = planQuestionTypeChange(step?.question, dialog.type);
	if (loss === null) return null;
	return { title: 'Změnit typ otázky?', message: typeChangeMessage(loss) };
}

function assignLesson(input: ScreenInput): AssignLessonView | null {
	const dialog = input.ui.dialog;
	if (dialog === null || dialog.kind !== 'assign_lesson') return null;
	const lessons = input.doc.lessons
		.filter((l) => !l.blocks.some((b) => b.block_id === dialog.blockId))
		.map((l) => ({ value: l.lesson_id, label: lessonLabel(input.doc, l) }));
	return {
		lessons,
		chosen: dialog.lessonId,
		can_assign: lessons.some((l) => l.value === dialog.lessonId)
	};
}

export function buildDialogs(input: ScreenInput): DialogsRegion {
	return {
		open: input.ui.dialog?.kind ?? null,
		export_review: buildExport(input),
		versions: buildVersions(input),
		course_settings: buildCourseSettings(input),
		lesson_settings: buildLessonSettings(input),
		card_settings: buildCardSettings(input),
		repair: buildRepair(input),
		type_change: typeChange(input),
		assign_lesson: assignLesson(input)
	};
}
