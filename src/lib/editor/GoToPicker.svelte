<script module lang="ts">
	import type { BlockStep, BlockV2, CourseV2 } from '$lib/domain/schema';
	import type { DocIndex } from '$lib/domain/index-doc';
	import { blockPreview, stepSummary } from '$lib/domain/derive';
	import { STEP_TYPES } from '$lib/lang';

	/** The names the picker and the answer table's summary share (§8: "Krok 3", not "s3"). */
	export function stepLabel(block: BlockV2, step: BlockStep, showIds: boolean): string {
		const position = block.steps.findIndex((s) => s.id === step.id) + 1;
		const name = showIds ? step.id : `Krok ${position}`;
		const text = stepSummary(step);
		const shortened = text.length > 40 ? `${text.slice(0, 40)}…` : text;
		if (shortened !== '') return `${name}: ${shortened}`;
		const type = STEP_TYPES.find((t) => t.type === step.type)?.label ?? step.type;
		return `${name} (${type.toLowerCase()})`;
	}

	export function blockLabelOf(doc: CourseV2, b: BlockV2, showIds: boolean): string {
		const position = doc.lessons
			.map((lesson) => lesson.blocks.findIndex((binding) => binding.block_id === b.block_id))
			.find((i) => i >= 0);
		const name = blockPreview(b, 40, position === undefined ? undefined : position + 1);
		return showIds ? `${b.block_id} — ${name}` : name;
	}

	/**
	 * Where an answer leads, in a few words, for a row that is not being edited. Empty
	 * for the default (carry on), so only a choice the author made is shown.
	 */
	export function goToSummary(
		doc: CourseV2,
		block: BlockV2,
		value: string | undefined | null,
		showIds: boolean,
		index: DocIndex
	): string {
		if (value === undefined || value === null || value === '' || value === 'NEXT_STEP') return '';
		if (value === 'AGAIN') return 'znovu tuto otázku';
		if (value === 'END') return 'konec bloku';
		if (value === 'CHAT') return 'chat s lektorem';
		const step = block.steps.find((s) => s.id === value);
		if (step !== undefined) {
			const position = block.steps.indexOf(step) + 1;
			return showIds ? step.id : `Krok ${position}`;
		}
		const target = doc.blocks.find((b) => b.block_id === value) ?? index.blocksById.get(value);
		return target === undefined
			? showIds
				? value
				: 'neplatný cíl'
			: blockLabelOf(doc, target, showIds);
	}
</script>

<script lang="ts">
	/**
	 * `go_to` is always chosen, never typed (§3 invariant 9). A free-text field here
	 * produces branches that point nowhere, and the student finds out, not the author.
	 *
	 * The picker is hidden entirely for exercise blocks and exercise_v2 courses, where
	 * the player ignores branching (§9).
	 */
	import { useStore } from '$lib/ui/context';
	import { allows } from '$lib/ui/fields';

	interface Props {
		value: string | undefined | null;
		block: BlockV2;
		doc: CourseV2;
		/** The step this option belongs to, so "this step" reads correctly. */
		stepId: string;
		onchange: (value: string | undefined) => void;
	}

	let { value, block, doc, stepId, onchange }: Props = $props();

	const store = useStore();
	/** Ids are the advanced author's business only (plan §8). */
	const showIds = $derived(allows('step', 'id', store.mode));

	const KEYWORDS = [
		{ value: '', label: 'Pokračovat dál' },
		{ value: 'AGAIN', label: 'Zkusit tuto otázku znovu' },
		{ value: 'END', label: 'Ukončit blok' },
		{ value: 'CHAT', label: 'Otevřít chat s AI lektorem' }
	];

	const steps = $derived(block.steps.filter((s) => s.id !== stepId));
	const blocks = $derived(doc.blocks.filter((b) => b.block_id !== block.block_id));

	// The stored value is always the id; only the label changes, because a teacher
	// picks "Krok 3", not "s3" (§8). The names are the ones the rest of the editor
	// uses — `stepSummary` for a step, `blockPreview` for a card — so a card is not
	// "Části zlomku" in the tree and "Části zlomku | Pozice | Název" here.
	const label = (step: BlockStep) => stepLabel(block, step, showIds);
	const blockLabel = (b: BlockV2) => blockLabelOf(doc, b, showIds);

	// `NEXT_STEP` and an absent value mean the same thing; the picker shows one option
	// for both and writes the absent form, which is what the corpus uses.
	const current = $derived(value === 'NEXT_STEP' || value === null ? '' : (value ?? ''));

	/**
	 * A jump into a later question of another card (`domain/groups.ts`) names a block
	 * the card is made of, not the card. The index resolves it to the card, and the
	 * picker names it as such, so the teacher sees where it goes instead of a blank.
	 */
	const into = $derived.by(() => {
		if (
			current === '' ||
			steps.some((s) => s.id === current) ||
			blocks.some((b) => b.block_id === current)
		) {
			return undefined;
		}
		const card = store.index.blocksById.get(current);
		if (card === undefined || card.block_id === current || card.block_id === block.block_id)
			return undefined;
		return { value: current, label: `${blockLabel(card)} (od jedné z dalších otázek)` };
	});
</script>

<select
	class="picker"
	aria-label="Kam pokračovat po této odpovědi"
	value={current}
	onchange={(e) => onchange(e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
>
	<optgroup label="Průběh">
		{#each KEYWORDS as keyword (keyword.value)}
			<option value={keyword.value}>{keyword.label}</option>
		{/each}
	</optgroup>
	{#if steps.length > 0}
		<optgroup label="Krok v tomto bloku">
			{#each steps as step, i (i)}
				<option value={step.id}>{label(step)}</option>
			{/each}
		</optgroup>
	{/if}
	{#if blocks.length > 0}
		<optgroup label="Jiný blok v kurzu">
			{#each blocks as target, i (i)}
				<option value={target.block_id}>{blockLabel(target)}</option>
			{/each}
			{#if into !== undefined}
				<option value={into.value}>{into.label}</option>
			{/if}
		</optgroup>
	{/if}
</select>

<style>
	.picker {
		width: 100%;
		max-width: 260px;
		padding: 4px 6px;
		border: 1px solid transparent;
		border-radius: var(--radius-xs);
		background: none;
		font-family: var(--font-body);
		font-size: var(--text-s);
		color: var(--e-text-muted);
		cursor: pointer;
	}

	.picker:hover,
	.picker:focus {
		border-color: var(--e-border-strong);
		background: var(--surface);
		color: var(--e-text);
	}
</style>
