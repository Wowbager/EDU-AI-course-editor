<script lang="ts">
	/**
	 * `learning.prerequisites` — readiness gates (§6.4).
	 *
	 * A rule names either a block or a skill code, plus the mastery level required.
	 * The block picker offers real blocks so a rule cannot point at nothing, and the
	 * skill picker offers the course's own dimension codes for the same reason.
	 *
	 * The app does not enforce these yet. The label says so rather than promising an
	 * effect the student will never experience.
	 */
	import type { BlockV2, CourseV2, PrerequisiteRule } from '$lib/domain/schema';
	import { useStore } from '$lib/ui/context';
	import Button from '$lib/ui/Button.svelte';
	import { setField } from '$lib/domain/commands';

	interface Props {
		doc: CourseV2;
		block: BlockV2;
	}
	let { doc, block }: Props = $props();

	const store = useStore();
	const rules = $derived(block.learning?.prerequisites ?? []);
	const others = $derived(doc.blocks.filter((b) => b.block_id !== block.block_id));
	const dimensions = $derived(store.skillConfig?.vector?.dimensions ?? []);

	function write(next: PrerequisiteRule[]) {
		store.apply((d) =>
			setField(
				d,
				{ blockId: block.block_id, field: 'learning.prerequisites' },
				next.length === 0 ? undefined : next
			)
		);
	}

	const add = () => write([...rules, { min_level: 0.5 }]);
	const remove = (index: number) => write(rules.filter((_, i) => i !== index));

	function update(index: number, patch: Partial<PrerequisiteRule>) {
		write(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
	}

	/** A rule names a block or a skill, never both — picking one clears the other. */
	function pickBlock(index: number, blockId: string) {
		update(index, blockId === '' ? { block_id: undefined } : { block_id: blockId, skill: undefined });
	}
	function pickSkill(index: number, skill: string) {
		update(index, skill === '' ? { skill: undefined } : { skill, block_id: undefined });
	}
</script>

<section class="prerequisites">
	<header>
		<span class="title">Předpoklady</span>
		<span class="note">Aplikace je zatím nevynucuje — slouží jako dokumentace návaznosti.</span>
	</header>

	{#each rules as rule, index (index)}
		<div class="rule">
			<select
				aria-label="Karta, kterou musí žák zvládat"
				value={rule.block_id ?? ''}
				onchange={(e) => pickBlock(index, e.currentTarget.value)}
			>
				<option value="">— karta —</option>
				{#each others as other, i (i)}
					<option value={other.block_id}>{other.block_id}</option>
				{/each}
			</select>

			<select
				aria-label="Dovednost, kterou musí žák zvládat"
				value={rule.skill ?? ''}
				onchange={(e) => pickSkill(index, e.currentTarget.value)}
			>
				<option value="">— dovednost —</option>
				{#each dimensions as dimension (dimension.dimension_index)}
					<option value={dimension.code}>{dimension.code} — {dimension.name}</option>
				{/each}
			</select>

			<label>
				aspoň
				<input
					type="number"
					min="0"
					max="1"
					step="0.1"
					aria-label="Požadovaná úroveň zvládnutí"
					value={rule.min_level}
					onchange={(e) => update(index, { min_level: Number(e.currentTarget.value) })}
				/>
			</label>

			<button type="button" aria-label="Odebrat předpoklad" onclick={() => remove(index)}>×</button>
		</div>
	{/each}

	<Button variant="secondary" size="s" onclick={add}>+ Přidat předpoklad</Button>
</section>

<style>
	.prerequisites {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
	}

	.title {
		color: var(--e-text-muted);
		font: var(--type-meta);
	}

	.note {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.rule {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	select {
		max-width: 220px;
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font-size: var(--text-s);
		color: var(--e-text);
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	input {
		width: 64px;
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-code);
		font-size: var(--text-s);
	}

	.rule button {
		border: none;
		background: none;
		color: var(--e-text-faint);
		font-size: var(--text-l);
		line-height: 1;
		cursor: pointer;
	}

	.rule button:hover {
		color: var(--e-error);
	}


</style>
