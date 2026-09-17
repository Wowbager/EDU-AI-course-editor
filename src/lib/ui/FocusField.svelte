<script lang="ts">
	/**
	 * The focus-reveal pattern: a value is shown as text, and the input appears only
	 * when the author moves to it. It keeps a dense screen — a lesson of fifteen cards
	 * with an answer table each — readable as content rather than as a form.
	 *
	 * The text state is a real `<button>`, so the pattern is reachable by keyboard and
	 * announced as editable; Enter or a click swaps in the input, Escape abandons the
	 * edit, blur and Enter commit it.
	 *
	 * **The resting state has to look editable anyway.** The first version drew
	 * nothing at all until hover, and the honest report was that you could not tell
	 * what was a field and what was a caption. So a field at rest carries a faint
	 * tint and a writing line under the text — enough to read as a place to type, not
	 * so much that a page of them reads as a form. The three states are a grammar:
	 *
	 *   filled  tint + a solid writing line
	 *   empty   the same tint + a dashed line, and the text in italics
	 *   invalid a red left bar, and it wins — a field that is both reads as broken
	 *
	 * Empty is deliberately *not* alarming. Most optional fields are empty most of
	 * the time, and a screen where every unfilled hint glows amber teaches authors
	 * to ignore the colour that is supposed to mean "this is wrong".
	 */
	interface Props {
		value: string | undefined;
		label: string;
		placeholder?: string;
		multiline?: boolean;
		/** Shown instead of the value when it is empty — the author's cue to fill it. */
		emptyText?: string;
		monospace?: boolean;
		/**
		 * `compact` keeps the writing line and drops the fill. For headings: a 6 %
		 * wash under 20px heavy type stops being a hint and starts being a form.
		 */
		density?: 'normal' | 'compact';
		disabled?: boolean;
		invalid?: boolean;
		onchange: (value: string | undefined) => void;
	}

	let {
		value,
		label,
		placeholder = '',
		multiline = false,
		emptyText,
		monospace = false,
		density = 'normal',
		disabled = false,
		invalid = false,
		onchange
	}: Props = $props();

	let editing = $state(false);
	let draft = $state('');
	let element = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

	const display = $derived((value ?? '').trim());

	function begin() {
		if (disabled) return;
		draft = value ?? '';
		editing = true;
	}

	function commit() {
		editing = false;
		const next = draft.trim() === '' ? undefined : draft;
		if (next !== value) onchange(next);
	}

	function abandon() {
		editing = false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			abandon();
		} else if (event.key === 'Enter' && !multiline) {
			event.preventDefault();
			commit();
		}
	}

	$effect(() => {
		if (editing && element) {
			element.focus();
			element.select();
		}
	});
</script>

{#if editing}
	{#if multiline}
		<textarea
			bind:this={element}
			bind:value={draft}
			aria-label={label}
			{placeholder}
			class="field"
			class:mono={monospace}
			rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
			onblur={commit}
			onkeydown={onkeydown}
		></textarea>
	{:else}
		<input
			bind:this={element}
			bind:value={draft}
			aria-label={label}
			{placeholder}
			class="field"
			class:mono={monospace}
			onblur={commit}
			onkeydown={onkeydown}
		/>
	{/if}
{:else}
	<button
		type="button"
		class="reveal"
		class:empty={display === ''}
		class:mono={monospace}
		class:invalid
		class:multiline
		class:compact={density === 'compact'}
		{disabled}
		aria-label={`${label}: ${display === '' ? 'nevyplněno' : display}`}
		onclick={begin}
		onfocus={begin}
	>
		{display === '' ? (emptyText ?? placeholder ?? label) : display}
	</button>
{/if}

<style>
	.reveal {
		display: block;
		width: 100%;
		padding: 6px 8px;
		margin: -6px -8px;
		border: 1px solid transparent;
		border-radius: var(--radius-xs);
		/*
		 * The writing line is an inset shadow, not a border: the -6px/-8px margin
		 * above cancels the padding so the text sits where it would unstyled, and a
		 * real border would put that arithmetic back.
		 */
		background: var(--e-field-rest);
		box-shadow: inset 0 -1px 0 var(--e-field-rest-rule);
		font: inherit;
		color: var(--e-text);
		text-align: left;
		white-space: pre-wrap;
		cursor: text;
	}

	/* A heading is one line. Wrapping the course name turns the topbar into a block. */
	.reveal.compact {
		overflow: hidden;
		background: none;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reveal.multiline {
		min-height: 2.6em;
	}

	.reveal:hover:not(:disabled) {
		background: var(--e-field-hover);
		box-shadow: inset 0 -1px 0 var(--e-focus-ring);
	}

	.reveal.empty {
		border-bottom: 1px dashed var(--e-field-rest-rule);
		box-shadow: none;
		color: var(--e-text-faint);
		font-style: italic;
	}

	.reveal.empty:hover:not(:disabled) {
		border-bottom-color: var(--e-focus-ring);
		box-shadow: none;
	}

	/* Last, so a field that is both empty and invalid reads as invalid. */
	.reveal.invalid {
		box-shadow: inset 2px 0 0 var(--e-error);
	}

	.reveal:disabled {
		background: none;
		box-shadow: none;
		cursor: default;
		color: var(--e-text-muted);
	}

	.field {
		display: block;
		width: 100%;
		padding: 6px 8px;
		margin: -6px -8px;
		border: 1px solid var(--e-focus-ring);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font: inherit;
		color: var(--e-text);
		outline: 2px solid var(--primary);
		outline-offset: 0;
		resize: vertical;
	}

	.mono {
		font-family: var(--font-code);
		font-size: var(--text-s);
	}
</style>
