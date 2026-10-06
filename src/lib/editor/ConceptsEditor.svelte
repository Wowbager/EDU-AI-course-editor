<script lang="ts">
	/**
	 * `learning.concepts` — the key terms a card is about (§6.4), as chips.
	 *
	 * One term per chip, added with Enter or "Přidat"; a pasted comma-separated list
	 * becomes several chips at once, so a list typed in another tool arrives as it was.
	 * Terms are free text and the list is never reordered; a term that is already there
	 * is refused with a sentence rather than silently dropped.
	 *
	 * Spelling stays the same across the course: while typing, terms other cards already
	 * use are suggested in a small list under the field (arrows and Enter reach it, and
	 * so does a click), and picking one adds it with the course's spelling. A term typed
	 * out that matches one of them apart from case is written the way the course has it
	 * (`domain/concepts.ts`).
	 *
	 * The chips, the suggestions and whether the list is open are the model's
	 * (`screen/settings.ts`); the text being typed and what was refused are
	 * `store.ui.concepts`.
	 */
	import { withUndoNotice } from './undo-notice';
	import type { BlockV2 } from '$lib/domain/schema';
	import type { ConceptsView } from '$lib/screen/types';
	import { X } from '@lucide/svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { setField } from '$lib/domain/commands';
	import { addTerms, courseTerms, isTermList, refusalText } from '$lib/domain/concepts';

	interface Props {
		block: BlockV2;
		view: ConceptsView;
		/** Where `view` is in the model, for `data-screen`. */
		screen: string;
	}
	let { block, view, screen }: Props = $props();

	const store = useStore();
	const form = $derived(store.ui.concepts);
	const concepts = $derived(block.learning?.concepts ?? []);

	const uid = $props.id();
	const listId = `concept-suggestions-${uid}`;

	const write = (next: string[]) =>
		store.apply((d) =>
			setField(
				d,
				{ blockId: block.block_id, field: 'learning.concepts' },
				next.length === 0 ? undefined : next
			)
		);

	function add(raw: string) {
		form.active = -1;
		const { next, refused } = addTerms(concepts, raw, courseTerms(store.source.blocks));
		form.problem = refusalText(refused);
		if (next.length !== concepts.length) write(next);
		// A refused term stays in the field, to be corrected rather than retyped.
		if (refused.length === 0 || next.length !== concepts.length) form.draft = refused.join(', ');
	}

	function remove(term: string) {
		form.problem = '';
		withUndoNotice(store, 'Pojem odebrán.', () => write(concepts.filter((c) => c !== term)), {
			lessonId: store.open.lesson?.lesson_id,
			blockId: block.block_id
		});
	}
</script>

<section class="concepts">
	<header>
		<span class="title">Pojmy</span>
		<span class="note">Klíčové pojmy, o kterých karta je.</span>
	</header>

	{#if view.terms.length > 0}
		<ul>
			{#each view.terms as item, i (item.term)}
				<li>
					<span class="term" data-screen="{screen}.terms[{i}].term">{item.term}</span>
					<button
						type="button"
						class="remove"
						title="Odebrat pojem"
						aria-label={item.remove_label}
						onclick={() => remove(item.term)}><X size={13} aria-hidden="true"></X></button
					>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="add">
		<div class="field">
			<input
				type="text"
				role="combobox"
				autocomplete="off"
				placeholder="např. čitatel"
				aria-label="Nový pojem"
				aria-expanded={view.listing}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={view.listing && view.active >= 0
					? `${listId}-${view.active}`
					: undefined}
				value={view.draft}
				data-screen="{screen}.draft"
				oninput={(e) => {
					form.draft = e.currentTarget.value;
					form.active = -1;
				}}
				onfocus={() => (form.focused = true)}
				onblur={() => (form.focused = false)}
				onkeydown={(e) => {
					if (e.key === 'ArrowDown' && view.listing) {
						e.preventDefault();
						form.active = (form.active + 1) % view.suggestions.length;
					} else if (e.key === 'ArrowUp' && view.listing) {
						e.preventDefault();
						form.active = form.active <= 0 ? view.suggestions.length - 1 : form.active - 1;
					} else if (e.key === 'Escape' && view.listing) {
						// Closes the list, not the dialog around it.
						e.preventDefault();
						e.stopPropagation();
						form.focused = false;
					} else if (e.key === 'Enter') {
						e.preventDefault();
						add(view.listing && view.active >= 0 ? view.suggestions[view.active] : view.draft);
					}
				}}
				onpaste={(e) => {
					const text = e.clipboardData?.getData('text') ?? '';
					if (!isTermList(text)) return;
					e.preventDefault();
					add(text);
				}}
			/>
			{#if view.listing}
				<ul class="suggestions" id={listId} role="listbox" aria-label="Pojmy z jiných karet">
					{#each view.suggestions as term, i (term)}
						<!-- A press, not a click: the field would lose focus and close the list first. -->
						<li
							id={`${listId}-${i}`}
							role="option"
							aria-selected={i === view.active}
							class:active={i === view.active}
							data-screen="{screen}.suggestions[{i}]"
							onpointerdown={(e) => {
								e.preventDefault();
								add(term);
							}}
						>
							{term}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		<Button variant="secondary" size="s" ariaLabel="Přidat pojem" onclick={() => add(view.draft)}
			>Přidat</Button
		>
	</div>
	{#if view.problem !== ''}
		<p class="problem" role="alert" data-screen="{screen}.problem">{view.problem}</p>
	{/if}
</section>

<style>
	.concepts {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.title {
		color: var(--e-text-muted);
		font: var(--type-meta);
	}

	.note {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px 2px 2px 10px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-pill);
		background: var(--surface-light);
		font-size: var(--text-s);
		color: var(--e-text);
	}

	.term {
		overflow-wrap: anywhere;
	}

	.add {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.field {
		position: relative;
	}

	.suggestions {
		position: absolute;
		z-index: 5;
		top: 100%;
		left: 0;
		display: block;
		min-width: 100%;
		margin: 2px 0 0;
		padding: 2px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		box-shadow: var(--shadow-medium);
	}

	.suggestions li {
		display: block;
		padding: 4px 8px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		white-space: nowrap;
		cursor: pointer;
	}

	.suggestions li:hover,
	.suggestions li.active {
		background: var(--surface-light);
	}

	input {
		width: 200px;
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		font-size: var(--text-s);
	}

	.problem {
		margin: 0;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	/* Always visible, only quiet. */
	.remove {
		display: inline-flex;
		padding: 4px;
		border: none;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--e-text-faint);
		cursor: pointer;
	}

	.remove:hover,
	.remove:focus-visible {
		color: var(--e-error);
	}
</style>
