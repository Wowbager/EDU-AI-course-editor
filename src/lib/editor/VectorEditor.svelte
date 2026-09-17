<script lang="ts">
	/**
	 * The full per-dimension vector table (§6.3) — the advanced author's fine-tuning
	 * surface. The everyday control is `TopicPicker`, which adds and removes topics;
	 * this exists for the case where every dimension has to be inspected at once.
	 *
	 * Dimensions, their count and their labels come from the course's skill
	 * configuration — never from a constant in this file (§3 invariant 6). Until the
	 * configuration has loaded the editor says so rather than guessing a length.
	 */
	import type { BlockV2 } from '$lib/domain/schema';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { setField, setTopics, type BlockTopic } from '$lib/domain/commands';
	import {
		dimensionCount,
		dimensionsByDomain,
		ELO_BASELINE,
		type SkillDimension
	} from '$lib/domain/skill-config';

	interface Props {
		block: BlockV2;
	}
	let { block }: Props = $props();

	const store = useStore();
	const count = $derived(dimensionCount(store.skillConfig));
	const groups = $derived(dimensionsByDomain(store.skillConfig));
	const relation = $derived(block.gpf?.relation_vector);
	const elo = $derived(block.gpf?.elo_vector);

	const strong = $derived(
		(relation ?? [])
			.map((value, index) => ({ value, index }))
			.filter((d) => d.value === 2)
			.map((d) => codeFor(d.index))
	);
	const weak = $derived(
		(relation ?? [])
			.map((value, index) => ({ value, index }))
			.filter((d) => d.value === 1)
			.map((d) => codeFor(d.index))
	);

	/** The classification the strongest topic implies — kept in step with the vector. */
	function naming(index: number) {
		const dimension = store.skillConfig?.vector?.dimensions?.find(
			(d: SkillDimension) => d.dimension_index === index
		);
		if (dimension === undefined) return {};
		return {
			domain: dimension.domain_name,
			construct: dimension.construct_name,
			subconstruct: `${dimension.code} ${dimension.name}`
		};
	}

	function codeFor(index: number): string {
		const all = store.skillConfig?.vector?.dimensions ?? [];
		return all.find((d: SkillDimension) => d.dimension_index === index)?.code ?? `#${index}`;
	}

	function vectorOf(source: number[] | undefined, fill: number): number[] {
		const length = count ?? source?.length ?? 0;
		return Array.from({ length }, (_, i) => source?.[i] ?? fill);
	}

	function setRelation(index: number, value: number) {
		const next = vectorOf(relation, 0);
		next[index] = value;
		const topics = next
			.map((relationValue, i) => ({ dimensionIndex: i, relation: relationValue, elo: elo?.[i] ?? ELO_BASELINE }))
			.filter((t): t is BlockTopic => t.relation === 1 || t.relation === 2);
		// Routed through `setTopics` rather than written directly: it is the one place
		// that guarantees every live relation also carries a difficulty. Without one,
		// `EloEngine.updateTask` skips the dimension and the card measures nothing.
		if (count === null) return;
		store.apply((d) => setTopics(d, block.block_id, topics, count, naming));
	}

	function setElo(index: number, value: number) {
		const next = vectorOf(elo, ELO_BASELINE);
		next[index] = value;
		store.apply((d) => setField(d, { blockId: block.block_id, field: 'gpf.elo_vector' }, next));
	}

	let open = $state(false);
</script>

<section class="vectors">
	<header>
		<span class="title">Všechny dovednosti</span>
		{#if count === null}
			<Chip tone="warning">Nastavení dovedností kurzu se ještě nenačetlo</Chip>
		{:else if strong.length === 0 && weak.length === 0}
			<Chip tone="warning" title="Bez vazby na dovednost se profil žáka po této kartě nepohne">
				nenastaveno
			</Chip>
		{:else}
			{#if strong.length > 0}<Chip tone="ok">silně: {strong.join(', ')}</Chip>{/if}
			{#if weak.length > 0}<Chip tone="quiet">slabě: {weak.join(', ')}</Chip>{/if}
		{/if}
		<Button variant="secondary" size="s" onclick={() => (open = !open)} disabled={count === null}>
			{open ? 'Skrýt' : 'Upravit'}
		</Button>
	</header>

	{#if open && count !== null}
		<p class="help">
			Drž to střídmě: většina karet má jednu dvě silné vazby. Karta, která tvrdí silnou vazbu
			k osmi dovednostem, rozmělní jednu odpověď žáka do osmi hodnocení.
			Obtížnost je na stupnici 1–10; žák začíná na {ELO_BASELINE}.
		</p>

		{#each groups as group (group.domainCode)}
			<h4>{group.domainName}</h4>
			<table>
				<thead>
					<tr>
						<th scope="col">Dovednost</th>
						<th scope="col">Vazba</th>
						<th scope="col">Obtížnost</th>
					</tr>
				</thead>
				<tbody>
					{#each group.dimensions as dimension (dimension.dimension_index)}
						{@const i = dimension.dimension_index}
						{@const value = relation?.[i] ?? 0}
						<tr class:active={value > 0}>
							<th scope="row">
								<code>{dimension.code}</code>
								{dimension.name}
							</th>
							<td>
								<div class="relation">
									{#each [0, 1, 2] as level (level)}
										<button
											type="button"
											class:selected={value === level}
											onclick={() => setRelation(i, level)}
											title={['Netýká se', 'Okrajově', 'Je o tom'][level]}
										>
											{['—', 'okrajově', 'je o tom'][level]}
										</button>
									{/each}
								</div>
							</td>
							<td>
								{#if value > 0}
									<input
										type="number"
										min="1"
										max="10"
										step="0.5"
										aria-label={`Obtížnost v dovednosti ${dimension.code}`}
										value={elo?.[i] ?? ELO_BASELINE}
										onchange={(e) => setElo(i, Number(e.currentTarget.value))}
									/>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/each}
	{/if}
</section>

<style>
	.vectors {
		font-size: var(--text-m);
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.title {
		margin-right: 4px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.help {
		margin: 10px 0;
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		line-height: 1.5;
	}

	h4 {
		margin: 14px 0 4px;
		color: var(--e-text-muted);
		font-family: var(--font-heading);
		font-size: var(--text-s);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-s);
	}

	th[scope='col'] {
		padding: 2px 6px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		text-align: left;
	}

	th[scope='row'] {
		padding: 3px 6px;
		color: var(--e-text-muted);
		font-weight: var(--weight-regular);
		text-align: left;
	}

	tr.active th[scope='row'] {
		color: var(--e-text);
	}

	td {
		padding: 3px 6px;
	}

	code {
		font-family: var(--font-code);
		color: var(--e-text-faint);
	}

	.relation {
		display: inline-flex;
		gap: 2px;
	}

	.relation button {
		padding: 2px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--e-text-faint);
		font-family: var(--font-body);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.relation button.selected {
		border-color: transparent;
		background: var(--primary);
		color: var(--surface);
	}

	input[type='number'] {
		width: 68px;
		padding: 2px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-code);
		font-size: var(--text-s);
	}


</style>
