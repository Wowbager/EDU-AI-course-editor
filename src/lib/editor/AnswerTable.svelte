<script lang="ts">
	/**
	 * The answer table: one row per option, in the focus-reveal pattern. Everything is
	 * read as text until the author moves into it — the point being that a question with
	 * four options and four pieces of feedback should read like a question, not a form.
	 *
	 * The grid holds what an answer *is*: the mark of right or wrong, the option text
	 * and the feedback the student sees after choosing it. What it *does* (§8.2: where
	 * it leads, the mark collected in quiz mode, the share of points) sits in a detail
	 * line under the row. A value that is set is read under the answer without opening
	 * anything, and that line is itself the way in: it opens the detail line with the
	 * first field focused (for a branch, "Kam dál"), so what you read is what you click.
	 * The chevron stays for the answers that say nothing yet (nothing to click) and for
	 * folding the line away again.
	 *
	 * A change of "Kam dál" (or removing an answer) that leaves a step or a card with no
	 * way to it says so once under that answer, with "Vrátit zpět" (`madeUnreachable`),
	 * and says nothing after the next edit.
	 *
	 * Everything drawn is the model's (`store.screen.card`, `screen/card.ts`): the
	 * columns the mode shows, the summary lines, which detail lines are open. This
	 * writes what the teacher does and keeps focus.
	 */
	import { tick, untrack } from 'svelte';
	import type { BlockStep, BlockV2 } from '$lib/domain/schema';
	import type { AnswersView } from '$lib/screen/types';
	import FocusField from '$lib/ui/FocusField.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import GoToPicker from './GoToPicker.svelte';
	import { useStore } from '$lib/ui/context';
	import { addOption, deleteOption, reorderOptions, setField } from '$lib/domain/commands';
	import {
		ArrowDown,
		ArrowUp,
		Check,
		ChevronRight,
		CornerDownRight,
		Plus,
		Trash
	} from '@lucide/svelte';
	import { withUndoNotice } from './undo-notice';

	interface Props {
		block: BlockV2;
		step: BlockStep;
		/** The step's key in the list, which its folds and open lines are remembered under. */
		stepKey: string;
		answers: AnswersView;
		/** Where `answers` is in the model, for `data-screen`. */
		screen: string;
		/** Several picks are allowed: ticking one does not untick the rest. */
		multiple: boolean;
	}
	let { block, step, stepKey, answers, screen, multiple }: Props = $props();

	const store = useStore();
	const uid = $props.id();
	const options = $derived(step.question?.options ?? []);
	const detailKey = (key: string) => `${block.block_id}/${stepKey}/${key}`;
	const rowScreen = (i: number, rest: string) => `${screen}.rows[${i}].${rest}`;

	// A selection or a visible issue on one of the detail fields opens that row's line
	// and leaves it open, so typing in the field never pulls it away.
	// It opens when something starts pointing into the line, once: the author closing it
	// by hand while the pointer is still there must not have it reopen.
	const pointedBefore = new Set<string>();
	$effect(() => {
		if (!answers.detail_offered) return;
		const now = new Set<string>();
		for (const row of answers.rows) {
			if (!row.pointed) continue;
			now.add(row.key);
			if (!pointedBefore.has(row.key)) untrack(() => store.ui.setDetail(detailKey(row.key), true));
		}
		pointedBefore.clear();
		for (const key of now) pointedBefore.add(key);
	});

	/**
	 * Opens an answer's detail line and puts the cursor in its first field, which is
	 * "Kam dál" for a branching question. Used by the summary line under the answer.
	 */
	async function openDetail(key: string, i: number) {
		store.ui.setDetail(detailKey(key), true);
		await tick();
		document
			.getElementById(`${uid}-detail-${i}`)
			?.querySelector<HTMLElement>('button, input, textarea, [role="radio"]')
			?.focus();
	}

	const set = (optionId: string, field: string, value: unknown) =>
		store.apply((d) =>
			setField(d, { blockId: block.block_id, stepId: step.id, optionId, field }, value)
		);

	/** One place up (-1) or down (1); the ends stay where they are. */
	function move(index: number, by: -1 | 1) {
		const ids = options.map((o) => o.id);
		const to = index + by;
		if (to < 0 || to >= ids.length) return;
		[ids[index], ids[to]] = [ids[to], ids[index]];
		store.apply((d) => reorderOptions(d, block.block_id, step.id, ids));
	}

	/**
	 * What the last change cut off, said under the answer that was changed: the model's
	 * `notices.cut_off`, which the store keeps while that change is the last edit
	 * (`store.trackReach`). `option_id` is empty for a removed answer, which has no row
	 * left.
	 */
	const cutOffNow = $derived(store.screen.notices.cut_off);

	function toggleChecked(optionId: string) {
		const option = options.find((o) => o.id === optionId);

		if (answers.fixed) {
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

{#snippet cutOffLine(text: string)}
	<p class="cut-off" role="status">
		<span data-screen="notices.cut_off.text">{text}</span>
		<span aria-hidden="true"> · </span>
		<button type="button" class="undo" onclick={() => store.undo()}>Vrátit zpět</button>
	</p>
{/snippet}

<div class="answers" class:bare={!answers.headed} style:--answer-tracks={answers.tracks}>
	{#if answers.headed}
		<div class="head" aria-hidden="true">
			<span></span>
			<span>Odpověď</span>
			{#if answers.feedback_column}<span>Co se žák dozví</span>{/if}
			<span></span>
		</div>
	{/if}

	{#each answers.rows as row, i (row.key)}
		<div class="row">
			<div class="cell">
				<button
					type="button"
					class="verb"
					class:correct={row.correct}
					class:multiple
					aria-pressed={row.correct}
					aria-label={row.correct_label}
					title={row.correct_title}
					onclick={() => toggleChecked(row.id)}
				>
					<!-- The mark of a radio button, or of a checkbox when several may be picked. -->
					<span class="mark-box">
						{#if row.correct}<Check size={14} strokeWidth={3} />{/if}
					</span>
				</button>
			</div>

			<div class="cell text">
				<FocusField
					label={row.text.label}
					value={row.text.value}
					emptyText={row.text.empty_text}
					onchange={(v) => set(row.id, 'text', v ?? '')}
					disabled={row.text.disabled}
					ref={row.text.ref}
					screen={rowScreen(i, 'text.value')}
				/>
				{#if !row.open}
					{#if row.summary.length > 0}
						<button
							type="button"
							class="set-values"
							aria-controls="{uid}-detail-{i}"
							aria-expanded="false"
							title="Upravit podrobnosti odpovědi"
							onclick={() => openDetail(row.key, i)}
						>
							{#each row.summary as part, j (j)}
								{#if j > 0}<span aria-hidden="true"> · </span>{/if}
								<span class="set-value">
									{#if part.branch}<CornerDownRight size={12} aria-label="Kam dál:"
										></CornerDownRight>{/if}<span data-screen={rowScreen(i, `summary[${j}].text`)}
										>{part.text}</span
									>
								</span>
							{/each}
						</button>
					{/if}
				{/if}
				{#if cutOffNow !== null && cutOffNow.option_id === row.id}
					{@render cutOffLine(cutOffNow.text)}
				{/if}
			</div>

			{#if row.feedback}
				<div class="cell feedback">
					<FocusField
						label={row.feedback.label}
						value={row.feedback.value}
						multiline
						emptyText={row.feedback.empty_text}
						ref={row.feedback.ref}
						onchange={(v) => set(row.id, 'feedback', v)}
						screen={rowScreen(i, 'feedback.value')}
					/>
				</div>
			{/if}

			<div class="cell actions">
				{#if answers.detail_offered}
					<button
						type="button"
						class="more"
						class:open={row.open}
						aria-expanded={row.open}
						aria-controls="{uid}-detail-{i}"
						aria-label={row.more_label}
						title="Podrobnosti odpovědi"
						onclick={() => store.ui.setDetail(detailKey(row.key), !row.open)}
					>
						<ChevronRight size={14} aria-hidden="true" />
					</button>
				{/if}
				{#if row.trash}
					<span class="trash">
						<Button
							variant="ghost"
							size="s"
							disabled={row.trash.disabled}
							title={row.trash.title}
							ariaLabel={row.trash.label}
							onclick={() =>
								store.trackReach('', () =>
									withUndoNotice(
										store,
										'Odpověď smazána.',
										() => store.apply((d) => deleteOption(d, block.block_id, step.id, row.id)),
										{
											lessonId: store.open.lesson?.lesson_id,
											blockId: block.block_id,
											stepId: step.id
										}
									)
								)}
						>
							<Trash size={14}></Trash>
						</Button>
					</span>
				{/if}
			</div>

			{#if answers.detail_offered && row.open}
				<div class="detail" id="{uid}-detail-{i}" role="group" aria-label="Podrobnosti odpovědi">
					{#if row.detail.branch}
						<div class="field">
							<span class="label">Kam dál</span>
							<GoToPicker
								branch={row.detail.branch}
								screen={rowScreen(i, 'detail.branch.shown')}
								onchange={(v) => store.trackReach(row.id, () => set(row.id, 'go_to', v))}
							/>
						</div>
					{/if}
					{#if row.detail.marks}
						<div class="field">
							<span class="label">Známka</span>
							<Segmented
								label="Známka za tuto odpověď"
								options={row.detail.marks.options}
								value={row.detail.marks.value}
								onchange={(v) => set(row.id, 'mark', v || undefined)}
							/>
						</div>
					{/if}
					{#if row.detail.order}
						<div class="field">
							<span class="label">Pořadí</span>
							<span class="moves">
								<Button
									variant="secondary"
									size="s"
									disabled={row.detail.order.up_disabled}
									ariaLabel={row.detail.order.up_label}
									onclick={() => move(i, -1)}
								>
									<ArrowUp size={14} aria-hidden="true"></ArrowUp>
									Posunout nahoru
								</Button>
								<Button
									variant="secondary"
									size="s"
									disabled={row.detail.order.down_disabled}
									ariaLabel={row.detail.order.down_label}
									onclick={() => move(i, 1)}
								>
									<ArrowDown size={14} aria-hidden="true"></ArrowDown>
									Posunout dolů
								</Button>
							</span>
						</div>
					{/if}
					{#if row.detail.score}
						<div class="field score">
							<span class="label">Podíl bodů</span>
							<NumberField
								label={row.detail.score.label}
								value={row.detail.score.value === '' ? undefined : row.detail.score.value}
								emptyText={row.detail.score.empty_text}
								ref={row.detail.score.ref}
								screen={rowScreen(i, 'detail.score.value')}
								onwrite={(v) => set(row.id, 'score_koef', v)}
							/>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

	{#if cutOffNow !== null && cutOffNow.option_id === ''}
		{@render cutOffLine(cutOffNow.text)}
	{/if}

	{#each answers.list_issues as issue, i (i)}
		<p
			class="list-issue"
			class:warning={issue.severity === 'warning'}
			data-screen="{screen}.list_issues[{i}].message"
		>
			{issue.message}
		</p>
	{/each}

	{#if answers.can_add}
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

	.set-value {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	/*
	 * The line under an answer is a button that looks like a caption: quiet at rest,
	 * and a tinted pill with an underline when it is pointed at or focused, so it
	 * reads as something to click without a border on every row.
	 */
	.set-values {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 3px;
		margin: 2px 0 0 -2px;
		padding: 1px 6px;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		font: inherit;
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		transition:
			background 120ms,
			color 120ms;
	}

	.set-values:hover,
	.set-values:focus-visible {
		background: var(--surface);
		color: var(--e-text);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.set-values:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}

	.cut-off {
		margin: 4px 0 0;
		padding: 0 6px;
		color: var(--e-warning);
		font-size: var(--text-xs);
	}

	.undo {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-weight: var(--weight-semibold);
		text-decoration: underline;
		cursor: pointer;
	}

	.undo:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
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
		opacity: 0.45;
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
     * Removing an answer is rare, so its button is faint (like the step handle) and
     * full when the row is pointed at or worked in, red only under the pointer.
     */
	.trash {
		display: inline-flex;
		opacity: 0.45;
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

	.moves {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.add {
		align-self: flex-start;
		margin-top: 6px;
	}
</style>
