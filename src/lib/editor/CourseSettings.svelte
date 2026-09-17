<script lang="ts">
	/**
	 * Course-level settings (§3).
	 *
	 * Which settings exist here is decided by the mode, from `$lib/ui/fields.ts` —
	 * this panel renders that table rather than keeping a second opinion about it.
	 * The two exceptions are the course type and its status: both are consequential
	 * enough to earn a segmented control and a written consequence per option.
	 */
	import type { CourseV2, ExportType, Status } from '$lib/domain/schema';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import { useStore } from '$lib/ui/context';
	import { fieldsFor } from '$lib/ui/fields';
	import { setField } from '$lib/domain/commands';

	interface Props {
		doc: CourseV2;
		onclose: () => void;
	}
	let { doc, onclose }: Props = $props();

	const store = useStore();
	const set = (field: string, value: unknown) => store.apply((d) => setField(d, { field }, value));
	const read = (path: string): unknown => (doc as Record<string, unknown>)[path];

	const fields = $derived(fieldsFor('course', store.mode));
	const basics = $derived(fields.filter((f) => f.mode === 'teacher'));
	const didactic = $derived(fields.filter((f) => f.mode === 'metodik'));
	const rest = $derived(fields.filter((f) => f.mode === 'advanced'));

	const STATUSES: { value: Status; label: string }[] = [
		{ value: 'draft', label: 'Rozpracovaný' },
		{ value: 'private', label: 'Jen na PIN' },
		{ value: 'locked', label: 'Zamčený' },
		{ value: 'approved', label: 'Schválený' },
		{ value: 'published', label: 'Publikovaný' }
	];

	const EXPORT_TYPES: { value: ExportType; label: string; title: string }[] = [
		{ value: 'course_v2', label: 'Kurz', title: 'Plný zážitek: nápovědy, řešení, větvení, XP' },
		{ value: 'exercise_v2', label: 'Cvičení', title: 'Lineární drilování — větvení se ignoruje' },
		{ value: 'quiz_v2', label: 'Test', title: 'Bez nápověd, řešení i zpětné vazby' }
	];
</script>

{#snippet body()}
	<div class="grid">
		<div class="row">
			<span>Typ kurzu</span>
			<Segmented
				label="Typ kurzu"
				options={EXPORT_TYPES}
				value={doc.export_type}
				onchange={(v) => set('export_type', v)}
			/>
		</div>

		<div class="row">
			<span>Stav</span>
			<Segmented
				label="Stav kurzu"
				options={STATUSES}
				value={doc.status ?? 'draft'}
				onchange={(v) => set('status', v)}
			/>
		</div>

		<FieldGroup fields={basics} {read} write={set} />

		{#if didactic.length > 0}
			<h3>Didaktika</h3>
			<FieldGroup fields={didactic} {read} write={set} />
		{/if}

		{#if rest.length > 0}
			<h3>Technické</h3>
			<div class="row">
				<span>Identifikátor</span>
				<code class="id">{doc.course_id}</code>
			</div>
			<FieldGroup fields={rest} {read} write={set} />
		{/if}
	</div>
{/snippet}

<Modal title="Nastavení kurzu" size="l" {onclose} children={body} />

<style>
	h3 {
		margin: 8px 0 0;
		color: var(--e-text-muted);
		font-family: var(--font-heading);
		font-size: var(--text-s);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px 24px;
	}

	.row {
		display: grid;
		grid-template-columns: 150px 1fr;
		gap: 12px;
		align-items: start;
		font-size: var(--text-m);
	}

	.row > span:first-child {
		padding-top: 6px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}




	code {
		padding-top: 6px;
		font-family: var(--font-code);
		font-size: var(--text-s);
		color: var(--e-text-faint);
	}
</style>
