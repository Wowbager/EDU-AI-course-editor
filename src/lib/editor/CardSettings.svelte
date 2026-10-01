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
	 * Which settings exist is still decided by the mode, from `$lib/ui/fields.ts`, and
	 * so is where each one sits: in sections named by what they do (`SECTIONS`), which
	 * `SettingsNav` lists down the left from Metodik up. It renders those tables rather
	 * than keeping a second opinion about either.
	 */
	import type { BlockV2, CourseV2, LessonBlockBinding } from '$lib/domain/schema';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Toggle from '$lib/ui/Toggle.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import SettingsNav from '$lib/ui/SettingsNav.svelte';
	import TopicPicker from './TopicPicker.svelte';
	import CompetencyEditor from './CompetencyEditor.svelte';
	import PrerequisiteEditor from './PrerequisiteEditor.svelte';
	import { useStore } from '$lib/ui/context';
	import { fieldsFor, listsSections, sectionsFor, type FieldLevel } from '$lib/ui/fields';
	import { sectionHasIssue, sectionTargeted } from '$lib/ui/settings-target';
	import { SettingsSearch, setSettingsSearch } from '$lib/ui/settings-search.svelte';
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

	const blockFields = $derived(fieldsFor('block', mode, store.showFeedback));
	const inSection = (id: string) => blockFields.filter((f) => f.section === id);
	const bindingFields = $derived(
		binding === undefined ? [] : fieldsFor('binding', mode, store.showFeedback)
	);
	/**
	 * The card's sections, and the lesson's binding as one more just before the card's
	 * details: it is about this card, but only where this lesson shows it.
	 */
	const sections = $derived.by(() => {
		const own = sectionsFor('block', mode, store.showFeedback);
		const lesson = bindingFields.length > 0 ? sectionsFor('binding', mode, store.showFeedback) : [];
		const at = own.findIndex((s) => s.id === 'meta');
		return at === -1 ? [...own, ...lesson] : [...own.slice(0, at), ...lesson, ...own.slice(at)];
	});
	/** The two rows of the review section: where a card starts, and how it is scheduled. */
	const reviewStart = $derived(
		inSection('review').filter((f) => f.path.startsWith('fsrs.initial_'))
	);
	const reviewPlan = $derived(
		inSection('review').filter((f) => !f.path.startsWith('fsrs.initial_'))
	);

	const levelOf = (id: string): FieldLevel => (id === 'lesson' ? 'binding' : 'block');
	const scope = $derived({ blockId: block.block_id });
	const targeted = (id: string) => sectionTargeted(store, [levelOf(id)], id, scope);
	const alert = (id: string) => sectionHasIssue(store, [levelOf(id)], id, scope);

	const search = new SettingsSearch(['block', 'binding'], () => ({
		mode: store.mode,
		feedback: store.showFeedback
	}));
	setSettingsSearch(search);

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
		return path
			.split('.')
			.reduce<unknown>(
				(node, key) =>
					node === undefined || node === null ? undefined : (node as Record<string, unknown>)[key],
				block as unknown
			);
	}
	const readBinding = (path: string): unknown =>
		(binding as Record<string, unknown> | undefined)?.[path];

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
			(together ||
				(card !== undefined && store.source.blocks.filter((b) => groupOf(b) === card).length > 1))
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

{#snippet pane(id: string)}
	{#if id === 'main'}
		<div class="main">
			<FieldGroup fields={inSection('main')} {read} write={set} />
			{#if together && questionCount(block) > 1 && mode !== 'advanced'}
				<p class="note">
					Otázky této karty se žákovi hodnotí jako jedna (nastaveno v pokročilém režimu).
				</p>
			{/if}
		</div>
	{:else if id === 'ladder'}
		<p class="note">Použije se u kroků, které nemají nápovědu vlastní.</p>
		<FieldGroup fields={inSection('ladder')} {read} write={set} />
	{:else if id === 'topics'}
		<TopicPicker {block} />
		<CompetencyEditor {block} />
		<FieldGroup fields={inSection('topics')} {read} write={set} />
	{:else if id === 'review'}
		<h4>Začátek</h4>
		<FieldGroup fields={reviewStart} {read} write={set} />
		<h4>Plánování</h4>
		<FieldGroup fields={reviewPlan} {read} write={set} />
	{:else if id === 'followup'}
		<PrerequisiteEditor {doc} {block} />
		<FieldGroup fields={inSection('followup')} {read} write={set} />
	{:else if id === 'lesson'}
		<FieldGroup fields={bindingFields} read={readBinding} write={setBinding} />
	{:else if id === 'meta'}
		<div class="row">
			<span class="label">Identifikátor</span>
			<code>{block.block_id}</code>
		</div>
		<FieldGroup fields={inSection('meta')} {read} write={set} />
		{#if canKeepTogether}
			<Toggle
				checked={together}
				label="Více otázek v jedné kartě"
				hint="Žák dostane otázky v jedné kartě a aplikace je hodnotí jako jednu: nejlepší skóre, poslední známka, jedna karta k procvičování. Vypnuto: každá otázka je vlastní karta."
				onchange={keepTogether}
			/>
		{/if}
	{/if}
{/snippet}

{#snippet body()}
	<SettingsNav
		{sections}
		list={listsSections(mode)}
		{targeted}
		{alert}
		search={mode === 'advanced' ? search : undefined}
		{pane}
	/>
{/snippet}

{#snippet actions()}
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
