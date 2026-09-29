<script lang="ts">
	/**
	 * The lesson panel folded to a rail: one circle per lesson and, under the open
	 * one, one tile per card. It is not a smaller copy of the tree. It keeps what a
	 * teacher does with the tree most — see where they are, jump to a card, reorder,
	 * add a card — and drops the text.
	 *
	 * A tile is an icon and nothing else. What can be done to a card (settings,
	 * duplicate, remove from the lesson, delete) is in a panel that opens beside the
	 * tile on hover or focus (`RailPeek`), the same four actions as the tree's rows
	 * (`CardActions`). A lesson circle opens a lighter one, with its totals and its
	 * settings.
	 *
	 * The card zone's state (`cards`, the drag handlers and the keys) belongs to
	 * `Sidebar` and is handed in, so a card is reordered by exactly the same code
	 * whichever of the two is showing.
	 */
	import { tick } from 'svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { Plus, Settings } from '@lucide/svelte';
	import type { CourseV2, LessonBlockBinding } from '$lib/domain/schema';
	import { addBlock, addLesson } from '$lib/domain/commands';
	import { blockPreview, lessonTotals } from '$lib/domain/derive';
	import { lessonLabel } from '$lib/domain/naming';
	import { CARD_TYPES, cardTypeIcon, cardTypeLabel } from '$lib/ui/card-types';
	import { useStore } from '$lib/ui/context';
	import { uniqueKeys } from '$lib/ui/keys';
	import { cardsCount, errorsCount } from '$lib/ui/plural';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';
	import CardActions from './CardActions.svelte';
	import RailPeek from './RailPeek.svelte';
	import { cardActions } from './card-actions';

	type CardItem = { id: string; binding: LessonBlockBinding };

	interface Props {
		doc: CourseV2;
		activeLessonId: string | undefined;
		activeBlockId: string | undefined;
		/** The open lesson's cards, as the drag zone keeps them. */
		cards: CardItem[];
		oncardConsider: (event: CustomEvent<DndEvent<CardItem>>) => void;
		oncardFinalize: (event: CustomEvent<DndEvent<CardItem>>) => void;
		oncardkey: (event: KeyboardEvent, lessonId: string, blockId: string, position: number) => void;
		errorsIn: (lessonId: string) => number;
		errorsOn: (blockId: string) => number;
		onlessonSettings: (lessonId: string) => void;
		oncardSettings: (blockId: string) => void;
		onrepairBlock: (blockId: string) => void;
	}
	let {
		doc,
		activeLessonId,
		activeBlockId,
		cards,
		oncardConsider,
		oncardFinalize,
		oncardkey,
		errorsIn,
		errorsOn,
		onlessonSettings,
		oncardSettings,
		onrepairBlock
	}: Props = $props();

	const store = useStore();
	const lessonKeys = $derived(uniqueKeys(doc.lessons.map((l) => l.lesson_id)));
	const actions = cardActions(store, {
		onsettings: (blockId) => oncardSettings(blockId),
		onrepair: (blockId) => onrepairBlock(blockId)
	});

	function selectLesson(lessonId: string) {
		store.selection = { lessonId };
	}

	// ── The peek: which tile or circle has its panel open ─────────────────────────

	/** Hover opens a panel after this long, so a pointer crossing the rail does not. */
	const OPEN_DELAY = 150;
	/** Within this long of one closing, the next opens at once: running down the tiles. */
	const GROUP_WINDOW = 400;
	/** The pointer may leave the tile and panel this long before the panel goes. */
	const CLOSE_DELAY = 200;

	/** `key` names what it is for (`card:…`, `lesson:…`); `pinned` ones ignore the pointer leaving. */
	let peek = $state<{ key: string; pinned: boolean } | null>(null);
	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	let closedAt = -Infinity;
	let dragging = false;
	/** What each panel points at, by key. Not reactive: read when a panel is rendered. */
	const anchors: Record<string, HTMLElement> = {};

	const cardKey = (id: string) => `card:${id}`;
	const lessonKey = (id: string) => `lesson:${id}`;

	function track(key: string) {
		return (node: HTMLElement) => {
			anchors[key] = node;
			return () => {
				if (anchors[key] === node) delete anchors[key];
			};
		};
	}

	function closePeek() {
		clearTimeout(openTimer);
		clearTimeout(closeTimer);
		if (peek !== null) closedAt = performance.now();
		peek = null;
	}

	function showPeek(key: string, pinned: boolean) {
		clearTimeout(openTimer);
		clearTimeout(closeTimer);
		peek = { key, pinned: pinned || (peek?.key === key && peek.pinned) };
	}

	function hoverIn(key: string, event: PointerEvent) {
		clearTimeout(closeTimer);
		// A finger has no hover: it taps, which `tap` handles.
		if (event.pointerType === 'touch') return;
		// Mid-drag, or reaching for a tile with the button down, is not looking.
		if (dragging || event.buttons !== 0) return;
		if (peek?.key === key) return;
		clearTimeout(openTimer);
		if (peek !== null || performance.now() - closedAt < GROUP_WINDOW) showPeek(key, false);
		else openTimer = setTimeout(() => showPeek(key, false), OPEN_DELAY);
	}

	function hoverOut(key: string, event: PointerEvent) {
		if (event.pointerType === 'touch') return;
		clearTimeout(openTimer);
		if (peek?.key !== key || peek.pinned) return;
		// Keyboard focus in the panel keeps it, as the pointer would.
		const holder = anchors[key]?.closest('[data-peek-key]');
		if (holder?.matches(':focus-within') && document.activeElement?.matches(':focus-visible')) return;
		closeTimer = setTimeout(closePeek, CLOSE_DELAY);
	}

	function focusIn(key: string, event: FocusEvent) {
		// Focus that came from the mouse is a click, and the hover has shown it already.
		if (!(event.target instanceof Element) || !event.target.matches(':focus-visible')) return;
		if (peek?.key !== key) showPeek(key, false);
		else clearTimeout(closeTimer);
	}

	function focusOut(key: string, event: FocusEvent) {
		const holder = event.currentTarget as HTMLElement;
		if (event.relatedTarget instanceof Node && holder.contains(event.relatedTarget)) return;
		if (peek?.key !== key) return;
		if (peek.pinned || !holder.matches(':hover')) closePeek();
	}

	/** The panel a key or a right click asks for stays until Escape, or focus or a press elsewhere. */
	async function openPinned(holder: HTMLElement, key: string, into: boolean) {
		showPeek(key, true);
		if (!into) return;
		await tick();
		holder.querySelector<HTMLElement>('.peek button')?.focus();
	}

	/** ← or Escape in the panel: back to the tile or circle it belongs to. */
	function backToAnchor() {
		const holder = document.activeElement?.closest<HTMLElement>('[data-peek-key]');
		holder?.querySelector<HTMLElement>(':scope > [role="button"], :scope > .rail-item, :scope > button')?.focus();
	}

	/** Keys that open or dismiss a panel; `true` when the key was one of them. */
	function peekKey(event: KeyboardEvent, key: string): boolean {
		const holder = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-peek-key]');
		if (holder === null || event.altKey || event.ctrlKey || event.metaKey) return false;
		const open = event.key === 'ArrowRight' || event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
		if (open) {
			event.preventDefault();
			event.stopPropagation();
			void openPinned(holder, key, true);
			return true;
		}
		if (event.key === 'Escape' && peek?.key === key) {
			event.stopPropagation();
			closePeek();
			return true;
		}
		return false;
	}

	function contextMenu(event: MouseEvent, key: string) {
		// The keyboard's ContextMenu key raises this too, after `peekKey` has focused the
		// panel; pinning again changes nothing.
		event.preventDefault();
		showPeek(key, true);
	}

	// A pinned panel goes when the press lands anywhere but on it.
	$effect(() => {
		const current = peek;
		if (current === null || !current.pinned) return;
		const away = (event: Event) => {
			const holder = event.target instanceof Element ? event.target.closest('[data-peek-key]') : null;
			if (holder?.getAttribute('data-peek-key') !== current.key) closePeek();
		};
		window.addEventListener('pointerdown', away, true);
		return () => window.removeEventListener('pointerdown', away, true);
	});

	// Nothing is left on a timer when the rail goes.
	$effect(() => () => {
		clearTimeout(openTimer);
		clearTimeout(closeTimer);
	});

	function considerCards(event: CustomEvent<DndEvent<CardItem>>) {
		dragging = true;
		closePeek();
		oncardConsider(event);
	}
	function finalizeCards(event: CustomEvent<DndEvent<CardItem>>) {
		dragging = false;
		oncardFinalize(event);
	}

	function select(event: MouseEvent, lessonId: string, blockId: string, key: string) {
		const wasSelected = store.selection?.blockId === blockId;
		store.selection = { lessonId, blockId };
		// The drag library takes the mouse-down, so nothing else would focus the tile.
		(event.currentTarget as HTMLElement).focus();
		// On a screen with no hover, a tap on the selected tile is the way to its panel.
		if (wasSelected && window.matchMedia('(hover: none)').matches) {
			if (peek?.key === key) closePeek();
			else showPeek(key, true);
		}
	}

	/**
	 * Do what a panel's button asks, then close the panel: it has done its job. If the
	 * keyboard was in it, focus goes back to the tile, unless the action opened a
	 * dialog, which has taken the focus.
	 */
	function run(key: string, action: () => void) {
		const holder = anchors[key]?.closest<HTMLElement>('[data-peek-key]') ?? null;
		const inside = holder?.contains(document.activeElement) ?? false;
		action();
		closePeek();
		if (!inside) return;
		void tick().then(() => {
			if (document.querySelector('dialog[open]') === null) anchors[key]?.focus();
		});
	}

	function tileKey(event: KeyboardEvent, key: string, lessonId: string, blockId: string, position: number) {
		if (peekKey(event, key)) return;
		oncardkey(event, lessonId, blockId, position);
	}
</script>

<ul class="rail">
	{#each doc.lessons as lesson, i (lessonKeys[i])}
		{@const open = lesson.lesson_id === activeLessonId}
		{@const totals = lessonTotals(lesson, store.index)}
		{@const errors = errorsIn(lesson.lesson_id)}
		{@const name = lessonLabel(doc, lesson)}
		{@const lKey = lessonKey(lessonKeys[i])}
		<li class="lesson" class:open>
			<!-- The row is only a hover and focus boundary for the circle and its panel. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="lesson-row"
				data-peek-key={lKey}
				onpointerenter={(event) => hoverIn(lKey, event)}
				onpointerleave={(event) => hoverOut(lKey, event)}
				onfocusin={(event) => focusIn(lKey, event)}
				onfocusout={(event) => focusOut(lKey, event)}
				oncontextmenu={(event) => contextMenu(event, lKey)}>
				<button
					type="button"
					class="rail-item"
					class:selected={open}
					class:peeked={peek?.key === lKey}
					aria-current={open ? 'true' : undefined}
					aria-label={`${i + 1}. lekce: ${name}`}
					{@attach track(lKey)}
					onclick={() => selectLesson(lesson.lesson_id)}
					onkeydown={(event) => peekKey(event, lKey)}>
					{i + 1}
				</button>
				{#if errors > 0}<span class="dot" aria-hidden="true"></span>{/if}
				{#if peek?.key === lKey && anchors[lKey] !== undefined}
					<RailPeek anchor={anchors[lKey]} label={`Lekce ${i + 1}`} onclose={closePeek}>
						<div class="peek-head">
							<span class="overline">{i + 1}. lekce</span>
							{#if errors > 0}<span class="peek-errors">{errorsCount(errors)}</span>{/if}
						</div>
						<p class="peek-title">{name}</p>
						<p class="peek-meta">
							{cardsCount(totals.blockCount)} · {totals.durationMinutes} min · {totals.xp} XP
						</p>
						<hr class="peek-rule" />
						<button
							type="button"
							class="peek-wide"
							tabindex="-1"
							aria-label={`Nastavení lekce ${name}`}
							onclick={() => run(lKey, () => onlessonSettings(lesson.lesson_id))}
							onkeydown={(event) => {
								if (event.key === 'Escape' || event.key === 'ArrowLeft') {
									event.preventDefault();
									event.stopPropagation();
									backToAnchor();
								}
							}}>
							<Settings size={16} aria-hidden="true" />
							Nastavení lekce
						</button>
					</RailPeek>
				{/if}
			</div>

			{#if open}
				<ul
					class="tiles"
					use:dndzone={{
						items: cards,
						flipDurationMs: 150,
						dropTargetStyle: {},
						type: 'bindings',
						// The tile is the one tab stop, as in the tree.
						zoneItemTabIndex: -1
					}}
					onconsider={considerCards}
					onfinalize={finalizeCards}>
					{#each cards as card, position (card.id)}
						{@const block = doc.blocks.find((b) => b.block_id === card.binding.block_id)}
						{@const key = cardKey(card.id)}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions (the hover and focus boundary of the tile and its panel) -->
						<li
							class="tile-item"
							data-peek-key={key}
							onpointerenter={(event) => hoverIn(key, event)}
							onpointerleave={(event) => hoverOut(key, event)}
							onfocusin={(event) => focusIn(key, event)}
							onfocusout={(event) => focusOut(key, event)}
							oncontextmenu={(event) => contextMenu(event, key)}>
							{#if block === undefined}
								<span class="rail-tile missing" title="Chybějící karta" aria-label="Chybějící karta">!</span>
							{:else}
								{@const cardErrors = errorsOn(block.block_id)}
								{@const selected = block.block_id === activeBlockId}
								{@const Icon = cardTypeIcon(block.type)}
								{@const n = position + 1}
								<!--
									A div for the same reason as the tree's rows: a button would
									refuse a press on its own padding to the drag library. What
									can be done to the card is in the panel beside it, not on it.
								-->
								<!-- svelte-ignore a11y_click_events_have_key_events (the key handler is a capture one, which the check does not see) -->
								<div
									role="button"
									tabindex="0"
									class="rail-tile"
									class:selected
									class:peeked={peek?.key === key}
									aria-current={selected ? 'true' : undefined}
									aria-label={`${n}. ${cardTypeLabel(block.type)}: ${blockPreview(block, 60, n)}${
										cardErrors > 0 ? `, ${errorsCount(cardErrors)}` : ''
									}`}
									{@attach track(key)}
									onclick={(event) => select(event, lesson.lesson_id, block.block_id, key)}
									onkeydowncapture={(event) => tileKey(event, key, lesson.lesson_id, block.block_id, position)}>
									<Icon size={18} aria-hidden="true" />
								</div>
								{#if cardErrors > 0}<span class="dot" aria-hidden="true"></span>{/if}
								{#if peek?.key === key && anchors[key] !== undefined}
									<RailPeek anchor={anchors[key]} label={`Karta ${n}`} onclose={closePeek}>
										<div class="peek-head">
											<span class="overline">{n} · {cardTypeLabel(block.type)}</span>
											{#if cardErrors > 0}<span class="peek-errors">{errorsCount(cardErrors)}</span>{/if}
										</div>
										<p class="peek-text">{blockPreview(block, 120, n)}</p>
										<hr class="peek-rule" />
										<CardActions
											position={n}
											total={cards.length}
											caption
											onsettings={() => run(key, () => actions.settings(lesson.lesson_id, block.block_id))}
											onduplicate={() => run(key, () => actions.duplicate(block.block_id, lesson.lesson_id))}
											onremoveFromLesson={() => run(key, () => actions.removeFromLesson(lesson.lesson_id, block.block_id, { follow: false }))}
											onremove={() => run(key, () => actions.remove(block.block_id, lesson.lesson_id))}
											onexit={backToAnchor} />
									</RailPeek>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>

				<Menu
					label="Přidat kartu"
					icon={Plus}
					placement="right-start"
					class="add-card">
					{#each CARD_TYPES as option (option.type)}
						<MenuItem
							icon={option.icon}
							title={option.title}
							onclick={() =>
								store.apply((d, r) => addBlock(d, lesson.lesson_id, option.type, undefined, r))}>
							{option.label}
						</MenuItem>
					{/each}
				</Menu>
			{/if}
		</li>
	{/each}
</ul>

<button
	type="button"
	class="new-lesson"
	aria-label="Nová lekce"
	title="Nová lekce"
	onclick={() => store.apply((d, r) => addLesson(d, undefined, r))}>
	<Plus size={16}></Plus>
</button>

<style>
	ul {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rail {
		align-items: stretch;
		gap: 4px;
		margin-top: 28px;
	}

	li {
		position: relative;
	}

	/* The open lesson and its tiles read as one group, tinted like the tree's open lesson. */
	.lesson {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3px 0;
		border-radius: var(--radius-s);
	}

	.lesson.open {
		background: var(--primary-dark-06);
	}

	.lesson-row {
		position: relative;
		display: flex;
		justify-content: center;
		width: 100%;
	}

	.rail-item {
		width: 32px;
		height: 32px;
		border: 1px solid var(--e-border);
		border-radius: 50%;
		background: var(--surface);
		color: var(--e-text-muted);
		font-size: var(--text-s);
		cursor: pointer;
		transition: box-shadow 120ms ease;
	}

	.rail-item:hover,
	.rail-item.peeked {
		border-color: var(--e-border-strong);
	}

	.rail-item.selected {
		border-color: transparent;
		background: var(--primary);
		color: var(--surface);
	}

	.tiles {
		align-items: center;
		gap: 2px;
		width: 100%;
		margin-top: 4px;
	}

	.tile-item {
		position: relative;
		display: flex;
		justify-content: center;
		width: 100%;
	}

	/* An icon and nothing else: what can be done to the card is in the panel beside it. */
	.rail-tile {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-xs);
		color: var(--e-text-muted);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			box-shadow 120ms ease;
	}

	.rail-tile:hover,
	.rail-tile.peeked {
		background: var(--surface);
		color: var(--e-text);
	}

	.rail-tile:focus-visible,
	.rail-item:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}

	/* Selected: a tint of the brand colour, ringed, with the icon in the deeper purple. */
	.rail-tile.selected {
		background: color-mix(in srgb, var(--primary) 26%, var(--surface));
		box-shadow: inset 0 0 0 1.5px var(--primary);
		color: var(--gradient-purple);
	}

	.rail-tile.missing {
		color: var(--e-error);
		cursor: default;
	}

	/* An error, without a number: the count is in the tile's name and in its panel. */
	.dot {
		position: absolute;
		top: 1px;
		left: calc(50% + 8px);
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--e-error);
		box-shadow: 0 0 0 2px var(--surface);
		pointer-events: none;
	}

	.lesson.open > .lesson-row > .dot {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-dark) 6%, var(--surface));
	}

	/* ── The panel's content (the shell is RailPeek) ─────────────────────────── */

	.peek-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.overline {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.peek-errors {
		color: var(--e-error);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
	}

	.peek-text,
	.peek-title {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		margin: 4px 0 0;
		overflow: hidden;
		color: var(--e-text);
		font-size: var(--text-s);
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.peek-title {
		font-weight: var(--weight-semibold);
	}

	.peek-meta {
		margin: 2px 0 0;
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.peek-rule {
		height: 1px;
		margin: 10px -12px 8px;
		border: none;
		background: var(--e-border);
	}

	.peek-wide {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 32px;
		padding: 0 10px;
		border: none;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--e-text-muted);
		font: inherit;
		font-size: var(--text-s);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.peek-wide:hover {
		background: var(--primary-dark-08);
		color: var(--e-text);
	}

	.peek-wide:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}

	.lesson :global(.add-card) {
		margin-top: 4px;
	}

	.new-lesson {
		display: flex;
		align-items: center;
		justify-content: center;
		align-self: center;
		width: 32px;
		height: 32px;
		margin-top: 8px;
		border: 1px solid var(--e-border-strong);
		border-radius: 50%;
		background: none;
		color: var(--e-text-muted);
		cursor: pointer;
	}

	.new-lesson:hover {
		border-color: var(--primary);
		background: var(--primary-dark-06);
		color: var(--e-text);
	}

	@media (prefers-reduced-motion: reduce) {
		.rail-tile,
		.rail-item,
		.peek-wide {
			transition: none;
		}
	}
</style>
