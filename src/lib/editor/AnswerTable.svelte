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
	 */
	import { parseNumberInput } from '$lib/domain/number-input';
	import { tick, untrack } from 'svelte';
	import type { BlockStep, BlockV2, CourseV2 } from '$lib/domain/schema';
	import FocusField from '$lib/ui/FocusField.svelte';
	import RichField from '$lib/ui/RichField.svelte';
	import { INLINE, SNIFFED } from '$lib/domain/markdown';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import GoToPicker, { blockLabelOf, goToSummary } from './GoToPicker.svelte';
	import { sectionTargeted } from '$lib/ui/settings-target';
	import { useStore } from '$lib/ui/context';
	import { uniqueKeys } from '$lib/ui/keys';
	import { allows } from '$lib/ui/fields';
	import { madeUnreachable } from '$lib/ui/issue-visibility';
	import type { UndoEntry } from '$lib/state/doc-store.svelte';
	import { addOption, deleteOption, reorderOptions, setField } from '$lib/domain/commands';
	import { optionOutcomesApply } from '$lib/domain/derive';
	import { MIN_CHOICE_OPTIONS } from '$lib/domain/validate';
	import { Check, ChevronRight, CornerDownRight, GripVertical, Plus, Trash } from '@lucide/svelte';
	import { withUndoNotice } from './undo-notice';

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
	// A true/false pair has no order to change.
	const movable = $derived(!fixedOptions && options.length > 1);
	// The detail line exists only when at least one of its fields does. Reordering
	// lives on each row's own handle, so it no longer keeps the line alive.
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
			// Untracked: closing the line by hand must not re-run this and reopen it.
			if (pointed) untrack(() => (opened[optionKeys[i]] = true));
		}
	});

	/**
	 * Reordering an answer is a pointer drag on its own handle. It is done here, not
	 * with `svelte-dnd-action`, because an answer list is a drag zone nested inside a
	 * step — itself an item of the card's step zone — and the library keeps one drag
	 * per page in module state: the inner `dragHandleZone` subscribing to that state
	 * resets it on the step's handle press, so the step drag never starts. The pointer
	 * events here touch nothing shared, and the command is the same `reorderOptions`.
	 */
	let rowsEl = $state<HTMLDivElement | null>(null);
	/** The carried answer: where it came from and the gap it would drop into. */
	let drag = $state<{ id: string; from: number; to: number; moved: boolean } | null>(null);

	/** The index the carried answer would land in: how many rows end above the pointer. */
	function dropIndexFor(clientY: number): number {
		const rows = rowsEl?.querySelectorAll<HTMLElement>(':scope > .row') ?? [];
		let to = 0;
		for (const row of rows) {
			const rect = row.getBoundingClientRect();
			if (clientY > rect.top + rect.height / 2) to++;
		}
		return to;
	}

	/**
	 * The press on a handle, carried on the handle itself with pointer capture, so the
	 * row under the pointer is never the one that decides the drop. A press that moves
	 * less than the threshold is not a drag, and a drop where it started is not an edit.
	 */
	function dragStart(event: PointerEvent, index: number) {
		if (event.button !== 0) return;
		const option = options[index];
		if (option === undefined) return;
		event.preventDefault();
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const startY = event.clientY;
		drag = { id: option.id, from: index, to: index, moved: false };

		const move = (e: PointerEvent) => {
			if (drag === null) return;
			drag = {
				...drag,
				to: dropIndexFor(e.clientY),
				moved: drag.moved || Math.abs(e.clientY - startY) > 4
			};
		};
		const finish = (e: PointerEvent) => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', finish);
			handle.removeEventListener('pointercancel', finish);
			if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
			const committed = drag;
			drag = null;
			if (committed === null || !committed.moved) return;
			const ids = options.map((o) => o.id);
			const [moved] = ids.splice(committed.from, 1);
			ids.splice(committed.to > committed.from ? committed.to - 1 : committed.to, 0, moved);
			store.apply((d) => reorderOptions(d, block.block_id, step.id, ids));
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', finish);
		handle.addEventListener('pointercancel', finish);
	}

	/**
	 * Opens an answer's detail line and puts the cursor in its first field, which is
	 * "Kam dál" for a branching question. Used by the summary line under the answer.
	 */
	async function openDetail(key: string, i: number) {
		opened[key] = true;
		await tick();
		document
			.getElementById(`${uid}-detail-${i}`)
			?.querySelector<HTMLElement>('button, input, textarea, [role="radio"]')
			?.focus();
	}

	/**
	 * What is set on an answer, in a few words; defaults say nothing. Where the answer
	 * leads is drawn with the branch icon, not a typed arrow.
	 */
	function summaryOf(option: (typeof options)[number]): { text: string; branch?: true }[] {
		const parts: { text: string; branch?: true }[] = [];
		if (branching) {
			const where = goToSummary(doc, block, option.go_to, showIds, store.index);
			if (where !== '') parts.push({ text: where, branch: true });
		}
		if (quizMarks && option.mark !== undefined && option.mark !== '') {
			parts.push({ text: `známka ${option.mark}` });
		}
		if (advanced && option.score_koef !== undefined) {
			parts.push({ text: `podíl bodů ${option.score_koef}` });
		}
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
	// Shared, content-independent tracks keep headings and all rows aligned. The grip
	// track is only there when answers can be reordered.
	const tracks = $derived(
		[
			...(movable ? ['1.25rem'] : []),
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

	/** One place up (-1) or down (1); the ends stay where they are. */
	function move(index: number, by: -1 | 1) {
		const ids = options.map((o) => o.id);
		const to = index + by;
		if (to < 0 || to >= ids.length) return;
		[ids[index], ids[to]] = [ids[to], ids[index]];
		store.apply((d) => reorderOptions(d, block.block_id, step.id, ids));
	}

	/**
	 * The arrow keys on a row's handle move the answer — the keyboard's way to the same
	 * command a drag sends. Focus is given back to the handle the DOM reorders around.
	 */
	function grabbed(handle: HTMLElement, optionId: string) {
		const key = async (event: KeyboardEvent) => {
			if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
			event.preventDefault();
			event.stopPropagation();
			const index = options.findIndex((o) => o.id === optionId);
			if (index < 0) return;
			move(index, event.key === 'ArrowUp' ? -1 : 1);
			// Moving a node in the DOM can drop its focus; give it back to the same handle.
			await tick();
			handle.focus();
		};
		handle.addEventListener('keydown', key);
		return {
			destroy() {
				handle.removeEventListener('keydown', key);
			}
		};
	}

	/**
	 * What the last change cut off: the step or card nothing leads to any more, said
	 * under the answer that was changed. It lives as long as that change is the last
	 * edit, so the next one of any kind clears it, and "Vrátit zpět" can only ever undo
	 * this change. `optionId` is empty for a removed answer, which has no row left.
	 */
	let cutOff = $state<{ entry: UndoEntry; optionId: string; text: string } | null>(null);
	const cutOffNow = $derived(
		cutOff !== null && store.undoStack.at(-1) === cutOff.entry ? cutOff : null
	);

	/** "Krok 3", the card's name: the words the summary line and the picker use. */
	function lostName(issue: ReturnType<typeof madeUnreachable>[number]): string {
		const target = doc.blocks.find((b) => b.block_id === issue.ref.blockId);
		if (target === undefined) return '';
		if (issue.ref.stepId === undefined) return `karta „${blockLabelOf(doc, target, showIds)}“`;
		const position = target.steps.findIndex((s) => s.id === issue.ref.stepId) + 1;
		return showIds ? issue.ref.stepId : `Krok ${position}`;
	}

	/** Runs `change`; if it left something unreachable that was reachable, remembers it. */
	function withReachNotice(optionId: string, change: () => void) {
		const before = store.doc;
		const top = store.undoStack.at(-1);
		change();
		const entry = store.undoStack.at(-1);
		cutOff = null;
		if (entry === undefined || entry === top) return;
		const lost = madeUnreachable(before, store.doc);
		if (lost.length === 0) return;
		const names = lost.map(lostName).filter((n) => n !== '');
		if (names.length === 0) return;
		const shown = names.length > 3 ? [...names.slice(0, 3), 'další'] : names;
		const list =
			shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} a ${shown.at(-1)}`;
		const many = lost.length > 1;
		// A step is "ho", a card "ji", several "je".
		const pronoun = many ? 'je' : lost[0].ref.stepId === undefined ? 'ji' : 'ho';
		const head = showIds ? list : `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
		const text = `${head} teď ${many ? 'nikam nevedou' : 'nikam nevede'} — žák ${pronoun} neuvidí`;
		cutOff = { entry, optionId, text };
	}

	const MARKS = [
		{ value: '', label: 'Bez známky' },
		...['1', '2', '3', '4', '5'].map((m) => ({ value: m, label: m }))
	];

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

{#snippet cutOffLine(text: string)}
	<p class="cut-off" role="status">
		{text}
		<span aria-hidden="true"> · </span>
		<button type="button" class="undo" onclick={() => store.undo()}>Vrátit zpět</button>
	</p>
{/snippet}

<div class="answers" class:bare={!headed} style:--answer-tracks={tracks}>
	{#if headed}
		<div class="head" aria-hidden="true">
			{#if movable}<span></span>{/if}
			<span></span>
			<span>Odpověď</span>
			{#if feedback}<span>Co se žák dozví</span>{/if}
			<span></span>
		</div>
	{/if}

	<div class="rows" bind:this={rowsEl}>
		{#each options as option, i (optionKeys[i])}
			{@const key = optionKeys[i]}
			<div
				class="row"
				class:dragged={drag !== null && drag.moved && drag.id === option.id}
				class:drop-before={drag !== null && drag.moved && drag.to === i}
				class:drop-after={drag !== null &&
					drag.moved &&
					drag.to === options.length &&
					i === options.length - 1}
			>
				{#if movable}
					<div class="cell grip-cell">
						<button
							type="button"
							class="grip"
							onpointerdown={(event) => dragStart(event, i)}
							use:grabbed={option.id}
							aria-label={`Přesunout odpověď: ${option.text || 'bez textu'}`}
							title="Přetažením (nebo šipkami nahoru a dolů) změníš pořadí odpovědí"
						>
							<GripVertical size={16} aria-hidden="true" />
						</button>
					</div>
				{/if}
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
					<RichField
						label="Text odpovědi"
						dialect={INLINE}
						value={option.text}
						emptyText="Napiš odpověď…"
						onchange={(v) => set(option.id, 'text', v ?? '')}
						disabled={fixedOptions}
						ref={ref(option.id, 'text')}
					/>
					{#if !isOpen(key)}
						{@const summary = summaryOf(option)}
						{#if summary.length > 0}
							<button
								type="button"
								class="set-values"
								aria-controls="{uid}-detail-{i}"
								aria-expanded="false"
								title="Upravit podrobnosti odpovědi"
								onclick={() => openDetail(key, i)}
							>
								{#each summary as part, j (j)}
									{#if j > 0}<span aria-hidden="true"> · </span>{/if}
									<span class="set-value">
										{#if part.branch}<CornerDownRight size={12} aria-label="Kam dál:"
											></CornerDownRight>{/if}{part.text}
									</span>
								{/each}
							</button>
						{/if}
					{/if}
					{#if cutOffNow !== null && cutOffNow.optionId === option.id}
						{@render cutOffLine(cutOffNow.text)}
					{/if}
				</div>

				{#if feedback}
					<div class="cell feedback">
						<RichField
							label="Zpětná vazba k této odpovědi"
							dialect={SNIFFED}
							value={option.feedback}
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
							class:open={isOpen(key)}
							aria-expanded={isOpen(key)}
							aria-controls="{uid}-detail-{i}"
							aria-label={`Podrobnosti odpovědi ${option.text || 'bez textu'}`}
							title="Podrobnosti odpovědi"
							onclick={() => (opened[key] = !isOpen(key))}
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
									withReachNotice('', () =>
										withUndoNotice(
											store,
											'Odpověď smazána.',
											() => store.apply((d) => deleteOption(d, block.block_id, step.id, option.id)),
											{
												lessonId: store.selection?.lessonId,
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

				{#if detailOffered && isOpen(key)}
					<div class="detail" id="{uid}-detail-{i}" role="group" aria-label="Podrobnosti odpovědi">
						{#if branching}
							<div class="field">
								<span class="label">Kam dál</span>
								<GoToPicker
									{doc}
									{block}
									stepId={step.id}
									value={option.go_to}
									onchange={(v) => withReachNotice(option.id, () => set(option.id, 'go_to', v))}
								/>
							</div>
						{/if}
						{#if quizMarks}
							<div class="field">
								<span class="label">Známka</span>
								<Segmented
									label="Známka za tuto odpověď"
									options={MARKS}
									value={option.mark ?? ''}
									onchange={(v) => set(option.id, 'mark', v || undefined)}
								/>
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
									onchange={(v) => {
										// Empty is unset; a comma is a decimal; text is not written.
										const value = parseNumberInput(v);
										if (v === undefined || v.trim() === '' || value !== undefined)
											set(option.id, 'score_koef', value);
									}}
								/>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if cutOffNow !== null && cutOffNow.optionId === ''}
		{@render cutOffLine(cutOffNow.text)}
	{/if}

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

	/* The drag zone: its direct children are the answers, so it is the rows alone. */
	.rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
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
		transition: background 0.2s ease-in-out;
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

	/*
	 * Reordering an answer is a drag, so the handle sits at the row's edge, faint
	 * until the row is pointed at or worked in (like a step's grip and the trash).
	 * A screen with no hover shows it full.
	 */
	.grip-cell {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.grip {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		border: none;
		border-radius: var(--radius-s);
		background: none;
		color: var(--e-text-faint);
		opacity: 0.45;
		transition:
			opacity 120ms,
			background 120ms;
		cursor: grab;
		touch-action: none;
		height: 36px;
	}

	/* Drag feedback: the carried row fades, and a line shows the gap it drops into. */
	.dragged {
		opacity: 0.4;
	}

	.row.dragged .grip {
		cursor: grabbing;
	}

	.drop-before {
		box-shadow: inset 0 2px 0 var(--e-focus-ring);
	}

	.drop-after {
		box-shadow: inset 0 -2px 0 var(--e-focus-ring);
	}

	.row:hover .grip,
	.row:focus-within .grip,
	.grip:hover,
	.grip:focus-visible {
		opacity: 1;
	}

	.grip:hover,
	.grip:focus-visible {
		color: var(--e-text);
		background: var(--surface);
	}

	.grip:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}

	@media (hover: none) {
		.grip {
			opacity: 1;
		}
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

		/* The handle is not a field: no caption line above it. */
		.grip-cell::before {
			display: none;
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
		height: 36px;
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

	.add {
		align-self: flex-start;
		margin-top: 6px;
	}
</style>
