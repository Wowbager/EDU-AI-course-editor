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
	import Toggle from '$lib/ui/Toggle.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import TopicPicker from './TopicPicker.svelte';
	import CompetencyEditor from './CompetencyEditor.svelte';
	import PrerequisiteEditor from './PrerequisiteEditor.svelte';
	import VectorEditor from './VectorEditor.svelte';
	import { useStore } from '$lib/ui/context';
	import { allows, fieldsFor } from '$lib/ui/fields';
	import { setField, setPractice } from '$lib/domain/commands';
	import { bindingFlagsPractice, isPracticeBlock } from '$lib/domain/derive';
	import {
		groupOf,
		keepsQuestionsTogether,
		mergeQuestionCard,
		questionCount,
		splitQuestionCard
	} from '$lib/domain/groups';

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
	const allBlockFields = $derived(fieldsFor('block', mode, store.showFeedback));
	const ladderFields = $derived(allBlockFields.filter((f) => LADDER.includes(f.path)));
	const blockFields = $derived(allBlockFields.filter((f) => !LADDER.includes(f.path)));
	const teacherFields = $derived(blockFields.filter((f) => f.mode === 'teacher'));
	const metodikFields = $derived(blockFields.filter((f) => f.mode === 'metodik'));
	const advancedFields = $derived(blockFields.filter((f) => f.mode === 'advanced'));
	const bindingFields = $derived(binding === undefined ? [] : fieldsFor('binding', mode));

	/**
	 * Whether the card is in practice, however it got there: the block, a step or a
	 * lesson's binding (`isPracticeBlock`). The switch shows this, not the block's
	 * own flag, so it never disagrees with the „Opakování“ chip on the card.
	 */
	const practice = $derived(isPracticeBlock(block, bindingFlagsPractice(doc, block.block_id)));

	const set = (field: string, value: unknown) =>
		store.apply((d) =>
			field === 'default_practice'
				? setPractice(d, block.block_id, value === true)
				: setField(d, { blockId: block.block_id, field }, value)
		);
	const setBinding = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { lessonId, blockId: block.block_id, field }, value));

	function read(path: string): unknown {
		if (path === 'default_practice') return practice;
		return path.split('.').reduce<unknown>(
			(node, key) =>
				node === undefined || node === null ? undefined : (node as Record<string, unknown>)[key],
			block as unknown
		);
	}
	const readBinding = (path: string): unknown => (binding as Record<string, unknown> | undefined)?.[path];

	/**
	 * Whether this card's questions are graded as one item (`domain/groups.ts`). Every
	 * question is its own card by default; the advanced author may keep a card whole,
	 * for a retry that branches between its own questions. Offered only where there
	 * is more than one question to keep together.
	 */
	const together = $derived(keepsQuestionsTogether(block));
	const card = $derived(groupOf(block));
	const canKeepTogether = $derived(
		mode === 'advanced' &&
			block.type !== 'display' &&
			(together || (card !== undefined && store.source.blocks.filter((b) => groupOf(b) === card).length > 1))
	);

	function keepTogether(on: boolean) {
		if (on && card !== undefined) {
			store.applySource((d) => ({
				doc: mergeQuestionCard(d, card),
				description: 'Otázky karty spojeny do jedné',
				ref: { lessonId, blockId: card }
			}));
		} else if (!on && together) {
			store.applySource((d, reserved) => ({
				doc: splitQuestionCard(d, block.block_id, reserved),
				description: 'Otázky karty rozděleny do samostatných karet',
				ref: { lessonId, blockId: block.block_id }
			}));
		}
	}
</script>

{#snippet body()}
	<div class="section">
		<FieldGroup fields={teacherFields} {read} write={set} />
		{#if together && questionCount(block) > 1 && mode !== 'advanced'}
			<p class="note">
				Otázky této karty se žákovi hodnotí jako jedna (nastaveno v pokročilém režimu).
			</p>
		{/if}
	</div>

	{#if ladderFields.length > 0}
		<div class="section">
			<h3>Nápověda pro celou kartu</h3>
			<p class="note">Použije se u kroků, které nemají nápovědu vlastní.</p>
			<FieldGroup fields={ladderFields} {read} write={set} />
		</div>
	{/if}

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
			{#if canKeepTogether}
				<Toggle
					checked={together}
					label="Více otázek v jedné kartě"
					hint="Žák dostane otázky v jedné kartě a aplikace je hodnotí jako jednu: nejlepší skóre, poslední známka, jedna karta k procvičování. Vypnuto: každá otázka je vlastní karta."
					onchange={keepTogether}
				/>
			{/if}
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
