<script lang="ts">
	/**
	 * Delete-safety, made visible (§3 invariant 3). Before a block or step goes away,
	 * every pointer at it is listed and has to be given a destination — redirect it, or
	 * remove it. Nothing is deleted while a pointer is still dangling.
	 *
	 * What it says (the title, one sentence per pointer, what each is going to do, the
	 * picker's list) is the model's (`store.screen.dialogs.repair`, `screen/repair.ts`);
	 * the destinations chosen so far are `store.ui.repairChoices`. This is the last
	 * screen before something is destroyed, so every name in it is the one `naming.ts`
	 * gives and ids come back only in the mode that is allowed to see them.
	 */
	import type { RepairView } from '$lib/screen/types';
	import { useStore } from '$lib/ui/context';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import ChoicePicker from '$lib/ui/ChoicePicker.svelte';
	import { ChevronDown } from '@lucide/svelte';
	import {
		deleteBlock,
		deleteStep,
		planDeleteBlock,
		planDeleteStep,
		type Repair
	} from '$lib/domain/commands';

	interface Props {
		view: RepairView;
		target: { blockId: string; stepId?: string };
		onclose: () => void;
	}
	let { view, target, onclose }: Props = $props();

	const store = useStore();
	const screen = 'dialogs.repair';
	const keyOf = (from: object) => JSON.stringify(from);
	const choose = (key: string, value: string) =>
		(store.ui.repairChoices = { ...store.ui.repairChoices, [key]: value });
	const pickers = $state<Record<string, ReturnType<typeof ChoicePicker> | null>>({});

	function confirm() {
		const references =
			target.stepId === undefined
				? planDeleteBlock(store.doc, target.blockId)
				: planDeleteStep(store.doc, target.blockId, target.stepId);
		const repairs: Repair[] = references.map((reference) => {
			const picked = store.ui.repairChoices[keyOf(reference.from)] ?? '';
			return picked === ''
				? { reference, action: 'clear' }
				: { reference, action: 'redirect', to: picked };
		});
		store.apply((d) =>
			target.stepId === undefined
				? deleteBlock(d, target.blockId, repairs)
				: deleteStep(d, target.blockId, target.stepId!, repairs)
		);
		onclose();
	}
</script>

{#snippet body()}
	{#if view.safe_text}
		<p data-screen="{screen}.safe_text">{view.safe_text}</p>
	{:else}
		<p class="lead" data-screen="{screen}.lead">{view.lead}</p>
		<ul>
			{#each view.rows as row, i (row.key)}
				<li>
					<span class="what" data-screen="{screen}.rows[{i}].what">{row.what}</span>
					{#if row.options}
						<select
							aria-label={row.what}
							value={row.choice}
							onchange={(e) => choose(row.key, e.currentTarget.value)}
						>
							{#each row.options as option, o (option.value)}
								<option value={option.value} data-screen="{screen}.rows[{i}].options[{o}].label"
									>{option.label}</option
								>
							{/each}
						</select>
					{:else if row.picker_id}
						<button
							type="button"
							class="choose"
							aria-haspopup="dialog"
							aria-label={row.what}
							onclick={(e) => pickers[row.key]?.show(e.currentTarget)}
						>
							<span class="shown" data-screen="{screen}.rows[{i}].chosen_label"
								>{row.chosen_label}</span
							>
							<ChevronDown size={14} aria-hidden="true"></ChevronDown>
						</button>
						<ChoicePicker
							id={row.picker_id}
							onpick={(path) => choose(row.key, path[0])}
							bind:this={pickers[row.key]}
						/>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet actions()}
	<Button variant="ghost" onclick={onclose}>Zpět</Button>
	<Button variant="danger-solid" onclick={confirm}>Smazat a opravit odkazy</Button>
{/snippet}

<Modal title={view.title} screen="{screen}.title" {onclose} children={body} footer={actions} />

<style>
	.lead {
		margin: 0 0 12px;
		color: var(--e-text-muted);
		font-size: var(--text-m);
		line-height: 1.5;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px;
		border-radius: var(--radius-s);
		background: var(--info-bg);
	}

	.what {
		color: var(--e-text);
		font-size: var(--text-s);
	}

	.choose {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 5px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text);
		font-family: var(--font-body);
		font-size: var(--text-s);
		text-align: left;
		cursor: pointer;
	}

	.shown {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	select {
		padding: 5px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font-family: var(--font-body);
		font-size: var(--text-s);
	}
</style>
