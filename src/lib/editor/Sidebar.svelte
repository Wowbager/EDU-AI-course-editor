<script lang="ts">
	/**
	 * The course tree: lessons, and the cards inside the open one.
	 *
	 * This is where a lesson becomes legible. The editor column holds one card at a
	 * time, so the shape of the lesson — how many cards, of what kind, in what order,
	 * which ones are broken — has to be readable somewhere, all at once. That is this
	 * panel's whole job, and it is why the cards moved here out of the centre.
	 *
	 * Selection lives here and nowhere else. The card in the editor column is by
	 * definition the selected one, so it carries no "you are here" marker of its own;
	 * two markers for one fact is how a screen stops being scannable.
	 *
	 * Collapses to a 64px rail (`SidebarRail.svelte`). It cannot carry two legible
	 * levels of text, so it keeps a circle per lesson and, under the open one, a tile
	 * per card: enough to see where you are, jump, reorder and add.
	 */
	import { tick, untrack } from 'svelte';
	import { countOf, focusAfterDelete, focusSelectedCard } from '$lib/ui/focus-after';
	import { dndzone, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
	import type { BlockV2, CourseV2, LessonV2 } from '$lib/domain/schema';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import {
		addBlock,
		addLesson,
		moveBlockInLesson,
		reorderBindings,
		reorderLessons
	} from '$lib/domain/commands';
	import { blockPreview, lessonTotals } from '$lib/domain/derive';
	import { cardsCount, stepsCount } from '$lib/domain/plural';
	import { uniqueKeys } from '$lib/ui/keys';
	import { groupOf, groupsOf } from '$lib/domain/groups';
	import { lessonLabel } from '$lib/domain/naming';
	import { CARD_TYPES, cardTypeIcon } from '$lib/ui/card-types';
	import SidebarRail from './SidebarRail.svelte';
	import CardActions from './CardActions.svelte';
	import Backpack from './Backpack.svelte';
	import { cardActions } from './card-actions';
	import { CardDrag, type CardItem, type Held } from './card-drag.svelte';
	import { LoaderCircle, PanelLeftOpen, PanelLeftClose, Settings, Plus } from '@lucide/svelte';
	import { ai } from '$lib/state/ai.svelte';
	import { aiPanel } from '$lib/state/ai-panel.svelte';

	interface Props {
		doc: CourseV2;
		/**
		 * What the editor column is showing. Passed in rather than read off the
		 * selection, because a ref does not always name its lesson and the tree must
		 * never highlight something other than what is open.
		 */
		activeLessonId: string | undefined;
		activeBlockId: string | undefined;
		collapsed: boolean;
		ontoggle: () => void;
		oncourseSettings: () => void;
		onlessonSettings: (lessonId: string, options?: { focusName?: boolean }) => void;
		oncardSettings: (blockId: string) => void;
		/** A card another card points at: the repair dialog decides where those go. */
		onrepairBlock: (blockId: string) => void;
	}
	let {
		doc,
		activeLessonId,
		activeBlockId,
		collapsed,
		ontoggle,
		oncourseSettings,
		onlessonSettings,
		oncardSettings,
		onrepairBlock
	}: Props = $props();

	const store = useStore();
	// The rows' actions; the rail has its own copy of these calls (`card-actions.ts`).
	const actions = cardActions(store, {
		onsettings: (blockId) => oncardSettings(blockId),
		onrepair: (blockId) => onrepairBlock(blockId)
	});
	// Cards carried between the open lesson, the other lessons and the backpack.
	const drag = new CardDrag(store, (lessonId, blockId) =>
		actions.removeFromLesson(lessonId, blockId, { follow: false })
	);

	/**
	 * In Pokročilý the tree shows the blocks the course is exported as, where one
	 * teacher's card may be several (`domain/groups.ts`). Each says which part of
	 * its card it is; in the other modes a card is one entry and says nothing.
	 */
	const groups = $derived(groupsOf(doc));
	function partOf(block: BlockV2): string | undefined {
		const key = groupOf(block);
		const members = key === undefined ? undefined : groups.get(key);
		if (members === undefined || members.length < 2) return undefined;
		return `část ${members.indexOf(block) + 1}/${members.length}`;
	}
	/**
	 * Where a card sits in a run of parts of one card: the thin line that joins them is
	 * drawn from the first part's middle to the last part's middle. Only neighbours in
	 * the same lesson are joined, so a line never jumps over a card that is not a part.
	 */
	function joinOf(position: number): 'first' | 'middle' | 'last' | undefined {
		const keyAt = (i: number) => {
			const id = cards[i]?.binding.block_id;
			const block = id === undefined ? undefined : doc.blocks.find((b) => b.block_id === id);
			return block === undefined ? undefined : groupOf(block);
		};
		const key = keyAt(position);
		if (key === undefined) return undefined;
		const before = keyAt(position - 1) === key;
		const after = keyAt(position + 1) === key;
		if (before && after) return 'middle';
		if (after) return 'first';
		if (before) return 'last';
		return undefined;
	}

	/**
	 * The one-time note, the first time the tree shows split cards in Pokročilý. It is
	 * not a toast: it has to stay until read, and a toast goes by itself after a few
	 * seconds. Dismissed once, it is remembered per browser.
	 */
	const PARTS_NOTE_KEY = 'edu-editor:parts-note-seen';
	let partsNote = $state(false);
	const hasSplitCards = $derived(groupsOf(store.source).size > 0);
	$effect(() => {
		if (collapsed || store.mode !== 'advanced' || !hasSplitCards) {
			partsNote = false;
			return;
		}
		try {
			if (localStorage.getItem(PARTS_NOTE_KEY) === null) partsNote = true;
		} catch {
			// No storage: the note shows each time the mode is switched, which is harmless.
			partsNote = true;
		}
	});
	function dismissPartsNote() {
		partsNote = false;
		try {
			localStorage.setItem(PARTS_NOTE_KEY, '1');
		} catch {
			// Nothing to remember it in.
		}
	}
	/**
	 * What the AI panel just put in the course, shown for a moment where it went: the new
	 * lessons' rows, the new cards in an open lesson, or the row of a folded lesson that got
	 * them. The selection stays where the teacher is.
	 */
	const LANDED_MS = 1600;
	let landed = $state<{ lessons: Set<string>; cards: Set<string> } | null>(null);
	let landedTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const what = aiPanel.landed;
		if (what === null) return;
		untrack(() => {
			landed = { lessons: new Set(what.lessonIds), cards: new Set(what.blockIds) };
			clearTimeout(landedTimer);
			landedTimer = setTimeout(() => (landed = null), LANDED_MS);
			void tick().then(() =>
				document.querySelector('.sidebar .landed')?.scrollIntoView({ block: 'nearest' })
			);
		});
	});
	const lessonLanded = (lesson: LessonV2, open: boolean): boolean =>
		drag.landed === lesson.lesson_id ||
		(landed !== null &&
			(landed.lessons.has(lesson.lesson_id) ||
				(!open && lesson.blocks.some((b) => landed!.cards.has(b.block_id)))));
	const dropTarget = (lessonId: string): boolean =>
		drag.hover?.kind === 'lesson' && drag.hover.lessonId === lessonId;

	const selectedLesson = $derived(activeLessonId);
	const selectedBlock = $derived(activeBlockId);

	// svelte-dnd-action keys items by an `id` property; a lesson is keyed by
	// `lesson_id`, so the zone is driven by a thin wrapper rather than by renaming
	// a field the format owns.
	type LessonItem = { id: string; lesson: LessonV2 };
	let draggingLessons = $state<LessonItem[] | null>(null);
	// The key carries the position as well as the id. A document with two lessons
	// sharing an id is exactly the document the validator exists to complain about,
	// and a keyed `{#each}` on the id alone throws before the author can read the
	// complaint — the tool would break on the error it is meant to report.
	const items = $derived(
		draggingLessons ??
			doc.lessons.map((lesson, i) => ({
				id: `${lesson.lesson_id}#${i}`,
				lesson
			}))
	);

	/**
	 * True from the press on a lesson until the drop (or the release of a press that
	 * never became a drag): every lesson shows only its header, so the dragged copy is
	 * one row tall and the gap it leaves is too, whichever lesson is open.
	 */
	let folding = $state(false);
	/** The list `grab` pinned and padded, until the drop or release clears it. */
	let pinned: HTMLElement | null = null;
	function unpin() {
		pinned?.style.removeProperty('min-height');
		pinned?.style.removeProperty('padding-top');
		pinned = null;
	}

	/**
	 * A lesson starting to move, before the library has measured anything. Mirrors the
	 * steps' `grab` (CardEditor): fold now so the library measures the short list, then
	 * put the lesson back under the pointer — the column is scrolled by what the fold
	 * moved, the list is pinned to its height so the scroll cannot be clamped, and
	 * whatever scrolling cannot give back is padded on top until the drop or release.
	 */
	async function grab(lesson: HTMLElement) {
		if (folding) return;
		const list = lesson.parentElement;
		const scroller = lesson.closest<HTMLElement>('.sidebar');
		const before = lesson.getBoundingClientRect().top;
		if (list !== null) {
			list.style.minHeight = `${list.getBoundingClientRect().height}px`;
			list.style.paddingTop = '';
		}
		folding = true;
		pinned = list;
		await tick();
		const shift = lesson.getBoundingClientRect().top - before;
		if (shift !== 0) scroller?.scrollBy({ top: shift, behavior: 'instant' });
		const rest = lesson.getBoundingClientRect().top - before;
		if (rest < -0.5 && list !== null) list.style.paddingTop = `${-rest}px`;
		// A press that never became a drag gets no `finalize`.
		const release = () => {
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
			window.removeEventListener('keyup', release);
			window.removeEventListener('blur', release);
			if (draggingLessons === null) {
				folding = false;
				unpin();
			}
		};
		window.addEventListener('pointerup', release);
		// A touch the browser takes over for a scroll ends in a cancel, not an up.
		window.addEventListener('pointercancel', release);
		window.addEventListener('keyup', release);
		window.addEventListener('blur', release);
	}
	/**
	 * A press on a lesson folds the list once the pointer moves 2 px: before the library's
	 * own threshold (3 px), so it still measures the folded list, but not on a plain
	 * click, which would fold and unfold the tree under the teacher's click.
	 */
	function lessonPress(event: PointerEvent) {
		const target = event.target as HTMLElement;
		// A card, the add row and the settings button are not the lesson's to grab, and
		// the library starts no drag from an element with a `value` (a button).
		if (event.button !== 0 || target.closest('.cards, .tree-add, .row-actions') !== null) return;
		if ((target as HTMLInputElement).value !== undefined) return;
		const lesson = event.currentTarget as HTMLElement;
		const { pointerId, clientX, clientY } = event;
		const move = (e: PointerEvent) => {
			if (e.pointerId !== pointerId) return;
			// Released where the window did not see it (another window): no drag after all.
			if (e.buttons === 0) return stop();
			// The jitter of a click is no drag; the library's own threshold is 3 px.
			if (Math.abs(e.clientX - clientX) < 2 && Math.abs(e.clientY - clientY) < 2) return;
			stop();
			void grab(lesson);
		};
		const stop = () => {
			window.removeEventListener('pointermove', move, true);
			window.removeEventListener('pointerup', stop, true);
			window.removeEventListener('pointercancel', stop, true);
		};
		window.addEventListener('pointermove', move, true);
		window.addEventListener('pointerup', stop, true);
		window.addEventListener('pointercancel', stop, true);
	}
	function lessonKey(event: KeyboardEvent) {
		if (event.target !== event.currentTarget) return;
		if (event.key === ' ' || event.key === 'Enter') void grab(event.currentTarget as HTMLElement);
	}

	function onconsider(event: CustomEvent<DndEvent<LessonItem>>) {
		draggingLessons = event.detail.items;
	}
	function onfinalize(event: CustomEvent<DndEvent<LessonItem>>) {
		draggingLessons = null;
		folding = false;
		// After the library's own unlock, which put the pinned min-height back.
		unpin();
		store.apply((d) =>
			reorderLessons(
				d,
				event.detail.items.map((item) => item.lesson.lesson_id)
			)
		);
	}

	// The card zone, for the open lesson only — which is what keeps the two nested
	// drag zones from ever having to coexist. A closed lesson takes a card on its name
	// (`card-drag.svelte.ts`).
	let draggingCards = $state<Held | null>(null);
	const openLesson = $derived(doc.lessons.find((l) => l.lesson_id === selectedLesson));
	// Keyed by the card's own id, so a card keeps its DOM (and its focus) when it
	// moves; a duplicated id in a broken course still gets a distinct key.
	const cards = $derived.by(() => {
		const held = drag.held(draggingCards);
		if (held !== null) return held;
		const bindings = openLesson?.blocks ?? [];
		const keys = uniqueKeys(bindings.map((b) => b.block_id));
		const lessonId = openLesson?.lesson_id;
		return bindings.map((binding, i): CardItem => ({ id: keys[i], binding, lessonId }));
	});

	function oncardConsider(event: CustomEvent<DndEvent<CardItem>>) {
		draggingCards = drag.hold(event.detail.items);
		drag.considered(event, openLesson?.lesson_id);
	}
	/**
	 * A card let go in the open lesson: reordered, or, when it came from the backpack,
	 * put in where it was let go. Let go over another lesson's name, it moves there.
	 */
	function oncardFinalize(event: CustomEvent<DndEvent<CardItem>>) {
		draggingCards = null;
		const toLesson = drag.finalized(event);
		if (openLesson === undefined) return;
		if (toLesson !== undefined) {
			const item = event.detail.items.find((i) => i.id === event.detail.info.id);
			if (item !== undefined) {
				drag.toLesson(item, toLesson);
				drag.glow(toLesson);
			}
			return;
		}
		if (event.detail.info.trigger === TRIGGERS.DROPPED_INTO_ANOTHER) return;
		const arrived = drag.arrived(event, (item) => item.from === undefined);
		if (arrived !== undefined) {
			drag.toLesson(arrived.item, openLesson.lesson_id, arrived.index);
			return;
		}
		store.apply((d) =>
			reorderBindings(
				d,
				openLesson.lesson_id,
				event.detail.items
					.filter((item) => item.from === undefined)
					.map((item) => item.binding.block_id)
			)
		);
	}

	/**
	 * A card's keys, for a row of the tree and a tile of the rail alike. Enter and
	 * Space select it; Alt+Arrow moves it. Both are claimed in the capture phase,
	 * because Svelte delegates a plain `onkeydown` to the root, after the `<li>` has
	 * already handed the key to svelte-dnd-action's keyboard drag.
	 */
	async function oncardkey(
		event: KeyboardEvent,
		lessonId: string,
		blockId: string,
		position: number
	) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			event.stopPropagation();
			select(lessonId, blockId);
		} else if (
			event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			(event.key === 'ArrowUp' || event.key === 'ArrowDown')
		) {
			event.preventDefault();
			event.stopPropagation();
			const delta = event.key === 'ArrowUp' ? -1 : 1;
			const target = position + delta;
			if (target < 0 || target >= cards.length) return;
			const list = (event.currentTarget as HTMLElement).closest('ul');
			store.apply((d) => moveBlockInLesson(d, lessonId, blockId, delta));
			// Moving a node in the DOM drops its focus; give it back to the same card.
			await tick();
			list?.querySelectorAll<HTMLElement>(':scope > li > [role="button"]')[target]?.focus();
		}
	}

	/**
	 * A tree row's keys are the card's (`oncardkey`), and → besides, which goes into
	 * the row's actions. Escape or ← from the first action comes back (`backToRow`).
	 */
	function rowKey(event: KeyboardEvent, lessonId: string, blockId: string, position: number) {
		if (event.key === 'ArrowRight' && !event.altKey && !event.ctrlKey && !event.metaKey) {
			event.preventDefault();
			event.stopPropagation();
			(event.currentTarget as HTMLElement)
				.closest('li')
				?.querySelector<HTMLElement>('.card-actions button')
				?.focus();
			return;
		}
		oncardkey(event, lessonId, blockId, position);
	}

	/**
	 * A new lesson is named "Nová lekce" until the teacher says otherwise, so its
	 * settings open with the name selected: typing renames it.
	 */
	function newLesson() {
		const result = store.apply((d, r) => addLesson(d, undefined, r));
		const lessonId = result.ref?.lessonId;
		if (lessonId !== undefined) onlessonSettings(lessonId, { focusName: true });
	}

	/**
	 * „Všechny otázky v jedné kartě“ can take its own button away (a card left with
	 * fewer than two questions no longer offers it), and with it the focus. Focus that
	 * was on the card's buttons then goes to the card's row.
	 */
	async function toggleTogether(block: BlockV2, lessonId: string) {
		const inside = document.activeElement?.closest('.tree-actions') != null;
		actions.toggleTogether(block, lessonId);
		await tick();
		if (!inside || (document.activeElement !== document.body && document.activeElement !== null))
			return;
		document.querySelector<HTMLElement>('.tree-card.selected')?.focus();
	}

	/**
	 * A card's row is about to go (deleted, or taken out of the lesson): focus moves to
	 * the next row, else the previous one, else the lesson's „Přidat kartu“.
	 */
	function leaveRow(change: () => void) {
		const row = document.activeElement?.closest('ul.cards > li') ?? null;
		const list = row?.parentElement ?? null;
		const index = row === null || list === null ? -1 : [...list.children].indexOf(row);
		const before = countOf(list, ROWS);
		change();
		if (list !== null)
			void focusAfterDelete(list, ROWS, index, before, () =>
				list.closest('li')?.querySelector<HTMLElement>('.tree-add button')
			);
	}
	const ROWS = ':scope > li';

	function backToRow() {
		document.activeElement
			?.closest('li')
			?.querySelector<HTMLElement>(':scope > [role="button"]')
			?.focus();
	}

	// Counted from what may be shown, like every inline marker — a card nobody has
	// left yet is being written, not broken. The top bar and export review count all.
	const errorsIn = (lessonId: string) =>
		store.shown.errors.filter(
			(issue) =>
				issue.ref.lessonId === lessonId ||
				(issue.ref.blockId !== undefined &&
					(store.index.lessonsByBlock.get(issue.ref.blockId) ?? []).includes(lessonId))
		).length;

	const errorsOn = (blockId: string) =>
		store.shown.errors.filter((issue) => issue.ref.blockId === blockId).length;

	const orphans = $derived(
		doc.blocks.filter((b) => (store.index.lessonsByBlock.get(b.block_id) ?? []).length === 0)
	);

	function select(lessonId: string, blockId: string) {
		store.selection = { lessonId, blockId };
	}

	function selectLesson(lessonId: string) {
		store.selection = { lessonId };
	}
</script>

<nav class="sidebar" class:collapsed aria-label="Struktura kurzu">
	<button
		type="button"
		class="rail-toggle"
		onclick={ontoggle}
		class:collapsed
		aria-label={collapsed ? 'Rozbalit panel lekcí' : 'Sbalit panel lekcí'}
		title={collapsed ? 'Rozbalit panel lekcí (Ctrl+B)' : 'Sbalit panel lekcí (Ctrl+B)'}
	>
		{#if collapsed}
			<PanelLeftOpen size={16}></PanelLeftOpen>
		{:else}
			<PanelLeftClose size={16}></PanelLeftClose>
		{/if}
	</button>

	{#if !collapsed}
		<button type="button" class="course" onclick={oncourseSettings}>
			<span class="gear" aria-hidden="true"><Settings></Settings></span>
			<span class="name">{doc.name || 'Nový kurz'}</span>
			<span class="meta">Nastavení kurzu</span>
		</button>

		{#if partsNote}
			<div class="parts-note" role="note">
				<p>
					V Pokročilém vidíš karty tak, jak je dostane aplikace: karta s více otázkami je rozdělená
					na části.
				</p>
				<button type="button" onclick={dismissPartsNote}>Rozumím</button>
			</div>
		{/if}

		<h2>Lekce</h2>

		<ul use:dndzone={{ items, flipDurationMs: 150, dropTargetStyle: {} }} {onconsider} {onfinalize}>
			{#each items as item (item.id)}
				{@const lesson = item.lesson}
				{@const totals = lessonTotals(lesson, store.index)}
				{@const errors = errorsIn(lesson.lesson_id)}
				{@const open = lesson.lesson_id === selectedLesson}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions (the library makes the lesson a draggable item; these only fold the list for it) -->
				<li class="tree-lesson" class:open onpointerdown={lessonPress} onkeydown={lessonKey}>
					<button
						type="button"
						class="lesson"
						class:selected={open}
						class:landed={lessonLanded(lesson, open)}
						class:drop-target={dropTarget(lesson.lesson_id)}
						data-drop-lesson={lesson.lesson_id}
						onclick={() => selectLesson(lesson.lesson_id)}
					>
						<span class="name">{lessonLabel(doc, lesson)}</span>
						<span class="meta">
							{cardsCount(totals.blockCount)} · {totals.durationMinutes}
							min · {totals.xp} XP
						</span>
					</button>
					<div class="row-actions" class:pinned={open}>
						{#if errors > 0}<Chip tone="error">{errors}</Chip>{/if}
						<button
							type="button"
							title="Nastavení lekce"
							aria-label={`Nastavení lekce ${lessonLabel(doc, lesson)}`}
							onclick={() => onlessonSettings(lesson.lesson_id)}
							class="icon-button"
						>
							<Settings size={16}></Settings>
						</button>
					</div>

					{#if open && !folding}
						<ul
							class="cards"
							use:dndzone={{
								items: cards,
								flipDurationMs: 150,
								dropTargetStyle: {},
								type: 'bindings',
								// The card inside is the one tab stop; the library's own
								// keyboard drag on the <li> would be a second, unlabelled one.
								zoneItemTabIndex: -1
							}}
							onconsider={oncardConsider}
							onfinalize={oncardFinalize}
						>
							{#each cards as card, position (card.id)}
								{@const block = drag.blockOf(card)}
								<li
									class="tree-row"
									class:selected={block?.block_id === selectedBlock}
									data-join={joinOf(position)}
								>
									{#if block === undefined}
										<span class="missing" title={card.binding.block_id}>Chybějící karta</span>
									{:else}
										{@const cardErrors = errorsOn(block.block_id)}
										{@const Icon = cardTypeIcon(block.type)}
										<!--
											A div, not a button: svelte-dnd-action refuses to start a
											drag from an element that has a `value` (every button does)
											unless the press lands on a child, so only the text used to
											grab. Enter and Space select it, as they would a button.
										-->
										<!-- svelte-ignore a11y_click_events_have_key_events (the key handler is a capture one, which the check does not see) -->
										<div
											role="button"
											tabindex="0"
											class="tree-card"
											class:selected={block.block_id === selectedBlock}
											class:landed={landed?.cards.has(block.block_id) === true}
											onclick={() => select(lesson.lesson_id, block.block_id)}
											title="Alt+šipka nahoru nebo dolů přesune kartu"
											onkeydowncapture={(event) =>
												rowKey(event, lesson.lesson_id, block.block_id, position)}
										>
											<span class="type">
												{#if ai.writing.has(block.block_id)}
													<LoaderCircle size={16} class="spin" aria-label="AI kartu píše"
													></LoaderCircle>
												{:else}
													<Icon size={16}></Icon>
												{/if}
											</span>
											<!--
												The position is a fallback name for a card with no text
												yet, not a number printed next to every card: three cards
												added in a row were otherwise all "Karta bez textu" here.
											-->
											<span class="snippet">
												{blockPreview(block, 44, position + 1)}
											</span>
											<span class="steps">{partOf(block) ?? stepsCount(block.steps.length)}</span>
											{#if cardErrors > 0}
												<Chip tone="error">{cardErrors}</Chip>
											{/if}
										</div>
										<!--
											A sibling of the row, not inside it: the row is what a
											drag grabs, and a press on a button must not grab it.
											Always laid out and only faded, so it can be focused.
										-->
										<div class="tree-actions">
											<CardActions
												size="s"
												position={position + 1}
												onsettings={() => actions.settings(lesson.lesson_id, block.block_id)}
												onduplicate={() => {
													actions.duplicate(block.block_id, lesson.lesson_id);
													void focusSelectedCard();
												}}
												together={actions.together(block)?.on}
												ontoggleTogether={() => toggleTogether(block, lesson.lesson_id)}
												onremoveFromLesson={() =>
													leaveRow(() =>
														actions.removeFromLesson(lesson.lesson_id, block.block_id, {
															follow: false
														})
													)}
												onremove={() =>
													leaveRow(() => actions.remove(block.block_id, lesson.lesson_id))}
												onexit={backToRow}
											/>
										</div>
									{/if}
								</li>
							{/each}
						</ul>

						<div class="tree-add">
							<span class="add-label">Přidat kartu:</span>
							{#each CARD_TYPES as option (option.type)}
								<Button
									variant="secondary"
									size="s"
									title={option.title}
									onclick={() => {
										store.apply((d, r) => addBlock(d, lesson.lesson_id, option.type, undefined, r));
										void focusSelectedCard();
									}}
								>
									{@const Icon = option.icon}
									<Icon size={16}></Icon>
									{option.label}
								</Button>
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<div class="add">
			<!--
				No name is passed: `addLesson` numbers the default against the lessons
				already in the course ("Nová lekce", "Nová lekce 2", …). Passing the
				literal here is what made every new lesson identical in this list.
			-->
			<Button variant="secondary" onclick={newLesson}>
				<Plus size={16}></Plus> Nová lekce
			</Button>
		</div>
	{:else}
		<SidebarRail
			{doc}
			activeLessonId={selectedLesson}
			activeBlockId={selectedBlock}
			{cards}
			{oncardConsider}
			{oncardFinalize}
			{oncardkey}
			{errorsIn}
			{errorsOn}
			{onlessonSettings}
			{oncardSettings}
			{onrepairBlock}
			{dropTarget}
			landedLesson={drag.landed}
		/>
	{/if}

	<div class="bottom">
		<Backpack
			{drag}
			loose={orphans}
			selectedBlockId={selectedBlock}
			lessonId={selectedLesson}
			{collapsed}
			onexpand={ontoggle}
		>
			{#if !collapsed}
				<Chip tone="quiet" title="Součet přes celý kurz">{store.totals.durationMinutes} min</Chip>
				<Chip tone="quiet" title={doc.max_xp ? `Strop kurzu je ${doc.max_xp} XP` : 'Bez stropu'}>
					{store.totals.cappedXp} XP
				</Chip>
			{/if}
		</Backpack>
	</div>
</nav>

<style>
	.sidebar {
		position: relative;
		display: flex;
		flex-direction: column;
		width: var(--e-sidebar-width);
		flex: none;
		padding: 16px 12px;
		border-right: 1px solid var(--e-border);
		background: var(--surface);
		overflow-y: auto;
		transition:
			width 0.3s,
			padding 0.3s;
	}

	.sidebar.collapsed {
		width: var(--e-sidebar-rail);
		padding: 16px 6px;
	}

	.rail-toggle {
		position: absolute;
		top: 12px;
		right: 8px;
		width: 30px;
		height: 30px;
		border: 1px solid var(--e-border);
		border-radius: 50%;
		background: var(--surface);
		color: var(--e-text-muted);
		cursor: pointer;
		z-index: 1;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.rail-toggle.collapsed {
		right: 16px;
		top: 8px;
	}

	.course {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0 8px;
		width: 100%;
		margin-bottom: 8px;
		padding: 8px 30px 8px 10px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.course:hover {
		border-color: var(--primary);
		background: var(--primary-dark-06);
	}

	.gear {
		grid-row: span 2;
		align-self: center;
		color: var(--e-text-faint);
	}

	h2 {
		margin: 6px 0 10px;
		color: var(--e-text-faint);
		font: var(--type-badge-small);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		position: relative;
	}

	.tree-lesson:hover .row-actions {
		display: flex;
	}

	.tree-lesson.open {
		margin-bottom: 8px;
		padding-bottom: 6px;
		border-radius: var(--radius-s);
	}

	/* The dragged copy is a clone in <body>: with only a tint it is see-through, so
	   every lesson carries the sidebar's surface behind its own colour. */
	.tree-lesson {
		background: var(--surface);
	}
	.tree-lesson.open {
		background: linear-gradient(var(--primary-dark-06), var(--primary-dark-06)), var(--surface);
	}

	.lesson {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: var(--radius-s);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.lesson:hover {
		background: var(--info-bg);
	}

	/* Where the AI panel's proposal just went: a short, quiet glow, once. */
	.lesson.landed,
	.tree-card.landed {
		animation: landed 1600ms ease-out;
	}

	@keyframes landed {
		from {
			background: var(--primary-dark-12, var(--info-bg));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lesson.landed,
		.tree-card.landed {
			animation: none;
			outline: 2px solid var(--primary);
		}
	}

	.lesson.selected .name {
		font: var(--type-meta-bold);
	}

	.name {
		color: var(--e-text);
		font: var(--type-body-small);
	}

	.meta {
		color: var(--e-text-faint);
		font: var(--type-caption);
	}

	/*
	 * The gear on the open lesson is always there; duplicate and delete moved into
	 * the panel it opens. An action that only exists on hover is an action nobody
	 * finds, and the one thing worth finding here is the settings.
	 */
	.row-actions {
		display: none;
		position: absolute;
		top: 8px;
		right: 6px;
		gap: 2px;
	}

	.row-actions.pinned {
		display: flex;
	}

	.row-actions button {
		width: 22px;
		height: 22px;
		border: none;
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text-faint);
		cursor: pointer;
	}

	.row-actions button:hover {
		background: var(--surface-light);
		color: var(--e-text);
	}

	.cards {
		gap: 4px;
		margin: 0 6px;
	}

	/* Parts of one card: a thin line down the row's left edge, from the middle of the first
	   part to the middle of the last, so "část 1/2" and "část 2/2" read as one card. */
	.tree-row[data-join]::before {
		content: '';
		position: absolute;
		left: -3px;
		width: 1px;
		background: var(--e-border-strong, var(--e-border));
		pointer-events: none;
	}

	.tree-row[data-join='first']::before {
		top: 50%;
		bottom: -1px;
	}

	.tree-row[data-join='middle']::before {
		top: -1px;
		bottom: -1px;
	}

	.tree-row[data-join='last']::before {
		top: -1px;
		bottom: 50%;
	}

	.parts-note {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		margin: 4px 8px;
		padding: 8px 10px;
		border-left: 2px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		line-height: 1.5;
	}

	.parts-note p {
		margin: 0;
	}

	.parts-note button {
		padding: 0;
		border: none;
		background: none;
		color: var(--primary);
		font: inherit;
		font-weight: var(--weight-semibold);
		cursor: pointer;
	}

	.tree-card {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 2px 6px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		border-left: 2px solid transparent;
		border-radius: var(--radius-xs);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.tree-card:hover,
	.tree-row:focus-within .tree-card {
		background: var(--surface);
	}

	/*
	 * The row's actions: over its right end, faded in on hover, on focus inside and
	 * on the selected row. The gradient carries the row's own background over the end
	 * of the snippet, so the buttons never sit on running text. Faded, never
	 * `display: none`: a control that is not laid out cannot be focused. The band
	 * itself takes no presses (a drag can start from it); only the buttons do.
	 */
	.tree-actions {
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		display: flex;
		align-items: center;
		padding: 0 6px 0 10px;
		/* The band spans the whole row height, so no glyph of the title shows above it. */
		background: linear-gradient(to right, transparent, var(--surface) 10px);
		border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
		opacity: 0;
		transition: opacity 120ms ease;
		pointer-events: none;
	}

	.tree-actions :global(.row) {
		pointer-events: none;
	}

	.tree-row:hover .tree-actions,
	.tree-row:focus-within .tree-actions,
	.tree-row.selected .tree-actions {
		opacity: 1;
	}

	.tree-row:hover .tree-actions :global(.row),
	.tree-row:focus-within .tree-actions :global(.row),
	.tree-row.selected .tree-actions :global(.row) {
		pointer-events: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.tree-actions {
			transition: none;
		}
	}

	.tree-card.selected {
		border-left-color: var(--primary);
		background: var(--surface);
		box-shadow: var(--shadow-light);
	}

	/* While the action band is over the row's end, the name ends with an ellipsis before
	   it rather than being cut mid-letter under it. */
	.tree-row:hover .tree-card .snippet,
	.tree-row:focus-within .tree-card .snippet,
	.tree-row.selected .tree-card .snippet {
		padding-right: var(--actions-room, 132px);
	}

	.snippet {
		overflow: hidden;
		color: var(--e-text);
		font: var(--type-caption);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tree-card .steps {
		grid-column: 2;
		color: var(--e-text-faint);
		font: var(--type-caption);
	}

	.type {
		grid-row: span 2;
		align-self: center;
	}

	.missing {
		display: block;
		padding: 6px 8px;
		color: var(--e-error-text);
		font-size: var(--text-xs);
	}

	.tree-add {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin: 6px 8px 0;
	}

	/*
	 * Three bare words — Výklad, Otázka, Cvičení — read as a filter or as the card
	 * types already present. Saying what the buttons make is also what separates the
	 * Cvičení *card* here from the Cvičení *course type* in course settings.
	 */
	.add-label {
		width: 100%;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.add {
		margin-top: 8px;
	}

	/* The backpack and the course's totals stay in view at the bottom while the lessons scroll. */
	.bottom {
		position: sticky;
		bottom: -16px;
		margin: auto -12px -16px;
		padding: 12px 12px 16px;
		background: var(--surface);
		z-index: 2;
	}

	.sidebar.collapsed .bottom {
		margin: auto -6px -16px;
		padding: 12px 6px 16px;
	}

	/* A lesson a carried card would go into, if let go now. */
	.lesson.drop-target {
		background: var(--info-bg);
		box-shadow: inset 0 0 0 2px var(--primary);
	}

	/* A card AI is writing: its type icon turns, slowly, until the text arrives. */
	.type :global(.spin) {
		animation: tree-spin 1.2s linear infinite;
	}

	@keyframes tree-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.type :global(.spin) {
			animation: none;
		}
	}
</style>
