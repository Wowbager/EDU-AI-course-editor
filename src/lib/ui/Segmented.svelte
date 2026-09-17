<script lang="ts" generics="T extends string">
	interface Props {
		options: { value: T; label: string; title?: string }[];
		value: T;
		label: string;
		onchange: (value: T) => void;
	}
	let { options, value, label, onchange }: Props = $props();
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
	{#each options as option (option.value)}
		<button
			type="button"
			role="radio"
			aria-checked={option.value === value}
			class:selected={option.value === value}
			title={option.title}
			onclick={() => onchange(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: inline-flex;
		padding: 3px;
		border-radius: var(--radius-pill);
		background: var(--surface-light);
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
