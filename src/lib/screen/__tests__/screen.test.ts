/**
 * The screen model, held to what it promises: it is a function of the store's state,
 * the regions say what the components used to work out themselves, and what an AI tool
 * returns for a region is that region, unchanged.
 */
import { describe, expect, it } from 'vitest';
import { lessonTotals, courseTotals } from '$lib/domain/derive';
import { cardLabel } from '$lib/domain/naming';
import { setField } from '$lib/domain/commands';
import { buildScreen, screenSlice, type ScreenRegion } from '$lib/screen';
import { FIXTURES, MODES, storeFor } from './fixtures';

const REGIONS: ScreenRegion[] = [
	'topbar',
	'tree',
	'issues',
	'preview',
	'notices',
	'ui',
	'card',
	'pickers',
	'dialogs',
	'ai'
];

describe.each(FIXTURES)('%s', (name) => {
	describe.each(MODES)('in %s mode', (mode) => {
		const store = storeFor(name, mode);

		it('has regions that are the pure builders of the store’s input', () => {
			const built = buildScreen(store.screen.input);
			for (const region of REGIONS) {
				expect(store.screen[region], region).toEqual(built[region]);
			}
		});

		it('hands an AI tool each region as plain JSON, equal to what the screen reads', () => {
			for (const region of REGIONS) {
				const slice = screenSlice(store.screen, region);
				expect(slice, region).toEqual(JSON.parse(JSON.stringify(store.screen[region])));
				// Plain data: no class instances, no undefined, nothing a tool could not send.
				expect(JSON.parse(JSON.stringify(slice))).toEqual(slice);
			}
		});

		it('says the tree’s numbers as the domain computes them', () => {
			const { tree } = store.screen;
			expect(tree.lessons).toHaveLength(store.doc.lessons.length);
			store.doc.lessons.forEach((lesson, i) => {
				const totals = lessonTotals(lesson, store.index);
				const row = tree.lessons[i];
				expect(row.counts.cards).toBe(lesson.blocks.length);
				expect(row.counts.blocks).toBe(totals.blockCount);
				expect(row.counts.minutes).toBe(totals.durationMinutes);
				expect(row.counts.xp).toBe(totals.xp);
				expect(row.cards).toHaveLength(lesson.blocks.length);
				row.cards.forEach((card) => {
					if (card.missing) return;
					const block = store.doc.blocks.find((b) => b.block_id === card.block_id)!;
					expect(card.name).toBe(
						cardLabel(store.doc, block, { lessonId: lesson.lesson_id, max: 44 })
					);
				});
			});
			const totals = courseTotals(store.doc, store.index);
			expect(tree.footer.duration).toBe(`${totals.durationMinutes} min`);
			expect(tree.footer.xp).toBe(`${totals.cappedXp} XP`);
		});

		it('lists every issue once, with when it may be shown', () => {
			const { issues } = store.screen;
			const found = store.validation.errors.length + store.validation.warnings.length;
			expect(issues.items).toHaveLength(found);
			expect(new Set(issues.items.map((i) => i.key)).size).toBe(found);
			const count = (v: string) => issues.items.filter((i) => i.visibility === v).length;
			expect(count('shown')).toBe(store.shown.errors.length + store.shown.warnings.length);
			expect(count('held_back')).toBe(issues.counts.held_back);
			expect(issues.panel.errors).toHaveLength(store.listed.errors.length);
			// Errors block export, so none is ever held back.
			expect(
				issues.items.filter((i) => i.severity === 'error' && i.visibility === 'held_back')
			).toEqual([]);
		});

		it('opens exactly one card, and marks it in its lesson only', () => {
			const { tree } = store.screen;
			const open = store.open;
			const selected = tree.lessons.flatMap((l) => l.cards.filter((c) => c.selected));
			if (open.card === undefined || open.lesson === undefined) {
				expect(selected).toEqual([]);
				return;
			}
			expect(tree.lessons.filter((l) => l.open).length).toBeGreaterThanOrEqual(1);
			for (const card of selected) expect(card.block_id).toBe(open.card.block_id);
		});
	});
});

describe('the issue timing the model reports', () => {
	it('holds back feedback advice while Zpětná vazba is off, and says how many', () => {
		const store = storeFor('corpus/zlomky-5-trida.json');
		const withFeedback = store.screen.issues;
		store.showFeedback = false;
		const without = store.screen.issues;
		expect(without.counts.held_back).toBeGreaterThanOrEqual(withFeedback.counts.held_back);
		for (const item of without.items.filter((i) => i.visibility === 'held_back')) {
			expect(item.severity).toBe('warning');
		}
		if (without.counts.held_back > 0)
			expect(without.panel.held_text).toMatch(/doporučení ke zpětné vazbě/);
	});

	it('lists an unfinished field as pending until the author leaves its card', () => {
		const store = storeFor('spec-16-course-broken.json');
		const before = store.screen.issues.items.filter((i) => i.visibility === 'pending_timing');
		expect(before.length).toBeGreaterThan(0);
		const card = before.find((i) => i.ref.blockId !== undefined)!;
		store.touchCard(card.ref.blockId!);
		const after = store.screen.issues.items.find((i) => i.key === card.key)!;
		expect(after.visibility).toBe('shown');
	});

	it('says that skill vectors are not checked while the list is not known', () => {
		const store = storeFor('spec-16-course.json');
		expect(store.skillConfigStatus).toBe('loading');
		expect(store.screen.issues.skipped_checks).toMatch(/načítají/);
		store.skillConfig = null;
		expect(store.screen.issues.skipped_checks).toMatch(/nepodařilo/);
	});
});

describe('the topbar', () => {
	it('keeps the count quiet while writing and red once the review has been opened', () => {
		const store = storeFor('spec-16-course-broken.json');
		const writing = store.screen.topbar.check;
		expect(writing.errors).toBeGreaterThan(0);
		expect(writing.chip).toEqual({ tone: 'quiet', text: `${writing.errors} k dokončení` });
		store.beginReview();
		expect(store.screen.topbar.check.chip).toEqual({ tone: 'error', text: `${writing.errors}` });
	});

	it('is calm for a clean course and says the save line the way the bar did', () => {
		const store = storeFor('spec-16-course.json');
		store.skillConfig = { is_default: true } as never;
		const bar = store.screen.topbar;
		expect(bar.check.chip).toEqual({ tone: 'ok', text: '0' });
		expect(bar.save.text).toBe('Bez zálohy v souboru');
		store.exportedJson = store.exportJson();
		expect(store.screen.topbar.save).toMatchObject({ text: 'Staženo do souboru', backed_up: true });
		store.draftStatus = 'blocked';
		expect(store.screen.topbar.save).toMatchObject({
			text: 'Ukládání pozastaveno',
			tone: 'warning'
		});
	});
});

describe('the preview', () => {
	it('says there is nothing to show instead of keeping the last card', () => {
		const store = storeFor('spec-16-course.json');
		store.preview.boot = 'ready';
		store.preview.sync = 'in_sync';
		expect(store.screen.preview.status).toBe('in_sync');
		expect(store.screen.preview.target.kind).toBe('card');

		store.load(store.source);
		store.applySource((doc) => ({ doc: { ...doc, lessons: [], blocks: [] }, description: 'x' }));
		const empty = store.screen.preview;
		expect(empty.status).toBe('empty');
		expect(empty.target).toEqual({ kind: 'none' });
		expect(empty.empty_text).toMatch(/Nic není vybráno/);
	});

	it('follows the player: not started, syncing, in sync, error', () => {
		const store = storeFor('spec-16-course.json');
		expect(store.screen.preview.status).toBe('not_started');
		expect(store.screen.preview.player).toBe('starting');
		store.preview.boot = 'starting';
		expect(store.screen.preview.chip).toEqual({ tone: 'neutral', text: 'spouští se…' });
		store.preview.boot = 'ready';
		expect(store.screen.preview.status).toBe('syncing');
		store.preview.inspected('block');
		expect(store.screen.preview.status).toBe('in_sync');
		store.preview.inspected('error', 'Neplatný blok');
		expect(store.screen.preview).toMatchObject({
			status: 'player_error',
			player_error: 'Neplatný blok'
		});
		store.preview.boot = 'stalled';
		expect(store.screen.preview).toMatchObject({
			status: 'not_started',
			fallback: 'stalled',
			player: 'failed',
			chip: { tone: 'warning', text: 'přehrávač neběží' }
		});
	});

	it('keeps what a finished card reported, marked as not on screen', () => {
		const store = storeFor('spec-16-course.json');
		store.preview.completed = { xp: 8, scoreKoef: 1 };
		expect(store.screen.preview.last_completed).toEqual({
			xp: 8,
			score_koef: 1,
			mark: null,
			on_screen: false
		});
	});

	it('targets the lesson that is played, not the one selected', () => {
		const store = storeFor('corpus/zlomky-5-trida.json');
		const second = store.doc.lessons[1];
		store.preview.view = 'play';
		store.preview.run = { lessonId: second.lesson_id, startBlockId: second.blocks[0]?.block_id };
		const target = store.screen.preview.target;
		expect(target.kind).toBe('lesson');
		if (target.kind === 'lesson') expect(target.lesson).toBe(store.screen.tree.lessons[1].name);
	});
});

describe('the cut-off notice', () => {
	// spec §16: answer b of L1_B3_poznej's second step is the only way to its step 3.
	const ref = { blockId: 'L1_B3_poznej', stepId: 's2', optionId: 'b', field: 'go_to' };

	it('says what the change cut off, then nothing after the next edit', () => {
		const store = storeFor('spec-16-course.json', 'advanced');
		expect(store.screen.notices.cut_off).toBeNull();
		store.trackReach('b', () => store.apply((d) => setField(d, ref, 'END')));
		expect(store.screen.notices.cut_off).toEqual({
			text: 's3 teď nikam nevede — žák ho neuvidí',
			option_id: 'b'
		});
		// The next edit of any kind clears it.
		store.apply((d) => setField(d, { field: 'name' }, 'Jiný název'));
		expect(store.screen.notices.cut_off).toBeNull();
	});

	it('names the step as the mode does: "Krok 3" for a teacher, its id in Pokročilý', () => {
		const store = storeFor('spec-16-course.json', 'metodik');
		store.trackReach('b', () => store.apply((d) => setField(d, ref, 'END')));
		expect(store.screen.notices.cut_off?.text).toBe('Krok 3 teď nikam nevede — žák ho neuvidí');
	});

	it('is gone when the change is undone', () => {
		const store = storeFor('spec-16-course.json', 'advanced');
		store.trackReach('b', () => store.apply((d) => setField(d, ref, 'END')));
		store.undo();
		expect(store.screen.notices.cut_off).toBeNull();
	});

	it('is not made for a change that cuts nothing off', () => {
		const store = storeFor('spec-16-course.json', 'advanced');
		store.trackReach('b', () => store.apply((d) => setField(d, ref, 's3')));
		expect(store.screen.notices.cut_off).toBeNull();
	});
});

describe('the ui slice', () => {
	it('says the Pokročilý parts note is on screen only for a split course, once', () => {
		const store = storeFor('corpus/zlomky-5-trida.json');
		expect(store.screen.ui.parts_note).toEqual({ eligible: false, shown: false });
		store.mode = 'advanced';
		expect(store.screen.ui.parts_note.eligible).toBe(true);
		store.ui.partsNoteSeen = false;
		expect(store.screen.ui.parts_note.shown).toBe(true);
		store.ui.dismissPartsNote();
		expect(store.screen.ui.parts_note.shown).toBe(false);
		store.ui.sidebarCollapsed = true;
		expect(store.screen.ui.parts_note.eligible).toBe(false);
	});

	it('forgets hidden warnings when the panel closes', () => {
		const store = storeFor('spec-16-course-broken.json');
		store.ui.validationOpen = true;
		const first = store.screen.issues.panel.warnings[0];
		if (first === undefined) return;
		store.ui.dismissIssue(first.key);
		expect(store.screen.issues.panel.warnings.map((i) => i.key)).not.toContain(first.key);
		store.ui.validationOpen = false;
		store.ui.validationOpen = true;
		expect(store.screen.issues.panel.warnings.map((i) => i.key)).toContain(first.key);
	});
});
