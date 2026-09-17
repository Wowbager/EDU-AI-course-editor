<script lang="ts">
	/**
	 * The container the editor column's card sits in.
	 *
	 * It used to carry selection too — a click or a focus anywhere inside selected
	 * the card, because the column held every card in the lesson at once. The column
	 * holds one card now and the tree owns selection, so a highlight here would be a
	 * second "you are here" marker for a fact already stated on the left.
	 */
	interface Props {
		/** The binding's `bg_color`, when the author set one. */
		tone?: string;
		children: import('svelte').Snippet;
	}
	let { tone, children }: Props = $props();
</script>

<section class="card" style={tone ? `--card-tone: ${tone}` : undefined}>
	{@render children()}
</section>

<style>
	.card {
		padding: 16px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-l);
		background: var(--card-tone, var(--surface));
		box-shadow: var(--shadow-light);
	}
</style>
