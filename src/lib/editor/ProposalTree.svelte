<script lang="ts">
	/**
	 * The proposal as a compact tree of tick boxes: lessons with cards under them, or the
	 * cards alone. Everything is ticked to begin with. A name is a field once it is
	 * clicked; a card's kind is changed from its icon. A row is reordered by its handle
	 * (dragged, or with the arrow keys on the handle): a lesson among lessons, a card
	 * anywhere, into another lesson too. A row has its × on hover, and an open lesson and
	 * the tree their quiet „+ karta“ and „+ lekce“.
	 *
	 * Writing an outline by hand is typing: Enter after a card's name starts the next card,
	 * after a new lesson's name its first card; Backspace in an empty name removes the row
	 * and goes back to the one above, and Enter on a new empty row ends. A row clicked away
	 * from without a name stays, „bez názvu“: the outline's shape can come first, the names
	 * after.
	 *
	 * It edits the panel's draft through `aiPanel`, each edit one undo step, and nothing
	 * else: no row here is in the course until „Vytvořit vybrané“.
	 */
	import { tick, untrack } from 'svelte';
	import { ChevronRight, GripVertical, X } from '@lucide/svelte';
	import {
		addDraftCard,
		addDraftLesson,
		canAddCard,
		canAddLesson,
		lessonStartsOpen,
		settleOpen,
		lessonTick,
		moveCardTo,
		moveLesson,
		OUTLINE_KINDS,
		removeCard,
		removeLesson,
		renameDraftCard,
		renameDraftLesson,
		setCardTick,
		setDraftKind,
		setLessonTick,
		stepCard,
		type Draft,
		type OutlineKind
	} from '$lib/domain/outline';
	import { cardTypeIcon, cardTypeLabel } from '$lib/ui/card-types';
	import {
		cardPlace,
		shiftOf,
		startReorder,
		type DragState,
		type FlatRow
	} from '$lib/ui/drag-reorder';
	import { placeMenu } from '$lib/ui/placement';
	import { aiPanel } from '$lib/state/ai-panel.svelte';
	import { materials } from '$lib/state/materials.svelte';
	import { sourceLine } from '$lib/domain/materials';

	interface Props {
		draft: Draft;
	}
	let { draft }: Props = $props();

	/** The draft as it is now, also between an edit and the next render. */
	const now = (): Draft => aiPanel.draft ?? draft;
	const edit = (next: Draft) => aiPanel.change(next);

	/** Where a card comes from, in one line, or nothing. */
	const sourcesOf = (keys: readonly string[] | undefined): string =>
		keys === undefined ? '' : sourceLine(materials.sections, keys);

	/** Lessons the teacher folded or opened by hand; the first one is open until then, or all of them when the proposal is short. */
	let opened = $state<Record<string, boolean>>({});
	const isOpen = (key: string, index: number) => opened[key] ?? lessonStartsOpen(draft, index);
	// The default is settled once per lesson, as it first appears (`settleOpen`).
	$effect(() => {
		const next = settleOpen(
			untrack(() => opened),
			draft
		);
		if (Object.keys(next).length !== untrack(() => Object.keys(opened).length)) opened = next;
	});

	/** Every row in the order it is on screen: a lesson's head, then its cards when it is open. */
	interface Shown extends FlatRow {
		key: string;
		name: string;
	}
	const shown = $derived.by((): Shown[] => {
		if (draft.scope === 'cards')
			return draft.lessons[0].cards.map((c, card) => ({
				key: c.key,
				name: c.name,
				lesson: 0,
				card
			}));
		return draft.lessons.flatMap((l, lesson) => {
			const open = isOpen(l.key, lesson);
			return [
				{ key: l.key, name: l.name, lesson, ...(open ? {} : { folded: true }) },
				...(open ? l.cards.map((c, card) => ({ key: c.key, name: c.name, lesson, card })) : [])
			];
		});
	});
	const flatIndex = $derived(new Map(shown.map((row, i) => [row.key, i])));

	// ───────────────────────────── names ─────────────────────────────

	/** The name being edited, what is typed so far, and whether the row is new (with its undo step). */
	/**
	 * The name being edited, what is typed so far, whether the row is new (with its undo step),
	 * and whether Enter started it rather than the teacher.
	 */
	let editing = $state<{
		key: string;
		value: string;
		fresh: boolean;
		step: number;
		chained?: boolean;
	} | null>(null);

	async function focusName(key: string, select: boolean) {
		await tick();
		const field = document.getElementById(`ai-name-${key}`);
		if (!(field instanceof HTMLInputElement)) return;
		field.focus();
		if (select) field.select();
		else field.setSelectionRange(field.value.length, field.value.length);
	}
	async function focusRow(key: string) {
		await tick();
		document.getElementById(`ai-row-${key}`)?.focus();
	}

	function rename(key: string, value: string, select = true) {
		editing = { key, value, fresh: false, step: 0 };
		void focusName(key, select);
	}
	function begin(key: string, step: number, chained = false) {
		editing = { key, value: '', fresh: true, step, chained };
		void focusName(key, false);
	}

	// A row the empty panel started is named here.
	$effect(() => {
		const typing = aiPanel.typing;
		if (typing === null) return;
		untrack(() => {
			aiPanel.typing = null;
			begin(typing.key, typing.step);
		});
	});

	const nameOf = (d: Draft, key: string): string | undefined =>
		d.lessons.find((l) => l.key === key)?.name ??
		d.lessons.flatMap((l) => l.cards).find((c) => c.key === key)?.name;
	const without = (d: Draft, key: string, lesson: boolean) =>
		lesson ? removeLesson(d, key) : removeCard(d, key);

	/** What a row is called on screen and to assistive tech: its name, or that it has none. */
	const shownName = (name: string): string => name.trim() || 'bez názvu';

	/**
	 * The name typed is kept. A row left empty stays as it was: one the teacher added stays
	 * without a name (Backspace, Escape or its × take it away), an existing one keeps its old
	 * name. Only a row Enter started and nothing was done with goes; its kind icon, `to`,
	 * counts as something. Returns whether a name was typed.
	 */
	/** The card whose kind icon is being pressed, while its name field loses focus to it. */
	let pressedKind: string | null = null;
	function commit(key: string, lesson: boolean, to?: EventTarget | null): boolean {
		if (editing?.key !== key) return false;
		const { value, fresh, step, chained } = editing;
		editing = null;
		const name = value.trim();
		const d = now();
		if (name === '') {
			// A pressed button is not focused everywhere (Safari), so the press counts too.
			const own =
				pressedKind === key ||
				(to instanceof Element && to.closest('[data-row]')?.getAttribute('data-row') === key);
			pressedKind = null;
			if (chained && !own) aiPanel.takeBack(step, without(d, key, lesson));
			return false;
		}
		const next = lesson ? renameDraftLesson(d, key, name) : renameDraftCard(d, key, name);
		// A new row and its name are one step.
		if (fresh) aiPanel.amend(next);
		else if (name !== nameOf(d, key)) edit(next);
		return true;
	}

	function addCard(lessonKey: string, at?: number, chained = false): boolean {
		const d = now();
		if (!canAddCard(d, lessonKey)) return false;
		const key = aiPanel.key();
		const step = edit(addDraftCard(d, lessonKey, key, at));
		opened[lessonKey] = true;
		begin(key, step, chained);
		return true;
	}
	function addLesson() {
		const d = now();
		if (!canAddLesson(d)) return;
		const key = aiPanel.key();
		const step = edit(addDraftLesson(d, key));
		opened[key] = true;
		begin(key, step);
	}

	/**
	 * Enter: the name is kept and the next row is started, ready to type. On a new row with
	 * nothing typed it ends the typing, as in a list, and the row goes.
	 */
	function enter(key: string, lesson: boolean) {
		if (editing?.key === key && editing.fresh && editing.value.trim() === '') {
			cancel(key, lesson);
			return;
		}
		if (!commit(key, lesson)) {
			if (nameOf(now(), key) !== undefined) void focusRow(key);
			return;
		}
		const d = now();
		const owner = lesson
			? d.lessons.find((l) => l.key === key)
			: d.lessons.find((l) => l.cards.some((c) => c.key === key));
		if (owner === undefined) return;
		const started = lesson
			? owner.cards.length === 0 && addCard(owner.key, 0, true)
			: addCard(owner.key, owner.cards.findIndex((c) => c.key === key) + 1, true);
		if (!started) void focusRow(key);
	}

	/** Escape: nothing typed is kept, and a new row goes. */
	function cancel(key: string, lesson: boolean) {
		if (editing?.key !== key) return;
		const { fresh, step } = editing;
		editing = null;
		if (fresh) aiPanel.takeBack(step, without(now(), key, lesson));
		else void focusRow(key);
	}

	/** Backspace in an empty name: the row goes and the one above is edited. A lesson with cards stays. */
	function backspace(key: string, lesson: boolean) {
		if (editing?.key !== key) return;
		const d = now();
		if (lesson && (d.lessons.find((l) => l.key === key)?.cards.length ?? 0) > 0) return;
		const above = shown[(flatIndex.get(key) ?? 0) - 1];
		const { fresh, step } = editing;
		editing = null;
		if (fresh) aiPanel.takeBack(step, without(d, key, lesson));
		else edit(without(d, key, lesson));
		if (above !== undefined) rename(above.key, nameOf(now(), above.key) ?? above.name, false);
	}

	function onNameKey(event: KeyboardEvent, key: string, lesson: boolean) {
		if (event.isComposing) return;
		if (event.key === 'Enter') {
			event.preventDefault();
			enter(key, lesson);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancel(key, lesson);
		} else if (event.key === 'Backspace' && editing?.value === '') {
			event.preventDefault();
			backspace(key, lesson);
		}
	}

	// ───────────────────────────── kind ─────────────────────────────

	let kindPanel = $state<HTMLElement | null>(null);
	/** The card whose kind menu is open, and the icon it opened from. */
	let kindFor = $state<{ key: string; anchor: HTMLElement } | null>(null);
	let kindOpenAtPress = false;
	const kindShowing = () => kindPanel?.matches(':popover-open') ?? false;

	function placeKinds() {
		if (kindPanel === null || kindFor === null) return;
		const box = kindPanel.getBoundingClientRect();
		const spot = placeMenu(
			kindFor.anchor.getBoundingClientRect(),
			{ width: box.width, height: box.height },
			{ width: window.innerWidth, height: window.innerHeight },
			'bottom-start'
		);
		kindPanel.style.top = `${spot.top}px`;
		kindPanel.style.left = `${spot.left}px`;
	}

	function openKinds(event: MouseEvent, key: string) {
		pressedKind = null;
		// The press that closed the menu (light dismiss) does not open it again.
		if (kindOpenAtPress) {
			kindOpenAtPress = false;
			return;
		}
		if (kindPanel === null) return;
		kindFor = { key, anchor: event.currentTarget as HTMLElement };
		kindPanel.showPopover();
		placeKinds();
		// The card's own kind has the focus (the marks are drawn a moment later).
		const kind = now()
			.lessons.flatMap((l) => l.cards)
			.find((c) => c.key === key)?.kind;
		kindPanel.querySelector<HTMLElement>(`[data-kind="${kind}"]`)?.focus();
	}

	function pickKind(kind: OutlineKind) {
		if (kindFor !== null) edit(setDraftKind(now(), kindFor.key, kind));
		kindPanel?.hidePopover();
	}

	function onKindsToggle(event: Event) {
		if ((event as ToggleEvent).newState === 'open') return;
		const anchor = kindFor?.anchor;
		kindFor = null;
		// Focus goes back to the icon, unless the teacher went somewhere else.
		const active = document.activeElement;
		if (active === null || active === document.body || kindPanel?.contains(active)) anchor?.focus();
	}

	function onKindsKey(event: KeyboardEvent) {
		if (event.key === 'Tab') {
			kindPanel?.hidePopover();
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || kindPanel === null) return;
		event.preventDefault();
		const items = [...kindPanel.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
		const at = items.indexOf(document.activeElement as HTMLElement);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? items.length - 1
					: (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		items[next]?.focus();
	}

	$effect(() => {
		if (kindFor === null) return;
		const follow = (e: Event) => {
			if (!(e.target instanceof Node && kindPanel?.contains(e.target))) placeKinds();
		};
		const dismiss = () => kindPanel?.hidePopover();
		window.addEventListener('scroll', follow, true);
		window.addEventListener('resize', dismiss);
		return () => {
			window.removeEventListener('scroll', follow, true);
			window.removeEventListener('resize', dismiss);
		};
	});

	const currentKind = $derived(
		kindFor === null
			? undefined
			: draft.lessons.flatMap((l) => l.cards).find((c) => c.key === kindFor!.key)?.kind
	);

	// ───────────────────────────── moving ─────────────────────────────

	/**
	 * What is being dragged: the lessons among themselves, or a card over the flat list of
	 * every row on screen (heads and cards), and how far.
	 */
	let drag = $state<{ list: 'lessons' | 'cards'; state: DragState } | null>(null);
	const lessonShift = (index: number) =>
		shiftOf(drag?.list === 'lessons' ? drag.state : null, index);
	const rowShift = (key: string) =>
		shiftOf(drag?.list === 'cards' ? drag.state : null, flatIndex.get(key) ?? -1);
	/** Where a carried card would land now; a folded lesson it would go into shows it. */
	const dropInto = $derived(
		drag?.list === 'cards' && drag.state.moved
			? cardPlace(shown, drag.state.from, drag.state.to)
			: null
	);
	const translate = (y: number) => (y === 0 ? undefined : `translateY(${y}px)`);

	let root = $state<HTMLElement | null>(null);
	let lessonsEl = $state<HTMLElement | null>(null);

	function pressLesson(event: PointerEvent, from: number) {
		if (lessonsEl === null) return;
		const rows = [...lessonsEl.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
		startReorder(
			event,
			rows,
			from,
			(state) => (drag = state === null ? null : { list: 'lessons', state }),
			(a, b) => edit(moveLesson(now(), a, b))
		);
	}

	function pressCard(event: PointerEvent, key: string) {
		if (root === null) return;
		const els = [...root.querySelectorAll<HTMLElement>('[data-flat]')];
		const rows = shown.map(({ lesson, card, folded }): FlatRow => ({ lesson, card, folded }));
		const from = flatIndex.get(key);
		if (from === undefined || els.length !== rows.length) return;
		const lessons = now().lessons;
		startReorder(
			event,
			els,
			from,
			(state) => (drag = state === null ? null : { list: 'cards', state }),
			(a, b) => {
				const place = cardPlace(rows, a, b);
				const into = lessons[place.lesson];
				if (into !== undefined) edit(moveCardTo(now(), key, into.key, place.index));
			},
			// Below the first lesson's head: a card is always in a lesson.
			rows[0]?.card === undefined ? 1 : 0
		);
	}

	/** The arrow keys on a handle move the row one place: the keyboard's drag. */
	async function lessonArrows(event: KeyboardEvent, index: number) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const to = index + (event.key === 'ArrowUp' ? -1 : 1);
		if (to < 0 || to >= now().lessons.length) return;
		const handle = event.currentTarget as HTMLElement;
		edit(moveLesson(now(), index, to));
		// The row moves in the DOM; the handle keeps the focus.
		await tick();
		handle.focus();
	}

	/** A card goes past the end of its lesson into the next one, which opens to show it. */
	async function cardArrows(event: KeyboardEvent, key: string) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const next = stepCard(now(), key, event.key === 'ArrowUp' ? -1 : 1);
		if (next === now()) return;
		edit(next);
		const into = next.lessons.find((l) => l.cards.some((c) => c.key === key));
		if (into !== undefined) opened[into.key] = true;
		await tick();
		document.getElementById(`ai-grip-${key}`)?.focus();
	}

	function indeterminate(node: HTMLInputElement, on: boolean) {
		node.indeterminate = on;
		return {
			update(next: boolean) {
				node.indeterminate = next;
			}
		};
	}
</script>

{#snippet cardRow(card: Draft['lessons'][number]['cards'][number])}
	{@const Icon = cardTypeIcon(card.kind)}
	<li
		class="row card"
		data-flat
		data-row={card.key}
		class:dragged={drag?.list === 'cards' &&
			drag.state.moved &&
			drag.state.from === flatIndex.get(card.key)}
		style:transform={translate(rowShift(card.key))}
	>
		<button
			type="button"
			class="grip"
			id={`ai-grip-${card.key}`}
			aria-label={`Přesunout: ${shownName(card.name)}`}
			title="Přetažením (nebo šipkami nahoru a dolů) změníš pořadí"
			onpointerdown={(e) => pressCard(e, card.key)}
			onkeydown={(e) => cardArrows(e, card.key)}
		>
			<GripVertical size={14} aria-hidden="true" />
		</button>
		<input
			type="checkbox"
			checked={card.on}
			aria-label={`Vytvořit: ${shownName(card.name)}`}
			onchange={(e) => edit(setCardTick(now(), card.key, e.currentTarget.checked))}
		/>
		<div class="text">
			<div class="line">
				<button
					type="button"
					class="kind"
					aria-label={`Typ karty: ${cardTypeLabel(card.kind)}`}
					title={`${cardTypeLabel(card.kind)} (změnit typ)`}
					aria-haspopup="menu"
					aria-expanded={kindFor?.key === card.key}
					onpointerdown={() => {
						kindOpenAtPress = kindShowing();
						pressedKind = card.key;
					}}
					onclick={(e) => openKinds(e, card.key)}
				>
					<Icon size={13} aria-hidden="true" />
				</button>
				{#if editing?.key === card.key}
					<input
						id={`ai-name-${card.key}`}
						class="name-field"
						aria-label="Název karty"
						placeholder="Název karty"
						bind:value={editing.value}
						onblur={(e) => commit(card.key, false, e.relatedTarget)}
						onkeydown={(e) => onNameKey(e, card.key, false)}
					/>
				{:else}
					<button
						type="button"
						class="name"
						id={`ai-row-${card.key}`}
						class:off={!card.on}
						class:unnamed={card.name.trim() === ''}
						title="Přejmenovat"
						onclick={() => rename(card.key, card.name)}>{shownName(card.name)}</button
					>
				{/if}
			</div>
			{#if sourcesOf(card.sources) !== ''}
				<div class="source" class:off={!card.on} title={sourcesOf(card.sources)}>
					{sourcesOf(card.sources)}
				</div>
			{/if}
		</div>
		<button
			type="button"
			class="remove"
			aria-label={`Odebrat z návrhu: ${shownName(card.name)}`}
			title="Odebrat z návrhu"
			onclick={() => edit(removeCard(now(), card.key))}
		>
			<X size={14} aria-hidden="true" />
		</button>
	</li>
{/snippet}

<div
	class="tree"
	class:asking={aiPanel.asking}
	class:carrying={drag?.state.moved === true}
	bind:this={root}
>
	{#if draft.scope === 'cards'}
		<ul class="cards flat">
			{#each draft.lessons[0].cards as card (card.key)}
				{@render cardRow(card)}
			{/each}
		</ul>
		{#if canAddCard(draft, draft.lessons[0].key)}
			<button
				type="button"
				class="add"
				aria-label="Nová karta"
				onclick={() => addCard(draft.lessons[0].key)}>+ karta</button
			>
		{/if}
	{:else}
		<ul class="lessons" bind:this={lessonsEl}>
			{#each draft.lessons as lesson, li (lesson.key)}
				{@const state = lessonTick(lesson)}
				{@const open = isOpen(lesson.key, li)}
				<li
					class="lesson"
					class:dragged={drag?.list === 'lessons' && drag.state.moved && drag.state.from === li}
					style:transform={translate(lessonShift(li))}
				>
					<div
						class="row head"
						data-flat
						class:dropping={dropInto?.index === 'end' && dropInto.lesson === li}
						style:transform={translate(rowShift(lesson.key))}
					>
						<button
							type="button"
							class="grip"
							aria-label={`Přesunout lekci: ${shownName(lesson.name)}`}
							title="Přetažením (nebo šipkami nahoru a dolů) změníš pořadí"
							onpointerdown={(e) => pressLesson(e, li)}
							onkeydown={(e) => lessonArrows(e, li)}
						>
							<GripVertical size={14} aria-hidden="true" />
						</button>
						<button
							type="button"
							class="fold"
							class:open
							aria-expanded={open}
							aria-label={`${open ? 'Sbalit' : 'Rozbalit'} lekci: ${shownName(lesson.name)}`}
							onclick={() => (opened[lesson.key] = !open)}
						>
							<ChevronRight size={14} aria-hidden="true" />
						</button>
						<input
							type="checkbox"
							checked={state === 'all'}
							use:indeterminate={state === 'some'}
							aria-label={`Vytvořit lekci: ${shownName(lesson.name)}`}
							onchange={(e) => edit(setLessonTick(now(), lesson.key, e.currentTarget.checked))}
						/>
						<div class="text">
							{#if editing?.key === lesson.key}
								<input
									id={`ai-name-${lesson.key}`}
									class="name-field lesson-name"
									aria-label="Název lekce"
									placeholder="Název lekce"
									bind:value={editing.value}
									onblur={(e) => commit(lesson.key, true, e.relatedTarget)}
									onkeydown={(e) => onNameKey(e, lesson.key, true)}
								/>
							{:else}
								<button
									type="button"
									class="name lesson-name"
									id={`ai-row-${lesson.key}`}
									class:off={state === 'none'}
									class:unnamed={lesson.name.trim() === ''}
									title="Přejmenovat"
									onclick={() => rename(lesson.key, lesson.name)}>{shownName(lesson.name)}</button
								>
							{/if}
						</div>
						<button
							type="button"
							class="remove"
							aria-label={`Odebrat z návrhu lekci: ${shownName(lesson.name)}`}
							title="Odebrat z návrhu"
							onclick={() => edit(removeLesson(now(), lesson.key))}
						>
							<X size={14} aria-hidden="true" />
						</button>
					</div>
					{#if open}
						<ul class="cards">
							{#each lesson.cards as card (card.key)}
								{@render cardRow(card)}
							{/each}
						</ul>
						{#if canAddCard(draft, lesson.key)}
							<button
								type="button"
								class="add in-lesson"
								aria-label={`Nová karta v lekci: ${shownName(lesson.name)}`}
								onclick={() => addCard(lesson.key)}>+ karta</button
							>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
		{#if canAddLesson(draft)}
			<button type="button" class="add" aria-label="Nová lekce" onclick={addLesson}>+ lekce</button>
		{/if}
	{/if}
</div>

<div
	class="kinds"
	popover="auto"
	role="menu"
	tabindex="-1"
	aria-label="Typ karty"
	bind:this={kindPanel}
	ontoggle={onKindsToggle}
	onkeydown={onKindsKey}
>
	{#each OUTLINE_KINDS as kind (kind)}
		{@const KindIcon = cardTypeIcon(kind)}
		<button
			type="button"
			role="menuitemradio"
			aria-checked={currentKind === kind}
			tabindex="-1"
			class="kind-item"
			data-kind={kind}
			onclick={() => pickKind(kind)}
		>
			<KindIcon size={14} aria-hidden="true" />
			{cardTypeLabel(kind)}
		</button>
	{/each}
</div>

<style>
	ul {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.lessons {
		gap: 6px;
	}

	.cards {
		margin: 2px 0 0 38px;
	}

	.cards.flat {
		margin: 0;
	}

	.lesson,
	.row.card,
	.row.head {
		transition: transform 150ms ease;
	}

	.dragged {
		position: relative;
		z-index: 1;
		background: var(--surface);
		box-shadow: var(--shadow-medium);
		border-radius: var(--radius-xs);
		transition: none;
	}

	.row {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 5px 4px;
		border-radius: var(--radius-xs);
	}

	.row:hover,
	.row:focus-within,
	.row.dropping {
		background: var(--primary-dark-06);
	}

	/* The carried row is opaque whatever it is over: the tint goes on top of the surface. */
	.row.dragged,
	.lesson.dragged {
		background: linear-gradient(var(--primary-dark-06), var(--primary-dark-06)), var(--surface);
	}

	.text {
		flex: 1;
		min-width: 0;
	}

	.line {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	/* The card's kind: its icon, which opens the kinds when clicked. */
	.kind {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 19px;
		height: 19px;
		margin: 0 -2px;
		padding: 0;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		cursor: pointer;
	}

	.kind:hover,
	.kind[aria-expanded='true'] {
		background: var(--primary-dark-06);
		color: var(--e-text);
	}

	/* In the card's line it fills what the kind mark leaves; under a lesson, the text column. */
	.text > .name {
		display: block;
		width: 100%;
	}

	.name {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: none;
		border-bottom: 1px dashed transparent;
		background: none;
		font: var(--type-body-small);
		color: var(--e-text);
		text-align: left;
		cursor: text;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name:hover {
		border-bottom-color: var(--e-field-rest-rule);
	}

	.lesson-name {
		font: var(--type-label);
	}

	.name.off {
		color: var(--e-text-faint);
	}

	.name.unnamed {
		font-style: italic;
		color: var(--e-text-faint);
	}

	/* Where the card comes from: one quiet line under its name, only when it has sources. */
	.source {
		padding-left: 19px;
		overflow: hidden;
		color: var(--e-text-faint);
		font: var(--type-caption);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source.off {
		opacity: 0.6;
	}

	.name-field {
		flex: 1;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		padding: 1px 6px;
		border: 1px solid transparent;
		border-bottom-color: var(--e-field-rest-rule);
		border-radius: var(--radius-xs);
		background: var(--e-field-rest);
		font: var(--type-body-small);
		color: var(--e-text);
	}

	.name-field.lesson-name {
		font: var(--type-label);
	}

	input[type='checkbox'] {
		flex: none;
		width: 15px;
		height: 15px;
		margin: 3px 2px 0;
		accent-color: var(--primary-dark);
		cursor: pointer;
	}

	.grip,
	.fold,
	.remove {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
	}

	/* Handle and × are faint until the row is pointed at or worked in. */
	.grip,
	.remove {
		opacity: 0;
		transition: opacity 120ms;
	}

	.row:hover .grip,
	.row:focus-within .grip,
	.row:hover .remove,
	.row:focus-within .remove {
		opacity: 1;
	}

	/* „+ karta“ and „+ lekce“: quiet words, there when the lesson or the tree is pointed at or worked in. */
	.add {
		display: block;
		height: 20px;
		/* Under the lessons' tick boxes, as „+ karta“ is under the cards'. */
		margin: 2px 0 0 49px;
		padding: 0 4px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		font: var(--type-caption);
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms;
	}

	.add.in-lesson {
		margin-left: 64px;
	}

	.cards.flat + .add {
		margin-left: 26px;
	}

	.lesson:hover > .add,
	.lesson:focus-within > .add,
	.tree:hover > .add,
	.tree:focus-within > .add,
	.add:focus-visible {
		opacity: 1;
	}

	.add:hover {
		color: var(--e-text);
		background: var(--primary-dark-06);
	}

	/* Not there while the AI is writing, nor in the way of a row being carried. */
	.tree.carrying .add,
	.tree.asking .add {
		visibility: hidden;
	}

	@media (hover: none) {
		.grip,
		.remove,
		.add {
			opacity: 0.6;
		}
	}

	.grip {
		cursor: grab;
		touch-action: none;
	}

	.fold,
	.remove {
		cursor: pointer;
	}

	.fold :global(svg) {
		transition: transform 120ms;
	}

	.fold.open :global(svg) {
		transform: rotate(90deg);
	}

	.remove:hover {
		color: var(--e-error-text);
	}

	.grip:hover,
	.fold:hover {
		color: var(--e-text);
	}

	/* The kinds: a small menu under the icon, in the top layer. */
	.kinds:popover-open {
		position: fixed;
		inset: auto;
		top: 0;
		left: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin: 0;
		padding: 4px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--e-text);
		box-shadow: var(--shadow-strong);
		outline: none;
	}

	.kind-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 10px 5px 8px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text);
		font: var(--type-body-small);
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}

	.kind-item :global(svg) {
		color: var(--e-text-faint);
	}

	.kind-item[aria-checked='true'] {
		font-weight: 600;
	}

	.kind-item:hover,
	.kind-item:focus-visible {
		background: var(--primary-dark-06);
		outline: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.lesson,
		.row.card,
		.row.head,
		.fold :global(svg) {
			transition: none;
		}
	}
</style>
