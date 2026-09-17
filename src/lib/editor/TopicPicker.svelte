<script lang="ts">
	/**
	 * What the card trains (§6.3) — the didactic front door, and the metodik's main
	 * control.
	 *
	 * A card can train **several** topics: `relation_vector` carries one value per
	 * subconstruct, and the spec expects "one or two `2`s and perhaps a couple of
	 * `1`s". The descriptive `gpf.subconstruct` is a single string, so it names the
	 * strongest topic and is rewritten from the set on every change — the two can no
	 * longer disagree, which the old single `<select>` allowed them to do.
	 *
	 * The list of dimensions comes from the course's skill configuration, never from
	 * a constant here (§3 invariant 6).
	 */
	import type { BlockV2 } from '$lib/domain/schema';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { blockTopics, setTopics, type BlockTopic } from '$lib/domain/commands';
	import {
		dimensionCount,
		dimensionsByDomain,
		ELO_BASELINE,
		ELO_MAX,
		ELO_MIN,
		type SkillDimension
	} from '$lib/domain/skill-config';

	interface Props {
		block: BlockV2;
	}
	let { block }: Props = $props();

	const store = useStore();
	const count = $derived(dimensionCount(store.skillConfig));
	const groups = $derived(dimensionsByDomain(store.skillConfig));
	const topics = $derived(blockTopics(block));
	const chosen = $derived(new Set(topics.map((t) => t.dimensionIndex)));

	let adding = $state(false);

	function dimensionAt(index: number): SkillDimension | undefined {
		return store.skillConfig?.vector?.dimensions?.find((d) => d.dimension_index === index);
	}

	/** The classification the strongest topic implies. */
	function naming(index: number) {
		const dimension = dimensionAt(index);
		if (dimension === undefined) return {};
		return {
			domain: dimension.domain_name,
			construct: dimension.construct_name,
			subconstruct: `${dimension.code} ${dimension.name}`
		};
	}

	function commit(next: BlockTopic[]) {
		if (count === null) return;
		store.apply((d) => setTopics(d, block.block_id, next, count, naming));
	}

	const add = (index: number) => {
		adding = false;
		if (chosen.has(index)) return;
		commit([...topics, { dimensionIndex: index, relation: 2, elo: ELO_BASELINE }]);
	};

	const remove = (index: number) => commit(topics.filter((t) => t.dimensionIndex !== index));

	const setRelation = (index: number, relation: 1 | 2) =>
		commit(topics.map((t) => (t.dimensionIndex === index ? { ...t, relation } : t)));

	const setElo = (index: number, elo: number) =>
		commit(
			topics.map((t) =>
				t.dimensionIndex === index
					? { ...t, elo: Math.min(ELO_MAX, Math.max(ELO_MIN, elo)) }
					: t
			)
		);

	const strongCount = $derived(topics.filter((t) => t.relation === 2).length);
</script>

<section class="topics">
	<header>
		<span class="title">Co karta procvičuje</span>
		{#if count === null}
			<Chip tone="warning">Nastavení dovedností se nenačetlo</Chip>
		{:else if topics.length === 0}
			<Chip tone="warning" title="Bez vazby na dovednost se profil žáka po této kartě nepohne">
				nenastaveno
			</Chip>
		{:else if strongCount > 3}
			<Chip tone="warning" title="Jeden výsledek se rozmělní do příliš mnoha dovedností">
				{strongCount} silných vazeb
			</Chip>
		{/if}
		{#if store.skillConfig?.is_default}
			<Chip
				tone="warning"
				title="Kurz nemá vlastní nastavení dovedností — použit výchozí seznam. Načti JSON kurzu z administrace, pokud používá jiný."
			>
				výchozí sada
			</Chip>
		{/if}
	</header>

	{#if count !== null}
		{#if topics.length > 0}
			<ul class="chosen">
				{#each topics as topic (topic.dimensionIndex)}
					{@const dimension = dimensionAt(topic.dimensionIndex)}
					<li class:strong={topic.relation === 2}>
						<span class="code">{dimension?.code ?? `#${topic.dimensionIndex}`}</span>
						<span class="name">{dimension?.name ?? 'neznámá dovednost'}</span>

						<div class="relation">
							<button
								type="button"
								class:selected={topic.relation === 2}
								title="Karta je hlavně o téhle dovednosti"
								onclick={() => setRelation(topic.dimensionIndex, 2)}
							>
								je o tom
							</button>
							<button
								type="button"
								class:selected={topic.relation === 1}
								title="Dovednost se v kartě objeví, ale jen mimochodem"
								onclick={() => setRelation(topic.dimensionIndex, 1)}
							>
								okrajově
							</button>
						</div>

						<label class="elo">
							obtížnost
							<input
								type="number"
								min={ELO_MIN}
								max={ELO_MAX}
								step="0.5"
								value={topic.elo}
								onchange={(e) => setElo(topic.dimensionIndex, Number(e.currentTarget.value))}
							/>
						</label>

						<button
							type="button"
							class="remove"
							title="Odebrat dovednost"
							aria-label={`Odebrat ${dimension?.code ?? 'dovednost'}`}
							onclick={() => remove(topic.dimensionIndex)}
						>
							×
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if adding}
			<!-- Picking from the list is the whole action; a confirm button would add a
			     step to something that happens once. -->
			<select
				aria-label="Přidat dovednost, kterou karta procvičuje"
				value=""
				onchange={(e) => add(Number(e.currentTarget.value))}
			>
				<option value="">— vyber dovednost —</option>
				{#each groups as group (group.domainCode)}
					<optgroup label={group.domainName}>
						{#each group.dimensions as dimension (dimension.dimension_index)}
							{#if !chosen.has(dimension.dimension_index)}
								<option value={dimension.dimension_index}>
									{dimension.code} — {dimension.name}
								</option>
							{/if}
						{/each}
					</optgroup>
				{/each}
			</select>
			<Button variant="ghost" size="s" onclick={() => (adding = false)}>Zrušit</Button>
		{:else}
			<Button variant="secondary" size="s" onclick={() => (adding = true)}>+ Přidat dovednost</Button>
		{/if}

		<p class="help">
			Drž to střídmě: většina karet má jednu dvě silné vazby. Karta, která tvrdí silnou vazbu
			k osmi dovednostem, rozmělní jednu odpověď žáka do osmi hodnocení. Obtížnost je na
			stupnici {ELO_MIN}–{ELO_MAX}; žák začíná na {ELO_BASELINE}.
		</p>
	{/if}
</section>

<style>
	.topics {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
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
		font: var(--type-meta);
	}

	.chosen {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chosen li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
	}

	.chosen li.strong {
		border-color: var(--primary);
		background: var(--info-bg);
	}

	.code {
		font-family: var(--font-code);
		font-size: var(--text-xs);
		color: var(--e-text-muted);
	}

	.name {
		flex: 1;
		min-width: 120px;
		font-size: var(--text-s);
		color: var(--e-text);
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

	.elo {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	input[type='number'] {
		width: 64px;
		padding: 2px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-code);
		font-size: var(--text-s);
	}

	.remove {
		border: none;
		background: none;
		color: var(--e-text-faint);
		font-size: var(--text-l);
		line-height: 1;
		cursor: pointer;
	}

	.remove:hover {
		color: var(--e-error);
	}

	select {
		min-width: 260px;
		max-width: 520px;
		padding: 5px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font: var(--type-meta);
		color: var(--e-text);
	}



	.help {
		margin: 2px 0 0;
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		line-height: 1.5;
	}
</style>
