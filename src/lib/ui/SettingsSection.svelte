<script lang="ts">
	/**
	 * One fold of a settings dialog: a quiet heading that opens its fields.
	 *
	 * The dialogs open short and keep the rest behind headings named by what the fields
	 * do (`SECTIONS` in `fields.ts`). A fold opens with one click, and by itself when
	 * `autoOpen` says something points into it (`sectionTargeted`): the preview's
	 * question mark, a review jump, an invalid field. It never closes by itself, so
	 * typing in a field that clears its issue does not pull the field away. Whether it
	 * is open is local to this instance; a dialog opens folded every time.
	 */
	import type { Snippet } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';

	interface Props {
		label: string;
		open?: boolean;
		/** Open now, and stay open. The caller says why. */
		autoOpen?: boolean;
		/** Where the model says the heading, for `data-screen`. */
		screen?: string;
		children: Snippet;
	}
	let { label, open = $bindable(false), autoOpen = false, screen, children }: Props = $props();

	$effect(() => {
		if (autoOpen) open = true;
	});

	const uid = $props.id();
</script>

<section class="fold" class:open>
	<h3>
		<button
			type="button"
			aria-expanded={open}
			aria-controls="{uid}-region"
			onclick={() => (open = !open)}
		>
			<ChevronRight size={14} aria-hidden="true"></ChevronRight>
			<span data-screen={screen}>{label}</span>
		</button>
	</h3>
	{#if open}
		<div class="region" id="{uid}-region" role="region" aria-label={label}>
			{@render children()}
		</div>
	{/if}
</section>

<style>
	.fold {
		border-top: 1px solid var(--e-border);
		padding-top: 2px;
	}

	h3 {
		margin: 0;
		font: inherit;
	}

	button {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 8px 0;
		border: 0;
		background: none;
		color: var(--e-text-muted);
		font-family: var(--font-heading);
		font-size: var(--text-s);
		text-align: left;
		cursor: pointer;
	}

	button:hover {
		color: var(--e-text);
	}

	button:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 2px;
	}

	button :global(svg) {
		flex: none;
		transition: transform 120ms ease;
	}

	.open button :global(svg) {
		transform: rotate(90deg);
	}

	.region {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 4px 0 14px;
	}

	@media (prefers-reduced-motion: reduce) {
		button :global(svg) {
			transition: none;
		}
	}
</style>
