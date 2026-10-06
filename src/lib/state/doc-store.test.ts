import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DocStore } from './doc-store.svelte';
import { MemoryBackend } from './versions/backend';
import { VersionStore } from './versions/version-store.svelte';
import { importCourse } from '$lib/domain/document';
import {
	addBlock,
	addLesson,
	addStep,
	bindBlock,
	setField,
	unbindBlock
} from '$lib/domain/commands';
import { emptyCourse, serialise } from '$lib/domain/document';
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

describe('one version for the label and the file (H5)', () => {
	async function opened() {
		const store = new DocStore();
		store.load({ ...emptyCourse('C1', 'Kurz'), version: 1 });
		const versions = new VersionStore([new MemoryBackend()]);
		store.attachHistory(versions);
		return { store, versions };
	}

	it('says "načítá se" and has no number to hand out before the history is read', async () => {
		const { store, versions } = await opened();
		expect(store.versionState.loaded).toBe(false);
		expect(store.versionState.label).toBe('načítá se');
		expect(store.versionState.next).toBeUndefined();
		const pending = versions.load('C1');
		expect(store.versionState.loaded).toBe(false);
		await pending;
		expect(store.versionState.loaded).toBe(true);
	});

	it('exports under the number the label shows, after a version was saved', async () => {
		const { store, versions } = await opened();
		await versions.load('C1');
		expect(store.versionState.label).toBe('v1');
		expect(store.export().version).toBe(1);
		await versions.save(JSON.parse(JSON.stringify(store.source)), '');
		expect(store.versionState.label).toBe('v1');
		store.apply((d) => setField(d, { field: 'name' }, 'Jiný'));
		expect(store.versionState.label).toBe('v1 · upraveno');
		expect(store.versionState.next).toBe(2);
		expect(store.export().version).toBe(2);
		expect(JSON.parse(store.exportJson()).version).toBe(2);
	});

	it('is not loaded for another course than the history belongs to', async () => {
		const { store, versions } = await opened();
		await versions.load('C1');
		store.load({ ...emptyCourse('C2', 'Jiný kurz'), version: 7 });
		expect(store.versionState.loaded).toBe(false);
		expect(store.export().version).toBe(7);
	});
});

describe('the skill list status (M5)', () => {
	const config = (isDefault?: boolean) =>
		({
			vector: { id: 'v', name: 'V', dimension_count: 1, dimensions: [] },
			...(isDefault ? { is_default: true } : {})
		}) as never;

	it('is loading until the list is set, and load() starts it over', () => {
		const store = new DocStore();
		expect(store.skillConfigStatus).toBe('loading');
		store.skillConfig = config();
		expect(store.skillConfigStatus).toBe('loaded');
		store.load(emptyCourse('C2', 'Jiný'));
		expect(store.skillConfig).toBeNull();
		expect(store.skillConfigStatus).toBe('loading');
	});

	it('tells the neutral default set from a course list, and a failure from loading', () => {
		const store = new DocStore();
		store.skillConfig = config(true);
		expect(store.skillConfigStatus).toBe('default');
		store.skillConfig = null;
		expect(store.skillConfigStatus).toBe('failed');
	});
});

describe('the revision', () => {
	it('grows on every change to the document: edit, undo, redo, load, and the mode', () => {
		const store = loaded();
		const seen = [store.revision];
		const bump = (change: () => void) => {
			change();
			seen.push(store.revision);
		};
		bump(() =>
			store.apply((d) => setField(d, { blockId: 'L1_B1_uvod', field: 'name' }, 'Nové jméno'))
		);
		bump(() => store.undo());
		bump(() => store.redo());
		bump(() => (store.mode = 'metodik'));
		bump(() => store.load(emptyCourse('C2', 'Jiný')));
		for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
	});

	it('does not move when nothing changed', () => {
		const store = loaded();
		const before = store.revision;
		store.mode = 'teacher';
		store.apply((d) => ({ doc: d, description: 'nic' }));
		expect(store.revision).toBe(before);
	});
});

describe('undo and redo of a question card', () => {
	it('redo puts back the source, not the view the command ran on', () => {
		const store = loaded();
		const card = store.doc.blocks.find((b) => b.block_id === 'L1_B4_cviceni')!;
		store.apply((d) =>
			setField(d, { blockId: card.block_id, stepId: card.steps[0].id, field: 'content' }, 'X')
		);
		const edited = JSON.stringify(store.source);
		store.undo();
		store.redo();
		expect(JSON.stringify(store.source)).toBe(edited);
	});
});

describe('transaction', () => {
	const rename = (store: DocStore, id: string, name: string) =>
		store.apply((d) => setField(d, { blockId: id, field: 'name' }, name));

	it('records several commands as one undo entry with its origin and action id', () => {
		const store = loaded();
		const before = store.source;
		const depth = store.undoStack.length;
		store.transaction(
			() => {
				rename(store, 'L1_B1_uvod', 'A');
				rename(store, 'L1_B2_casti', 'B');
				rename(store, 'L1_B1_uvod', 'C');
			},
			{ origin: 'ai', actionId: 'x1', description: 'Přejmenovány karty' }
		);
		expect(store.undoStack.length).toBe(depth + 1);
		const entry = store.undoStack.at(-1)!;
		expect(entry).toMatchObject({
			origin: 'ai',
			actionId: 'x1',
			description: 'Přejmenovány karty'
		});
		expect(entry.before).toBe(before);
		expect(entry.after).toBe(store.source);
		store.undo();
		expect(store.source).toBe(before);
		store.redo();
		expect(store.doc.blocks.find((b) => b.block_id === 'L1_B1_uvod')?.name).toBe('C');
	});

	it('rolls everything back when the function throws', () => {
		const store = loaded();
		const before = store.source;
		const depth = store.undoStack.length;
		const revision = store.revision;
		const selection = store.selection;
		expect(() =>
			store.transaction(
				() => {
					store.apply((d) => addLesson(d, 'Nová'));
					throw new Error('boom');
				},
				{ origin: 'ai' }
			)
		).toThrow('boom');
		expect(store.source).toBe(before);
		expect(store.undoStack.length).toBe(depth);
		expect(store.revision).toBe(revision);
		expect(store.selection).toBe(selection);
		expect(store.hasAiSession).toBe(false);
		expect(store.aiActions).toEqual([]);
		// The ids handed out inside are free again: the aborted change never happened.
		const again = store.apply((d, r) => addLesson(d, 'Nová', r));
		expect(again.ref?.lessonId).toBeDefined();
	});

	it('leaves the revision, the session and the version hook alone when it nets out to nothing', () => {
		const store = loaded();
		const saved: string[] = [];
		store.onBeforeAiSession = (_s, label) => void saved.push(label);
		store.dirty = true;
		const revision = store.revision;
		const source = store.source;
		store.transaction(
			() => store.apply((d) => setField(d, { blockId: 'L1_B1_uvod', field: 'name' }, undefined)),
			{ origin: 'ai' }
		);
		expect(store.revision).toBe(revision);
		expect(store.source).toBe(source);
		expect(store.hasAiSession).toBe(false);
		expect(saved).toEqual([]);
	});

	it('leaves no entry when the change nets out to nothing', () => {
		const store = loaded();
		const depth = store.undoStack.length;
		const name = store.doc.blocks.find((b) => b.block_id === 'L1_B1_uvod')?.name;
		store.transaction(
			() => {
				rename(store, 'L1_B1_uvod', 'jiné');
				rename(store, 'L1_B1_uvod', name as string);
			},
			{ origin: 'ai' }
		);
		expect(store.undoStack.length).toBe(depth);
		expect(store.aiActions).toEqual([]);
	});

	it('marks teacher edits as the teacher’s and does not mark the card as left by an AI edit', () => {
		const store = loaded();
		rename(store, 'L1_B1_uvod', 'ručně');
		expect(store.undoStack.at(-1)?.origin).toBe('teacher');
		store.selection = { lessonId: 'L1_INTRO', blockId: 'L1_B1_uvod' };
		store.transaction(() => rename(store, 'L1_B2_casti', 'AI'), { origin: 'ai' });
		expect(store.selection?.blockId).toBe('L1_B2_casti');
		expect(store.touchedCards.has('L1_B1_uvod')).toBe(false);
	});

	it('logs each AI action, and undo and redo mark it', () => {
		const store = loaded();
		const r0 = store.revision;
		store.transaction(() => rename(store, 'L1_B1_uvod', 'A'), {
			origin: 'ai',
			description: 'Přejmenována karta'
		});
		const [action] = store.aiActions;
		expect(action).toMatchObject({ description: 'Přejmenována karta', undone: false });
		expect(action.revisionBefore).toBe(r0);
		expect(action.revisionAfter).toBe(store.revision);
		store.undo();
		expect(store.aiActions[0].undone).toBe(true);
		store.redo();
		expect(store.aiActions[0].undone).toBe(false);
	});

	it('undoes the last AI action only when it is the last change', () => {
		const store = loaded();
		store.transaction(() => rename(store, 'L1_B1_uvod', 'A'), { origin: 'ai' });
		rename(store, 'L1_B2_casti', 'ručně');
		expect(store.undoLastAiAction()).toBeUndefined();
		store.undo();
		expect(store.undoLastAiAction()?.undone).toBe(true);
		expect(store.doc.blocks.find((b) => b.block_id === 'L1_B1_uvod')?.name).not.toBe('A');
	});
});

describe('the AI session', () => {
	const aiRename = (store: DocStore, id: string, name: string) =>
		store.transaction(() => store.apply((d) => setField(d, { blockId: id, field: 'name' }, name)), {
			origin: 'ai'
		});

	it('begins at the first AI write, not at a read or a teacher edit', () => {
		const store = loaded();
		store.apply((d) => setField(d, { blockId: 'L1_B1_uvod', field: 'name' }, 'ručně'));
		expect(store.hasAiSession).toBe(false);
		aiRename(store, 'L1_B2_casti', 'AI');
		expect(store.hasAiSession).toBe(true);
	});

	it('saves one durable version first, only when there is unsaved work', () => {
		const calls: string[] = [];
		const store = loaded();
		store.dirty = false;
		store.onBeforeAiSession = (_source, label) => void calls.push(label);
		aiRename(store, 'L1_B2_casti', 'AI');
		expect(calls).toEqual([]);
		store.endAiSession();
		store.dirty = true;
		aiRename(store, 'L1_B1_uvod', 'AI');
		aiRename(store, 'L1_B2_casti', 'AI 2');
		expect(calls).toEqual(['Před úpravami AI']);
	});

	it('is not stopped by a version that could not be saved', () => {
		const store = loaded();
		store.dirty = true;
		store.onBeforeAiSession = () => {
			throw new Error('disk');
		};
		expect(() => aiRename(store, 'L1_B1_uvod', 'AI')).not.toThrow();
	});

	it('reverts to the checkpoint byte for byte, as one undoable entry', () => {
		const store = loaded();
		store.apply((d) => setField(d, { blockId: 'L1_B1_uvod', field: 'name' }, 'ručně'));
		const original = JSON.stringify(serialise(store.source));
		aiRename(store, 'L1_B1_uvod', 'AI 1');
		store.transaction(() => store.apply((d, r) => addLesson(d, 'Od AI', r)), { origin: 'ai' });
		aiRename(store, 'L1_B2_casti', 'AI 2');
		const changed = JSON.stringify(serialise(store.source));
		expect(changed).not.toBe(original);
		const depth = store.undoStack.length;

		expect(store.revertAiSession()).toBe(true);
		expect(JSON.stringify(serialise(store.source))).toBe(original);
		expect(store.undoStack.length).toBe(depth + 1);
		expect(store.undoStack.at(-1)?.origin).toBe('teacher');
		expect(store.hasAiSession).toBe(false);
		expect(store.aiActions).toEqual([]);

		store.undo();
		expect(JSON.stringify(serialise(store.source))).toBe(changed);
	});

	it('keeps the ids it handed out reserved after a revert', () => {
		const store = loaded();
		let minted = '';
		store.transaction(
			() => {
				minted = store.apply((d, r) => addLesson(d, 'Od AI', r)).ref!.lessonId!;
			},
			{ origin: 'ai' }
		);
		store.revertAiSession();
		expect(store.reservations.lessons.has(minted)).toBe(true);
		const next = store.apply((d, r) => addLesson(d, 'Jiná', r)).ref!.lessonId;
		expect(next).not.toBe(minted);
	});

	it('has nothing to revert without a session', () => {
		expect(loaded().revertAiSession()).toBe(false);
	});
});
