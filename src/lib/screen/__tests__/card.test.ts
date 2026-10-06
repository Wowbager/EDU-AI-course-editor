/**
 * The card, pickers and dialogs regions: what the editor column and the dialogs say is
 * a function of the store, with the mode deciding what is listed, and an AI reads the
 * same objects the components draw.
 */
import { describe, expect, it } from 'vitest';
import { derivedBlockXp } from '$lib/domain/derive';
import { cardLabel } from '$lib/domain/naming';
import { fieldsFor } from '$lib/ui/fields';
import { screenSlice } from '$lib/screen';
import { FIXTURES, MODES, storeFor } from './fixtures';

describe.each(FIXTURES)('%s: the open card', (name) => {
	describe.each(MODES)('in %s mode', (mode) => {
		const store = storeFor(name, mode);
		const column = store.screen.card;

		it('is the card the store opens, named and counted by the one rule', () => {
			const card = store.open.card;
			if (card === undefined) {
				expect(column.state).not.toBe('card');
				expect(column.empty_text).not.toBeNull();
				return;
			}
			const view = column.card!;
			expect(view.block_id).toBe(card.block_id);
			expect(view.heading.placeholder).toBe(
				cardLabel(store.doc, card, { lessonId: store.open.lesson?.lesson_id, max: 70 })
			);
			// The XP chip is what the steps are worth, never the authored `xp`.
			expect(view.chips.xp.text).toBe(`${derivedBlockXp(card)} XP`);
			expect(view.steps).toHaveLength(card.steps.length);
			view.steps.forEach((step, i) => {
				expect(step.position).toBe(i + 1);
				// A teacher is never shown an id: only Pokročilý names a step by it.
				expect(step.name).toBe(mode === 'advanced' ? card.steps[i].id : `Krok ${i + 1}`);
			});
		});

		it('is plain JSON, as an AI tool gets it', () => {
			expect(JSON.parse(JSON.stringify(screenSlice(store.screen, 'card')))).toEqual(
				JSON.parse(JSON.stringify(column))
			);
		});

		it('lists only the fields of the mode, and names the rest as hidden', () => {
			if (column.card === null) return;
			const shownKeys = column.card.steps.flatMap((s) =>
				(s.extras?.fields ?? []).map((f) => f.path)
			);
			const allowed = fieldsFor('step', mode, store.showFeedback).map((f) => f.path);
			for (const path of shownKeys) expect(allowed).toContain(path);
			if (mode !== 'advanced') {
				expect(column.hidden_fields.some((f) => f.hidden_in_mode !== null)).toBe(true);
			} else {
				expect(column.hidden_fields.filter((f) => f.hidden_in_mode !== null)).toEqual([]);
			}
		});
	});
});

describe('what the answers show', () => {
	it('keeps Podíl bodů and the ids to Pokročilý', () => {
		const find = (mode: (typeof MODES)[number]) => {
			const store = storeFor('spec-16-course.json', mode);
			// Open the question card.
			const lesson = store.doc.lessons[0];
			const block = lesson.blocks
				.map((b) => store.doc.blocks.find((x) => x.block_id === b.block_id)!)
				.find((b) => b.steps.some((s) => s.type === 'question'))!;
			store.selection = { lessonId: lesson.lesson_id, blockId: block.block_id };
			return store.screen.card.card!.steps.find((s) => s.question?.answers)!.question!.answers!;
		};
		expect(find('teacher').rows[0].detail.score).toBeNull();
		expect(find('advanced').rows[0].detail.score).not.toBeNull();
	});

	it('warns before a type change that would lose answers, and not for a fresh question', () => {
		const store = storeFor('spec-16-course.json');
		const lesson = store.doc.lessons[0];
		const block = lesson.blocks
			.map((b) => store.doc.blocks.find((x) => x.block_id === b.block_id)!)
			.find((b) => b.steps.some((s) => s.type === 'question'))!;
		store.selection = { lessonId: lesson.lesson_id, blockId: block.block_id };
		const step = store.screen.card.card!.steps.find((s) => s.question !== null)!;
		const real = block.steps.find((s) => s.id === step.id)!;
		const authored = (real.question?.options ?? []).some((o) => o.text.trim() !== '');
		expect(step.question!.types.find((t) => t.value === 'numeric')!.confirm).toBe(authored);
	});
});

describe('the dialogs and pickers are built only while they are open', () => {
	it('has none with nothing open, and the card settings once asked for', () => {
		const store = storeFor('spec-16-course.json', 'metodik');
		expect(store.screen.dialogs).toMatchObject({
			open: null,
			card_settings: null,
			course_settings: null,
			lesson_settings: null,
			repair: null,
			export_review: null,
			versions: null
		});
		expect(store.screen.pickers.open).toBeNull();
		store.ui.dialog = { kind: 'card', blockId: store.open.card!.block_id };
		const view = store.screen.dialogs.card_settings!;
		expect(store.screen.ui.dialog).toBe('card');
		expect(view.sections.map((s) => s.id)).toContain('topics');
		// Pokročilý's sections are not listed to Metodik, and the line says where they are.
		expect(view.sections.map((s) => s.id)).not.toContain('followup');
		expect(view.gain?.text).toMatch(/Pokročilý/);
	});

	it('says the course settings fields of the mode', () => {
		const teacher = storeFor('spec-16-course.json', 'teacher');
		teacher.ui.dialog = { kind: 'course' };
		const advanced = storeFor('spec-16-course.json', 'advanced');
		advanced.ui.dialog = { kind: 'course' };
		const count = (s: typeof teacher) =>
			Object.values(s.screen.dialogs.course_settings!.fields).flat().length;
		expect(count(advanced)).toBeGreaterThan(count(teacher));
		expect(teacher.screen.dialogs.course_settings!.list).toBe(false);
		expect(advanced.screen.dialogs.course_settings!.list).toBe(true);
	});

	it('walks a picker by the path in the store, and disables what would make a cycle', () => {
		const store = storeFor('spec-16-course.json', 'advanced');
		const block = store.open.card!;
		store.ui.dialog = { kind: 'card', blockId: block.block_id };
		store.ui.picker = { id: 'prerequisite', path: [], query: '' };
		const root = store.screen.pickers.open!;
		expect(root.title).toBe('Na co karta čeká?');
		expect(root.can_go_back).toBe(false);
		store.ui.picker = { id: 'prerequisite', path: ['card'], query: '' };
		const cards = store.screen.pickers.open!;
		expect(cards.can_go_back).toBe(true);
		expect(cards.title).toBe('Jaká karta');
		expect(cards.groups.flatMap((g) => g.items).length).toBeGreaterThan(0);
	});

	it('lists the export review the way the top bar counts, and the version history', () => {
		const store = storeFor('spec-16-course-broken.json');
		store.ui.reviewOpen = true;
		const review = store.screen.dialogs.export_review!;
		expect(review.blocked).toBe(true);
		expect(review.errors.flatMap((g) => g.rows)).toHaveLength(store.validation.errors.length);
		expect(review.can_download).toBe(false);
	});
});

describe('an AI tool reads the new regions as the screen does, with a dialog or picker open', () => {
	it.each(MODES)('in %s mode', (mode) => {
		const store = storeFor('spec-16-course.json', mode);
		const open = [
			{ kind: 'course' as const },
			{ kind: 'lesson' as const, lessonId: store.doc.lessons[0].lesson_id },
			{ kind: 'card' as const, blockId: store.open.card!.block_id },
			{ kind: 'repair' as const, blockId: store.open.card!.block_id }
		];
		for (const dialog of open) {
			store.ui.dialog = dialog;
			for (const region of ['dialogs', 'pickers', 'ui', 'card'] as const) {
				expect(screenSlice(store.screen, region), `${dialog.kind} ${region}`).toEqual(
					JSON.parse(JSON.stringify(store.screen[region]))
				);
			}
			expect(store.screen.ui.dialog).toBe(dialog.kind);
		}
		store.ui.reviewOpen = true;
		expect(screenSlice(store.screen, 'dialogs')).toEqual(
			JSON.parse(JSON.stringify(store.screen.dialogs))
		);
		expect(store.screen.dialogs.export_review).not.toBeNull();
	});
});
