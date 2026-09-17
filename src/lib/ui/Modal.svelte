<script lang="ts">
	/**
	 * A real modal: focus goes in, Escape and the backdrop get you out, and the page
	 * behind it is inert while it is open.
	 *
	 * Built on the native `<dialog>` with `showModal()` rather than a positioned div,
	 * because the browser then owns the focus trap, the Escape key, `inert` on
	 * everything behind, and the top layer — four things the editor's first dialog
	 * hand-rolled and got three of them wrong. `<dialog>` also carries an implicit
	 * `role="dialog"`, so nothing has to be announced twice.
	 *
	 * Focus is restored to whatever opened it on close, which is the part a keyboard
	 * author notices: closing the card settings must put you back on the card.
	 */
	interface Props {
		title: string;
		onclose: () => void;
		/** `l` for the settings panels, which are two columns of fields. */
		size?: 'm' | 'l';
		children: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	}
	let { title, onclose, size = 'm', children, footer }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		const element = dialog;
		if (element === null) return;
		// Whatever had focus opened us; it is where focus belongs again afterwards.
		const opener = document.activeElement;
		element.showModal();
		return () => {
			if (element.open) element.close();
			if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
		};
	});
</script>

<!--
	`oncancel` is Escape. It is prevented and routed through `onclose` so that the
	owner's state is what decides the dialog is gone — otherwise the element closes
	itself, the owner still thinks it is open, and it can never be reopened.
-->
<dialog
	bind:this={dialog}
	class={size}
	aria-label={title}
	oncancel={(event) => {
		event.preventDefault();
		onclose();
	}}
	onclick={(event) => {
		// Clicks inside the panel stop there; a click on the dialog element itself is
		// the backdrop, because the panel fills the dialog's whole content box.
		if (event.target === dialog) onclose();
	}}
>
	<div class="panel">
		<header>
			<h2>{title}</h2>
			<button type="button" class="close" onclick={onclose} aria-label="Zavřít">×</button>
		</header>

		<div class="body">
			{@render children()}
		</div>

		{#if footer}
			<footer>{@render footer()}</footer>
		{/if}
	</div>
</dialog>

<style>
	dialog {
		width: min(560px, 90vw);
		max-height: 80vh;
		padding: 0;
		border: none;
		border-radius: var(--radius-l);
		background: var(--surface);
		box-shadow: var(--shadow-strong);
		color: var(--e-text);
		overflow: hidden;
	}

	dialog.l {
		width: min(860px, 92vw);
	}

	dialog::backdrop {
		background: var(--primary-dark-32);
	}

	.panel {
		display: flex;
		flex-direction: column;
		max-height: 80vh;
	}

	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 20px 12px;
		border-bottom: 1px solid var(--e-border);
	}

	h2 {
		flex: 1;
		margin: 0;
		font: var(--type-subtitle);
	}

	.close {
		padding: 0 4px;
		border: none;
		background: none;
		color: var(--e-text-faint);
		font-size: var(--text-2xl);
		line-height: 1;
		cursor: pointer;
	}

	.close:hover {
		color: var(--e-text);
	}

	.body {
		flex: 1;
		min-height: 0;
		padding: 18px 20px;
		overflow-y: auto;
	}

	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px;
		border-top: 1px solid var(--e-border);
	}
</style>
