<script lang="ts">
	/**
	 * The proposal as a compact tree of tick boxes: lessons with cards under them, or the
	 * cards alone. Everything is ticked to begin with. A name is a field once it is
	 * clicked; a row is reordered by its handle (dragged, or with the arrow keys on the
	 * handle) within its own lesson, lessons among lessons; a row has its × on hover.
	 *
	 * It edits the panel's draft (`aiPanel.draft`) and nothing else: no row here is in
	 * the course until „Vytvořit vybrané“.
	 */
	import { tick } from 'svelte';
	import { ChevronRight, GripVertical, X } from '@lucide/svelte';
	import {
		lessonTick,
		moveCard,
		moveLesson,
		removeCard,
		removeLesson,
		renameDraftCard,
		renameDraftLesson,
		setCardTick,
		setLessonTick,
		type Draft
	} from '$lib/domain/outline';
	import { cardTypeIcon, cardTypeLabel } from '$lib/ui/card-types';
	import { shiftOf, startReorder, type DragState } from '$lib/ui/drag-reorder';
	import { aiPanel } from '$lib/state/ai-panel.svelte';

	interface Props {
		draft: Draft;
	}
	let { draft }: Props = $props();

	const edit = (next: Draft) => (aiPanel.draft = next);

	/** Lessons the teacher folded or opened by hand; the first one is open until then. */
	let opened = $state<Record<string, boolean>>({});
	const isOpen = (key: string, index: number) => opened[key] ?? index === 0;

	/** The name being edited: a lesson's or a card's key, and what is typed so far. */
	let editing = $state<{ key: string; value: string } | null>(null);
	async function rename(key: string, value: string) {
		editing = { key, value };
		await tick();
		const field = document.getElementById(`ai-name-${key}`);
		if (field instanceof HTMLInputElement) {
			field.focus();
			field.select();
		}
	}
	function commit(key: string, lesson: boolean) {
		if (editing?.key !== key) return;
		const name = editing.value.trim();
		editing = null;
		// An emptied name is the old one: a proposal row is never left without a name.
		if (name === '') return;
		edit(lesson ? renameDraftLesson(draft, key, name) : renameDraftCard(draft, key, name));
	}

	/** Which list is being dragged (a lesson's key, or `lessons`), and how far. */
	let drag = $state<{ list: string; state: DragState } | null>(null);
	const shift = (list: string, index: number) =>
		shiftOf(drag?.list === list ? drag.state : null, index);

	function press(event: PointerEvent, list: string, from: number, container: HTMLElement | null) {
		if (container === null) return;
		const rows = [...container.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
		startReorder(
			event,
			rows,
			from,
			(state) => (drag = state === null ? null : { list, state }),
			(a, b) => edit(list === 'lessons' ? moveLesson(draft, a, b) : moveCard(draft, list, a, b))
		);
	}

	/** The arrow keys on a handle move the row one place: the keyboard's drag. */
	async function arrows(event: KeyboardEvent, list: string, index: number, count: number) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const to = index + (event.key === 'ArrowUp' ? -1 : 1);
		if (to < 0 || to >= count) return;
		const handle = event.currentTarget as HTMLElement;
		edit(list === 'lessons' ? moveLesson(draft, index, to) : moveCard(draft, list, index, to));
		// The row moves in the DOM; the handle keeps the focus.
		await tick();
		handle.focus();
	}

	function indeterminate(node: HTMLInputElement, on: boolean) {
		node.indeterminate = on;
		return {
			update(next: boolean) {
				node.indeterminate = next;
			}
		};
	}

	let lessonsEl = $state<HTMLElement | null>(null);
	const cardsEls = $state<Record<string, HTMLElement | null>>({});
</script>

{#snippet cardRow(
	card: Draft['lessons'][number]['cards'][number],
	lesson: Draft['lessons'][number],
	index: number
)}
	{@const Icon = cardTypeIcon(card.kind)}
	<li
		class="row card"
		class:dragged={drag?.list === lesson.key && drag.state.moved && drag.state.from === index}
		style:transform={shift(lesson.key, index) === 0
			? undefined
			: `translateY(${shift(lesson.key, index)}px)`}
	>
		<button
			type="button"
			class="grip"
			aria-label={`Přesunout: ${card.name}`}
			title="Přetažením (nebo šipkami nahoru a dolů) změníš pořadí"
			onpointerdown={(e) => press(e, lesson.key, index, cardsEls[lesson.key])}
			onkeydown={(e) => arrows(e, lesson.key, index, lesson.cards.length)}
		>
			<GripVertical size={14} aria-hidden="true" />
		</button>
		<input
			type="checkbox"
			checked={card.on}
			aria-label={`Vytvořit: ${card.name}`}
			onchange={(e) => edit(setCardTick(draft, card.key, e.currentTarget.checked))}
		/>
		<div class="text">
			<div class="line">
				<span class="kind" title={cardTypeLabel(card.kind)}>
					<Icon size={13} aria-hidden="true" />
					<span class="sr">{cardTypeLabel(card.kind)}</span>
				</span>
				{#if editing?.key === card.key}
					<input
						id={`ai-name-${card.key}`}
						class="name-field"
						aria-label="Název karty"
						bind:value={editing.value}
						onblur={() => commit(card.key, false)}
						onkeydown={(e) => {
							if (e.key === 'Enter') commit(card.key, false);
							if (e.key === 'Escape') editing = null;
						}}
					/>
				{:else}
					<button
						type="button"
						class="name"
						class:off={!card.on}
						title="Přejmenovat"
						onclick={() => rename(card.key, card.name)}>{card.name}</button
					>
				{/if}
			</div>
		</div>
		<button
			type="button"
			class="remove"
			aria-label={`Odebrat z návrhu: ${card.name}`}
			title="Odebrat z návrhu"
			onclick={() => edit(removeCard(draft, card.key))}
		>
			<X size={14} aria-hidden="true" />
		</button>
	</li>
{/snippet}

{#if draft.scope === 'cards'}
	<ul class="cards flat" bind:this={cardsEls[draft.lessons[0].key]}>
		{#each draft.lessons[0].cards as card, index (card.key)}
			{@render cardRow(card, draft.lessons[0], index)}
		{/each}
	</ul>
{:else}
	<ul class="lessons" bind:this={lessonsEl}>
		{#each draft.lessons as lesson, li (lesson.key)}
			{@const state = lessonTick(lesson)}
			{@const open = isOpen(lesson.key, li)}
			<li
				class="lesson"
				class:dragged={drag?.list === 'lessons' && drag.state.moved && drag.state.from === li}
				style:transform={shift('lessons', li) === 0
					? undefined
					: `translateY(${shift('lessons', li)}px)`}
			>
				<div class="row head">
					<button
						type="button"
						class="grip"
						aria-label={`Přesunout lekci: ${lesson.name}`}
						title="Přetažením (nebo šipkami nahoru a dolů) změníš pořadí"
						onpointerdown={(e) => press(e, 'lessons', li, lessonsEl)}
						onkeydown={(e) => arrows(e, 'lessons', li, draft.lessons.length)}
					>
						<GripVertical size={14} aria-hidden="true" />
					</button>
					<button
						type="button"
						class="fold"
						class:open
						aria-expanded={open}
						aria-label={`${open ? 'Sbalit' : 'Rozbalit'} lekci: ${lesson.name}`}
						onclick={() => (opened[lesson.key] = !open)}
					>
						<ChevronRight size={14} aria-hidden="true" />
					</button>
					<input
						type="checkbox"
						checked={state === 'all'}
						use:indeterminate={state === 'some'}
						aria-label={`Vytvořit lekci: ${lesson.name}`}
						onchange={(e) => edit(setLessonTick(draft, lesson.key, e.currentTarget.checked))}
					/>
					<div class="text">
						{#if editing?.key === lesson.key}
							<input
								id={`ai-name-${lesson.key}`}
								class="name-field lesson-name"
								aria-label="Název lekce"
								bind:value={editing.value}
								onblur={() => commit(lesson.key, true)}
								onkeydown={(e) => {
									if (e.key === 'Enter') commit(lesson.key, true);
									if (e.key === 'Escape') editing = null;
								}}
							/>
						{:else}
							<button
								type="button"
								class="name lesson-name"
								class:off={state === 'none'}
								title="Přejmenovat"
								onclick={() => rename(lesson.key, lesson.name)}>{lesson.name}</button
							>
						{/if}
					</div>
					<button
						type="button"
						class="remove"
						aria-label={`Odebrat z návrhu lekci: ${lesson.name}`}
						title="Odebrat z návrhu"
						onclick={() => edit(removeLesson(draft, lesson.key))}
					>
						<X size={14} aria-hidden="true" />
					</button>
				</div>
				{#if open}
					<ul class="cards" bind:this={cardsEls[lesson.key]}>
						{#each lesson.cards as card, index (card.key)}
							{@render cardRow(card, lesson, index)}
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

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
		margin: 2px 0 4px 38px;
	}

	.cards.flat {
		margin: 0;
	}

	.lesson,
	.row.card {
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
	.row:focus-within {
		background: var(--primary-dark-06);
	}

	.text {
		flex: 1;
		min-width: 0;
	}

	.line {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.kind {
		display: inline-flex;
		flex: none;
		color: var(--e-text-faint);
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

	@media (hover: none) {
		.grip,
		.remove {
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

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.lesson,
		.row.card,
		.fold :global(svg) {
			transition: none;
		}
	}
</style>
