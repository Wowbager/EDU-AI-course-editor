<script lang="ts">
	/**
	 * What a finished run of Vyzkoušet came to: shown at the foot of the preview, over
	 * the pupil's last card, and gone with one click, Escape or the next edit. It is a
	 * note, not a dialog: nothing behind it is blocked and the editor column is
	 * never covered.
	 */
	import { X } from '@lucide/svelte';
	import Button from '$lib/ui/Button.svelte';

	interface Props {
		xp: number;
		maxXp: number;
		/** Mean score of the finished cards, 0–1. */
		share: number;
		/** Only when the player sent one. */
		mark?: string;
		onretry: () => void;
		onclose: () => void;
	}
	let { xp, maxXp, share, mark, onretry, onclose }: Props = $props();
	const percent = $derived(Math.round(share * 100));
	let root = $state<HTMLElement>();

	/** For the column: take focus here when it was in the preview a moment ago. */
	export function focusClose() {
		root?.querySelector<HTMLElement>('[aria-label="Zavřít"]')?.focus();
	}
	/** Whether focus is inside, so closing can hand it back. */
	export function hasFocus() {
		return root?.contains(document.activeElement) ?? false;
	}
</script>

<section class="summary" aria-label="Shrnutí zkoušky" bind:this={root}>
	<div class="text">
		<strong>Hotovo</strong>
		<span class="numbers">
			{xp} z {maxXp} XP · úspěšnost {percent} %{mark !== undefined ? ` · známka ${mark}` : ''}
		</span>
	</div>
	<Button variant="secondary" size="s" onclick={onretry}>Zkusit znovu</Button>
	<Button variant="ghost" size="s" ariaLabel="Zavřít" title="Zavřít (Esc)" onclick={onclose}>
		<X size={16}></X>
	</Button>
</section>

<style>
	.summary {
		position: absolute;
		right: 12px;
		bottom: 12px;
		left: 12px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 8px 10px 14px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-l);
		background: var(--surface);
		box-shadow: var(--shadow-strong);
	}

	.text {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	strong {
		font: var(--type-meta-bold);
		color: var(--e-text);
	}

	.numbers {
		font: var(--type-caption);
		color: var(--e-text-muted);
	}
</style>
