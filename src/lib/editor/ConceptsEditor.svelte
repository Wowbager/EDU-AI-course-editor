<script lang="ts">
	/**
	 * `learning.concepts` — the key terms a card is about (§6.4), as chips.
	 *
	 * One term per chip, added with Enter or "Přidat"; a pasted comma-separated list
	 * becomes several chips at once, so a list typed in another tool arrives as it was.
	 * Terms are free text and the list is never reordered; a term that is already there
	 * is refused with a sentence rather than silently dropped.
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
		const next = [...concepts];
		const refused: string[] = [];
		for (const term of split(raw)) {
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
			lessonId: store.selection?.lessonId,
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
		<input
			type="text"
			placeholder="např. čitatel"
			aria-label="Nový pojem"
			bind:value={draft}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					add(draft);
				}
			}}
			onpaste={(e) => {
				const text = e.clipboardData?.getData('text') ?? '';
				if (!/[,;\n]/.test(text)) return;
				e.preventDefault();
				add(text);
			}}
		/>
		<Button variant="secondary" size="s" onclick={() => add(draft)}>Přidat</Button>
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
