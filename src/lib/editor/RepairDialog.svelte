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
	import { deleteBlock, deleteStep, planDeleteBlock, planDeleteStep, type Repair } from '$lib/domain/commands';

	interface Props {
		doc: CourseV2;
		target: { blockId: string; stepId?: string };
		onclose: () => void;
	}
	let { doc, target, onclose }: Props = $props();

	const store = useStore();
	const references = $derived(
		target.stepId === undefined
			? planDeleteBlock(doc, target.blockId)
			: planDeleteStep(doc, target.blockId, target.stepId)
	);

	// Default: clear the pointer. The author can redirect instead.
	let choices = $state<Record<string, string>>({});
	const keyOf = (reference: Reference) => JSON.stringify(reference.from);

	const targets = $derived([
		{ value: '', label: 'Zrušit odkaz' },
		...(target.stepId !== undefined
			? [
					{ value: 'AGAIN', label: 'Místo toho: zkusit znovu' },
					{ value: 'END', label: 'Místo toho: ukončit blok' },
					...(doc.blocks
						.find((b) => b.block_id === target.blockId)
						?.steps.filter((s) => s.id !== target.stepId)
						.map((s) => ({ value: s.id, label: `Přesměrovat na krok ${s.id}` })) ?? [])
				]
			: doc.blocks
					.filter((b) => b.block_id !== target.blockId)
					.map((b) => ({ value: b.block_id, label: `Přesměrovat na blok ${b.block_id}` })))
	]);

	const describe = (reference: Reference): string => {
		switch (reference.kind) {
			case 'binding':
				return `Lekce „${reference.from.lessonId}“ tuto kartu obsahuje`;
			case 'go_to':
				return `Odpověď „${reference.from.optionId}“ v kroku „${reference.from.stepId}“ sem větví`;
			case 'prerequisite':
				return `Blok „${reference.from.blockId}“ ji má jako předpoklad`;
		}
	};

	function confirm() {
		const repairs: Repair[] = references.map((reference) => {
			const choice = choices[keyOf(reference)] ?? '';
			return choice === '' ? { reference, action: 'clear' } : { reference, action: 'redirect', to: choice };
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
			Než ji smažeš, je potřeba rozhodnout, kam povede {references.length === 1 ? 'odkaz' : 'těchto odkazů'},
			které na ni míří. Jinak by žák uvízl na místě, které už neexistuje.
		</p>
		<ul>
			{#each references as reference (keyOf(reference))}
				<li>
					<span class="what">{describe(reference)}</span>
					<select
						aria-label={describe(reference)}
						value={choices[keyOf(reference)] ?? ''}
						onchange={(e) => (choices = { ...choices, [keyOf(reference)]: e.currentTarget.value })}
					>
						{#each targets as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet actions()}
	<Button variant="ghost" onclick={onclose}>Zpět</Button>
	<Button variant="danger-solid" onclick={confirm}>Smazat a opravit odkazy</Button>
{/snippet}

<Modal
	title={target.stepId === undefined
		? `Smazat kartu „${target.blockId}“`
		: `Smazat krok „${target.stepId}“`}
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

	select {
		padding: 5px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font-family: var(--font-body);
		font-size: var(--text-s);
	}

</style>
