<script lang="ts">
	/**
	 * Delete-safety, made visible (§3 invariant 3). Before a block or step goes away,
	 * every pointer at it is listed and has to be given a destination — redirect it, or
	 * remove it. Nothing is deleted while a pointer is still dangling.
	 */
	import type { CourseV2 } from '$lib/domain/schema';
	import type { Reference } from '$lib/domain/index-doc';
	import { useStore } from '$lib/ui/context';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import ChoicePicker from '$lib/ui/ChoicePicker.svelte';
	import type { PickerGroup } from '$lib/ui/choice-picker';
	import { cardGroups, cardNames } from '$lib/domain/naming';
	import { ChevronDown } from '@lucide/svelte';
	import {
		deleteBlock,
		deleteStep,
		planDeleteBlock,
		planDeleteStep,
		type Repair
	} from '$lib/domain/commands';
	import { allows } from '$lib/ui/fields';
	import {
		cardLabel,
		capitalize,
		lessonLabelById,
		optionLabelById,
		stepLabelById,
		stepPosition
	} from '$lib/domain/naming';

	interface Props {
		doc: CourseV2;
		target: { blockId: string; stepId?: string };
		onclose: () => void;
	}
	let { doc, target, onclose }: Props = $props();

	const store = useStore();
	/**
	 * This dialog is the last screen before a card is destroyed, so it is the last
	 * place that may speak a language the author does not. It used to print raw ids
	 * throughout — „Smazat kartu ‚L1_B2_casti‘“, „Lekce ‚L1_INTRO‘“, „Přesměrovat na
	 * krok s3“ — which is the one thing plan §8 says never to do, and it did it while
	 * asking for an irreversible decision. Every name here now comes from `naming.ts`,
	 * the same rule the tree, the heading and the validation panel use, and the ids
	 * come back only in the mode that is allowed to see them.
	 */
	const showIds = $derived(allows('block', 'block_id', store.mode));
	const targetBlock = $derived(doc.blocks.find((b) => b.block_id === target.blockId));
	const targetStep = $derived(
		target.stepId === undefined ? undefined : targetBlock?.steps.find((s) => s.id === target.stepId)
	);
	const targetName = $derived(
		targetBlock === undefined ? target.blockId : cardLabel(doc, targetBlock, { max: 46 })
	);
	const references = $derived(
		target.stepId === undefined
			? planDeleteBlock(doc, target.blockId)
			: planDeleteStep(doc, target.blockId, target.stepId)
	);

	// Default: clear the pointer. The author can redirect instead.
	let choices = $state<Record<string, string>>({});
	const keyOf = (reference: Reference) => JSON.stringify(reference.from);

	/** A step's choices are few and stay a plain list; a card's are many, and go to the picker. */
	const stepTargets = $derived([
		{ value: '', label: 'Zrušit odkaz' },
		{ value: 'AGAIN', label: 'Místo toho: zkusit znovu' },
		{ value: 'END', label: 'Místo toho: ukončit kartu' },
		...(targetBlock?.steps
			.filter((s) => s.id !== target.stepId)
			.map((s) => ({
				value: s.id,
				label: `Přesměrovat na krok ${stepPosition(targetBlock, s)}${showIds ? ` (${s.id})` : ''}`
			})) ?? [])
	]);

	const names = $derived(cardNames(doc, 46));
	const cardGroupsList = $derived(cardGroups(doc, { exclude: target.blockId, max: 46 }));
	/** The reference whose „Kam“ the picker is open for. */
	let asking = $state('');
	let picker = $state<ReturnType<typeof ChoicePicker> | null>(null);

	const pickerGroups = $derived.by((): PickerGroup[] => [
		{
			items: [{ id: '', name: 'Zrušit odkaz', current: (choices[asking] ?? '') === '' }]
		},
		...cardGroupsList.map((group) => ({
			heading: group.title,
			items: group.cards.map((card) => ({
				id: card.id,
				name: card.name,
				detail: card.collides ? card.place : undefined,
				hint: showIds ? card.id : undefined,
				current: choices[asking] === card.id
			}))
		}))
	]);

	function chosenLabel(key: string): string {
		const id = choices[key] ?? '';
		if (id === '') return 'Zrušit odkaz';
		const card = names.get(id);
		return `Přesměrovat na kartu „${card?.label ?? id}“`;
	}

	const describe = (reference: Reference): string => {
		const { lessonId, blockId, stepId, optionId } = reference.from;
		switch (reference.kind) {
			case 'binding': {
				const lesson = lessonId === undefined ? undefined : lessonLabelById(doc, lessonId);
				return `Lekce „${lesson ?? lessonId}“ tuto kartu obsahuje`;
			}
			case 'go_to': {
				// The branch lives in some *other* card's step, not in the one being
				// deleted, so both ends have to be resolved against the document.
				const from =
					blockId === undefined ? undefined : doc.blocks.find((b) => b.block_id === blockId);
				const step =
					from === undefined || stepId === undefined
						? undefined
						: from.steps.find((s) => s.id === stepId);
				const option =
					step === undefined || optionId === undefined
						? undefined
						: optionLabelById(step.question, optionId, { max: 32 });
				const where = from === undefined ? '' : ` v kartě „${cardLabel(doc, from, { max: 32 })}“`;
				const which = step === undefined ? '' : `, ${stepLabelById(from!, step.id)}`;
				return `${capitalize(option ?? `odpověď „${optionId}“`)}${where}${which} sem větví`;
			}
			case 'prerequisite': {
				const name = blockId === undefined ? undefined : cardLabel(doc, blockId, { max: 46 });
				return `Karta „${name}“ ji má jako předpoklad`;
			}
		}
	};

	function confirm() {
		const repairs: Repair[] = references.map((reference) => {
			const choice = choices[keyOf(reference)] ?? '';
			return choice === ''
				? { reference, action: 'clear' }
				: { reference, action: 'redirect', to: choice };
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
	{#if references.length === 0}
		<p>Na tuto část nic neodkazuje — smazání je bezpečné.</p>
	{:else}
		<p class="lead">
			Než ji smažeš, je potřeba rozhodnout, kam povede {references.length === 1
				? 'odkaz'
				: 'těchto odkazů'}, které na ni míří. Jinak by žák uvízl na místě, které už neexistuje.
		</p>
		<ul>
			{#each references as reference (keyOf(reference))}
				<li>
					<span class="what">{describe(reference)}</span>
					{#if target.stepId !== undefined}
						<select
							aria-label={describe(reference)}
							value={choices[keyOf(reference)] ?? ''}
							onchange={(e) =>
								(choices = { ...choices, [keyOf(reference)]: e.currentTarget.value })}
						>
							{#each stepTargets as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					{:else}
						<button
							type="button"
							class="choose"
							aria-haspopup="dialog"
							aria-label={describe(reference)}
							onclick={(e) => {
								asking = keyOf(reference);
								picker?.show(e.currentTarget);
							}}
						>
							<span class="shown">{chosenLabel(keyOf(reference))}</span>
							<ChevronDown size={14} aria-hidden="true"></ChevronDown>
						</button>
					{/if}
				</li>
			{/each}
		</ul>
		{#if target.stepId === undefined}
			<ChoicePicker
				label="Kam odkaz povede"
				root={{ title: 'Kam odkaz povede', groups: pickerGroups }}
				onpick={(path) => (choices = { ...choices, [asking]: path[0] })}
				bind:this={picker}
			/>
		{/if}
	{/if}
{/snippet}

{#snippet actions()}
	<Button variant="ghost" onclick={onclose}>Zpět</Button>
	<Button variant="danger-solid" onclick={confirm}>Smazat a opravit odkazy</Button>
{/snippet}

<Modal
	title={target.stepId === undefined
		? `Smazat kartu „${targetName}“`
		: `Smazat krok ${targetBlock !== undefined && targetStep !== undefined ? stepPosition(targetBlock, targetStep) : ''} v kartě „${targetName}“`}
	{onclose}
	children={body}
	footer={actions}
/>

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
