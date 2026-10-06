/**
 * The `tree` region: the course as the Sidebar and its rail show it — lessons, the
 * cards in each, the cards that no lesson holds, and the totals.
 *
 * Names come from the one naming rule (`domain/naming.ts`), counts from the totals the
 * app would show (`domain/derive.ts`), and the error markers from what may be shown
 * inline right now (`issues.ts`), not from everything `validate()` found: a card
 * nobody has left yet is being written, not broken.
 */
import { courseTotals, lessonTotals, positionName } from '$lib/domain/derive';
import { groupOf, groupsOf } from '$lib/domain/groups';
import { cardLabel, lessonLabel, partLabel } from '$lib/domain/naming';
import type { BlockV2, LessonV2 } from '$lib/domain/schema';
import { CARD_TYPE_LABELS } from '$lib/ui/card-type-labels';
import { uniqueKeys } from '$lib/ui/keys';
import { cardsCount, errorsCount, stepsCount } from '$lib/ui/plural';
import { issueSets } from './issues';
import type { ScreenInput, TreeCard, TreeJoin, TreeLesson, TreeOrphan, TreeRegion } from './types';

export function buildTree(input: ScreenInput): TreeRegion {
	const { doc, index, open } = input;
	const { shown } = issueSets(input.validation, input.showFeedback, input.touched, input.reviewed);
	const blocksById = new Map<string, BlockV2>();
	for (const block of doc.blocks)
		if (!blocksById.has(block.block_id)) blocksById.set(block.block_id, block);

	const errorsInLesson = (lessonId: string) =>
		shown.errors.filter(
			(issue) =>
				issue.ref.lessonId === lessonId ||
				(issue.ref.blockId !== undefined &&
					(index.lessonsByBlock.get(issue.ref.blockId) ?? []).includes(lessonId))
		).length;
	const errorsOnCard = (blockId: string) =>
		shown.errors.filter((issue) => issue.ref.blockId === blockId).length;

	// In Pokročilý the tree shows the blocks the course is exported as, where one
	// teacher's card may be several (`domain/groups.ts`). Each says which part of its
	// card it is; in the other modes a card is one entry and says nothing.
	const groups = groupsOf(doc);
	const partOf = (block: BlockV2): string | null => {
		const key = groupOf(block);
		const members = key === undefined ? undefined : groups.get(key);
		if (members === undefined || members.length < 2) return null;
		return partLabel(members.indexOf(block), members.length);
	};

	const cardsOf = (lesson: LessonV2, lessonOpen: boolean): TreeCard[] => {
		const keys = uniqueKeys(lesson.blocks.map((b) => b.block_id));
		const groupAt = (i: number): string | undefined => {
			const block = blocksById.get(lesson.blocks[i]?.block_id ?? '');
			return block === undefined ? undefined : groupOf(block);
		};
		// A thin line joins the parts of one card. Only neighbours in the same lesson
		// are joined, so a line never jumps over a card that is not a part.
		const joinAt = (i: number): TreeJoin | null => {
			const key = groupAt(i);
			if (key === undefined) return null;
			const before = i > 0 && groupAt(i - 1) === key;
			const after = groupAt(i + 1) === key;
			if (before && after) return 'middle';
			if (after) return 'first';
			if (before) return 'last';
			return null;
		};
		return lesson.blocks.map((binding, i): TreeCard => {
			const block = blocksById.get(binding.block_id);
			const n = i + 1;
			if (block === undefined) {
				return {
					key: keys[i],
					missing: true,
					block_id: binding.block_id,
					position: n,
					type: null,
					type_label: '',
					name: 'Chybějící karta',
					name_rail: 'Chybějící karta',
					name_peek: 'Chybějící karta',
					steps_text: '',
					part: null,
					join: null,
					errors: 0,
					errors_text: null,
					selected: false,
					rail_label: 'Chybějící karta',
					peek_overline: '',
					peek_label: positionName(n)
				};
			}
			const errors = errorsOnCard(block.block_id);
			const part = partOf(block);
			const typeLabel = CARD_TYPE_LABELS[block.type];
			const label = (max: number) => cardLabel(doc, block, { lessonId: lesson.lesson_id, max });
			return {
				key: keys[i],
				missing: false,
				block_id: block.block_id,
				position: n,
				type: block.type,
				type_label: typeLabel,
				name: label(44),
				name_rail: label(60),
				name_peek: label(120),
				steps_text: part ?? stepsCount(block.steps.length),
				part,
				join: joinAt(i),
				errors,
				errors_text: errors > 0 ? errorsCount(errors) : null,
				selected: lessonOpen && block.block_id === open.card?.block_id,
				rail_label: `${n}. ${typeLabel}: ${label(60)}${errors > 0 ? `, ${errorsCount(errors)}` : ''}`,
				peek_overline: `${n} · ${typeLabel}`,
				peek_label: positionName(n)
			};
		});
	};

	const lessonKeys = uniqueKeys(doc.lessons.map((l) => l.lesson_id));
	const lessons = doc.lessons.map((lesson, i): TreeLesson => {
		const lessonOpen = lesson.lesson_id === open.lesson?.lesson_id;
		const totals = lessonTotals(lesson, index);
		const errors = errorsInLesson(lesson.lesson_id);
		const name = lessonLabel(doc, lesson);
		return {
			key: lessonKeys[i],
			lesson_id: lesson.lesson_id,
			index: i + 1,
			name,
			open: lessonOpen,
			counts: {
				cards: totals.cardCount,
				blocks: totals.blockCount,
				minutes: totals.durationMinutes,
				xp: totals.xp,
				duration_estimated: totals.durationEstimated
			},
			summary: `${cardsCount(totals.cardCount)} · ${totals.durationMinutes} min · ${totals.xp} XP`,
			errors,
			errors_text: errors > 0 ? errorsCount(errors) : null,
			rail_label: `${i + 1}. lekce: ${name}`,
			peek_label: `Lekce ${i + 1}`,
			peek_overline: `${i + 1}. lekce`,
			cards: cardsOf(lesson, lessonOpen)
		};
	});

	const orphans = doc.blocks.filter(
		(b) => (index.lessonsByBlock.get(b.block_id) ?? []).length === 0
	);
	const orphanKeys = uniqueKeys(orphans.map((b) => b.block_id));
	const totals = courseTotals(doc, index);
	return {
		course: { name: doc.name || 'Nový kurz' },
		lessons,
		orphans: orphans.map((block, i): TreeOrphan => ({
			key: orphanKeys[i],
			block_id: block.block_id,
			type: block.type,
			name: cardLabel(doc, block, { max: 44 }),
			note: 'žák se k ní nedostane',
			selected: block.block_id === open.card?.block_id
		})),
		orphans_heading: orphans.length > 0 ? 'Karty mimo lekce' : null,
		footer: {
			duration: `${totals.durationMinutes} min`,
			duration_title: 'Součet přes celý kurz',
			xp: `${totals.cappedXp} XP`,
			xp_title: doc.max_xp ? `Strop kurzu je ${doc.max_xp} XP` : 'Bez stropu'
		}
	};
}
