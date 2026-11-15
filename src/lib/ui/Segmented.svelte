<script lang="ts" generics="T extends string">
	/**
	 * A row of exclusive choices. A label is never wrapped: each button is as wide as
	 * the wider of its normal and its bold label (the hidden `::before` copy), so the
	 * selected state changes neither its size nor its line breaks. With `explain`, the
	 * selected option's `title` is also printed under the row, where it can be read
	 * rather than hovered for.
	 */
	import type { Component } from 'svelte';

	interface Props {
		options: { value: T; label: string; title?: string; icon?: Component }[];
		value: T;
		label: string;
		onchange: (value: T) => void;
		/** Settings can wrap; compact toolbar controls retain their single row. */
		wrap?: boolean;
		/** Print the selected option's `title` as a line under the row. */
		explain?: boolean;
		/** Id of a line elsewhere that describes the whole group. */
		describedby?: string;
	}
	let {
		options,
		value,
		label,
		onchange,
		wrap = false,
		explain = false,
		describedby
	}: Props = $props();
	const explanation = $derived(explain ? options.find((o) => o.value === value)?.title : undefined);
	const explainId = $props.id();
</script>

{#snippet row()}
	<div
		class="segmented"
		class:wrap
		role="radiogroup"
		aria-label={label}
		aria-describedby={explanation ? explainId : describedby}
	>
		{#each options as option (option.value)}
			<button
				type="button"
				role="radio"
				aria-checked={option.value === value}
				class:selected={option.value === value}
				class:icon={option.icon}
				title={explain ? undefined : option.title}
				data-label={option.label}
				onclick={() => onchange(option.value)}
			>
				<span>
					{#if option.icon}
						{@const Icon = option.icon}
						<Icon size={16} />
					{/if}
					{option.label}
				</span>
			</button>
		{/each}
	</div>
{/snippet}

{#if explain}
	<div class="segmented-box">
		{@render row()}
		{#if explanation}<p id={explainId} class="explanation">{explanation}</p>{/if}
	</div>
{:else}
	{@render row()}
{/if}

<style>
	.segmented-box {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		min-width: 0;
		max-width: 100%;
	}

	.explanation {
		margin: 0;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		line-height: 1.5;
	}

	.segmented {
		display: inline-flex;
		padding: 3px;
		border-radius: var(--radius-pill);
		background: var(--surface-light);
	}

	.wrap {
		/* A pill that holds several rows stops being a pill. */
		border-radius: var(--radius-m, 14px);
		min-width: 0;
		max-width: 100%;
		flex-wrap: wrap;
		gap: 3px;
	}

	button {
		padding: 5px 14px;
		border: none;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--e-text-muted);
		font-family: var(--font-body);
		font-size: var(--text-s);
		font-weight: var(--weight-medium);
		cursor: pointer;
		position: relative;
		flex: 1 1 auto;
		text-align: center;
	}

	button::before {
		content: attr(data-label);
		font-weight: var(--weight-bold);
		visibility: hidden;
		width: max-content;
		white-space: nowrap;
	}

	.icon {
		padding-left: 40px;
	}

	span {
		position: absolute;
		left: 14px;
		text-align: center;
		width: calc(100% - 28px);
		display: inline-flex;
		flex-direction: row;
		justify-content: center;
		white-space: nowrap;
		gap: 5px;
		align-items: center;
	}

	button:hover {
		color: var(--e-text);
	}

	.selected {
		background: var(--surface);
		color: var(--e-text);
		font-weight: var(--weight-bold);
		box-shadow: var(--shadow-light);
	}
</style>
