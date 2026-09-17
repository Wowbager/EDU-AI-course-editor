<script lang="ts">
	/**
	 * One card: a block, its steps, and the two texts the app's question mark reads.
	 *
	 * The editor column holds exactly one of these — the card selected in the tree —
	 * so everything here is open. There is nothing to expand and no summary line,
	 * because a card that is on screen is a card being worked on.
	 *
	 * What is *not* here is the card's configuration: length, practice enrolment, the
	 * knowledge vector, the machinery. That is one click away in `CardSettings`. The
	 * line between them is what the student experiences: steps, hint and help are
	 * read by a pupil, so they are content and they stay visible; the rest describes
	 * the card to the platform.
	 */
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { BlockStep, BlockV2, CourseV2, LessonBlockBinding, StepType } from '$lib/domain/schema';
	import Card from '$lib/ui/Card.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import FocusField from '$lib/ui/FocusField.svelte';
	import StepEditor from './StepEditor.svelte';
	import { useStore } from '$lib/ui/context';
	import { refKey } from '$lib/domain/ref';
	import { fieldSpec } from '$lib/ui/fields';
	import {
		addStep,
		CommandError,
		duplicateBlock,
		planDeleteBlock,
		reorderSteps,
		setField,
		unbindBlock
	} from '$lib/domain/commands';
	import { blockDurationMinutes, derivedBlockXp, effectiveBlockXp, isPracticeBlock } from '$lib/domain/derive';

	interface Props {
		doc: CourseV2;
		block: BlockV2;
		/** Absent for a card bound to no lesson — it is editable, just unreachable. */
		binding?: LessonBlockBinding;
		lessonId?: string;
		onsettings: () => void;
		onrepairBlock: (blockId: string) => void;
		onrepairStep: (blockId: string, stepId: string) => void;
	}
	let { doc, block, binding, lessonId, onsettings, onrepairBlock, onrepairStep }: Props = $props();

	const store = useStore();
	const issues = $derived(store.issuesAt({ blockId: block.block_id }));
	const sharedWith = $derived((store.index.lessonsByBlock.get(block.block_id) ?? []).length);
	const xp = $derived(effectiveBlockXp(block));
	const xpIsDerived = $derived(typeof block.xp !== 'number');
	const minutes = $derived(blockDurationMinutes(block));

	const set = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { blockId: block.block_id, field }, value));

	const typeLabel = { display: 'Výklad', question: 'Otázka', exercise: 'Cvičení' } as const;

	const ADDABLE: { type: StepType; label: string }[] = [
		{ type: 'text', label: 'Text' },
		{ type: 'image', label: 'Obrázek' },
		{ type: 'video', label: 'Video' },
		{ type: 'audio', label: 'Zvuk' },
		{ type: 'question', label: 'Otázka' }
	];

	const hintSpec = fieldSpec('block', 'hint');
	const helpSpec = fieldSpec('block', 'help');

	/**
	 * Bring the card's own hint or help into view when something outside the editor
	 * points at it — the question mark in the preview, or a validation jump.
	 *
	 * A card-level hint is addressed without a `stepId` (it belongs to the card, not
	 * to any one step), so `StepEditor`'s reveal never matches it. Without this the
	 * "?" in the preview reported the right field and the screen did nothing, which
	 * reads exactly like a dead button.
	 */
	let ladder = $state<HTMLElement | null>(null);
	const revealedField = $derived(
		store.selection?.blockId === block?.block_id && store.selection?.stepId === undefined
			? store.selection?.field
			: undefined
	);
	$effect(() => {
		// The reveal counter, not the selection: typing also moves the selection, and
		// scrolling on every keystroke would be unusable.
		void store.reveal;
		if (ladder !== null && (revealedField === 'hint' || revealedField === 'help')) {
			ladder.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	});

	// svelte-dnd-action needs an `id` on each item; steps already have one.
	let dragging = $state<BlockStep[] | null>(null);
	const items = $derived(dragging ?? block.steps);

	function onconsider(event: CustomEvent<DndEvent<BlockStep>>) {
		dragging = event.detail.items;
	}

	function onfinalize(event: CustomEvent<DndEvent<BlockStep>>) {
		dragging = null;
		store.apply((d) => reorderSteps(d, block.block_id, event.detail.items.map((s) => s.id)));
	}

	function removeFromLesson() {
		// Unbinding is always safe; deleting the block itself is not, so the card's
		// remove action unbinds and hands a still-referenced block to the repair dialog.
		if (lessonId === undefined) {
			onrepairBlock(block.block_id);
			return;
		}
		const references = planDeleteBlock(doc, block.block_id).filter((r) => r.kind !== 'binding');
		if (references.length > 0 || sharedWith > 1) {
			onrepairBlock(block.block_id);
			return;
		}
		try {
			store.apply((d) => unbindBlock(d, lessonId, block.block_id));
		} catch (error) {
			if (error instanceof CommandError) onrepairBlock(block.block_id);
			else throw error;
		}
	}
</script>

<Card tone={binding?.bg_color}>
	<header>
		<Chip tone="accent">{typeLabel[block.type]}</Chip>

		{#if isPracticeBlock(block, binding?.default_practice === true)}
			<Chip tone="quiet" title="Blok se žákovi vrací v denním opakování">Cvičení</Chip>
		{/if}
		{#if sharedWith > 1}
			<Chip tone="warning" title="Blok je i v jiné lekci — úprava se projeví všude">
				Sdílený ({sharedWith}×)
			</Chip>
		{/if}
		{#if block.status !== undefined && block.status !== 'published'}
			<Chip tone="warning" title="Blok, který není publikovaný, se žákovi v kurzu přeskočí">
				{block.status}
			</Chip>
		{/if}

		<div class="spacer"></div>

		<Chip
			tone="quiet"
			title={xpIsDerived
				? `Dopočteno z kroků (${derivedBlockXp(block)} XP). Vyplň XP, pokud chceš jinou odměnu.`
				: 'Zadaná odměna'}
		>
			{xp} XP{xpIsDerived ? '*' : ''}
		</Chip>
		<Chip
			tone={minutes === undefined ? 'warning' : 'quiet'}
			title={minutes === undefined ? 'Bez délky se čas lekce spočítá špatně' : 'Očekávaný čas na kartu'}
		>
			{minutes === undefined ? 'bez délky' : `${minutes} min`}
		</Chip>

		{#if issues.errors.length > 0}
			<Chip tone="error">{issues.errors.length} chyb</Chip>
		{:else if issues.warnings.length > 0}
			<Chip tone="warning">{issues.warnings.length}</Chip>
		{/if}

		<!--
			Always visible, and it says what is behind it. A settings button that only
			appears on hover is a setting nobody finds; one with an unread warning on
			it — a card with no length breaks the lesson's clock — is worth opening.
		-->
		<Button
			variant="secondary"
			size="s"
			onclick={onsettings}
			title={minutes === undefined ? 'Karta nemá délku — čas lekce se spočítá špatně' : 'Délka, zařazení, klasifikace'}
		>
			Nastavení karty{#if minutes === undefined}<span class="dot" aria-label="něco chybí"></span>{/if}
		</Button>
		<Button variant="ghost" size="s" onclick={() => store.apply((d, r) => duplicateBlock(d, block.block_id, lessonId, r))}>
			Duplikovat
		</Button>
		<Button variant="danger" size="s" onclick={removeFromLesson}>Odebrat</Button>
	</header>

	<div
		class="steps"
		use:dndzone={{ items, flipDurationMs: 150, dropTargetStyle: {} }}
		onconsider={onconsider}
		onfinalize={onfinalize}
	>
		{#each items as step, i (step.id)}
			<div class="step-wrap">
				<StepEditor {doc} {block} {step} position={i + 1} onrepair={onrepairStep} />
			</div>
		{/each}
	</div>

	<div class="add-step">
		<span class="add-label">Přidat krok:</span>
		{#each ADDABLE as option (option.type)}
			<Button
				variant="secondary"
				size="s"
				onclick={() => store.apply((d, r) => addStep(d, block.block_id, option.type, undefined, r))}
			>
				{option.label}
			</Button>
		{/each}
	</div>

	<!--
		The card-wide help ladder: used when a step has none of its own. Inline for the
		same reason the step's is — the app escalates to it, and a course whose help
		button leads nowhere is a course with a broken button.
	-->
	<div class="help-ladder" bind:this={ladder}>
		<h4>Nápověda pro celou kartu</h4>
		<div class="field-row" class:targeted={revealedField === 'hint'}>
			<span class="field-label">{hintSpec?.label ?? 'Nápověda ke kartě'}</span>
			<div class="control">
				<FocusField
					label={hintSpec?.label ?? 'Nápověda ke kartě'}
					value={block.hint}
					multiline
					emptyText="nevyplněno"
					onchange={(v) => set('hint', v)}
				/>
				<span class="hint">{hintSpec?.hint}</span>
			</div>
		</div>
		<div class="field-row" class:targeted={revealedField === 'help'}>
			<span class="field-label">{helpSpec?.label ?? 'Podrobná pomoc'}</span>
			<div class="control">
				<FocusField
					label={helpSpec?.label ?? 'Podrobná pomoc'}
					value={block.help}
					multiline
					emptyText="nevyplněno"
					onchange={(v) => set('help', v)}
				/>
				<span class="hint">{helpSpec?.hint}</span>
			</div>
		</div>
	</div>

	{#each [...issues.errors, ...issues.warnings] as issue (issue.code + refKey(issue.ref))}
		{#if issue.ref.stepId === undefined}
			<p class="issue" class:warning={issue.severity === 'warning'}>{issue.message}</p>
		{/if}
	{/each}
</Card>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.spacer {
		flex: 1;
	}

	.dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-left: 5px;
		border-radius: 50%;
		background: var(--e-warning);
		vertical-align: middle;
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 12px;
	}

	.step-wrap:focus {
		outline: none;
	}

	.add-step {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 12px;
	}

	.add-label {
		margin-right: 2px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.help-ladder {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px solid var(--e-border);
	}

	h4 {
		margin: 0;
		color: var(--e-text-muted);
		font-family: var(--font-heading);
		font-size: var(--text-s);
	}

	.field-row {
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 12px;
		align-items: start;
		font-size: var(--text-m);
	}

	.field-row.targeted {
		margin: -6px -10px;
		padding: 6px 10px;
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 2px var(--primary);
	}

	.field-label {
		padding-top: 6px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.control {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.hint {
		overflow: hidden;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		line-height: 1.5;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.issue {
		margin: 10px 0 0;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	.issue.warning {
		color: var(--e-warning);
	}
</style>
