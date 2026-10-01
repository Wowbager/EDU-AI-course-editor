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
	import type { BlockV2, CourseV2, LessonBlockBinding, LessonV2 } from '$lib/domain/schema';
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
	import { cardsCount, stepsCount } from '$lib/ui/plural';
	import { uniqueKeys } from '$lib/ui/keys';
	import { groupOf, groupsOf } from '$lib/domain/groups';
	import { lessonLabel } from '$lib/domain/naming';
	import { CARD_TYPES, cardTypeIcon } from '$lib/ui/card-types';
	import SidebarRail from './SidebarRail.svelte';
	import CardActions from './CardActions.svelte';
	import { cardActions } from './card-actions';
	import { PanelLeftOpen, PanelLeftClose, Settings, Plus } from '@lucide/svelte';

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
		onlessonSettings: (lessonId: string) => void;
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
	// The rows' four actions; the rail has its own copy of these calls (`card-actions.ts`).
	const actions = cardActions(store, {
		onsettings: (blockId) => oncardSettings(blockId),
		onrepair: (blockId) => onrepairBlock(blockId)
	});

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
	// drag zones from ever having to coexist.
	type CardItem = { id: string; binding: LessonBlockBinding };
	let draggingCards = $state<CardItem[] | null>(null);
	const openLesson = $derived(doc.lessons.find((l) => l.lesson_id === selectedLesson));
	// Keyed by the card's own id, so a card keeps its DOM (and its focus) when it
	// moves; a duplicated id in a broken course still gets a distinct key.
	const cards = $derived.by(() => {
		if (draggingCards !== null) return draggingCards;
		const bindings = openLesson?.blocks ?? [];
		const keys = uniqueKeys(bindings.map((b) => b.block_id));
		return bindings.map((binding, i) => ({ id: keys[i], binding }));
	});

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
				event.detail.items.map((item) => item.binding.block_id)
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
	const orphanKeys = $derived(uniqueKeys(orphans.map((b) => b.block_id)));

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
			<span class="name">{doc.name || 'Nový kurz'}</span>
			<span class="meta">Nastavení kurzu</span>
		</button>

		<h2>Lekce</h2>

		<ul use:dndzone={{ items, flipDurationMs: 150, dropTargetStyle: {} }} {onconsider} {onfinalize}>
			{#each items as item (item.id)}
				{@const lesson = item.lesson}
				{@const totals = lessonTotals(lesson, store.index)}
				{@const errors = errorsIn(lesson.lesson_id)}
				{@const open = lesson.lesson_id === selectedLesson}
				<li class="tree-lesson" class:open>
					<button
						type="button"
						class="lesson"
						class:selected={open}
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

					{#if open}
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
								{@const block = doc.blocks.find((b) => b.block_id === card.binding.block_id)}
								<li class="tree-row" class:selected={block?.block_id === selectedBlock}>
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
											onclick={() => select(lesson.lesson_id, block.block_id)}
											title="Alt+↑/↓ přesune kartu"
											onkeydowncapture={(event) =>
												rowKey(event, lesson.lesson_id, block.block_id, position)}
										>
											<span class="type">
												<Icon size={16}></Icon>
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
												onduplicate={() => actions.duplicate(block.block_id, lesson.lesson_id)}
												onremoveFromLesson={() =>
													actions.removeFromLesson(lesson.lesson_id, block.block_id, {
														follow: false
													})}
												onremove={() => actions.remove(block.block_id, lesson.lesson_id)}
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
			<Button variant="secondary" onclick={() => store.apply((d, r) => addLesson(d, undefined, r))}>
				<Plus size={16}></Plus> Nová lekce
			</Button>
		</div>

		{#if orphans.length > 0}
			<h2 class="secondary">Karty mimo lekce</h2>
			<ul class="orphans">
				{#each orphans as block, i (orphanKeys[i])}
					{@const Icon = cardTypeIcon(block.type)}
					<li>
						<button
							type="button"
							class="tree-card"
							class:selected={block.block_id === selectedBlock}
							onclick={() => selectOrphan(block.block_id)}
						>
							<span class="type">
								<Icon size={16}></Icon>
							</span>
							<span class="snippet">{blockPreview(block, 44)}</span>
							<span class="steps">žák se k ní nedostane</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
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
		/>
	{/if}

	{#if !collapsed}
		<footer>
			<Chip tone="quiet" title="Součet přes celý kurz">{store.totals.durationMinutes} min</Chip>
			<Chip tone="quiet" title={doc.max_xp ? `Strop kurzu je ${doc.max_xp} XP` : 'Bez stropu'}>
				{store.totals.cappedXp} XP
			</Chip>
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
		top: 50%;
		right: 0;
		display: flex;
		align-items: center;
		padding: 2px 6px;
		background: var(--surface);
		border-radius: var(--radius-xs);
		opacity: 0;
		transform: translateY(-50%);
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
