<script lang="ts">
	/**
	 * The lesson panel folded to a rail: one circle per lesson and, under the open
	 * one, one tile per card. It is not a smaller copy of the tree. It keeps what a
	 * teacher does with the tree most — see where they are, jump to a card, reorder,
	 * add a card, open a settings dialog — and drops the text.
	 *
	 * The card zone's state (`cards`, the drag handlers and the keys) belongs to
	 * `Sidebar` and is handed in, so a card is reordered by exactly the same code
	 * whichever of the two is showing.
	 *
	 * Controls that would crowd 64px (a gear on every circle and tile) are drawn
	 * with `opacity`, never `display: none`: a control that is not laid out cannot be
	 * focused, and a keyboard user reaches it the same way a mouse does.
	 */
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { Plus, Settings } from '@lucide/svelte';
	import type { CourseV2, LessonBlockBinding } from '$lib/domain/schema';
	import { addBlock, addLesson } from '$lib/domain/commands';
	import { blockPreview, lessonTotals } from '$lib/domain/derive';
	import { CARD_TYPES, cardTypeIcon, cardTypeLabel } from '$lib/ui/card-types';
	import { useStore } from '$lib/ui/context';
	import { uniqueKeys } from '$lib/ui/keys';
	import { cardsCount, errorsCount } from '$lib/ui/plural';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';

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
		oncardSettings
	}: Props = $props();

	const store = useStore();
	const lessonKeys = $derived(uniqueKeys(doc.lessons.map((l) => l.lesson_id)));

	function selectLesson(lessonId: string) {
		store.selection = { lessonId };
	}

	function select(event: MouseEvent, lessonId: string, blockId: string) {
		store.selection = { lessonId, blockId };
		// The drag library takes the mouse-down, so nothing else would focus the tile.
		(event.currentTarget as HTMLElement).focus();
	}

	function openCardSettings(lessonId: string, blockId: string) {
		store.selection = { lessonId, blockId };
		oncardSettings(blockId);
	}
</script>

<ul class="rail">
	{#each doc.lessons as lesson, i (lessonKeys[i])}
		{@const open = lesson.lesson_id === activeLessonId}
		{@const totals = lessonTotals(lesson, store.index)}
		{@const errors = errorsIn(lesson.lesson_id)}
		{@const name = lesson.name ?? lesson.lesson_id}
		<li class="lesson" class:open>
			<div class="lesson-row">
				<button
					type="button"
					class="rail-item"
					class:selected={open}
					aria-current={open ? 'true' : undefined}
					aria-label={`${i + 1}. lekce: ${name}`}
					title={`${name} · ${cardsCount(totals.blockCount)} · ${totals.durationMinutes} min · ${totals.xp} XP`}
					onclick={() => selectLesson(lesson.lesson_id)}>
					{i + 1}
				</button>
				{#if errors > 0}<span class="dot" aria-hidden="true"></span>{/if}
				<button
					type="button"
					class="gear"
					title="Nastavení lekce"
					aria-label={`Nastavení lekce ${name}`}
					onclick={() => onlessonSettings(lesson.lesson_id)}>
					<Settings size={12}></Settings>
				</button>
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
					onconsider={oncardConsider}
					onfinalize={oncardFinalize}>
					{#each cards as card, position (card.id)}
						{@const block = doc.blocks.find((b) => b.block_id === card.binding.block_id)}
						<li class="tile-item">
							{#if block === undefined}
								<span class="tile missing" title="Chybějící karta" aria-label="Chybějící karta">!</span>
							{:else}
								{@const cardErrors = errorsOn(block.block_id)}
								{@const selected = block.block_id === activeBlockId}
								{@const Icon = cardTypeIcon(block.type)}
								{@const n = position + 1}
								<!--
									A div for the same reason as the tree's rows: a button would
									refuse a press on its own padding to the drag library. The
									gear beside it is a real button, and is not inside it.
								-->
								<!-- svelte-ignore a11y_click_events_have_key_events (the key handler is a capture one, which the check does not see) -->
								<div
									role="button"
									tabindex="0"
									class="tile"
									class:selected
									aria-current={selected ? 'true' : undefined}
									aria-label={`${n}. ${cardTypeLabel(block.type)}: ${blockPreview(block, 60, n)}${
										cardErrors > 0 ? `, ${errorsCount(cardErrors)}` : ''
									}`}
									title={blockPreview(block, 80, n)}
									onclick={(event) => select(event, lesson.lesson_id, block.block_id)}
									onkeydowncapture={(event) => oncardkey(event, lesson.lesson_id, block.block_id, position)}>
									<Icon size={14}></Icon>
									<span class="n">{n}</span>
								</div>
								{#if cardErrors > 0}<span class="dot" aria-hidden="true"></span>{/if}
								<button
									type="button"
									class="gear"
									class:pinned={selected}
									tabindex={selected ? 0 : -1}
									title="Nastavení karty"
									aria-label={`Nastavení ${n}. karty`}
									onclick={() => openCardSettings(lesson.lesson_id, block.block_id)}>
									<Settings size={12}></Settings>
								</button>
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

	.tile {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		width: 40px;
		height: 34px;
		border-left: 2px solid transparent;
		border-radius: var(--radius-xs);
		color: var(--e-text-muted);
		cursor: pointer;
	}

	.tile:hover {
		background: var(--surface);
	}

	.tile.selected {
		border-left-color: var(--primary);
		background: var(--surface);
		color: var(--e-text);
		box-shadow: var(--shadow-light);
	}

	.tile.missing {
		color: var(--e-error);
		cursor: default;
	}

	.n {
		font-size: 11px;
		line-height: 1;
	}

	/* An error, without a number: the count is in the tile's name and the card's own chip. */
	.dot {
		position: absolute;
		top: 2px;
		left: 5px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--e-error);
		pointer-events: none;
	}

	.gear {
		position: absolute;
		top: -3px;
		right: 1px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 1px solid var(--e-border);
		border-radius: 50%;
		background: var(--surface);
		color: var(--e-text-faint);
		cursor: pointer;
		opacity: 0;
	}

	.gear:hover {
		color: var(--e-text);
	}

	.lesson-row:hover .gear,
	.lesson-row:focus-within .gear,
	.tile-item:hover .gear,
	.tile-item:focus-within .gear,
	.gear.pinned {
		opacity: 1;
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
</style>
