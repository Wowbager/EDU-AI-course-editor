<script lang="ts">
	/**
	 * The answer table: one row per option, in the focus-reveal pattern. Everything is
	 * read as text until the author moves into it — the point being that a question with
	 * four options and four pieces of feedback should read like a question, not a form.
	 *
	 * Columns follow §8.2: the option text, what it is (the outcome verb), the mark
	 * collected in quiz mode, the feedback the student sees after choosing it, and where
	 * that answer leads.
	 */
	import type { BlockStep, BlockV2, CourseV2 } from '$lib/domain/schema';
	import FocusField from '$lib/ui/FocusField.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import GoToPicker from './GoToPicker.svelte';
	import { useStore } from '$lib/ui/context';
	import { allows } from '$lib/ui/fields';
	import { refKey } from '$lib/domain/ref';
	import { addOption, deleteOption, setField } from '$lib/domain/commands';

	interface Props {
		doc: CourseV2;
		block: BlockV2;
		step: BlockStep;
	}
	let { doc, block, step }: Props = $props();

	const store = useStore();
	const options = $derived(step.question?.options ?? []);
	const branching = $derived(block.type === 'question' && doc.export_type !== 'exercise_v2');
	const quizMarks = $derived(doc.export_type === 'quiz_v2' || doc.quiz_evaluate === true);
	const advanced = $derived(allows('option', 'score_koef', store.mode));
	const fixedOptions = $derived(step.question?.type === 'true_false');

	const ref = (optionId: string, field: string) => ({
		blockId: block.block_id,
		stepId: step.id,
		optionId,
		field
	});

	const set = (optionId: string, field: string, value: unknown) =>
		store.apply((d) => setField(d, ref(optionId, field), value));

	const issuesFor = (optionId: string) =>
		store.issuesAt({ blockId: block.block_id, stepId: step.id, optionId });
</script>

<div class="answers">
	<div class="head" aria-hidden="true">
		<span>Odpověď</span>
		<span>Je to</span>
		{#if quizMarks}<span>Známka</span>{/if}
		<span>Co se žák dozví</span>
		{#if branching}<span>Kam dál</span>{/if}
		<span></span>
	</div>

	{#each options as option (option.id)}
		{@const issues = issuesFor(option.id)}
		<div class="row" class:invalid={issues.errors.length > 0}>
			<div class="cell text">
				<FocusField
					label="Text odpovědi"
					value={option.text}
					emptyText="Napiš odpověď…"
					invalid={issues.errors.some((i) => i.code === 'E_MC_EMPTY_OPTION_TEXT')}
					onchange={(v) => set(option.id, 'text', v ?? '')}
				/>
			</div>

			<div class="cell">
				<button
					type="button"
					class="verb"
					class:correct={option.is_correct === true}
					onclick={() => set(option.id, 'is_correct', option.is_correct !== true)}
				>
					{option.is_correct === true ? 'Správně' : 'Chyba'}
				</button>
			</div>

			{#if quizMarks}
				<div class="cell">
					<select
						class="mark"
						aria-label="Známka za tuto odpověď"
						value={option.mark ?? ''}
						onchange={(e) => set(option.id, 'mark', e.currentTarget.value || undefined)}
					>
						<option value="">—</option>
						{#each ['1', '2', '3', '4', '5'] as mark (mark)}
							<option value={mark}>{mark}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="cell feedback">
				<FocusField
					label="Zpětná vazba k této odpovědi"
					value={option.feedback}
					multiline
					emptyText={option.is_correct === true
						? 'Potvrď, proč je to správně…'
						: 'Pojmenuj chybu, která k této odpovědi vede…'}
					onchange={(v) => set(option.id, 'feedback', v)}
				/>
			</div>

			{#if branching}
				<div class="cell">
					<GoToPicker
						{doc}
						{block}
						stepId={step.id}
						value={option.go_to}
						onchange={(v) => set(option.id, 'go_to', v)}
					/>
				</div>
			{/if}

			<div class="cell actions">
				{#if advanced}
					<FocusField
						label="Podíl bodů za tuto odpověď"
						value={option.score_koef === undefined ? undefined : String(option.score_koef)}
						emptyText="1.0"
						monospace
						onchange={(v) => set(option.id, 'score_koef', v === undefined ? undefined : Number(v))}
					/>
				{/if}
				{#if !fixedOptions}
					<button
						type="button"
						class="remove"
						title="Smazat odpověď"
						aria-label={`Smazat odpověď ${option.text || option.id}`}
						onclick={() => store.apply((d) => deleteOption(d, block.block_id, step.id, option.id))}
					>
						×
					</button>
				{/if}
			</div>
		</div>

		{#each [...issues.errors, ...issues.warnings] as issue (issue.code + refKey(issue.ref))}
			<p class="issue" class:warning={issue.severity === 'warning'}>{issue.message}</p>
		{/each}
	{/each}

	{#if !fixedOptions}
		<div class="add">
			<Button
				variant="secondary"
				size="s"
				onclick={() => store.apply((d) => addOption(d, block.block_id, step.id))}
			>
				+ Další odpověď
			</Button>
		</div>
	{:else}
		<p class="note"><Chip tone="quiet">Ano / Ne</Chip> Tento typ otázky má vždy právě dvě odpovědi.</p>
	{/if}
</div>

<style>
	.answers {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 12px;
	}

	.head,
	.row {
		display: grid;
		grid-template-columns: minmax(140px, 1.4fr) 80px auto minmax(160px, 1.6fr) auto auto;
		gap: 12px;
		align-items: start;
	}

	.head {
		padding: 0 8px 4px;
		color: var(--e-text-faint);
		font: var(--type-chip-label);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.row {
		padding: 8px;
		border-radius: var(--radius-s);
	}

	/*
	 * The row tint and a field's resting tint are the same colour, so a hovered row
	 * would swallow the fields inside it. Deepen the row and flip the fields to the
	 * surface colour instead — they pop out of the row rather than dissolving into
	 * it. This works only because the field reads its resting fill from a variable.
	 */
	.row:hover,
	.row:focus-within {
		background: var(--primary-dark-08);
		--e-field-rest: var(--surface);
		--e-field-hover: var(--surface);
	}

	.row.invalid {
		box-shadow: inset 2px 0 0 var(--e-error);
	}

	.cell {
		min-width: 0;
		font-size: var(--text-m);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.verb {
		padding: 4px 12px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--e-text-muted);
		font: var(--type-chip-label);
		cursor: pointer;
	}

	.verb.correct {
		border-color: transparent;
		background: var(--e-ok-bg);
		color: var(--e-ok);
	}

	.mark {
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font-family: var(--font-body);
		font-size: var(--text-s);
	}

	.remove {
		padding: 0 6px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		font-size: var(--text-xl);
		line-height: 1;
		cursor: pointer;
	}

	.remove:hover {
		background: var(--e-error-bg);
		color: var(--e-error);
	}

	.add {
		align-self: flex-start;
		margin-top: 6px;
	}


	.issue {
		margin: 0 0 4px 8px;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	.issue.warning {
		color: var(--e-warning);
	}

	.note {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 8px 0 0;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}
</style>
