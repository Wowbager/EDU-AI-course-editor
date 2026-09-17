<script lang="ts">
	/**
	 * Every button in the editor, so that "how loud is this?" is a decision made once.
	 *
	 * Before this the `.ghost` class was written out in twelve components, in three
	 * sizes that did not agree, and the only *loud* button on the screen — the one
	 * that gets a course out of the tool — looked the same as a hover-only icon. The
	 * variants are a hierarchy, not a palette:
	 *
	 *  - `primary`   one per surface: the thing this screen exists to let you do.
	 *  - `secondary` the named actions that build a course. Solid, not dashed —
	 *    dashed is the drop-zone idiom, and a button that adds a card is not a hole
	 *    waiting to be filled.
	 *  - `ghost`     supporting actions: undo, duplicate, step back in the preview.
	 *  - `danger`    removal. Quiet until hovered, then unmistakably red.
	 *  - `danger-solid` the same act, confirmed: the red is already there, because a
	 *    dialog that exists to ask "are you sure" must not hide its answer.
	 */
	interface Props {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
		size?: 's' | 'm';
		type?: 'button' | 'submit';
		disabled?: boolean;
		title?: string;
		/** Set when the visible text is a glyph — the accessible name must be a word. */
		ariaLabel?: string;
		onclick?: (event: MouseEvent) => void;
		children: import('svelte').Snippet;
	}
	let {
		variant = 'secondary',
		size = 'm',
		type = 'button',
		disabled = false,
		title,
		ariaLabel,
		onclick,
		children
	}: Props = $props();
</script>

<button {type} class="btn {variant} {size}" {disabled} {title} aria-label={ariaLabel} {onclick}>
	{@render children()}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: var(--radius-pill);
		font-family: var(--font-body);
		white-space: nowrap;
		cursor: pointer;
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.s {
		padding: 4px 10px;
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
	}

	.m {
		padding: 6px 12px;
		font: var(--type-meta-bold);
	}

	.primary {
		border: none;
		background: var(--header-gradient);
		color: var(--surface);
		font: var(--type-action-small);
		box-shadow: var(--shadow-medium);
	}

	.primary:disabled {
		background: var(--disabled-button);
		color: var(--surface);
		opacity: 1;
		cursor: not-allowed;
	}

	.secondary {
		border: 1px solid var(--e-border-strong);
		background: var(--surface);
		color: var(--e-text);
	}

	.secondary:hover:not(:disabled) {
		border-color: var(--primary);
		background: var(--primary-dark-06);
	}

	.ghost {
		border: 1px solid transparent;
		background: none;
		color: var(--e-text-muted);
	}

	.ghost:hover:not(:disabled) {
		border-color: var(--e-border-strong);
		background: var(--primary-dark-06);
		color: var(--e-text);
	}

	.danger {
		border: 1px solid transparent;
		background: none;
		color: var(--e-text-muted);
	}

	.danger:hover:not(:disabled) {
		border-color: var(--e-error);
		background: var(--e-error-bg);
		color: var(--e-error);
	}

	.danger-solid {
		border: none;
		background: var(--e-error);
		color: var(--surface);
		box-shadow: var(--shadow-medium);
	}
</style>
