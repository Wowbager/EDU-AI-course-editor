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
	 * out that matches one of them apart from case is written the way the course has it.
	 */
	import { withUndoNotice } from './undo-notice';
	import type { BlockV2 } from '$lib/domain/schema';
	import { X } from '@lucide/svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { setField } from '$lib/domain/commands';

	interface Props {
		block: BlockV2;
	}
	let { block }: Props = $props();

	const store = useStore();
	const concepts = $derived(block.learning?.concepts ?? []);

	const uid = $props.id();
	const listId = `concept-suggestions-${uid}`;

	/** Every term used in the course, first spelling wins, in document order. */
	const courseTerms = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const b of store.source.blocks)
			for (const term of b.learning?.concepts ?? [])
				if (!seen.has(term.toLowerCase())) seen.set(term.toLowerCase(), term);
		return seen;
	});
	/** What the course has that this card has not, and that contains what is being typed. */
	const suggestions = $derived.by(() => {
		const typed = draft.trim().toLowerCase();
		if (typed === '' || /[,;\n]/.test(typed)) return [];
		const mine = new Set(concepts.map((c) => c.toLowerCase()));
		return [...courseTerms]
			.filter(([key]) => !mine.has(key) && key.includes(typed) && key !== typed)
			.map(([, term]) => term)
			.slice(0, 6);
	});
	let focused = $state(false);
	let active = $state(-1);
	const listing = $derived(focused && suggestions.length > 0);

	let draft = $state('');
	/** What the last action refused, in words, shown under the list. */
	let problem = $state('');

	const write = (next: string[]) =>
		store.apply((d) =>
			setField(
				d,
				{ blockId: block.block_id, field: 'learning.concepts' },
				next.length === 0 ? undefined : next
			)
		);

	/** "a, b,, c" → ["a", "b", "c"]; commas, semicolons and line breaks all separate. */
	const split = (raw: string) =>
		raw
			.split(/[,;\n]/)
			.map((part) => part.trim())
			.filter((part) => part !== '');

	function add(raw: string) {
		active = -1;
		const next = [...concepts];
		const refused: string[] = [];
		for (const typed of split(raw)) {
			// The course's own spelling, when it has one.
			const term = courseTerms.get(typed.toLowerCase()) ?? typed;
			if (next.some((c) => c.toLowerCase() === term.toLowerCase())) refused.push(term);
			else next.push(term);
		}
		problem =
			refused.length === 0
				? ''
				: refused.length === 1
					? `Pojem „${refused[0]}“ už karta má.`
					: 'Některé z těch pojmů už karta má.';
		if (next.length !== concepts.length) write(next);
		// A refused term stays in the field, to be corrected rather than retyped.
		if (refused.length === 0 || next.length !== concepts.length) draft = refused.join(', ');
	}

	function remove(term: string) {
		problem = '';
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

	{#if concepts.length > 0}
		<ul>
			{#each concepts as term (term)}
				<li>
					<span class="term">{term}</span>
					<button
						type="button"
						class="remove"
						title="Odebrat pojem"
						aria-label={`Odebrat pojem ${term}`}
						onclick={() => remove(term)}><X size={13} aria-hidden="true"></X></button
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
				aria-expanded={listing}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={listing && active >= 0 ? `${listId}-${active}` : undefined}
				bind:value={draft}
				oninput={() => (active = -1)}
				onfocus={() => (focused = true)}
				onblur={() => (focused = false)}
				onkeydown={(e) => {
					if (e.key === 'ArrowDown' && listing) {
						e.preventDefault();
						active = (active + 1) % suggestions.length;
					} else if (e.key === 'ArrowUp' && listing) {
						e.preventDefault();
						active = active <= 0 ? suggestions.length - 1 : active - 1;
					} else if (e.key === 'Escape' && listing) {
						// Closes the list, not the dialog around it.
						e.preventDefault();
						e.stopPropagation();
						focused = false;
					} else if (e.key === 'Enter') {
						e.preventDefault();
						add(listing && active >= 0 ? suggestions[active] : draft);
					}
				}}
				onpaste={(e) => {
					const text = e.clipboardData?.getData('text') ?? '';
					if (!/[,;\n]/.test(text)) return;
					e.preventDefault();
					add(text);
				}}
			/>
			{#if listing}
				<ul class="suggestions" id={listId} role="listbox" aria-label="Pojmy z jiných karet">
					{#each suggestions as term, i (term)}
						<!-- A press, not a click: the field would lose focus and close the list first. -->
						<li
							id={`${listId}-${i}`}
							role="option"
							aria-selected={i === active}
							class:active={i === active}
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
		<Button variant="secondary" size="s" ariaLabel="Přidat pojem" onclick={() => add(draft)}
			>Přidat</Button
		>
	</div>
	{#if problem !== ''}
		<p class="problem" role="alert">{problem}</p>
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
