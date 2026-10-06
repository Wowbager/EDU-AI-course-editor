<script lang="ts">
	/**
	 * The question the AI asks before anything it may not do on its own: a delete, a
	 * type change that drops answers, a large batch, taking everything back. It says what
	 * will happen and where, in the words the screen uses, and the answer is one of two
	 * buttons. Closing it any other way (Escape, the cross, a click outside) is "no".
	 */
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import type { AiRegion } from '$lib/screen/types';

	interface Props {
		confirm: NonNullable<AiRegion['confirm']>;
		onanswer: (allowed: boolean) => void;
	}
	let { confirm, onanswer }: Props = $props();
</script>

{#snippet body()}
	<p class="lead" data-screen="ai.confirm.message">{confirm.message}</p>
	{#if confirm.items.length > 0}
		<ul>
			{#each confirm.items as item, i (i)}
				<li data-screen="ai.confirm.items[{i}]">{item}</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet actions()}
	<Button variant="ghost" onclick={() => onanswer(false)}>Nepovolit</Button>
	<Button variant={confirm.destructive ? 'danger-solid' : 'primary'} onclick={() => onanswer(true)}
		>Povolit</Button
	>
{/snippet}

<Modal title={confirm.title} onclose={() => onanswer(false)} children={body} footer={actions} />

<style>
	.lead {
		margin: 0 0 12px;
		color: var(--e-text-muted);
		font-size: var(--text-m);
		line-height: 1.5;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0 0 0 18px;
		font-size: var(--text-m);
		line-height: 1.4;
	}
</style>
