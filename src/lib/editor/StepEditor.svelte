<script lang="ts">
	/**
	 * One step of a block. The controls follow the step type (§7.1), and the question
	 * controls follow the question type (§8.3) — the author never picks a renderer,
	 * they pick what they are adding.
	 *
	 * What is drawn is the model's (`store.screen.card`, `screen/card.ts`): the name, the
	 * summary, whether the step is open, which fields the mode shows and what each says.
	 * This writes what the teacher does, keeps focus and scroll, and holds the little
	 * state a remount must not lose (the media previews' debounce).
	 */
	import type { BlockStep, BlockV2, QuestionType } from '$lib/domain/schema';
	import type { StepView } from '$lib/screen/types';
	import FocusField from '$lib/ui/FocusField.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Toggle from '$lib/ui/Toggle.svelte';
	import AnswerTable from './AnswerTable.svelte';
	import { markdownEditor } from '$lib/ui/codemirror';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import { useStepView, useStore } from '$lib/ui/context';
	import { dragHandle } from 'svelte-dnd-action';
	import { tick, untrack } from 'svelte';
	import Button from '$lib/ui/Button.svelte';
	import {
		CommandError,
		deleteStep,
		duplicateStep,
		setField,
		setQuestionType,
		moveStep
	} from '$lib/domain/commands';
	import {
		Check,
		ChevronDown,
		ArrowDown,
		ArrowUp,
		ChevronRight,
		Ellipsis,
		Copy,
		CornerDownRight,
		GripVertical,
		Grid2X2,
		Hash,
		PencilLine,
		Trash
	} from '@lucide/svelte';
	import type { Component } from 'svelte';
	import SettingsSection from '$lib/ui/SettingsSection.svelte';
	import { STEP_TYPES } from '$lib/lang';
	import { withUndoNotice } from './undo-notice';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';

	interface Props {
		block: BlockV2;
		step: BlockStep;
		/** The model's step: `store.screen.card.card.steps[index]`. */
		view: StepView;
		/** Its place in the model, for `data-screen`. */
		screen: string;
		/** The lesson the card is open in, so that focusing a step keeps it there. */
		lessonId?: string;
		/** A press on the drag handle, before the drag begins (`CardEditor.grab`). */
		ongrab: (handle: HTMLElement) => void;
		onrepair: (blockId: string, stepId: string) => void;
	}
	let { block, step, view, screen, lessonId, ongrab, onrepair }: Props = $props();

	const store = useStore();
	const typeInfo = $derived(STEP_TYPES.find((t) => t.type === step.type));
	const question = $derived(view.question);
	const at = (rest: string) => `${screen}.${rest}`;

	/** Reads a dotted path off the step, for the extras' fields. */
	const set = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { blockId: block.block_id, stepId: step.id, field }, value));
	const setQuestion = (path: string, value: unknown) => set(`question.${path}`, value);

	const QUESTION_ICONS: Record<QuestionType, Component> = {
		multiple_choice: Grid2X2,
		true_false: Check,
		open: PencilLine,
		numeric: Hash
	};

	/**
	 * Switching the type asks first when the model says the change would throw away
	 * something the teacher wrote (`QuestionView.types[].confirm`); otherwise it applies
	 * straight away.
	 */
	function requestQuestionType(type: QuestionType) {
		const choice = question?.types.find((t) => t.value === type);
		if (choice === undefined) return;
		if (choice.confirm) {
			store.ui.dialog = { kind: 'type_change', blockId: block.block_id, stepId: step.id, type };
		} else {
			store.apply((d) => setQuestionType(d, block.block_id, step.id, type));
		}
	}

	/**
	 * The `<img>`/`<video>`/`<audio>` preview must not re-fetch on every keystroke, but
	 * it must not lag behind a change the author didn't type either — undo, import and
	 * opening a different step replace the whole url at once and should show up right
	 * away. `type()` is called from the field's own `onchange`, so it stamps `pending`
	 * before the store round-trips back into `step`'s prop; the effect below then reads
	 * "this echo matches what I just typed, the debounce already has it" from "this
	 * wasn't typed here, show it now" by comparing against that stamp.
	 */
	function debouncedMediaPreview(read: () => string | undefined) {
		let preview = $state(read());
		let pending: string | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		$effect(() => {
			const current = read();
			if (current === pending) return;
			clearTimeout(timer);
			pending = current;
			preview = current;
		});
		return {
			get value() {
				return preview;
			},
			/** Called on every keystroke; settles into the preview after a short pause. */
			type(v: string | undefined) {
				pending = v;
				clearTimeout(timer);
				timer = setTimeout(() => {
					preview = v;
				}, 450);
			},
			/** Called on blur — no reason to make the teacher wait once they've moved on. */
			flush(v: string | undefined) {
				pending = v;
				clearTimeout(timer);
				preview = v;
			}
		};
	}

	const imagePreview = debouncedMediaPreview(() => step.image?.url);
	const videoPreview = debouncedMediaPreview(() => step.video?.url);
	const audioPreview = debouncedMediaPreview(() => step.audio?.url);

	function remove() {
		try {
			withUndoNotice(
				store,
				'Krok smazán.',
				() => store.apply((d) => deleteStep(d, block.block_id, step.id)),
				{ lessonId: store.open.lesson?.lesson_id, blockId: block.block_id, stepId: step.id }
			);
		} catch (error) {
			if (error instanceof CommandError) onrepair(block.block_id, step.id);
			else throw error;
		}
	}

	// Highlight and scroll to this step when something outside the editor points at
	// it — a click in the preview, a jump from the validation panel.
	let root = $state<HTMLElement | null>(null);
	const targeted = $derived(view.targeted);
	$effect(() => {
		// Depends on the reveal counter, not on the selection: typing also moves the
		// selection, and scrolling on every keystroke would be unusable. A reveal is
		// answered once — this step may remount afterwards (a drag remounts it twice)
		// and must not pull the page back to itself when it does.
		const reveal = store.reveal;
		if (!targeted || root === null) return;
		if (untrack(() => stepView.revealHandled) === reveal) return;
		stepView.revealHandled = reveal;
		root.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});

	/**
	 * Open or folded is decided in one place (`ui/step-expansion.ts`) from state that
	 * outlives this component (`state/step-view.svelte.ts`): the author's chevron,
	 * whether the selection is here, and whether a step is being dragged. The model
	 * reads it (`view.expanded`).
	 */
	const stepView = useStepView();
	const collapsed = $derived(!view.expanded);

	/** One place up or down — the buttons' and the handle's arrow keys' version of a drag. */
	async function move(delta: -1 | 1) {
		const place = block.steps.findIndex((s) => s.id === step.id);
		const to = place + delta;
		if (place < 0 || to < 0 || to >= block.steps.length) return;
		const focusGrip = root?.contains(document.activeElement) ?? false;
		store.apply((d) => moveStep(d, block.block_id, step.id, delta));
		// Moving a node in the DOM can drop its focus; give it back to the same handle.
		if (focusGrip) {
			await tick();
			root?.querySelector<HTMLElement>('.grip')?.focus();
		}
	}

	/**
	 * The press on the handle, as a listener on the handle itself. A delegated
	 * `onmousedown` never arrives: `svelte-dnd-action` handles the same press on the
	 * step's wrapper, below the root where Svelte listens, and stops it there.
	 */
	function grabbed(handle: HTMLElement) {
		const press = () => ongrab(handle);
		const key = (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') ongrab(handle);
			else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
				event.preventDefault();
				event.stopPropagation();
				move(event.key === 'ArrowUp' ? -1 : 1);
			}
		};
		handle.addEventListener('mousedown', press);
		handle.addEventListener('touchstart', press);
		handle.addEventListener('keydown', key);
		return {
			destroy() {
				handle.removeEventListener('mousedown', press);
				handle.removeEventListener('touchstart', press);
				handle.removeEventListener('keydown', key);
			}
		};
	}

	/**
	 * Working in a step focuses it: the selection moves here, which is what opens a
	 * folded step, outlines it in the preview, and folds it again once the author
	 * moves on. Only the body counts — the header's buttons act on the step without
	 * being "in" it, and the drag handle must not open the step it is moving.
	 */
	function focusStep() {
		const selection = store.selection;
		if (selection?.blockId === block.block_id && selection?.stepId === step.id) return;
		store.selection = {
			...(lessonId !== undefined ? { lessonId } : {}),
			blockId: block.block_id,
			stepId: step.id
		};
	}
</script>

<article bind:this={root} class="step" class:invalid={view.invalid} class:targeted class:collapsed>
	<header>
		<button
			type="button"
			class="grip"
			use:dragHandle
			aria-label={view.grip_label}
			title="Přetažením (nebo šipkami nahoru a dolů) změníš pořadí kroků"
			use:grabbed
		>
			<GripVertical size={16}></GripVertical>
		</button>
		<Chip
			tone="quiet"
			title={collapsed ? 'Rozbalit krok' : 'Sbalit krok'}
			onclick={() => stepView.toggle(block.block_id, view.key, step.id, store.selection)}
		>
			{#if collapsed}
				<ChevronRight size={16}></ChevronRight>
			{:else}
				<ChevronDown size={16}></ChevronDown>
			{/if}
		</Chip>

		<!--
            One quiet fact instead of two chips: what kind of step, and which. "Krok N"
            stays in its own span — a teacher finds a step by its place, and never sees
            an id (§8), which only the advanced mode shows in its place.
        -->
		<Chip tone="quiet" title={view.name_title ?? undefined}>
			{#if typeInfo}
				{@const Icon = typeInfo.icon}
				<Icon size={14}></Icon>
			{/if}
			<span data-screen={at('name')}>{view.name}</span>
			<span> · <span data-screen={at('type_label')}>{view.type_label}</span></span>
		</Chip>
		{#if view.inbound_branches > 0}
			<Chip tone="accent" title="Na tento krok vede větvení z jiné odpovědi">
				<CornerDownRight size={14}></CornerDownRight>
				<span data-screen={at('inbound_branches')}>{view.inbound_branches}</span>
			</Chip>
		{/if}

		{#if collapsed}
			<!-- Clicking the summary looks inside without unfolding for good. -->
			<button
				type="button"
				class="summary"
				title="Zobrazit krok"
				data-screen={at('summary')}
				onclick={focusStep}>{view.summary}</button
			>
		{:else}
			<div class="spacer"></div>
		{/if}
		<!-- Out of the way until the step is the one being worked on. -->
		<div class="actions">
			<Menu label="Další akce s krokem" icon={Ellipsis} placement="bottom-end">
				<MenuItem icon={ArrowUp} onclick={() => move(-1)} disabled={view.move.up_disabled}>
					Posunout nahoru
				</MenuItem>
				<MenuItem icon={ArrowDown} onclick={() => move(1)} disabled={view.move.down_disabled}>
					Posunout dolů
				</MenuItem>
			</Menu>
			<Button
				variant="ghost"
				size="s"
				onclick={() => store.apply((d, r) => duplicateStep(d, block.block_id, step.id, r))}
				title="Duplikovat krok"
				ariaLabel="Duplikovat krok"
			>
				<Copy size={16}></Copy>
			</Button>
			<Button
				variant="danger"
				size="s"
				onclick={remove}
				title="Smazat krok"
				ariaLabel="Smazat krok"
			>
				<Trash size={16}></Trash>
			</Button>
		</div>
	</header>

	{#if !collapsed}
		<div
			class="body"
			role="group"
			aria-label={view.body_label}
			onfocusin={focusStep}
			onpointerdown={focusStep}
		>
			{#if step.type === 'text' && view.content}
				<div
					class="markdown"
					class:invalid={view.content.missing_text !== null}
					use:markdownEditor={{
						value: view.content.value,
						placeholder: view.content.placeholder,
						onchange: (v) => set('content', v === '' ? undefined : v),
						onbeginedit: () => store.beginEdit(),
						onendedit: () => store.endEdit()
					}}
				></div>
				{#if view.content.missing_text}
					<p class="missing-text" data-screen={at('content.missing_text')}>
						{view.content.missing_text}
					</p>
				{/if}
			{:else if view.media?.kind === 'image'}
				<div class="media">
					<FocusField
						label={view.media.url.label}
						value={view.media.url.value}
						emptyText={view.media.url.empty_text}
						monospace
						onchange={(v) => {
							set('image.url', v ?? '');
							imagePreview.type(v ?? '');
						}}
						ref={view.media.url.ref}
						screen={at('media.url.value')}
						onblur={() => imagePreview.flush(step.image?.url ?? '')}
					/>
					<!-- Nothing to describe until there is a picture. -->
					{#if view.media.alt}
						<FocusField
							label={view.media.alt.label}
							value={view.media.alt.value}
							emptyText={view.media.alt.empty_text}
							ref={view.media.alt.ref}
							screen={at('media.alt.value')}
							onchange={(v) => set('image.alt', v)}
						/>
					{/if}
					{#if imagePreview.value}
						<img src={imagePreview.value} alt={step.image?.alt ?? ''} />
					{/if}
				</div>
			{:else if view.media?.kind === 'video'}
				<div class="media">
					<FocusField
						label={view.media.url.label}
						value={view.media.url.value}
						emptyText={view.media.url.empty_text}
						monospace
						onchange={(v) => {
							set('video.url', v ?? '');
							videoPreview.type(v ?? '');
						}}
						ref={view.media.url.ref}
						screen={at('media.url.value')}
						onblur={() => videoPreview.flush(step.video?.url ?? '')}
					/>
					{#if view.media.page_link_warning}
						<!--
					§14 E_MEDIA_NOT_DIRECT fires on export, but by then the teacher has
					already pasted the wrong thing and moved on. Catching it here, next to
					the field, is what turns "proč se to nepřehrává" into a one-line fix.
				-->
						<p class="field-hint warning" data-screen={at('media.page_link_warning')}>
							{view.media.page_link_warning}
						</p>
					{/if}
					{#if videoPreview.value}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={videoPreview.value} controls></video>
					{/if}
				</div>
			{:else if view.media?.kind === 'audio'}
				<div class="media">
					<FocusField
						label={view.media.url.label}
						value={view.media.url.value}
						emptyText={view.media.url.empty_text}
						monospace
						onchange={(v) => {
							set('audio.url', v ?? '');
							audioPreview.type(v ?? '');
						}}
						ref={view.media.url.ref}
						screen={at('media.url.value')}
						onblur={() => audioPreview.flush(step.audio?.url ?? '')}
					/>
					{#if audioPreview.value}<audio src={audioPreview.value} controls></audio>{/if}
				</div>
			{:else if step.type === 'question' && view.content && question}
				<div class="question">
					<div
						class="markdown"
						use:markdownEditor={{
							value: view.content.value,
							placeholder: view.content.placeholder,
							onchange: (v) => set('content', v === '' ? undefined : v),
							onbeginedit: () => store.beginEdit(),
							onendedit: () => store.endEdit()
						}}
					></div>

					<div class="question-type">
						<Segmented
							label="Typ otázky"
							options={question.types.map((t) => ({
								value: t.value,
								label: t.label,
								title: t.title,
								icon: QUESTION_ICONS[t.value]
							}))}
							value={question.type}
							onchange={requestQuestionType}
						/>
					</div>

					{#if question.correct_answer}
						<div class="field-row">
							<span class="field-label">Správná odpověď</span>
							<FocusField
								label={question.correct_answer.label}
								value={question.correct_answer.value}
								emptyText={question.correct_answer.empty_text}
								ref={question.correct_answer.ref}
								screen={at('question.correct_answer.value')}
								onchange={(v) => set('question.correct_answer', v)}
							/>
						</div>
					{:else if question.correct_number && question.tolerance}
						<div class="field-row">
							<span class="field-label">Správný výsledek</span>
							<NumberField
								label={question.correct_number.label}
								value={question.correct_number.value === ''
									? undefined
									: question.correct_number.value}
								emptyText={question.correct_number.empty_text}
								ref={question.correct_number.ref}
								screen={at('question.correct_number.value')}
								onwrite={(v) => set('question.correct_number', v)}
							/>
						</div>
						<div class="field-row">
							<span class="field-label">Tolerance ±</span>
							<NumberField
								label={question.tolerance.label}
								value={question.tolerance.value === '' ? undefined : question.tolerance.value}
								emptyText={question.tolerance.empty_text}
								ref={question.tolerance.ref}
								screen={at('question.tolerance.value')}
								onwrite={(v) => set('question.tolerance', v)}
							/>
						</div>
					{:else if question.answers}
						<AnswerTable
							{block}
							{step}
							stepKey={view.key}
							answers={question.answers}
							screen={at('question.answers')}
							multiple={question.multiple?.checked === true}
						/>
						{#if question.multiple}
							<Toggle
								label={question.multiple.label}
								hint={question.multiple.hint ?? undefined}
								checked={question.multiple.checked === true}
								screen={at('question.multiple.checked')}
								onchange={(v) => set('question.allow_multiple', v || undefined)}
							/>
						{/if}
					{/if}

					{#if question.solution}
						<div class="field-row">
							<span class="field-label">Řešení</span>
							<FocusField
								label={question.solution.label}
								value={question.solution.value}
								multiline
								ref={question.solution.ref}
								screen={at('question.solution.value')}
								emptyText={question.solution.empty_text}
								onchange={(v) => set('question.solution', v)}
							/>
						</div>
					{/if}
				</div>
			{/if}

			<!--
		The help ladder, on screen. Two rungs: the hint narrows the search, the help
		teaches the method. The app's question mark offers the second only after the
		first, and shows nothing at all if these are empty.
	-->
			{#if view.ladder}
				<div class="help-ladder">
					<!-- The consequence of each rung sits under its name, like every other field's. -->
					<div class="field-row">
						<div class="field-label">
							<span data-screen={at('ladder.hint.label')}>{view.ladder.hint.label}</span>
							{#if view.ladder.hint.hint}<span class="hint" data-screen={at('ladder.hint.hint')}
									>{view.ladder.hint.hint}</span
								>{/if}
						</div>
						<FocusField
							label={view.ladder.hint.label}
							value={view.ladder.hint.value}
							multiline
							ref={view.ladder.hint.ref}
							emptyText={view.ladder.hint.empty_text}
							screen={at('ladder.hint.value')}
							onchange={(v) => set('hint', v)}
						/>
					</div>
					<div class="field-row">
						<div class="field-label">
							<span data-screen={at('ladder.help.label')}>{view.ladder.help.label}</span>
							{#if view.ladder.help.hint}<span class="hint" data-screen={at('ladder.help.hint')}
									>{view.ladder.help.hint}</span
								>{/if}
						</div>
						<FocusField
							label={view.ladder.help.label}
							value={view.ladder.help.value}
							multiline
							ref={view.ladder.help.ref}
							emptyText={view.ladder.help.empty_text}
							screen={at('ladder.help.value')}
							onchange={(v) => set('help', v)}
						/>
					</div>
				</div>
			{/if}

			{#if view.extras}
				<div class="step-extras">
					<SettingsSection label={view.extras.label} autoOpen={view.extras.targeted}>
						<div class="extras">
							<FieldGroup rows={view.extras.fields} write={set} screen={at('extras.fields')} />
							{#if view.extras.question_fields.length > 0}
								<FieldGroup
									rows={view.extras.question_fields}
									write={setQuestion}
									screen={at('extras.question_fields')}
								/>
							{/if}
						</div>
					</SettingsSection>
				</div>
			{/if}
		</div>
	{/if}
</article>

<style>
	.collapsed header {
		margin-bottom: 0;
	}

	.step {
		padding: 12px 14px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-m);
		background: var(--surface);
	}

	.step.invalid {
		border-color: var(--e-error);
	}

	.step.targeted {
		border-color: var(--primary);
		box-shadow: 0 0 0 3px var(--primary-dark-12);
	}

	header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.spacer {
		flex: 1;
	}

	.grip {
		display: inline-flex;
		align-items: center;
		margin-left: -6px;
		padding: 2px;
		border: none;
		border-radius: var(--radius-s);
		background: none;
		color: var(--e-text-faint);
		opacity: 0.45;
		transition: opacity 120ms;
		cursor: grab;
	}

	.step:hover .grip,
	.step:focus-within .grip,
	.grip:hover,
	.grip:focus-visible {
		opacity: 1;
	}

	.grip:hover,
	.grip:focus-visible {
		color: var(--e-text);
		background: var(--surface-light);
	}

	/*
     * Duplicate, delete and the step's menu are faint on every step and full on the one
     * being pointed at, typed into or targeted — as an answer's are. Invisible, a teacher
     * had no way to know a step could be removed. A screen with no hover shows them full.
     */
	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
		opacity: 0.45;
		transition: opacity 120ms;
	}

	.step:hover .actions,
	.step:focus-within .actions,
	.step.targeted .actions {
		opacity: 1;
	}

	@media (hover: none) {
		.actions,
		.grip {
			opacity: 1;
		}
	}

	/* The summary takes the room the spacer would, and never less than a few words. */
	.summary {
		overflow: hidden;
		min-width: 6rem;
		flex: 1 1 0;
		padding: 0;
		border: none;
		background: none;
		color: var(--e-text-muted);
		font: inherit;
		font-size: var(--text-s);
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.summary:hover {
		color: var(--e-text);
	}

	.markdown {
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		padding: 2px 10px;
		background: var(--info-bg);
	}

	.markdown.invalid {
		box-shadow: inset 2px 0 0 var(--e-error);
	}

	.missing-text {
		margin: 4px 0 0;
		padding-left: 8px;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	.markdown:focus-within {
		border-color: var(--primary);
	}

	.media {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.media img,
	.media video {
		max-width: 100%;
		max-height: 220px;
		border-radius: var(--radius-s);
		object-fit: contain;
		background: var(--surface-light);
	}

	.question,
	.step-extras,
	.help-ladder {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.step-extras {
		margin-top: 10px;
	}

	.help-ladder {
		margin-top: 14px;
		padding-top: 10px;
		border-top: 1px dashed var(--e-border);
	}

	.extras {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.question-type {
		display: flex;
	}

	.field-row {
		display: grid;
		grid-template-columns: 170px 1fr;
		gap: 12px;
		align-items: start;
		font-size: var(--text-m);
	}

	.field-label {
		padding-top: 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.hint {
		color: var(--e-text-faint);
		font: var(--type-meta);
		font-weight: var(--weight-regular);
		line-height: 1.5;
	}

	.field-hint {
		margin: 0;
		font-size: var(--text-xs);
	}

	.field-hint.warning {
		color: var(--e-warning);
	}
</style>
