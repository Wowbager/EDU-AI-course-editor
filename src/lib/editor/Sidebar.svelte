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
	import { tick } from 'svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { TreeCard, TreeLesson } from '$lib/screen';
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
	import { CARD_TYPES, cardTypeIcon } from '$lib/ui/card-types';
	import SidebarRail from './SidebarRail.svelte';
	import CardActions from './CardActions.svelte';
	import { cardActions } from './card-actions';
	import { PanelLeftOpen, PanelLeftClose, Settings, Plus } from '@lucide/svelte';

	interface Props {
		collapsed: boolean;
		ontoggle: () => void;
		oncourseSettings: () => void;
		onlessonSettings: (lessonId: string, options?: { focusName?: boolean }) => void;
		oncardSettings: (blockId: string) => void;
		/** A card another card points at: the repair dialog decides where those go. */
		onrepairBlock: (blockId: string) => void;
	}
	let {
		collapsed,
		ontoggle,
		oncourseSettings,
		onlessonSettings,
		oncardSettings,
		onrepairBlock
	}: Props = $props();

	const store = useStore();
	/**
	 * Every word and number in the tree is `store.screen.tree`: names by the one naming
	 * rule, parts and joins, counts, durations and XP, the error markers (from what may
	 * be shown inline, not from everything found), the cards no lesson holds. This file
	 * keeps the drag zones, the keys and the selection, which are the pointer's.
	 *
	 * What is open (the highlighted lesson and card) is `store.open`, resolved in the
	 * model; a ref does not always name its lesson, and the tree must never highlight
	 * something other than what is open.
	 */
	const tree = $derived(store.screen.tree);
	const note = $derived(store.screen.ui.parts_note);
	// The rows' four actions; the rail has its own copy of these calls (`card-actions.ts`).
	const actions = cardActions(store, {
		onsettings: (blockId) => oncardSettings(blockId),
		onrepair: (blockId) => onrepairBlock(blockId)
	});

	/**
	 * The one-time note, the first time the tree shows split cards in Pokročilý. It is
	 * not a toast: it has to stay until read, and a toast goes by itself after a few
	 * seconds. Dismissed once, it is remembered per browser (`store.ui`).
	 */
	$effect(() => {
		if (note.eligible) store.ui.readPartsNote();
		else store.ui.forgetPartsNote();
	});

	// svelte-dnd-action keys items by an `id` property; a lesson is keyed by the model's
	// key (its id, made unique for a document that repeats one), so the zone is driven
	// by a thin wrapper rather than by renaming a field the format owns.
	type LessonItem = { id: string; lesson: TreeLesson };
	let draggingLessons = $state<LessonItem[] | null>(null);
	const items = $derived(
		draggingLessons ?? tree.lessons.map((lesson) => ({ id: lesson.key, lesson }))
	);

	function onconsider(event: CustomEvent<DndEvent<LessonItem>>) {
		draggingLessons = event.detail.items;
	}
	function onfinalize(event: CustomEvent<DndEvent<LessonItem>>) {
		draggingLessons = null;
		store.apply((d) =>
			reorderLessons(
				d,
				event.detail.items.map((item) => item.lesson.lesson_id)
			)
		);
	}

	// The card zone, for the open lesson only — which is what keeps the two nested
	// drag zones from ever having to coexist. Keyed by the card's own id (made unique),
	// so a card keeps its DOM (and its focus) when it moves.
	type CardItem = { id: string; card: TreeCard };
	let draggingCards = $state<CardItem[] | null>(null);
	const openLesson = $derived(tree.lessons.find((l) => l.open));
	const cards = $derived<CardItem[]>(
		draggingCards ?? (openLesson?.cards ?? []).map((card) => ({ id: card.key, card }))
	);

	function oncardConsider(event: CustomEvent<DndEvent<CardItem>>) {
		draggingCards = event.detail.items;
	}
	function oncardFinalize(event: CustomEvent<DndEvent<CardItem>>) {
		draggingCards = null;
		if (openLesson === undefined) return;
		store.apply((d) =>
			reorderBindings(
				d,
				openLesson.lesson_id,
				event.detail.items.map((item) => item.card.block_id)
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

	function backToRow() {
		document.activeElement
			?.closest('li')
			?.querySelector<HTMLElement>(':scope > [role="button"]')
			?.focus();
	}

	function select(lessonId: string, blockId: string) {
		store.selection = { lessonId, blockId };
	}

	function selectLesson(lessonId: string) {
		store.selection = { lessonId };
	}

	function selectOrphan(blockId: string) {
		store.selection = { blockId };
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
			<span class="name" data-screen="tree.course.name">{tree.course.name}</span>
			<span class="meta">Nastavení kurzu</span>
		</button>

		{#if note.shown}
			<div class="parts-note" role="note">
				<p>
					V Pokročilém vidíš karty tak, jak je dostane aplikace: karta s více otázkami je rozdělená
					na části.
				</p>
				<button type="button" onclick={() => store.ui.dismissPartsNote()}>Rozumím</button>
			</div>
		{/if}

		<h2>Lekce</h2>

		<ul use:dndzone={{ items, flipDurationMs: 150, dropTargetStyle: {} }} {onconsider} {onfinalize}>
			{#each items as item (item.id)}
				{@const lesson = item.lesson}
				{@const L = lesson.index - 1}
				<li class="tree-lesson" class:open={lesson.open}>
					<button
						type="button"
						class="lesson"
						class:selected={lesson.open}
						onclick={() => selectLesson(lesson.lesson_id)}
					>
						<span class="name" data-screen="tree.lessons[{L}].name">{lesson.name}</span>
						<span class="meta" data-screen="tree.lessons[{L}].summary">{lesson.summary}</span>
					</button>
					<div class="row-actions" class:pinned={lesson.open}>
						{#if lesson.errors > 0}
							<Chip tone="error" screen="tree.lessons[{L}].errors">{lesson.errors}</Chip>
						{/if}
						<button
							type="button"
							title="Nastavení lekce"
							aria-label={`Nastavení lekce ${lesson.name}`}
							onclick={() => onlessonSettings(lesson.lesson_id)}
							class="icon-button"
						>
							<Settings size={16}></Settings>
						</button>
					</div>

					{#if lesson.open}
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
							{#each cards as item, position (item.id)}
								{@const card = item.card}
								{@const P = card.position - 1}
								<li
									class="tree-row"
									class:selected={card.selected}
									data-join={card.join ?? undefined}
								>
									{#if card.missing}
										<span class="missing" title={card.block_id}>{card.name}</span>
									{:else}
										{@const Icon = cardTypeIcon(card.type!)}
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
											class:selected={card.selected}
											onclick={() => select(lesson.lesson_id, card.block_id)}
											title="Alt+šipka nahoru nebo dolů přesune kartu"
											onkeydowncapture={(event) =>
												rowKey(event, lesson.lesson_id, card.block_id, position)}
										>
											<span class="type">
												<Icon size={16}></Icon>
											</span>
											<!--
												The position is a fallback name for a card with no text
												yet, not a number printed next to every card: three cards
												added in a row were otherwise all "Karta bez textu" here.
											-->
											<span class="snippet" data-screen="tree.lessons[{L}].cards[{P}].name">
												{card.name}
											</span>
											<span class="steps" data-screen="tree.lessons[{L}].cards[{P}].steps_text"
												>{card.steps_text}</span
											>
											{#if card.errors > 0}
												<Chip tone="error" screen="tree.lessons[{L}].cards[{P}].errors"
													>{card.errors}</Chip
												>
											{/if}
										</div>
										<!--
											A sibling of the row, not inside it: the row is what a
											drag grabs, and a press on a button must not grab it.
											Always laid out and only faded, so it can be focused.
										-->
										<div class="tree-actions">
											<CardActions
												armKey="card:{card.block_id}"
												size="s"
												position={position + 1}
												onsettings={() => actions.settings(lesson.lesson_id, card.block_id)}
												onduplicate={() => actions.duplicate(card.block_id, lesson.lesson_id)}
												onremoveFromLesson={() =>
													actions.removeFromLesson(lesson.lesson_id, card.block_id, {
														follow: false
													})}
												onremove={() => actions.remove(card.block_id, lesson.lesson_id)}
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
									onclick={() =>
										store.apply((d, r) => addBlock(d, lesson.lesson_id, option.type, undefined, r))}
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

		{#if tree.orphans.length > 0}
			<h2 class="secondary">{tree.orphans_heading}</h2>
			<ul class="orphans">
				{#each tree.orphans as orphan, i (orphan.key)}
					{@const Icon = cardTypeIcon(orphan.type)}
					<li>
						<button
							type="button"
							class="tree-card"
							class:selected={orphan.selected}
							onclick={() => selectOrphan(orphan.block_id)}
						>
							<span class="type">
								<Icon size={16}></Icon>
							</span>
							<span class="snippet" data-screen="tree.orphans[{i}].name">{orphan.name}</span>
							<span class="steps">{orphan.note}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		<SidebarRail
			{cards}
			{oncardConsider}
			{oncardFinalize}
			{oncardkey}
			{onlessonSettings}
			{oncardSettings}
			{onrepairBlock}
		/>
	{/if}

	{#if !collapsed}
		<footer>
			<Chip tone="quiet" title={tree.footer.duration_title} screen="tree.footer.duration"
				>{tree.footer.duration}</Chip
			>
			<Chip tone="quiet" title={tree.footer.xp_title} screen="tree.footer.xp">{tree.footer.xp}</Chip
			>
		</footer>
	{/if}
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

	h2.secondary {
		margin-top: 20px;
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
		background: var(--primary-dark-06);
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
		gap: 1px;
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
		color: var(--e-error);
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

	.orphans {
		gap: 1px;
	}

	footer {
		display: flex;
		gap: 6px;
		margin-top: auto;
		padding-top: 16px;
	}
</style>
