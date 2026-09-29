<script lang="ts">
	/**
	 * The editor's one notice (`state/notice.svelte.ts`), drawn once by the page.
	 *
	 * The live region is always in the page and the notice comes into it, because a
	 * screen reader announces a change inside a region that is already there and does
	 * not announce a region that appears with its text.
	 */
	import { notices } from '$lib/state/notice.svelte';
	import { useStore } from '$lib/ui/context';

	const store = useStore();
	const notice = $derived(notices.current);
	// Never let a stale notice undo a later, unrelated edit.
	const undoable = $derived(
		notice?.entry !== undefined && store.undoStack.at(-1) === notice.entry
	);

	function undo() {
		const current = notices.current;
		if (current === null) return;
		store.undo();
		if (current.ref !== undefined) store.selection = current.ref;
		notices.dismiss();
	}
</script>

<div class="slot" role="status" aria-live="polite">
	{#if notice !== null}
		{#key notice.id}
			<!-- Hover or focus is reading it: the clock stops until they leave. -->
			<div
				class="toast"
				role="presentation"
				onpointerenter={() => notices.pause()}
				onpointerleave={() => notices.resume()}
				onfocusin={() => notices.pause()}
				onfocusout={() => notices.resume()}>
				<span class="text">{notice.text}</span>
				{#if undoable}
					<button type="button" class="undo" onclick={undo}>Vrátit zpět</button>
				{/if}
			</div>
		{/key}
	{/if}
</div>

<style>
	.slot {
		display: flex;
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 14px;
		max-width: min(440px, 100%);
		padding: 10px 10px 10px 16px;
		border-radius: var(--radius-s);
		background: var(--primary-dark);
		color: var(--surface);
		box-shadow: var(--shadow-strong);
		font: var(--type-body-small);
		pointer-events: auto;
		animation: toast-in 160ms ease-out;
	}

	.text {
		min-width: 0;
	}

	.undo {
		flex: none;
		padding: 5px 12px;
		border: none;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.12);
		color: var(--primary);
		font: inherit;
		font-weight: var(--weight-semibold);
		cursor: pointer;
	}

	.undo:hover {
		background: rgb(255 255 255 / 0.2);
	}

	.undo:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation: none;
		}
	}
</style>
