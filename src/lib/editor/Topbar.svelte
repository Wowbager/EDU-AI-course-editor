<script lang="ts">
	import type { CourseV2 } from '$lib/domain/schema';
	import Chip from '$lib/ui/Chip.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import FocusField from '$lib/ui/FocusField.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { setField } from '$lib/domain/commands';
	import { serialiseToJson } from '$lib/domain/document';
	import { MODES, MODE_LABELS } from '$lib/ui/fields';

	interface Props {
		doc: CourseV2;
		onvalidation: () => void;
		onimport: (file: File) => void;
	}
	let { doc, onvalidation, onimport }: Props = $props();

	const store = useStore();
	let fileInput = $state<HTMLInputElement | null>(null);

	function download() {
		const blob = new Blob([serialiseToJson(store.doc)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${doc.course_id || 'kurz'}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

<header class="topbar">
	<div class="title">
		<FocusField
			label="Název kurzu"
			value={doc.name}
			density="compact"
			emptyText="Název kurzu"
			onchange={(v) => store.apply((d) => setField(d, { field: 'name' }, v))}
		/>
	</div>

	<Chip tone="quiet" title="Verze, kterou dostane žák při aktualizaci">v{doc.version ?? 1}</Chip>
	{#if store.dirty}<Chip tone="warning">neuloženo</Chip>{/if}

	<div class="spacer"></div>

	<Chip tone="quiet" title="Celkový čas kurzu">{store.totals.durationMinutes} min</Chip>
	<Chip tone="quiet" title="Nejvyšší možný zisk XP za celý kurz">{store.totals.cappedXp} XP</Chip>

	<button type="button" class="chip-button" onclick={onvalidation}>
		{#if store.validation.errors.length > 0}
			<Chip tone="error">{store.validation.errors.length} chyb</Chip>
		{:else if store.validation.warnings.length > 0}
			<Chip tone="warning">{store.validation.warnings.length} upozornění</Chip>
		{:else}
			<Chip tone="ok">v pořádku</Chip>
		{/if}
	</button>

	<Segmented
		label="Režim editoru"
		value={store.mode}
		options={MODES.map((mode) => ({ value: mode, ...MODE_LABELS[mode] }))}
		onchange={(mode) => (store.mode = mode)}
	/>

	<!-- The glyph is the label a mouse reads; the accessible name has to be a word. -->
	<Button variant="ghost" onclick={() => store.undo()} disabled={!store.canUndo} title="Zpět" ariaLabel="Zpět">
		↶
	</Button>
	<Button variant="ghost" onclick={() => store.redo()} disabled={!store.canRedo} title="Vpřed" ariaLabel="Vpřed">
		↷
	</Button>

	<Button variant="ghost" onclick={() => fileInput?.click()}>Načíst</Button>
	<input
		bind:this={fileInput}
		type="file"
		accept="application/json,.json"
		hidden
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			if (file) onimport(file);
			e.currentTarget.value = '';
		}}
	/>

	<Button variant="primary" onclick={download} disabled={!store.canPublish}>Stáhnout JSON</Button>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--e-topbar-height);
		padding: 0 16px;
		border-bottom: 1px solid var(--e-border);
		background: var(--surface);
	}

	.title {
		min-width: 160px;
		max-width: 260px;
		overflow: hidden;
		font: var(--type-card-title-alt);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.spacer {
		flex: 1;
	}

	.chip-button {
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}

</style>
