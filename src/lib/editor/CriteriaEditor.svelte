<script lang="ts">
	/**
	 * `question.ai_criteria_list` — the rubric the app sends to the AI with an open
	 * answer (`QuestionCriterion`, BR-P745Q8): a name, an optional description and a
	 * whole-number weight per line. The app keeps the first four named lines
	 * (`listFromJson`), so the list stops at four. A line the editor adds gets an id,
	 * because the AI's scores come back keyed by it; the teacher never sees it.
	 *
	 * The weight's scale is not defined in the app or the API this editor can read, so
	 * the field says only that it is relative.
	 *
	 * The list's warnings (a criterion with no name, more than four) are drawn once,
	 * under the rows; leaving a name field is leaving the list.
	 */
	import type { AiCriterion } from '$lib/domain/schema';
	import type { Ref } from '$lib/domain/ref';
	import { useStore } from '$lib/ui/context';
	import { AI_CRITERIA_MAX } from '$lib/domain/question-settings';
	import { uniqueKeys } from '$lib/ui/keys';
	import FocusField from '$lib/ui/FocusField.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { Plus, Trash } from '@lucide/svelte';
	import { countOf, focusAdded, focusAfterDelete } from '$lib/ui/focus-after';

	interface Props {
		criteria: AiCriterion[] | undefined;
		hint: string | undefined;
		/** Where the list's warnings point: the step's `question.ai_criteria_list`. */
		ref: Ref;
		onchange: (next: AiCriterion[] | undefined) => void;
	}
	let { criteria, hint, ref, onchange }: Props = $props();

	const store = useStore();
	const warnings = $derived(store.issuesAt(ref).warnings);

	const rows = $derived(criteria ?? []);
	// An imported list may repeat an id or have none; the keys stay unique anyway.
	const keys = $derived(uniqueKeys(rows.map((row) => row.id ?? '')));
	const uid = $props.id();

	function freshId(): string {
		const taken = new Set(rows.map((c) => c.id));
		let n = rows.length + 1;
		while (taken.has(`k${n}`)) n++;
		return `k${n}`;
	}

	let section = $state<HTMLElement | null>(null);
	const ROWS = ':scope > .row';

	function add() {
		write([...rows, { id: freshId(), name: '' }]);
		void focusAdded(section, ROWS, -1);
	}

	function removeAt(index: number) {
		const before = countOf(section, ROWS);
		write(rows.filter((_, j) => j !== index));
		void focusAfterDelete(section, ROWS, index, before, () =>
			section?.querySelector<HTMLElement>(':scope > button')
		);
	}

	const write = (next: AiCriterion[]) => onchange(next.length === 0 ? undefined : next);

	function update(index: number, patch: Partial<AiCriterion>) {
		write(
			rows.map((row, i) => {
				if (i !== index) return row;
				const next: AiCriterion = { ...row, ...patch };
				for (const key of Object.keys(patch) as (keyof AiCriterion)[])
					if (next[key] === undefined) delete next[key];
				return next;
			})
		);
	}
</script>

<section class="criteria" bind:this={section} aria-labelledby={`${uid}-title`}>
	<div class="head">
		<span class="title" id={`${uid}-title`}>Kritéria hodnocení</span>
		{#if hint}<span class="hint">{hint}</span>{/if}
	</div>
	{#each rows as row, i (keys[i])}
		<div class="row" role="group" aria-label={`Kritérium ${i + 1}`}>
			<FocusField
				label={`Název kritéria ${i + 1}`}
				value={row.name}
				emptyText="např. Postup"
				onblur={() => store.touchField(ref)}
				onchange={(v) => update(i, { name: v ?? '' })}
			/>
			<FocusField
				label={`Popis kritéria ${i + 1}`}
				value={row.description}
				emptyText="co má AI posoudit"
				onchange={(v) => update(i, { description: v })}
			/>
			<div class="weight">
				<NumberField
					label={`Váha kritéria ${i + 1}`}
					value={row.weight}
					emptyText="váha"
					onchange={(v) => update(i, { weight: v === undefined ? undefined : Math.round(v) })}
				/>
			</div>
			<Button
				variant="ghost"
				size="s"
				ariaLabel={`Odebrat kritérium ${i + 1}`}
				title="Odebrat kritérium"
				onclick={() => removeAt(i)}
			>
				<Trash size={14} aria-hidden="true" />
			</Button>
		</div>
	{/each}
	{#each warnings as warning, i (i)}
		<p class="note">{warning.message}</p>
	{/each}
	{#if rows.length < AI_CRITERIA_MAX}
		<Button variant="secondary" size="s" onclick={add}>
			<Plus size={14} aria-hidden="true" /> Přidat kritérium
		</Button>
	{/if}
</section>

<style>
	.criteria {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.title {
		color: var(--e-text-muted);
		font: var(--type-meta);
	}

	.hint {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	/* As under a field (`FocusField`): a line that explains, not an alarm. */
	.note {
		margin: 0;
		padding-left: 8px;
		color: var(--e-warning-text);
		font-size: var(--text-xs);
		line-height: 1.45;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) 4.5rem auto;
		gap: 6px;
		align-items: center;
		width: 100%;
	}

	@container (max-width: 520px) {
		.row {
			grid-template-columns: minmax(0, 1fr) 4.5rem auto;
		}
		.row > :global(:nth-child(2)) {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}
</style>
