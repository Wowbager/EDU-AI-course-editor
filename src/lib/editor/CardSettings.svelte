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
	 * Which settings exist is decided by the mode, from `$lib/ui/fields.ts`, and so is
	 * where each one sits: in sections named by what they do (`SECTIONS`), which
	 * `SettingsNav` lists down the left from Metodik up. The model
	 * (`store.screen.dialogs.card_settings`, `screen/settings.ts`) says both; this draws
	 * it and writes what the teacher does.
	 */
	import type { Snippet } from 'svelte';
	import type { CardSettingsView } from '$lib/screen/types';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Toggle from '$lib/ui/Toggle.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import SettingsNav from '$lib/ui/SettingsNav.svelte';
	import TopicPicker from './TopicPicker.svelte';
	import CompetencyEditor from './CompetencyEditor.svelte';
	import ConceptsEditor from './ConceptsEditor.svelte';
	import PrerequisiteEditor from './PrerequisiteEditor.svelte';
	import { useStore } from '$lib/ui/context';
	import { SettingsSearch, setSettingsSearch } from '$lib/ui/settings-search.svelte';
	import { setField, setPractice, setQuestionsTogether } from '$lib/domain/commands';
	import type { BlockV2 } from '$lib/domain/schema';

	interface Props {
		view: CardSettingsView;
		block: BlockV2;
		/** Absent for a card that is in no lesson — it then has no binding to edit. */
		lessonId?: string;
		onclose: () => void;
	}
	let { view, block, lessonId, onclose }: Props = $props();

	const store = useStore();
	const screen = 'dialogs.card_settings';

	const search = new SettingsSearch(
		() => (store.open.binding === undefined ? ['block'] : ['block', 'binding']),
		() => ({
			mode: store.mode,
			feedback: store.showFeedback
		})
	);
	setSettingsSearch(search);

	const set = (field: string, value: unknown) =>
		store.apply((d) =>
			field === 'default_practice'
				? setPractice(d, block.block_id, value === true)
				: setField(d, { blockId: block.block_id, field }, value)
		);
	const setBinding = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { lessonId, blockId: block.block_id, field }, value));

	function keepTogether(on: boolean) {
		store.applySource((d, reserved) =>
			setQuestionsTogether(d, reserved, {
				on,
				blockId: block.block_id,
				group: view.together?.group ?? undefined,
				lessonId
			})
		);
	}
</script>

{#snippet pane(id: string)}
	{#if id === 'main'}
		<div class="main">
			<FieldGroup rows={view.fields.main ?? []} write={set} screen="{screen}.fields.main" />
			{#if view.together_note}
				<p class="note" data-screen="{screen}.together_note">{view.together_note}</p>
			{/if}
		</div>
	{:else if id === 'ladder'}
		<p class="note">Použije se u kroků, které nemají nápovědu vlastní.</p>
		<FieldGroup rows={view.fields.ladder ?? []} write={set} screen="{screen}.fields.ladder" />
	{:else if id === 'topics'}
		<h4>Dovednosti</h4>
		<TopicPicker {block} view={view.topics} screen="{screen}.topics" />
		<h4 class="apart">Zařazení karty</h4>
		<ConceptsEditor {block} view={view.concepts} screen="{screen}.concepts" />
		<CompetencyEditor {block} view={view.competencies} screen="{screen}.competencies" />
		<FieldGroup rows={view.fields.topics ?? []} write={set} screen="{screen}.fields.topics" />
	{:else if id === 'review'}
		<h4>Kdy se karta vrací</h4>
		<FieldGroup rows={view.review.plan} write={set} screen="{screen}.review.plan" />
		<h4 class="apart">Výchozí odhad paměti</h4>
		<FieldGroup rows={view.review.start} write={set} screen="{screen}.review.start" />
	{:else if id === 'followup'}
		<PrerequisiteEditor {block} view={view.prerequisites} screen="{screen}.prerequisites" />
		<FieldGroup rows={view.fields.followup ?? []} write={set} screen="{screen}.fields.followup" />
	{:else if id === 'lesson'}
		<FieldGroup
			rows={view.fields.lesson ?? []}
			write={setBinding}
			screen="{screen}.fields.lesson"
		/>
	{:else if id === 'meta'}
		<div class="row">
			<span class="label">Identifikátor</span>
			<code data-screen="{screen}.block_id">{view.block_id}</code>
		</div>
		<FieldGroup rows={view.fields.meta ?? []} write={set} screen="{screen}.fields.meta" />
		{#if view.together}
			<Toggle
				checked={view.together.checked}
				label={view.together.label}
				hint={view.together.hint ?? undefined}
				screen="{screen}.together.checked"
				onchange={keepTogether}
			/>
			<p
				class="note"
				data-testid="together-consequence"
				data-screen="{screen}.together.consequence"
			>
				{view.together.consequence}
			</p>
		{/if}
	{/if}
{/snippet}

{#snippet body()}
	<SettingsNav dialog={view} {screen} {search} {pane} />
{/snippet}

{#snippet actions(notice: Snippet)}
	{@render notice()}
	<Button variant="secondary" onclick={onclose}>Hotovo</Button>
{/snippet}

<Modal title="Nastavení karty" size="l" {onclose} children={body} footer={actions} />

<style>
	.main {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	h4 {
		margin: 4px 0 0;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}

	/* A second group in one section: set off from the first by space, not a rule. */
	h4.apart {
		margin-top: 14px;
	}

	.note {
		margin: 0;
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
