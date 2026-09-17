<script lang="ts">
	/**
	 * `learning.competencies` — curriculum codes with percentage weights (§6.4).
	 *
	 * A map, not a list, so a card can serve several outcomes and say how much of it
	 * serves each. The plan's RVP → GPF mapping table does not exist yet (§9.3), so
	 * codes are typed rather than picked; when the table arrives this becomes its
	 * front end and nothing else has to move.
	 */
	import type { BlockV2 } from '$lib/domain/schema';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { setField } from '$lib/domain/commands';

	interface Props {
		block: BlockV2;
	}
	let { block }: Props = $props();

	const store = useStore();
	const entries = $derived(Object.entries(block.learning?.competencies ?? {}));
	const total = $derived(entries.reduce((sum, [, weight]) => sum + weight, 0));

	let code = $state('');
	let weight = $state('50');

	function write(next: Record<string, number>) {
		store.apply((d) =>
			setField(
				d,
				{ blockId: block.block_id, field: 'learning.competencies' },
				Object.keys(next).length === 0 ? undefined : next
			)
		);
	}

	function add() {
		const trimmed = code.trim();
		if (trimmed === '') return;
		const value = Number(weight);
		if (Number.isNaN(value)) return;
		write({ ...(block.learning?.competencies ?? {}), [trimmed]: value });
		code = '';
	}

	function remove(key: string) {
		const next = { ...(block.learning?.competencies ?? {}) };
		delete next[key];
		write(next);
	}

	function reweight(key: string, raw: string) {
		const value = Number(raw);
		if (Number.isNaN(value)) return;
		write({ ...(block.learning?.competencies ?? {}), [key]: value });
	}
</script>

<section class="competencies">
	<header>
		<span class="title">Výstupy RVP</span>
		{#if entries.length > 0}
			<Chip tone={total > 100 ? 'warning' : 'neutral'} title="Součet vah">{total} %</Chip>
		{/if}
	</header>

	{#if entries.length > 0}
		<ul>
			{#each entries as [key, value] (key)}
				<li>
					<code>{key}</code>
					<input
						type="number"
						min="0"
						max="100"
						step="5"
						aria-label={`Váha výstupu ${key}`}
						value={value}
						onchange={(e) => reweight(key, e.currentTarget.value)}
					/>
					<span class="unit">%</span>
					<button type="button" aria-label={`Odebrat ${key}`} onclick={() => remove(key)}>×</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="add">
		<input
			type="text"
			placeholder="M-5-1-02"
			aria-label="Kód výstupu RVP"
			bind:value={code}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					add();
				}
			}}
		/>
		<input type="number" min="0" max="100" step="5" aria-label="Váha výstupu" bind:value={weight} />
		<span class="unit">%</span>
		<Button variant="secondary" size="s" onclick={add}>Přidat</Button>
	</div>
</section>

<style>
	.competencies {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.title {
		color: var(--e-text-muted);
		font: var(--type-meta);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li,
	.add {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	code {
		min-width: 110px;
		font-family: var(--font-code);
		font-size: var(--text-s);
		color: var(--e-text);
	}

	input[type='text'] {
		width: 140px;
	}

	input[type='number'] {
		width: 68px;
	}

	input {
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-code);
		font-size: var(--text-s);
	}

	.unit {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	li button {
		border: none;
		background: none;
		color: var(--e-text-faint);
		font-size: var(--text-l);
		line-height: 1;
		cursor: pointer;
	}

	li button:hover {
		color: var(--e-error);
	}


</style>
