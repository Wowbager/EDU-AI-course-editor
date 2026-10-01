<script lang="ts">
	/**
	 * The answer table: one row per option, in the focus-reveal pattern. Everything is
	 * read as text until the author moves into it — the point being that a question with
	 * four options and four pieces of feedback should read like a question, not a form.
	 *
	 * The grid holds what an answer *is*: the mark of right or wrong, the option text
	 * and the feedback the student sees after choosing it. What it *does* (§8.2: where
	 * it leads, the mark collected in quiz mode, the share of points) sits in a detail
	 * line under the row that a quiet control opens. A value that is set shows as
	 * inert text under the answer, so it is read without opening anything.
	 */
	import type { BlockStep, BlockV2, CourseV2 } from '$lib/domain/schema';
	import FocusField from '$lib/ui/FocusField.svelte';
	import Button from '$lib/ui/Button.svelte';
	import GoToPicker, { goToSummary } from './GoToPicker.svelte';
	import { sectionTargeted } from '$lib/ui/settings-target';
	import { useStore } from '$lib/ui/context';
	import { uniqueKeys } from '$lib/ui/keys';
	import { allows } from '$lib/ui/fields';
	import { addOption, deleteOption, setField } from '$lib/domain/commands';
	import { optionOutcomesApply } from '$lib/domain/derive';
	import { MIN_CHOICE_OPTIONS } from '$lib/domain/validate';
	import { Check, ChevronRight, Plus, Trash } from '@lucide/svelte';

	interface Props {
		doc: CourseV2;
		block: BlockV2;
		step: BlockStep;
	}
	let { doc, block, step }: Props = $props();

	const store = useStore();
	const uid = $props.id();
	const options = $derived(step.question?.options ?? []);
	// Duplicate option ids are a warning (`W_DUPLICATE_OPTION_ID`), not a crash.
	const optionKeys = $derived(uniqueKeys(options.map((o) => o.id)));
	// The app reads an answer's "Kam dál" and grade only when the pupil picks one
	// answer (`optionOutcomesApply`), so a question with several picks has neither.
	const outcomes = $derived(optionOutcomesApply(step.question));
	const branching = $derived(
		outcomes && block.type === 'question' && doc.export_type !== 'exercise_v2'
	);
	const quizMarks = $derived(
		outcomes && (doc.export_type === 'quiz_v2' || doc.quiz_evaluate === true)
	);
	const multiple = $derived(step.question?.allow_multiple === true);
	const advanced = $derived(allows('option', 'score_koef', store.mode));
	// Zpětná vazba off: the column that tells the pupil what went wrong goes, and its
	// track with it — the rest of the row keeps its alignment.
	const feedback = $derived(allows('option', 'feedback', store.mode, store.showFeedback));
	const fixedOptions = $derived(step.question?.type === 'true_false');
	// "Odpověď" alone is not worth a heading: the column is the only one there is.
	const headed = $derived(feedback);
	// The detail line exists only when at least one of its three fields does.
	const detailOffered = $derived(branching || quizMarks || advanced);
	const showIds = $derived(allows('step', 'id', store.mode));
	// Which answers have their detail line open. Local to this table, like a fold.
	let opened = $state<Record<string, boolean>>({});
	const isOpen = (key: string) => opened[key] === true;
	// A selection or a visible issue on one of the detail fields opens that row's line
	// and leaves it open, so typing in the field never pulls it away.
	$effect(() => {
		if (!detailOffered) return;
		for (const [i, option] of options.entries()) {
			const pointed = sectionTargeted(store, ['option'], 'detail', {
				blockId: block.block_id,
				stepId: step.id,
				optionId: option.id
			});
			if (pointed && opened[optionKeys[i]] !== true) opened[optionKeys[i]] = true;
		}
	});

	/** What is set on an answer, in a few words; defaults say nothing. */
	function summaryOf(option: (typeof options)[number]): string[] {
		const parts: string[] = [];
		if (branching) {
			const where = goToSummary(doc, block, option.go_to, showIds, store.index);
			if (where !== '') parts.push(`→ ${where}`);
		}
		if (quizMarks && option.mark !== undefined && option.mark !== '') {
			parts.push(`známka ${option.mark}`);
		}
		if (advanced && option.score_koef !== undefined) parts.push(`podíl bodů ${option.score_koef}`);
		return parts;
	}
	// The last answers have to stay: a question with nothing to choose from is not a
	// question (`E_MC_TOO_FEW_OPTIONS`, which `MIN_CHOICE_OPTIONS` bounds).
	const lastAnswers = $derived(
		step.question?.type === 'multiple_choice' && options.length <= MIN_CHOICE_OPTIONS
	);
	// What is wrong with the list as a whole (too few answers, none right), said where
	// the list is, under the same timing as every other warning.
	const listIssues = $derived(
		store.issuesAt({
			blockId: block.block_id,
			stepId: step.id,
			field: 'question.options'
		})
	);
	// Shared, content-independent tracks keep headings and all rows aligned.
	const tracks = $derived(
		[
			'36px',
			'minmax(0, 1.4fr)',
			...(feedback ? ['minmax(0, 1.6fr)'] : []),
			detailOffered ? '4.25rem' : '2rem'
		].join(' ')
	);

	const ref = (optionId: string, field: string) => ({
		blockId: block.block_id,
		stepId: step.id,
		optionId,
		field
	});

	const set = (optionId: string, field: string, value: unknown) =>
		store.apply((d) => setField(d, ref(optionId, field), value));

	function toggleChecked(optionId: string) {
		const option = options.find((o) => o.id === optionId);

		if (fixedOptions) {
			// True/false questions have exactly two options, one correct and one incorrect.
			// Toggling one flips the other.
			const other = options.find((o) => o.id !== optionId);
			if (option && other) {
				set(optionId, 'is_correct', true);
				set(other.id, 'is_correct', false);
			}
			return;
		}

		if (option) {
			if (option.is_correct && options.filter((o) => o.is_correct).length === 1) {
				// Don't allow unchecking the last correct option.
				return;
			}

			set(optionId, 'is_correct', !option.is_correct);

			if (!multiple) {
				for (const other of options) {
					if (other.id !== optionId && other.is_correct) {
						set(other.id, 'is_correct', false);
					}
				}
			}
		}
	}
</script>

<div class="answers" class:bare={!headed} style:--answer-tracks={tracks}>
	{#if headed}
		<div class="head" aria-hidden="true">
			<span></span>
			<span>Odpověď</span>
			{#if feedback}<span>Co se žák dozví</span>{/if}
			<span></span>
		</div>
	{/if}

	{#each options as option, i (optionKeys[i])}
		<div class="row">
			<div class="cell">
				<button
					type="button"
					class="verb"
					class:correct={option.is_correct}
					class:multiple
					aria-pressed={option.is_correct === true}
					aria-label={`Správná odpověď: ${option.text || 'bez textu'}`}
					title={option.is_correct
						? 'Správná odpověď — klikni pro označení jako chybná'
						: 'Chybná odpověď — klikni pro označení jako správná'}
					onclick={() => toggleChecked(option.id)}
				>
					<!-- The mark of a radio button, or of a checkbox when several may be picked. -->
					<span class="mark-box">
						{#if option.is_correct}<Check size={14} strokeWidth={3} />{/if}
					</span>
				</button>
			</div>

			<div class="cell text">
				<FocusField
					label="Text odpovědi"
					value={option.text}
					emptyText="Napiš odpověď…"
					onchange={(v) => set(option.id, 'text', v ?? '')}
					disabled={fixedOptions}
					ref={ref(option.id, 'text')}
				/>
				{#if !isOpen(optionKeys[i])}
					{@const summary = summaryOf(option)}
					{#if summary.length > 0}
						<p class="set-values">{summary.join(' · ')}</p>
					{/if}
				{/if}
			</div>

			{#if feedback}
				<div class="cell feedback">
					<FocusField
						label="Zpětná vazba k této odpovědi"
						value={option.feedback}
						multiline
						emptyText={option.is_correct === true
							? 'Potvrď, proč je to správně…'
							: 'Pojmenuj chybu, která k této odpovědi vede…'}
						ref={ref(option.id, 'feedback')}
						onchange={(v) => set(option.id, 'feedback', v)}
					/>
				</div>
			{/if}

			<div class="cell actions">
				{#if detailOffered}
					<button
						type="button"
						class="more"
						class:open={isOpen(optionKeys[i])}
						aria-expanded={isOpen(optionKeys[i])}
						aria-controls="{uid}-detail-{i}"
						aria-label={`Podrobnosti odpovědi ${option.text || 'bez textu'}`}
						title="Podrobnosti odpovědi"
						onclick={() => (opened[optionKeys[i]] = !isOpen(optionKeys[i]))}
					>
						<ChevronRight size={14} aria-hidden="true" />
					</button>
				{/if}
				{#if !fixedOptions}
					<span class="trash">
						<Button
							variant="ghost"
							size="s"
							disabled={lastAnswers}
							title={lastAnswers
								? 'Otázka potřebuje aspoň dvě odpovědi, ze kterých žák vybírá'
								: 'Smazat odpověď'}
							ariaLabel={`Smazat odpověď ${option.text || 'bez textu'}`}
							onclick={() =>
								store.apply((d) => deleteOption(d, block.block_id, step.id, option.id))}
						>
							<Trash size={14}></Trash>
						</Button>
					</span>
				{/if}
			</div>

			{#if detailOffered && isOpen(optionKeys[i])}
				<div class="detail" id="{uid}-detail-{i}" role="group" aria-label="Podrobnosti odpovědi">
					{#if branching}
						<div class="field">
							<span class="label">Kam dál</span>
							<GoToPicker
								{doc}
								{block}
								stepId={step.id}
								value={option.go_to}
								onchange={(v) => set(option.id, 'go_to', v)}
							/>
						</div>
					{/if}
					{#if quizMarks}
						<div class="field">
							<span class="label">Známka</span>
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
					{#if advanced}
						<div class="field score">
							<span class="label">Podíl bodů</span>
							<FocusField
								label="Podíl bodů za tuto odpověď"
								value={option.score_koef === undefined ? undefined : String(option.score_koef)}
								emptyText="1.0"
								monospace
								ref={ref(option.id, 'score_koef')}
								onchange={(v) =>
									set(option.id, 'score_koef', v === undefined ? undefined : Number(v))}
							/>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

	{#each [...listIssues.errors, ...listIssues.warnings] as issue (issue.code)}
		<p class="list-issue" class:warning={issue.severity === 'warning'}>
			{issue.message}
		</p>
	{/each}

	{#if !fixedOptions}
		<div class="add">
			<Button
				variant="secondary"
				size="s"
				onclick={() => store.apply((d) => addOption(d, block.block_id, step.id))}
			>
				<Plus size={14} />
				Další odpověď
			</Button>
		</div>
	{/if}
</div>

<style>
	.answers {
		container: answers / inline-size;
		min-width: 0;
		overflow-wrap: anywhere;
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 12px;
	}

	.head,
	.row {
		display: grid;
		grid-template-columns: var(--answer-tracks);
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
		transition: background 0.2s;
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

	.cell {
		min-width: 0;
		font-size: var(--text-m);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.set-values {
		margin: 2px 0 0;
		padding: 0 6px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	/* The control that opens an answer's detail line is there when the row is. */
	.more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms;
	}

	.row:hover .more,
	.row:focus-within .more,
	.more.open {
		opacity: 1;
	}

	.more:hover {
		color: var(--e-text);
	}

	.more:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}

	.more :global(svg) {
		transition: transform 120ms ease;
	}

	.more.open :global(svg) {
		transform: rotate(90deg);
	}

	@media (hover: none) {
		.more {
			opacity: 1;
		}
	}

	.detail {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 12px 24px;
		padding-left: 48px;
		font-size: var(--text-m);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.field.score {
		width: 6rem;
	}

	.label {
		color: var(--e-text-faint);
		font: var(--type-chip-label);
	}

	/* The editor can be narrow even on a desktop with both sidebars open. */
	@container answers (max-width: 760px) {
		.head {
			display: none;
		}

		.detail {
			padding-left: 0;
		}

		.row {
			grid-template-columns: minmax(0, 1fr);
			gap: 10px;
			border-bottom: 1px solid var(--e-border);
		}

		.cell::before {
			display: block;
			margin-bottom: 4px;
			color: var(--e-text-faint);
			font: var(--type-chip-label);
		}

		.text::before {
			content: 'Odpověď';
		}
		.bare .text::before {
			display: none;
		}
		.feedback::before {
			content: 'Co se žák dozví';
		}
	}

	/*
     * Right or wrong is the shape of a radio button, or of a checkbox where several
     * answers may be picked, so the table itself says which kind of question this is.
     * Wrong is the empty shape; right is the same shape filled and ticked.
     */
	.verb {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: none;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--surface);
		cursor: pointer;
	}

	.mark-box {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: 2px solid var(--e-border-strong);
		border-radius: 50%;
		background: var(--surface);
		transition:
			border-color 120ms,
			background-color 120ms;
	}

	.multiple .mark-box {
		border-radius: 5px;
	}

	.verb:hover .mark-box {
		border-color: var(--e-ok);
	}

	.verb.correct .mark-box {
		border-color: var(--e-ok);
		background: var(--e-ok);
	}

	/*
     * Removing an answer is rare, so its button is not part of the table's look: it
     * is there when the row is pointed at or worked in, and red only under the pointer.
     * A screen with no hover shows it always.
     */
	.trash {
		display: inline-flex;
		opacity: 0;
		transition: opacity 120ms;
	}

	.row:hover .trash,
	.row:focus-within .trash {
		opacity: 1;
	}

	@media (hover: none) {
		.trash {
			opacity: 1;
		}
	}

	.trash :global(.btn:hover:not(:disabled)) {
		border-color: var(--e-error);
		background: var(--e-error-bg);
		color: var(--e-error);
	}

	.list-issue {
		margin: 4px 0 0;
		padding-left: 8px;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	.list-issue.warning {
		color: var(--e-warning);
	}

	.mark {
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font-family: var(--font-body);
		font-size: var(--text-s);
	}

	.add {
		align-self: flex-start;
		margin-top: 6px;
	}
</style>
