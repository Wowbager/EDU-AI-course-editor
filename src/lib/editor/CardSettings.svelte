<script lang="ts">
	/**
	 * Everything about a card that the student does not read.
	 *
	 * The split is deliberate and it is the whole reason this file exists. A card's
	 * *content* — its steps, with their own hint and help — stays in the editor
	 * column, always visible, because that is what the author came to write. Its
	 * *configuration* — how long it takes, whether it joins daily practice, what it
	 * trains, the machinery underneath — lives here, one click away. So does the
	 * card-wide hint and help: the app only falls back to them when a step has none,
	 * and at the bottom of the column they read as a stray extra step.
	 *
	 * Which settings exist is still decided by the mode, from `$lib/ui/fields.ts`, so
	 * this panel renders that table rather than keeping a second opinion about it.
	 */
	import type { BlockV2, CourseV2, LessonBlockBinding } from '$lib/domain/schema';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import TopicPicker from './TopicPicker.svelte';
	import CompetencyEditor from './CompetencyEditor.svelte';
	import PrerequisiteEditor from './PrerequisiteEditor.svelte';
	import VectorEditor from './VectorEditor.svelte';
	import { useStore } from '$lib/ui/context';
	import { allows, fieldsFor } from '$lib/ui/fields';
	import { setField } from '$lib/domain/commands';

	interface Props {
		doc: CourseV2;
		block: BlockV2;
		/** Absent for a card that is in no lesson — it then has no binding to edit. */
		binding?: LessonBlockBinding;
		lessonId?: string;
		onclose: () => void;
	}
	let { doc, block, binding, lessonId, onclose }: Props = $props();

	const store = useStore();
	const mode = $derived(store.mode);

	/** The card-wide help ladder, drawn as its own section. */
	const LADDER = ['hint', 'help'];

	const didactics = $derived(allows('block', 'default_practice', mode));
	const machinery = $derived(allows('block', 'xp', mode));
	const allBlockFields = $derived(fieldsFor('block', mode));
	const ladderFields = $derived(allBlockFields.filter((f) => LADDER.includes(f.path)));
	const blockFields = $derived(allBlockFields.filter((f) => !LADDER.includes(f.path)));
	const teacherFields = $derived(blockFields.filter((f) => f.mode === 'teacher'));
	const metodikFields = $derived(blockFields.filter((f) => f.mode === 'metodik'));
	const advancedFields = $derived(blockFields.filter((f) => f.mode === 'advanced'));
	const bindingFields = $derived(binding === undefined ? [] : fieldsFor('binding', mode));

	const set = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { blockId: block.block_id, field }, value));
	const setBinding = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { lessonId, blockId: block.block_id, field }, value));

	function read(path: string): unknown {
		return path.split('.').reduce<unknown>(
			(node, key) =>
				node === undefined || node === null ? undefined : (node as Record<string, unknown>)[key],
			block as unknown
		);
	}
	const readBinding = (path: string): unknown => (binding as Record<string, unknown> | undefined)?.[path];
</script>

{#snippet body()}
	<div class="section">
		<FieldGroup fields={teacherFields} {read} write={set} />
	</div>

	<div class="section">
		<h3>Nápověda pro celou kartu</h3>
		<p class="note">Použije se u kroků, které nemají nápovědu vlastní.</p>
		<FieldGroup fields={ladderFields} {read} write={set} />
	</div>

	{#if didactics}
		<div class="section">
			<h3>Didaktika</h3>
			<FieldGroup fields={metodikFields} {read} write={set} />
			<TopicPicker {block} />
			<CompetencyEditor {block} />
			{#if bindingFields.length > 0}
				<FieldGroup fields={bindingFields} read={readBinding} write={setBinding} />
			{/if}
		</div>
	{/if}

	{#if machinery}
		<div class="section">
			<h3>Technické</h3>
			<div class="row">
				<span class="label">Identifikátor</span>
				<code>{block.block_id}</code>
			</div>
			<FieldGroup fields={advancedFields} {read} write={set} />
			<PrerequisiteEditor {doc} {block} />
			<VectorEditor {block} />
		</div>
	{/if}
{/snippet}

{#snippet actions()}
	<Button variant="secondary" onclick={onclose}>Hotovo</Button>
{/snippet}

<Modal title="Nastavení karty" size="l" {onclose} children={body} footer={actions} />

<style>
	.section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.section + .section {
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px dashed var(--e-border);
	}

	h3 {
		margin: 0;
		color: var(--e-text-muted);
		font-family: var(--font-heading);
		font-size: var(--text-s);
	}

	.note {
		margin: -6px 0 0;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.row {
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 12px;
		align-items: start;
	}

	.label {
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	code {
		font-family: var(--font-code);
		font-size: var(--text-s);
		color: var(--e-text-faint);
	}
</style>
