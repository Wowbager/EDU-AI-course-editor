<script lang="ts">
	/**
	 * The backpack at the bottom of the lesson panel. Closed, it is one small button.
	 * Open, it shows its two parts over the end of the lesson list:
	 *
	 * - „Z tohoto kurzu“: this course's cards that no lesson shows. They are the course's
	 *   own, so a card dragged here leaves its lesson, and one dragged out goes into it.
	 * - „Moje karty“: copies the teacher keeps, in any course (`state/backpack.svelte.ts`).
	 *   A card dragged here is copied and its course does not change; one dragged out is
	 *   a new copy, and the backpack keeps the saved one.
	 *
	 * The drops themselves are `card-drag.svelte.ts`'s. On the rail the button alone is
	 * there, and it opens the panel and the backpack together.
	 */
	import { onMount, untrack, type Snippet } from 'svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { Backpack as BackpackIcon, ChevronDown, ChevronUp, Plus, X } from '@lucide/svelte';
	import type { BlockV2 } from '$lib/domain/schema';
	import { blockPreview } from '$lib/domain/derive';
	import { pasteBlock } from '$lib/domain/commands';
	import { cardTypeIcon } from '$lib/ui/card-types';
	import { uniqueKeys } from '$lib/ui/keys';
	import { useStore } from '$lib/ui/context';
	import { focusSelectedCard } from '$lib/ui/focus-after';
	import { backpack } from '$lib/state/backpack.svelte';
	import type { CardDrag, CardItem, Held } from './card-drag.svelte';

	interface Props {
		drag: CardDrag;
		/** The course's cards in no lesson. */
		loose: BlockV2[];
		selectedBlockId: string | undefined;
		/** The open lesson and card: where „Vložit do lekce“ puts a saved copy. */
		lessonId: string | undefined;
		collapsed: boolean;
		/** The rail's button: unfold the panel. */
		onexpand: () => void;
		/** What sits beside the button: the course's totals. */
		children?: Snippet;
	}
	let { drag, loose, selectedBlockId, lessonId, collapsed, onexpand, children }: Props = $props();

	const store = useStore();
	onMount(() => backpack.load());

	// ── „Z tohoto kurzu“ ─────────────────────────────────────────────────────────
	let draggingLoose = $state<Held | null>(null);
	const looseKeys = $derived(uniqueKeys(loose.map((b) => b.block_id)));
	const looseItems = $derived<CardItem[]>(
		drag.held(draggingLoose) ??
			loose.map((block, i) => ({
				id: `loose:${looseKeys[i]}`,
				binding: { block_id: block.block_id, order: 0 },
				from: 'loose'
			}))
	);

	function onlooseConsider(event: CustomEvent<DndEvent<CardItem>>) {
		draggingLoose = drag.hold(event.detail.items);
		drag.considered(event);
	}
	function onlooseFinalize(event: CustomEvent<DndEvent<CardItem>>) {
		draggingLoose = null;
		const toLesson = drag.finalized(event);
		if (toLesson !== undefined) {
			const item = event.detail.items.find((i) => i.id === event.detail.info.id);
			if (item !== undefined) {
				drag.toLesson(item, toLesson);
				drag.glow(toLesson);
			}
			return;
		}
		const arrived = drag.arrived(event, (i) => i.from === 'loose');
		if (arrived === undefined) return;
		const { item } = arrived;
		if (item.from === 'saved') drag.pasteLoose(item);
		else drag.takeOut(item);
	}

	// ── „Moje karty“ ─────────────────────────────────────────────────────────────
	let draggingSaved = $state<Held | null>(null);
	const savedItems = $derived<CardItem[]>(
		drag.held(draggingSaved) ??
			backpack.cards.map((card) => ({
				id: `saved:${card.id}`,
				binding: { block_id: card.block.block_id, order: 0 },
				from: 'saved',
				savedId: card.id
			}))
	);

	function onsavedConsider(event: CustomEvent<DndEvent<CardItem>>) {
		draggingSaved = drag.hold(event.detail.items);
		drag.considered(event);
	}
	function onsavedFinalize(event: CustomEvent<DndEvent<CardItem>>) {
		draggingSaved = null;
		const toLesson = drag.finalized(event);
		if (toLesson !== undefined) {
			const item = event.detail.items.find((i) => i.id === event.detail.info.id);
			if (item !== undefined) {
				drag.toLesson(item, toLesson);
				drag.glow(toLesson);
			}
			return;
		}
		const arrived = drag.arrived(event, (i) => i.from === 'saved');
		if (arrived !== undefined) drag.save(arrived.item);
	}

	/** A saved copy into the open lesson, after the open card: where Ctrl+V puts one. */
	function insert(savedId: string) {
		const saved = backpack.find(savedId);
		if (saved === undefined) return;
		const after = selectedBlockId;
		store.apply((d, r) => pasteBlock(d, saved.block, lessonId, after, r, saved.from));
		void focusSelectedCard();
	}

	/**
	 * The selected card became one of the course's loose ones (it was picked, or taken out
	 * of its lesson): the backpack opens to show where it is. Once, so a teacher who then
	 * closes it while writing the card is not fought on every keystroke.
	 */
	let shownFor: string | undefined;
	$effect(() => {
		const id = selectedBlockId;
		const isLoose = id !== undefined && loose.some((b) => b.block_id === id);
		if (!isLoose) {
			shownFor = undefined;
			return;
		}
		if (collapsed || shownFor === id) return;
		shownFor = id;
		untrack(() => (backpack.open = true));
	});

	function toggle() {
		if (collapsed) {
			onexpand();
			backpack.open = true;
			return;
		}
		backpack.open = !backpack.open;
	}

	/** A press on a row's button must not start the row's drag (as in `CardActions`). */
	function noDrag(node: HTMLElement) {
		const stop = (event: Event) => event.stopPropagation();
		node.addEventListener('mousedown', stop);
		node.addEventListener('touchstart', stop, { passive: true });
		return {
			destroy() {
				node.removeEventListener('mousedown', stop);
				node.removeEventListener('touchstart', stop);
			}
		};
	}

	const zone = (items: CardItem[]) => ({
		items,
		type: 'bindings',
		flipDurationMs: 150,
		dropTargetStyle: {},
		zoneItemTabIndex: -1
	});
</script>

<div class="backpack" class:collapsed>
	{#if backpack.open && !collapsed}
		<section class="panel" aria-label="Batoh">
			<div class="part">
				<h3>Z tohoto kurzu</h3>
				<div class="zone">
					<ul
						use:dndzone={zone(looseItems)}
						onconsider={onlooseConsider}
						onfinalize={onlooseFinalize}
						aria-label="Karty z tohoto kurzu mimo lekce"
					>
						{#each looseItems as item (item.id)}
							{@const block = drag.blockOf(item)}
							<li>
								{#if block !== undefined}
									{@const Icon = cardTypeIcon(block.type)}
									<div
										role="button"
										tabindex="0"
										class="row"
										class:selected={block.block_id === selectedBlockId}
										onclick={() => (store.selection = { blockId: block.block_id })}
										onkeydown={(event) => {
											if (event.key === 'Enter' || event.key === ' ') {
												event.preventDefault();
												store.selection = { blockId: block.block_id };
											}
										}}
									>
										<span class="type"><Icon size={16}></Icon></span>
										<span class="snippet">{blockPreview(block, 40)}</span>
										<span class="sub">žák se k ní nedostane</span>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
					{#if looseItems.length === 0}
						<p class="empty">Přetáhni sem kartu, kterou chceš vyndat z lekce.</p>
					{/if}
				</div>
			</div>

			<div class="part">
				<h3>Moje karty</h3>
				<div class="zone">
					<ul
						use:dndzone={zone(savedItems)}
						onconsider={onsavedConsider}
						onfinalize={onsavedFinalize}
						aria-label="Moje karty"
					>
						{#each savedItems as item (item.id)}
							{@const saved = item.savedId === undefined ? undefined : backpack.find(item.savedId)}
							{@const block = saved?.block ?? drag.blockOf(item)}
							<li>
								{#if block !== undefined}
									{@const Icon = cardTypeIcon(block.type)}
									<div class="row saved">
										<span class="type"><Icon size={16}></Icon></span>
										<span class="snippet">{blockPreview(block, 40)}</span>
										<!-- Where it came from says something only when that is another course. -->
										{#if saved?.courseName && saved.from.courseId !== store.doc.course_id}
											<span class="sub">z kurzu {saved.courseName}</span>
										{/if}
										{#if saved !== undefined}
											<span class="actions">
												<button
													type="button"
													use:noDrag
													aria-label={`Vložit kopii do lekce: ${blockPreview(block, 40)}`}
													title={lessonId === undefined
														? 'Vložit kopii do kurzu'
														: 'Vložit kopii do otevřené lekce'}
													onclick={() => insert(saved.id)}
												>
													<Plus size={14}></Plus>
												</button>
												<button
													type="button"
													use:noDrag
													aria-label={`Vyndat z batohu: ${blockPreview(block, 40)}`}
													title="Vyndat z batohu"
													onclick={() => backpack.drop(saved.id)}
												>
													<X size={14}></X>
												</button>
											</span>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
					{#if savedItems.length === 0}
						<p class="empty">Přetáhni sem kartu a její kopii vložíš i do jiného kurzu.</p>
					{/if}
				</div>
			</div>
		</section>
	{/if}

	<div class="bar">
		<button
			type="button"
			class="toggle"
			class:target={drag.hover?.kind === 'backpack'}
			data-drop-backpack
			aria-expanded={backpack.open && !collapsed}
			aria-label="Batoh"
			title={backpack.open && !collapsed
				? 'Zavřít batoh'
				: 'Batoh: karty mimo lekce a tvoje uložené'}
			onclick={toggle}
		>
			<BackpackIcon size={16}></BackpackIcon>
			{#if !collapsed}
				<span>Batoh</span>
				{#if backpack.open}
					<ChevronDown size={14}></ChevronDown>
				{:else}
					<ChevronUp size={14}></ChevronUp>
				{/if}
			{/if}
		</button>
		{@render children?.()}
	</div>
</div>

<style>
	.backpack {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-height: 45vh;
		overflow-y: auto;
		padding: 10px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.08);
	}

	h3 {
		margin: 0 0 4px;
		color: var(--e-text-faint);
		font: var(--type-badge-small);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.zone {
		position: relative;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: 52px;
		margin: 0;
		padding: 0;
		list-style: none;
		border-radius: var(--radius-xs);
	}

	li {
		position: relative;
		background: var(--surface);
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		margin: 0;
		padding: 0 8px;
		border: 1px dashed var(--e-border);
		border-radius: var(--radius-xs);
		color: var(--e-text-faint);
		font: var(--type-caption);
		pointer-events: none;
	}

	.row {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 6px;
		padding: 6px 8px;
		border-left: 2px solid transparent;
		border-radius: var(--radius-xs);
		cursor: grab;
	}

	.row:hover,
	.row:focus-within {
		background: var(--surface-light);
	}

	.row.selected {
		border-left-color: var(--primary);
		box-shadow: var(--shadow-light);
	}

	.type {
		grid-row: span 2;
		align-self: center;
	}

	.snippet {
		overflow: hidden;
		color: var(--e-text);
		font: var(--type-caption);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sub {
		grid-column: 2;
		overflow: hidden;
		color: var(--e-text-faint);
		font: var(--type-caption);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.saved .snippet,
	.saved .sub {
		padding-right: 0;
	}

	.row:hover .snippet,
	.row:focus-within .snippet {
		padding-right: 52px;
	}

	.actions {
		position: absolute;
		top: 0;
		right: 4px;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.row:hover .actions,
	.row:focus-within .actions {
		opacity: 1;
	}

	.actions button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--surface);
		color: var(--e-text-muted);
		cursor: pointer;
	}

	.actions button:hover {
		background: var(--info-bg);
		color: var(--e-text);
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.collapsed .bar {
		justify-content: center;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-right: auto;
		padding: 5px 10px;
		border: 1px solid var(--e-border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--e-text-muted);
		font: var(--type-caption);
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background 120ms ease;
	}

	.toggle:hover,
	.toggle[aria-expanded='true'] {
		border-color: var(--primary);
		color: var(--e-text);
	}

	.toggle.target {
		border-color: var(--primary);
		background: var(--info-bg);
	}

	.collapsed .toggle {
		margin-right: 0;
		width: 36px;
		height: 36px;
		padding: 0;
		justify-content: center;
		border-radius: 50%;
	}

	@media (prefers-reduced-motion: reduce) {
		.toggle,
		.actions {
			transition: none;
		}
	}
</style>
