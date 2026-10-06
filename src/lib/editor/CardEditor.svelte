<script lang="ts">
	/**
	 * One card: a block and its steps.
	 *
	 * The editor column holds exactly one of these — the card selected in the tree —
	 * so everything here is open. There is nothing to expand and no summary line,
	 * because a card that is on screen is a card being worked on.
	 *
	 * What is *not* here is the card's configuration: length, practice enrolment, the
	 * knowledge vector, the machinery. That is one click away in `CardSettings`. The
	 * card-wide hint and help are there too: they are only the fallback for steps
	 * that have none of their own, so the steps' ladders stay here and the card's
	 * sits with the rest of its settings.
	 *
	 * What is drawn — the chips, the XP, the names, whether a menu item is offered — is
	 * the model's (`store.screen.card`, `screen/card.ts`). This writes what the teacher
	 * does and keeps the drag.
	 */
	import {
		dragHandleZone,
		SHADOW_ITEM_MARKER_PROPERTY_NAME,
		SHADOW_PLACEHOLDER_ITEM_ID,
		type DndEvent
	} from 'svelte-dnd-action';
	import { tick } from 'svelte';
	import type { BlockStep, BlockV2, StepType } from '$lib/domain/schema';
	import type { CardView } from '$lib/screen/types';
	import Card from '$lib/ui/Card.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';
	import MenuSeparator from '$lib/ui/MenuSeparator.svelte';
	import { notices } from '$lib/state/notice.svelte';
	import type { Ref } from '$lib/domain/ref';
	import StepEditor from './StepEditor.svelte';
	import { useStepView, useStore } from '$lib/ui/context';
	import { uniqueKeys } from '$lib/ui/keys';
	import {
		addStep,
		bindBlock,
		moveBlockInLesson,
		reorderSteps,
		setQuestionType
	} from '$lib/domain/commands';
	import { cardActions } from './card-actions';
	import {
		ArrowDown,
		ArrowUp,
		Copy,
		Ellipsis,
		ListPlus,
		ListX,
		Plus,
		Settings,
		Trash
	} from '@lucide/svelte';
	import { STEP_TYPES } from '$lib/lang';
	import { cardTypeIcon } from '$lib/ui/card-types';

	interface Props {
		block: BlockV2;
		/** The model's card: `store.screen.card.card`. */
		view: CardView;
		/** Absent for a card bound to no lesson — it is editable, just unreachable. */
		lessonId?: string;
		onsettings: () => void;
		onrepairBlock: (blockId: string) => void;
		onrepairStep: (blockId: string, stepId: string) => void;
	}
	let { block, view, lessonId, onsettings, onrepairBlock, onrepairStep }: Props = $props();

	const store = useStore();
	const screen = 'card.card';
	// The same actions the rail and the tree call (`card-actions.ts`).
	const actions = cardActions(store, {
		onsettings: () => onsettings(),
		onrepair: (blockId) => onrepairBlock(blockId)
	});
	const dialogs = $derived(store.screen.dialogs);

	/**
	 * Open the card's settings when something outside the editor points at the card's
	 * own hint or help — the question mark in the preview, or a validation jump. Those
	 * two fields live in `CardSettings` now, and a card-level ref has no `stepId`, so
	 * `StepEditor`'s reveal never matches it; without this the "?" would report the
	 * right field and the screen would do nothing. The dialog opens the fold that holds
	 * the field by itself (`sectionTargeted`).
	 */
	const revealedField = $derived(
		store.selection?.blockId === block?.block_id && store.selection?.stepId === undefined
			? store.selection?.field
			: undefined
	);
	$effect(() => {
		// The reveal counter, not the selection: typing also moves the selection.
		void store.reveal;
		if (revealedField === 'hint' || revealedField === 'help') onsettings();
	});

	/**
	 * The list `svelte-dnd-action` reorders. Each item carries a key that is unique
	 * even when the document holds duplicate step ids, and the step itself.
	 */
	interface StepItem {
		id: string;
		step: BlockStep;
		[SHADOW_ITEM_MARKER_PROPERTY_NAME]?: boolean;
	}
	const stepView = useStepView();
	const baseItems = $derived.by((): StepItem[] => {
		const keys = uniqueKeys(block.steps.map((s) => s.id));
		return block.steps.map((step, i) => ({ id: keys[i], step }));
	});
	let dragging = $state<StepItem[] | null>(null);
	const items = $derived(dragging ?? baseItems);
	/** The key of the step being carried — the placeholder has another id at first. */
	let carried = $state<string | null>(null);
	const keyOf = (item: StepItem) =>
		item[SHADOW_ITEM_MARKER_PROPERTY_NAME] &&
		item.id === SHADOW_PLACEHOLDER_ITEM_ID &&
		carried !== null
			? carried
			: item.id;
	/** The model's step for an item of the list, and where it is in the model. */
	const viewOf = (item: StepItem) => {
		const key = keyOf(item);
		const index = view.steps.findIndex((s) => s.key === key);
		return index < 0 ? null : { step: view.steps[index], index };
	};

	/**
	 * A press on a step's handle, before the library has measured anything: fold
	 * every step now, so the list it measures — and the gap it leaves for the
	 * carried step — is the short one. The library records the pointer where it was
	 * pressed, but builds the clone from the handle's rect at the first move, so the
	 * handle has to end up where it was pressed, or the step stays offset from the
	 * pointer for the whole drag (and the drop follows the clone, not the pointer).
	 *
	 * Folding moves the handle up by whatever the folded steps above it gave back.
	 * The column is scrolled by the same amount, with three things done first:
	 *  - the scrolling column is found before the fold, while it still overflows;
	 *  - the list is pinned to its height, so the column keeps its scroll height and
	 *    the browser cannot clamp `scrollTop` down under a shorter list;
	 *  - whatever the scroll could not give back (`scrollTop` cannot go below 0) is
	 *    padded on top of the list. That gap is cleared on drop, or on release.
	 */
	async function grab(handle: HTMLElement) {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
		const zone = handle.closest<HTMLElement>('.steps');
		const scroller = scrollParent(handle);
		const before = handle.getBoundingClientRect().top;
		if (zone !== null) {
			zone.style.minHeight = `${zone.getBoundingClientRect().height}px`;
			zone.style.paddingTop = '';
		}
		stepView.dragging = true;
		await tick();
		const shift = handle.getBoundingClientRect().top - before;
		if (shift !== 0) scroller?.scrollBy({ top: shift, behavior: 'instant' });
		const rest = handle.getBoundingClientRect().top - before;
		if (rest < -0.5 && zone !== null) zone.style.paddingTop = `${-rest}px`;
		zoneOf = zone;
		// A press that never became a drag gets no `finalize`.
		const release = () => {
			window.removeEventListener('pointerup', release);
			window.removeEventListener('keyup', release);
			if (dragging === null) {
				stepView.dragging = false;
				unpinSteps();
			}
		};
		window.addEventListener('pointerup', release);
		window.addEventListener('keyup', release);
	}

	/** The list `grab` pinned and padded, until the drop or release clears it. */
	let zoneOf: HTMLElement | null = null;
	function unpinSteps() {
		zoneOf?.style.removeProperty('min-height');
		zoneOf?.style.removeProperty('padding-top');
		zoneOf = null;
	}

	function scrollParent(node: HTMLElement): HTMLElement | null {
		for (let el = node.parentElement; el !== null; el = el.parentElement) {
			const overflow = getComputedStyle(el).overflowY;
			if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight)
				return el;
		}
		return document.scrollingElement as HTMLElement | null;
	}

	function onconsider(event: CustomEvent<DndEvent<StepItem>>) {
		carried = event.detail.info.id;
		dragging = event.detail.items;
	}

	function onfinalize(event: CustomEvent<DndEvent<StepItem>>) {
		dragging = null;
		carried = null;
		stepView.dragging = false;
		// After the library's own unlock, which put the pinned min-height back.
		unpinSteps();
		store.apply((d) =>
			reorderSteps(
				d,
				block.block_id,
				event.detail.items.map((item) => item.step.id)
			)
		);
	}

	function moveCard(delta: -1 | 1) {
		if (lessonId === undefined) return;
		const id = lessonId;
		store.apply((d) => moveBlockInLesson(d, id, block.block_id, delta));
	}

	function showNotice(message: string, ref: Ref) {
		const entry = store.undoStack.at(-1);
		if (entry !== undefined) notices.show({ text: message, entry, ref });
	}

	/** „Zařadit do lekce“: the dialog's choice is `ui.dialog`, its list the model's. */
	function assignToLesson() {
		const dialog = store.ui.dialog;
		const assign = dialogs.assign_lesson;
		if (dialog?.kind !== 'assign_lesson' || assign === null || !assign.can_assign) return;
		const blockId = block.block_id;
		const lessonId = dialog.lessonId;
		const name = assign.lessons.find((l) => l.value === lessonId)!.label;
		store.apply((d) => bindBlock(d, lessonId, blockId));
		store.ui.dialog = null;
		showNotice(`Karta zařazena do lekce „${name}“.`, { blockId });
	}

	function confirmTypeChange() {
		const dialog = store.ui.dialog;
		if (dialog?.kind !== 'type_change') return;
		store.apply((d) => setQuestionType(d, dialog.blockId, dialog.stepId, dialog.type));
		store.ui.dialog = null;
	}
</script>

{#snippet stepItems(at: number | undefined)}
	{#each view.add_step as option (option.type)}
		{@const info = STEP_TYPES.find((t) => t.type === option.type)}
		<MenuItem
			icon={info?.icon}
			title={option.title}
			onclick={() =>
				store.apply((d, r) => addStep(d, block.block_id, option.type as StepType, at, r))}
		>
			{option.label}
		</MenuItem>
	{/each}
{/snippet}

<Card tone={store.open.binding?.bg_color}>
	<header>
		<Chip tone="accent" title={view.type_title}>
			{@const Icon = cardTypeIcon(view.type)}
			<Icon size={16}></Icon>
			<span data-screen="{screen}.type_label">{view.type_label}</span>
		</Chip>

		{#if view.chips.practice}
			<!--
				This chip is the practice queue, not the card's type — and on a card of
				type Cvičení the two chips sat next to each other reading the same word.
			-->
			<Chip tone="quiet" title={view.chips.practice.title}>
				<span data-screen="{screen}.chips.practice.text">{view.chips.practice.text}</span>
			</Chip>
		{/if}
		{#if view.chips.shared}
			<Chip tone="warning" title={view.chips.shared.title}>
				<span data-screen="{screen}.chips.shared.text">{view.chips.shared.text}</span>
			</Chip>
		{/if}
		<!--
            A card without a length is not a mistake: the app then estimates the
            lesson at about four minutes a card, so there is nothing to say until a
            teacher sets one. It was a warning on every new card, and then a chip
            saying "délka odhadem" on every card. The one case that does mislead a
            student — some cards of a lesson with a length and some without — is
            W_PARTIAL_DURATION, and it is said where the rest of the review is.
        -->
		{#if view.chips.minutes}
			<Chip tone="quiet" title={view.chips.minutes.title}>
				<span data-screen="{screen}.chips.minutes.text">{view.chips.minutes.text}</span>
			</Chip>
		{/if}

		<div class="spacer"></div>

		<Chip tone="quiet" title={view.chips.xp.title}>
			<span data-screen="{screen}.chips.xp.text">{view.chips.xp.text}</span>
		</Chip>

		<!--
			Always visible, the same quiet icon in every mode, and its tooltip says what is
			behind it. A settings button that only appears on hover is a setting nobody
			finds; a text button in two of three modes is a weight the card carries for
			one click now and then.
		-->
		<Button
			variant="ghost"
			size="s"
			onclick={onsettings}
			ariaLabel="Nastavení karty"
			title={view.settings_title}
		>
			<Settings size={16}></Settings>
		</Button>
		<Menu label="Další akce s kartou" icon={Ellipsis} placement="bottom-end">
			<MenuItem icon={Copy} onclick={() => actions.duplicate(block.block_id, lessonId)}>
				Duplikovat kartu
			</MenuItem>
			{#if view.menu.assign}
				<MenuItem
					icon={ListPlus}
					onclick={() => {
						store.ui.dialog = { kind: 'assign_lesson', blockId: block.block_id, lessonId: '' };
					}}
					disabled={view.menu.assign.disabled}
					title={view.menu.assign.title}
				>
					Zařadit do lekce
				</MenuItem>
			{:else if view.menu.remove_from_lesson && lessonId !== undefined}
				<!-- Neutral, not red: it is undoable, and the content stays. -->
				<MenuItem
					icon={ListX}
					onclick={() =>
						actions.removeFromLesson(lessonId, block.block_id, {
							follow: true
						})}
					title={view.menu.remove_from_lesson.title}
				>
					Odebrat z lekce
				</MenuItem>
			{/if}
			{#if view.menu.move}
				<MenuItem icon={ArrowUp} onclick={() => moveCard(-1)} disabled={view.menu.move.up_disabled}>
					Posunout nahoru
				</MenuItem>
				<MenuItem
					icon={ArrowDown}
					onclick={() => moveCard(1)}
					disabled={view.menu.move.down_disabled}
				>
					Posunout dolů
				</MenuItem>
			{/if}
			<MenuSeparator />
			<MenuItem
				icon={Trash}
				danger
				onclick={() => actions.remove(block.block_id, lessonId)}
				title="Smaže kartu z celého kurzu; jde vrátit zpět. Míří-li na ni odkaz odjinud, nejdřív se zeptá, kam má vést."
			>
				Smazat kartu
			</MenuItem>
		</Menu>
	</header>

	<div
		class="steps"
		use:dragHandleZone={{
			items,
			flipDurationMs: 150,
			dropTargetStyle: {}
		}}
		{onconsider}
		{onfinalize}
	>
		{#each items as item, i (item.id)}
			{@const found = viewOf(item)}
			<div class="step-wrap">
				{#if found}
					<StepEditor
						{block}
						step={item.step}
						view={found.step}
						screen="{screen}.steps[{found.index}]"
						{lessonId}
						ongrab={grab}
						onrepair={onrepairStep}
					/>
				{/if}
				<!--
                    Inside the dnd item, never beside it: every direct child of the zone
                    is a drag item. It stays a tab stop — the menu at the foot only adds
                    at the end, and without this a keyboard has no way to insert between.
                -->
				{#if found && i < items.length - 1 && !stepView.dragging}
					<Menu label={found.step.insert_label} icon={Plus} class="insert" title="Vložit krok sem">
						{@render stepItems(i + 1)}
					</Menu>
				{/if}
			</div>
		{/each}
	</div>

	<div class="add-step">
		<Menu
			label="Přidat krok"
			text="Přidat krok"
			icon={Plus}
			variant={block.steps.length === 0 ? 'secondary' : 'ghost'}
		>
			{@render stepItems(undefined)}
		</Menu>
	</div>
</Card>

{#if dialogs.assign_lesson}
	{@const assign = dialogs.assign_lesson}
	<Modal title="Zařadit do lekce" onclose={() => (store.ui.dialog = null)}>
		<p>Vyber lekci pro tuto kartu. Její obsah se nebude kopírovat.</p>
		<label class="lesson-picker">
			Lekce
			<select
				value={assign.chosen}
				onchange={(e) => {
					const dialog = store.ui.dialog;
					if (dialog?.kind === 'assign_lesson')
						store.ui.dialog = { ...dialog, lessonId: e.currentTarget.value };
				}}
			>
				<option value="" disabled>Vyber lekci…</option>
				{#each assign.lessons as lesson, i (lesson.value)}
					<option value={lesson.value} data-screen="dialogs.assign_lesson.lessons[{i}].label"
						>{lesson.label}</option
					>
				{/each}
			</select>
		</label>
		{#snippet footer()}
			<Button variant="ghost" onclick={() => (store.ui.dialog = null)}>Zpět</Button>
			<Button disabled={!assign.can_assign} onclick={assignToLesson}>Zařadit</Button>
		{/snippet}
	</Modal>
{/if}

{#if dialogs.type_change}
	<Modal title={dialogs.type_change.title} onclose={() => (store.ui.dialog = null)}>
		<p data-screen="dialogs.type_change.message">{dialogs.type_change.message}</p>
		{#snippet footer()}
			<Button variant="ghost" onclick={() => (store.ui.dialog = null)}>Zrušit</Button>
			<Button variant="danger-solid" onclick={confirmTypeChange}>Přesto změnit</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	.lesson-picker {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lesson-picker select {
		padding: 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--e-text);
		font: inherit;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-bottom: 12px;
	}

	.spacer {
		flex: 1;
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 12px;
	}

	.step-wrap {
		position: relative;
	}

	.step-wrap:focus {
		outline: none;
	}

	/*
     * The insert-between button straddles the gap under a step, out of sight until
     * the step is pointed at or focused. A screen with no hover shows it always.
     */
	.step-wrap :global(.insert) {
		position: absolute;
		bottom: -16px;
		left: 50%;
		z-index: 1;
		transform: translateX(-50%);
		opacity: 0;
		transition: opacity 120ms;
	}

	.step-wrap :global(.insert .menu-trigger) {
		padding: 2px;
		border-color: var(--e-border-strong);
		background: var(--surface);
	}

	.step-wrap:hover :global(.insert),
	.step-wrap:focus-within :global(.insert) {
		opacity: 1;
	}

	@media (hover: none) {
		.step-wrap :global(.insert) {
			opacity: 1;
		}
	}

	.add-step {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 12px;
	}
</style>
