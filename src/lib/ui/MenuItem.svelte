<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { useMenu } from './context';

	/**
	 * One action in a `Menu`. The menu closes *before* `onclick` runs, so the browser
	 * has already put focus back on the trigger by the time the action does its work;
	 * an action that opens a dialog then hands focus on from a sensible place.
	 */
	interface Props {
		onclick: () => void;
		icon?: Component;
		title?: string;
		disabled?: boolean;
		/** Removal: the text is the error colour. */
		danger?: boolean;
		children: Snippet;
	}
	let { onclick, icon: Icon, title, disabled = false, danger = false, children }: Props = $props();

	const menu = useMenu();

	function activate() {
		menu.close();
		onclick();
	}
</script>

<button
	type="button"
	role="menuitem"
	tabindex="-1"
	class="menu-item"
	class:danger
	{disabled}
	{title}
	onclick={activate}
>
	{#if Icon}<Icon size={16} aria-hidden="true" />{/if}
	<span class="menu-item-text">{@render children()}</span>
</button>

<style>
	.menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 10px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text);
		font-family: var(--font-body);
		font-size: var(--text-s);
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}

	.menu-item :global(svg) {
		flex: none;
	}

	.menu-item:hover:not(:disabled),
	.menu-item:focus-visible {
		background: var(--primary-dark-06);
	}

	.menu-item:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}

	.menu-item:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.menu-item.danger {
		color: var(--e-error);
	}

	.menu-item.danger:hover:not(:disabled),
	.menu-item.danger:focus-visible {
		background: var(--e-error-bg);
	}
</style>
