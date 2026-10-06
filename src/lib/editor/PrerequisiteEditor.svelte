<script lang="ts">
	/**
	 * `learning.prerequisites` — readiness gates (§6.4).
	 *
	 * A rule names either a card or a skill level, plus the mastery required (stored
	 * 0–1, shown as a percentage). Each rule is one sentence — „Nejdřív karta „Kolik
	 * je?“ (Lekce 2) · aspoň 50 %“ — with no selects in it. The sentence is a button:
	 * it reopens the picker on the current choice, so the card or skill can be changed
	 * in place and the percentage stays. „Přidat předpoklad“ asks „Na co karta čeká?“
	 * and offers another card (grouped by lesson) or a skill (area → skill → level, as
	 * „Přidat dovednost“ does); only then is a rule created, so there is none pointing
	 * at nothing.
	 *
	 * A card that already waits for this one, directly or through others, would make a
	 * cycle (Kontrola kurzu's „na sebe čekají navzájem“), so it is listed but cannot be
	 * picked. A card already used by another rule of this card is listed the same way.
	 *
	 * The sentences, the picker's list and its disabled reasons are the model's
	 * (`screen/prerequisites.ts`); which rule is being changed and what was refused are
	 * `store.ui.prerequisite`. The app does not enforce these yet. The note says so
	 * rather than promising an effect the student will never experience.
	 */
	import { withUndoNotice } from './undo-notice';
	import type { BlockV2, PrerequisiteRule } from '$lib/domain/schema';
	import type { PrerequisitesView } from '$lib/screen/types';
	import { useStore } from '$lib/ui/context';
	import Button from '$lib/ui/Button.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import ChoicePicker from '$lib/ui/ChoicePicker.svelte';
	import { setField } from '$lib/domain/commands';
	import { Plus, Trash2 } from '@lucide/svelte';

	interface Props {
		block: BlockV2;
		view: PrerequisitesView;
		/** Where `view` is in the model, for `data-screen`. */
		screen: string;
	}
	let { block, view, screen }: Props = $props();

	const store = useStore();
	const rules = $derived(block.learning?.prerequisites ?? []);
	/** A new rule asks for this much of the skill or card. */
	const DEFAULT_LEVEL = 0.5;

	function write(next: PrerequisiteRule[]) {
		store.apply((d) =>
			setField(
				d,
				{ blockId: block.block_id, field: 'learning.prerequisites' },
				next.length === 0 ? undefined : next
			)
		);
	}

	const remove = (index: number) =>
		withUndoNotice(store, 'Předpoklad odebrán.', () => write(rules.filter((_, i) => i !== index)), {
			lessonId: store.open.lesson?.lesson_id,
			blockId: block.block_id
		});

	/** The level is required by the format: emptying the field keeps the old one. */
	function setLevel(index: number, percent: number | undefined) {
		if (percent === undefined) {
			store.ui.prerequisite.problem =
				'Doplň, kolik procent musí žák zvládat. Zůstala původní hodnota.';
			return;
		}
		store.ui.prerequisite.problem = '';
		write(rules.map((rule, i) => (i === index ? { ...rule, min_level: percent / 100 } : rule)));
	}

	// The picker: one box, opened from „Přidat předpoklad“ (a new rule) or from a rule's
	// line (`editing` is its index, and its choice is marked).
	let picker = $state<ReturnType<typeof ChoicePicker> | null>(null);

	function openFor(anchor: HTMLElement, index: number | null) {
		store.ui.prerequisite.editing = index;
		picker?.show(anchor, index === null ? [] : (view.rules[index]?.path ?? []));
	}

	function picked(path: string[]) {
		const editing = store.ui.prerequisite.editing;
		const [kind, ...rest] = path;
		const choice: Partial<PrerequisiteRule> =
			kind === 'card'
				? { block_id: rest[rest.length - 1], skill: undefined }
				: { skill: rest[rest.length - 1], block_id: undefined };
		if (editing === null) write([...rules, { min_level: DEFAULT_LEVEL, ...choice }]);
		else {
			// A rule names a card or a skill, never both; the percentage stays.
			write(rules.map((rule, i) => (i === editing ? { ...rule, ...choice } : rule)));
		}
		store.ui.prerequisite.editing = null;
	}
</script>

<section class="prerequisites">
	<header>
		<span class="title">Předpoklady</span>
		<span class="note">Aplikace je zatím nevynucuje — slouží jako dokumentace návaznosti.</span>
	</header>

	{#each view.rules as rule, index (index)}
		<div class="rule">
			<button
				type="button"
				class="what"
				aria-haspopup="dialog"
				title="Změnit, na co karta čeká"
				onclick={(e) => openFor(e.currentTarget, index)}
			>
				<span data-screen="{screen}.rules[{index}].text">{rule.text}</span>{#if rule.where}<span
						class="where"
						>(<span data-screen="{screen}.rules[{index}].where">{rule.where}</span>)</span
					>{/if}{#if rule.code}<span class="code" data-screen="{screen}.rules[{index}].code"
						>{rule.code}</span
					>{/if}
			</button>
			<span class="sep" aria-hidden="true">·</span>
			<label>
				aspoň
				<span class="level"
					><NumberField
						label={rule.min_level.label}
						value={rule.min_level.value}
						ref={rule.min_level.ref}
						bounds={rule.min_level}
						screen="{screen}.rules[{index}].min_level.value"
						onwrite={(v) => setLevel(index, v)}
					/></span
				>
				%
			</label>

			<button
				type="button"
				class="remove"
				title="Odebrat předpoklad"
				aria-label="Odebrat předpoklad"
				onclick={() => remove(index)}
			>
				<Trash2 size={15} aria-hidden="true"></Trash2>
			</button>
		</div>
	{/each}

	{#if view.problem !== ''}
		<p class="problem" role="alert" data-screen="{screen}.problem">{view.problem}</p>
	{/if}

	<Button
		class="add-trigger"
		variant="secondary"
		size="s"
		aria-haspopup="dialog"
		onclick={(e) => openFor(e.currentTarget as HTMLElement, null)}
	>
		<Plus size={14} aria-hidden="true"></Plus>
		Přidat předpoklad
	</Button>

	<ChoicePicker id="prerequisite" onpick={picked} bind:this={picker} />
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
		gap: 4px 6px;
	}

	/* The sentence is the control: quiet until pointed at, like a row of the answer table. */
	.what {
		padding: 3px 6px;
		border: 1px solid transparent;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text);
		font-family: var(--font-body);
		font-size: var(--text-s);
		text-align: left;
		cursor: pointer;
	}

	.what:hover,
	.what:focus-visible {
		border-color: var(--e-border-strong);
		background: var(--surface);
	}

	.where {
		margin-left: 6px;
		color: var(--e-text-muted);
	}

	.code {
		margin-left: 6px;
		color: var(--e-text-faint);
		font-family: var(--font-code);
		font-size: var(--text-xs);
	}

	.sep {
		color: var(--e-text-faint);
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--e-text);
		font-size: var(--text-s);
	}

	.level {
		display: inline-block;
		width: 76px;
		font-size: var(--text-s);
	}

	.problem {
		margin: 0;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	/* Always visible, only quiet. */
	.remove {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		cursor: pointer;
	}

	.remove:hover,
	.remove:focus-visible {
		color: var(--e-error);
	}
</style>
