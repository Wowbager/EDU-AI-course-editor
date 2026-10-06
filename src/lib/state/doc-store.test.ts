import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DocStore } from './doc-store.svelte';
import { importCourse } from '$lib/domain/document';
import {
	addBlock,
	addLesson,
	addStep,
	bindBlock,
	setField,
	unbindBlock
} from '$lib/domain/commands';
import { emptyCourse } from '$lib/domain/document';
import { groupOf, questionCount } from '$lib/domain/groups';

/**
 * The store holds the course as exported (`source`) and shows the editor a view of it
 * (`doc`): in Učitel and Metodik each question card as one card, in Pokročilý the
 * source itself. These are the promises the rest of the editor relies on.
 */
const fixture = () =>
	importCourse(
		JSON.parse(
			readFileSync(
				new URL('../domain/__tests__/fixtures/corpus/zlomky-5-trida.json', import.meta.url),
				'utf8'
			)
		)
	).doc;

function loaded() {
	const store = new DocStore();
	store.load(fixture());
	store.splitQuestions();
	return store;
}

describe('the store and question cards', () => {
	it('splits an imported course as one undoable edit', () => {
		const store = new DocStore();
		store.load(fixture());
		const before = store.source;
		const { split } = store.splitQuestions();
		expect(split.length).toBe(5);
		expect(store.source.blocks.length).toBe(before.blocks.length + 5);
		store.undo();
		expect(store.source).toBe(before);
	});

	it('shows the teacher one card where the export has two', () => {
		const store = loaded();
		expect(store.doc.blocks.some((b) => b.block_id === 'L1_B4_cviceni_2')).toBe(false);
		expect(store.source.blocks.some((b) => b.block_id === 'L1_B4_cviceni_2')).toBe(true);
		store.mode = 'advanced';
		expect(store.doc).toBe(store.source);
	});

	it('writes a teacher’s new question into its own block, and undoes it whole', () => {
		const store = loaded();
		const before = store.source;
		store.apply((d, r) => addStep(d, 'L1_B3_poznej', 'question', undefined, r));
		const card = store.source.blocks.filter((b) => groupOf(b) === 'L1_B3_poznej');
		expect(card.length).toBeGreaterThan(1);
		for (const block of card) expect(questionCount(block)).toBeLessThanOrEqual(1);
		store.undo();
		expect(store.source).toBe(before);
	});

	it('moves the selection between a card and its block when the mode changes', () => {
		const store = loaded();
		store.selection = { lessonId: 'L1_INTRO', blockId: 'L1_B4_cviceni', stepId: 's4' };
		store.mode = 'advanced';
		expect(store.selection).toMatchObject({ blockId: 'L1_B4_cviceni_2', stepId: 's4' });
		store.mode = 'teacher';
		expect(store.selection).toMatchObject({ blockId: 'L1_B4_cviceni', stepId: 's4' });
	});

	it('carries a jump’s target into the mode it switches to', () => {
		const store = loaded();
		const ref = store.switchMode('advanced', { blockId: 'L1_B4_cviceni', stepId: 's3' });
		expect(ref).toMatchObject({ blockId: 'L1_B4_cviceni_2', stepId: 's3' });
	});

	it('maps what the player reports back to the teacher’s card', () => {
		const store = loaded();
		expect(store.toView({ blockId: 'L1_B4_cviceni_2', stepId: 's4' })).toMatchObject({
			blockId: 'L1_B4_cviceni'
		});
	});

	it('exports the source, not the view', () => {
		const store = loaded();
		store.apply((d) => setField(d, { field: 'name' }, 'Zlomky'));
		const out = store.export() as { name: string; blocks: { block_id: string }[] };
		expect(out.name).toBe('Zlomky');
		expect(out.blocks.map((b) => b.block_id)).toContain('L1_B4_cviceni_2');
		expect(JSON.stringify(out)).not.toContain('_members');
	});

	it('counts leaving a card as leaving its blocks too', () => {
		const store = loaded();
		store.selection = { blockId: 'L1_B4_cviceni' };
		store.selection = { blockId: 'L1_B1_uvod' };
		expect(store.touchedCards.has('L1_B4_cviceni')).toBe(true);
		expect(store.touchedCards.has('L1_B4_cviceni_2')).toBe(true);
	});
});

describe('the Zpětná vazba flag', () => {
	it('starts on and flips', () => {
		const store = new DocStore();
		expect(store.showFeedback).toBe(true);
		store.showFeedback = false;
		expect(store.showFeedback).toBe(false);
		store.showFeedback = true;
		expect(store.showFeedback).toBe(true);
	});

	it('is a view preference: loading another course keeps it', () => {
		const store = new DocStore();
		store.showFeedback = false;
		store.load(fixture());
		expect(store.showFeedback).toBe(false);
	});
});

describe('warnings about hidden feedback fields', () => {
	/** A question card whose only step has a detailed help but no hint to open it from. */
	function withUnreachableHelp() {
		const store = new DocStore();
		store.load({
			...emptyCourse('KURZ', 'Kurz'),
			lessons: [{ lesson_id: 'L1', version: 1, name: 'Lekce', order: 1, blocks: [] }]
		});
		const added = store.apply((d) => addBlock(d, 'L1', 'question'));
		const blockId = added.ref!.blockId!;
		const step = store.apply((d) => addStep(d, blockId, 'question'));
		const stepRef = { blockId, stepId: step.ref!.stepId, field: 'help' };
		store.apply((d) => setField(d, stepRef, 'Nejdřív si to nakresli.'));
		return { store, stepRef };
	}

	it('are in the full validation but not in what is listed, while feedback is hidden', () => {
		const { store } = withUnreachableHelp();
		const unreachable = (issues: readonly { code: string }[]) =>
			issues.filter((i) => i.code === 'W_HINT_UNREACHABLE').length;
		expect(unreachable(store.validation.warnings)).toBe(1);
		expect(unreachable(store.listed.warnings)).toBe(1);

		store.showFeedback = false;
		expect(unreachable(store.validation.warnings)).toBe(1);
		expect(unreachable(store.listed.warnings)).toBe(0);

		store.showFeedback = true;
		expect(unreachable(store.listed.warnings)).toBe(1);
	});

	it('are not marked inline while hidden', () => {
		const { store, stepRef } = withUnreachableHelp();
		expect(store.issuesAt(stepRef).warnings.map((i) => i.code)).toEqual(['W_HINT_UNREACHABLE']);
		store.showFeedback = false;
		expect(store.shown.warnings.map((i) => i.code)).not.toContain('W_HINT_UNREACHABLE');
		expect(store.issuesAt(stepRef).warnings).toEqual([]);
	});

	it('never hold back an error', () => {
		const { store } = withUnreachableHelp();
		const before = store.listed.errors.map((i) => i.code);
		expect(before.length).toBeGreaterThan(0);
		store.showFeedback = false;
		expect(store.listed.errors.map((i) => i.code)).toEqual(before);
		expect(store.listed.errors).toEqual(store.validation.errors);
	});
});

describe('jumping onto a hidden feedback field', () => {
	const hint = { blockId: 'B1', stepId: 's1', field: 'hint' };

	it('turns feedback back on, and it stays on', () => {
		const store = new DocStore();
		store.showFeedback = false;
		store.revealAt(hint);
		expect(store.showFeedback).toBe(true);
		expect(store.selection).toEqual(hint);
		store.revealAt({ blockId: 'B1' });
		expect(store.showFeedback).toBe(true);
	});

	it('leaves feedback hidden for a jump anywhere else', () => {
		const store = new DocStore();
		store.showFeedback = false;
		store.revealAt({ blockId: 'B1', stepId: 's1', field: 'question.options' });
		store.revealAt({ blockId: 'B1', stepId: 's1', optionId: 'a', field: 'text' });
		store.revealAt({ blockId: 'B1' });
		expect(store.showFeedback).toBe(false);
	});

	it('is not caused by following a played run', () => {
		const store = new DocStore();
		store.showFeedback = false;
		store.follow(hint);
		expect(store.showFeedback).toBe(false);
		expect(store.selection).toEqual(hint);
	});
});

describe('a run of typing', () => {
	function typing() {
		const store = loaded();
		const block = store.doc.blocks.find((b) => b.steps?.some((s) => s.type === 'text'))!;
		const step = block.steps!.find((s) => s.type === 'text')!;
		const ref = { blockId: block.block_id, stepId: step.id, field: 'content' };
		const type = (text: string) => store.apply((d) => setField(d, ref, text));
		return { store, type, step };
	}

	it('is one undo entry between beginEdit and endEdit', () => {
		const { store, type } = typing();
		const before = store.source;
		store.beginEdit();
		for (const text of ['Z', 'Zl', 'Zlo', 'Zlom']) type(text);
		store.endEdit();
		store.undo();
		expect(store.source).toBe(before);
	});

	it('is one entry per keystroke without them, which is what the editor must avoid', () => {
		const { store, type } = typing();
		const before = store.source;
		for (const text of ['Z', 'Zl', 'Zlo']) type(text);
		store.undo();
		expect(store.source).not.toBe(before);
	});

	it('leaves nothing behind when it nets out to no change', () => {
		const { store, type, step } = typing();
		const before = store.source;
		store.beginEdit();
		type('rozepsáno');
		type(step.content ?? '');
		store.endEdit();
		store.undo();
		// The one undo went past the run to the split of the import, not into it.
		expect(store.source).not.toBe(before);
		expect(store.source.blocks.length).toBeLessThan(before.blocks.length);
	});
});

describe('editing a card two lessons share', () => {
	function shared() {
		const store = new DocStore();
		store.apply((d, r) => addLesson(d, 'První', r));
		store.apply((d, r) => addLesson(d, 'Druhá', r));
		const [first, second] = store.doc.lessons.map((l) => l.lesson_id);
		const card = store.apply((d, r) => addBlock(d, first, 'display', undefined, r)).ref!.blockId!;
		store.apply((d) => bindBlock(d, second, card));
		store.apply((d, r) => addStep(d, card, 'text', undefined, r));
		const step = store.doc.blocks.find((b) => b.block_id === card)!.steps![0];
		const ref = { blockId: card, stepId: step.id, field: 'content' };
		return { store, first, second, card, ref };
	}

	it('stays in the lesson the teacher came from', () => {
		const { store, first, second, card, ref } = shared();
		expect(store.index.lessonsByBlock.get(card)).toEqual([first, second]);
		store.selection = { lessonId: second, blockId: card };
		store.apply((d) => setField(d, ref, 'Text'));
		expect(store.selection?.lessonId).toBe(second);
		expect(store.selection?.blockId).toBe(card);
	});

	it('stays there through undo and redo', () => {
		const { store, second, card, ref } = shared();
		store.selection = { lessonId: second, blockId: card };
		store.apply((d) => setField(d, ref, 'Text'));
		store.undo();
		expect(store.selection?.lessonId).toBe(second);
		store.redo();
		expect(store.selection?.lessonId).toBe(second);
	});

	it('follows the card when the lesson no longer holds it', () => {
		const { store, first, second, card, ref } = shared();
		store.selection = { lessonId: second, blockId: card };
		store.apply((d) => setField(d, { ...ref, lessonId: first }, 'Text'));
		expect(store.selection?.lessonId).toBe(first);
		store.selection = { lessonId: second, blockId: card };
		store.apply((d) => ({ ...unbindBlock(d, second, card), ref }));
		expect(store.selection?.lessonId).toBeUndefined();
	});
});

describe('the export review', () => {
	function unfinished() {
		const store = new DocStore();
		store.apply((d, r) => addLesson(d, 'První', r));
		const lesson = store.doc.lessons[0].lesson_id;
		store.apply((d, r) => addBlock(d, lesson, 'display', undefined, r));
		return { store, lesson };
	}
	const shownCodes = (store: DocStore) => store.shown.errors.map((i) => i.code);

	it('shows what it listed, and only that, until the course is downloaded', () => {
		const { store, lesson } = unfinished();
		expect(shownCodes(store)).not.toContain('E_DISPLAY_NO_TEXT');
		store.beginReview();
		expect(store.reviewing).toBe(true);
		expect(shownCodes(store)).toContain('E_DISPLAY_NO_TEXT');
		// A card added while fixing is unfinished like any new card, not red at birth.
		const added = store.apply((d, r) => addBlock(d, lesson, 'display', undefined, r)).ref!.blockId;
		const at = (blockId: string | undefined) =>
			store.shown.errors.filter((i) => i.ref.blockId === blockId);
		expect(store.validation.errors.some((i) => i.ref.blockId === added)).toBe(true);
		expect(at(added)).toEqual([]);
	});

	it('stops showing it early once the course has been downloaded', () => {
		const { store } = unfinished();
		store.beginReview();
		expect(shownCodes(store)).toContain('E_DISPLAY_NO_TEXT');
		store.endReview();
		expect(store.reviewing).toBe(false);
		expect(shownCodes(store)).not.toContain('E_DISPLAY_NO_TEXT');
	});

	it('is forgotten when another course is loaded', () => {
		const { store } = unfinished();
		store.beginReview();
		store.load(emptyCourse('NEW', 'Nový kurz'));
		expect(store.reviewing).toBe(false);
	});
});

describe('what is open (store.open)', () => {
	it('falls back to the first lesson and its first card with no selection', () => {
		const store = loaded();
		store.selection = null;
		const first = store.doc.lessons[0];
		expect(store.open.lesson?.lesson_id).toBe(first.lesson_id);
		expect(store.open.card?.block_id).toBe(first.blocks[0].block_id);
		expect(store.open.position).toBe(1);
		expect(store.open.orphaned).toBe(false);
		expect(store.open.binding).toBe(first.blocks[0]);
	});

	it('falls back to the lesson first card when the selected card is gone', () => {
		const store = loaded();
		const first = store.doc.lessons[0];
		store.selection = { lessonId: first.lesson_id, blockId: 'deleted-card' };
		expect(store.open.card?.block_id).toBe(first.blocks[0].block_id);
	});

	it('resolves the lesson of a ref that only names a card', () => {
		const store = loaded();
		const lesson = store.doc.lessons[store.doc.lessons.length - 1];
		const block = lesson.blocks[lesson.blocks.length - 1];
		store.selection = { blockId: block.block_id };
		expect(store.open.lesson?.lesson_id).toBe(lesson.lesson_id);
		expect(store.open.card?.block_id).toBe(block.block_id);
		expect(store.open.position).toBe(lesson.blocks.length);
	});

	it('opens a card in no lesson as an orphan with no lesson and no position', () => {
		const store = loaded();
		const lesson = store.doc.lessons[0];
		const id = lesson.blocks[0].block_id;
		store.apply((d) => unbindBlock(d, lesson.lesson_id, id));
		expect(store.index.lessonsByBlock.get(id) ?? []).toEqual([]);
		store.selection = { blockId: id };
		expect(store.open.orphaned).toBe(true);
		expect(store.open.lesson).toBeUndefined();
		expect(store.open.position).toBeUndefined();
		expect(store.open.card?.block_id).toBe(id);
	});

	it('is empty for a course with nothing in it', () => {
		const store = new DocStore();
		expect(store.open.card).toBeUndefined();
		expect(store.open.orphaned).toBe(false);
	});
});

describe('number drafts (H4)', () => {
	const ref = { blockId: 'B', stepId: 's', field: 'question.correct_number' };

	it('keeps text that is no number out of the document and says so', () => {
		const store = new DocStore();
		expect(store.enterNumber(ref, 'abc')).toEqual({ status: 'invalid', text: 'abc' });
		expect(store.draftAt(ref)).toBe('abc');
		expect(store.draftErrorAt(ref)).toContain('„abc“ není číslo');
	});

	it('drops the draft when a number is typed, the box is emptied, or on undo and load', () => {
		const store = new DocStore();
		store.enterNumber(ref, 'abc');
		expect(store.enterNumber(ref, '1 000,5')).toEqual({ status: 'ok', value: 1000.5 });
		expect(store.draftAt(ref)).toBeUndefined();
		store.enterNumber(ref, 'x');
		expect(store.enterNumber(ref, '  ').status).toBe('empty');
		expect(store.draftAt(ref)).toBeUndefined();
		store.enterNumber(ref, 'x');
		store.load(emptyCourse('NEW', 'Nový kurz'));
		expect(store.draftAt(ref)).toBeUndefined();
	});

	it('is dropped by undo', () => {
		const store = new DocStore();
		store.apply((d, r) => addLesson(d, 'První', r));
		store.enterNumber(ref, 'x');
		store.undo();
		expect(store.draftAt(ref)).toBeUndefined();
	});
});
