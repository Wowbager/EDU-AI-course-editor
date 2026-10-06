<script lang="ts">
	/**
	 * A place, broadest first — lesson, card, step, answer — with a chevron icon
	 * between the parts rather than a typed `›`, so it draws like every other glyph in
	 * the editor.
	 */
	import { ChevronRight } from '@lucide/svelte';

	interface Props {
		parts: readonly string[];
		class?: string;
		/** Where the screen model says these parts: each is `data-screen="<screen>[i]"`. */
		screen?: string;
	}
	let { parts, class: className = '', screen }: Props = $props();
</script>

<span class="crumbs {className}">
	{#each parts as part, i (i)}
		{#if i > 0}<ChevronRight size={12} aria-hidden="true"></ChevronRight>{/if}
		<span data-screen={screen === undefined ? undefined : `${screen}[${i}]`}>{part}</span>
	{/each}
</span>

<style>
	.crumbs {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 4px;
		min-width: 0;
	}

	.crumbs :global(svg) {
		flex: none;
		opacity: 0.7;
	}
</style>
