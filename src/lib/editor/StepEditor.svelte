<script lang="ts">
	/**
	 * One step of a block. The controls follow the step type (§7.1), and the question
	 * controls follow the question type (§8.3) — the author never picks a renderer,
	 * they pick what they are adding.
	 */
	import type { BlockStep, BlockV2, CourseV2, QuestionConfig, QuestionType } from '$lib/domain/schema';
	import FocusField from '$lib/ui/FocusField.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Toggle from '$lib/ui/Toggle.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import AnswerTable from './AnswerTable.svelte';
	import { markdownEditor } from '$lib/ui/codemirror';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import { useStore } from '$lib/ui/context';
	import { refKey } from '$lib/domain/ref';
	import Button from '$lib/ui/Button.svelte';
	import { allows, fieldSpec, fieldsFor } from '$lib/ui/fields';
	import { answersCount } from '$lib/ui/plural';
	import {
		CommandError,
		deleteStep,
		duplicateStep,
		planDeleteStep,
		setField,
		setQuestionType
	} from '$lib/domain/commands';

	interface Props {
		doc: CourseV2;
		block: BlockV2;
		step: BlockStep;
		/** 1-based position, for the label a teacher sees instead of the id (§8). */
		position: number;
		onrepair: (blockId: string, stepId: string) => void;
	}
	let { doc, block, step, position, onrepair }: Props = $props();

	const store = useStore();
	const mode = $derived(store.mode);
	/** Ids key a student's saved answers, so only the advanced mode ever shows one. */
	const showIds = $derived(allows('step', 'id', mode));
	const issues = $derived(store.issuesAt({ blockId: block?.block_id, stepId: step?.id }));

	/** Reads a dotted path off the step, for the generic renderer. */
	function read(path: string): unknown {
		return path.split('.').reduce<unknown>(
			(node, key) =>
				node === undefined || node === null ? undefined : (node as Record<string, unknown>)[key],
			step as unknown
		);
	}
	const readQuestion = (path: string): unknown =>
		path.split('.').reduce<unknown>(
			(node, key) =>
				node === undefined || node === null ? undefined : (node as Record<string, unknown>)[key],
			step.question as unknown
		);
	const setQuestion = (path: string, value: unknown) => set(`question.${path}`, value);

	/**
	 * Fields rendered by hand above, in the place the author is already looking.
	 *
	 * `hint` and `help` are in here because they are *content* — the two rungs of the
	 * ladder the app's question mark climbs, and the app needs both to have anything
	 * to show when a pupil says "nerozumím tomu". They were behind a disclosure and,
	 * for `help`, behind advanced mode; a teacher could ship a course whose help
	 * button led nowhere and never see the field that would have filled it.
	 */
	const INLINE_STEP = ['content', 'image.url', 'image.alt', 'video.url', 'audio.url', 'hint', 'help'];
	const INLINE_QUESTION = ['correct_answer', 'correct_number', 'tolerance', 'allow_multiple', 'solution'];

	/**
	 * What is left over: settings rather than content. In teacher mode both lists are
	 * empty, which is the point — nothing in this editor needs expanding to be found.
	 */
	const extraFields = $derived(
		fieldsFor('step', mode).filter((f) => !INLINE_STEP.includes(f.path))
	);
	const questionExtras = $derived(
		fieldsFor('question', mode).filter((f) => !INLINE_QUESTION.includes(f.path))
	);

	const hintSpec = fieldSpec('step', 'hint');
	const helpSpec = fieldSpec('step', 'help');

	const set = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { blockId: block.block_id, stepId: step.id, field }, value));

	const QUESTION_TYPES: { value: QuestionType; label: string; title: string }[] = [
		{ value: 'multiple_choice', label: 'Výběr', title: 'Žák vybírá z možností' },
		{ value: 'true_false', label: 'Ano/Ne', title: 'Dvě velká tlačítka — rychlé na procvičování' },
		{ value: 'open', label: 'Vlastní slovo', title: 'Žák píše odpověď; porovnává se bez ohledu na velikost písmen' },
		{ value: 'numeric', label: 'Číslo', title: 'Žák zadává číslo; vyhodnocuje se s tolerancí' }
	];

	/**
	 * What `setQuestionType` (commands.ts) would throw away by switching to `target`,
	 * counted only in things a teacher actually put there. A freshly scaffolded
	 * question (`emptyQuestion()`: two options, no text, no feedback, no branching) is
	 * indistinguishable from "nothing to lose" here on purpose — the option ids and the
	 * default `is_correct` are the type's own bookkeeping, not authored content, so
	 * switching an untouched question never nags. `null` means "apply straight away".
	 */
	interface TypeChangeLoss {
		answers: number;
		withFeedback: number;
		withBranching: number;
		correctAnswer?: string;
		correctNumber?: string;
	}

	function planQuestionTypeChange(
		question: QuestionConfig | undefined,
		target: QuestionType
	): TypeChangeLoss | null {
		if (question === undefined || question.type === target) return null;

		// Mirrors setQuestionType's own branches: true_false always replaces options,
		// open/numeric drop them, and multiple_choice only replaces them when there
		// were fewer than two to begin with (the scaffolded state).
		const optionsReplaced =
			target === 'true_false' ||
			target === 'open' ||
			target === 'numeric' ||
			(target === 'multiple_choice' && (question.options?.length ?? 0) < 2);

		const authored = optionsReplaced
			? (question.options ?? []).filter(
					(o) => o.text.trim() !== '' || !!o.feedback?.trim() || !!o.go_to
				)
			: [];

		const loss: TypeChangeLoss = {
			answers: authored.length,
			withFeedback: authored.filter((o) => !!o.feedback?.trim()).length,
			withBranching: authored.filter((o) => !!o.go_to).length
		};
		if (target !== 'open' && question.type === 'open' && question.correct_answer?.trim()) {
			loss.correctAnswer = question.correct_answer;
		}
		if (target !== 'numeric' && question.type === 'numeric' && question.correct_number !== undefined) {
			loss.correctNumber =
				question.tolerance !== undefined
					? `${question.correct_number} (tolerance ±${question.tolerance})`
					: String(question.correct_number);
		}

		const nothingLost = loss.answers === 0 && loss.correctAnswer === undefined && loss.correctNumber === undefined;
		return nothingLost ? null : loss;
	}


	function typeChangeMessage(loss: TypeChangeLoss): string {
		const parts: string[] = [];
		if (loss.answers > 0) {
			const extras: string[] = [];
			if (loss.withFeedback > 0) extras.push(`${loss.withFeedback}× s vysvětlením pro žáka`);
			if (loss.withBranching > 0) extras.push(`${loss.withBranching}× s větvením na jiný krok`);
			const suffix = extras.length > 0 ? ` (z toho ${extras.join(', ')})` : '';
			parts.push(`smaže ${answersCount(loss.answers)}${suffix}`);
		}
		if (loss.correctAnswer !== undefined) {
			parts.push(`smaže zadanou správnou odpověď „${loss.correctAnswer}“`);
		}
		if (loss.correctNumber !== undefined) {
			parts.push(`smaže zadaný správný výsledek ${loss.correctNumber}`);
		}
		return `Tato změna ${parts.join(' a ')}. Zpět se dá vrátit tlačítkem Zpět v liště, ale jen dokud kartu neopustíš.`;
	}

	let pendingTypeChange = $state<{ type: QuestionType; loss: TypeChangeLoss } | null>(null);

	function requestQuestionType(type: QuestionType) {
		const loss = planQuestionTypeChange(step.question, type);
		if (loss === null) {
			store.apply((d) => setQuestionType(d, block.block_id, step.id, type));
		} else {
			pendingTypeChange = { type, loss };
		}
	}

	function confirmQuestionTypeChange() {
		if (pendingTypeChange === null) return;
		store.apply((d) => setQuestionType(d, block.block_id, step.id, pendingTypeChange!.type));
		pendingTypeChange = null;
	}

	function cancelQuestionTypeChange() {
		pendingTypeChange = null;
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

	/** §14 E_MEDIA_NOT_DIRECT mirrors this same check — kept here too so the field can
	 *  explain the mistake before validation ever runs, not only after. */
	const VIDEO_PAGE_URL = /youtube\.com|youtu\.be|vimeo\.com/i;
	const videoIsPageLink = $derived(VIDEO_PAGE_URL.test(step.video?.url ?? ''));

	function remove() {
		try {
			store.apply((d) => deleteStep(d, block.block_id, step.id));
		} catch (error) {
			if (error instanceof CommandError) onrepair(block.block_id, step.id);
			else throw error;
		}
	}

	const inboundBranches = $derived(planDeleteStep(doc, block.block_id, step.id).length);

	// Highlight and scroll to this step when something outside the editor points at
	// it — a click in the preview, a jump from the validation panel.
	let root = $state<HTMLElement | null>(null);
	// Optional access, not defensiveness for its own sake: when a card is deleted the
	// selection moves in an effect, which flushes before this component is destroyed,
	// so the derived runs once more with the props already torn down.
	const targeted = $derived(
		store.selection?.blockId === block?.block_id && store.selection?.stepId === step?.id
	);
	$effect(() => {
		// Depends on the reveal counter, not on the selection: typing also moves the
		// selection, and scrolling on every keystroke would be unusable.
		void store.reveal;
		if (targeted && root !== null) {
			root.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	});
</script>

<article bind:this={root} class="step" class:invalid={issues.errors.length > 0} class:targeted>
	<header>
		<!-- Ids key a student's saved answers, so a teacher never sees or types one. -->
		<Chip tone="quiet" title={showIds ? 'Identifikátor kroku' : undefined}>
			{showIds ? step.id : `Krok ${position}`}
		</Chip>
		{#if inboundBranches > 0}
			<Chip tone="accent" title="Na tento krok vede větvení z jiné odpovědi">
				← {inboundBranches}
			</Chip>
		{/if}
		<div class="spacer"></div>
		<Button variant="ghost" size="s" onclick={() => store.apply((d, r) => duplicateStep(d, block.block_id, step.id, r))}>
			Duplikovat
		</Button>
		<Button variant="danger" size="s" onclick={remove}>Smazat</Button>
	</header>

	{#if step.type === 'text'}
		<div
			class="markdown"
			use:markdownEditor={{
				value: step.content ?? '',
				placeholder: 'Text kroku. Markdown a $LaTeX$ fungují.',
				onchange: (v) => set('content', v === '' ? undefined : v)
			}}
		></div>
	{:else if step.type === 'image'}
		<div class="media">
			<FocusField
				label="Adresa obrázku"
				value={step.image?.url}
				emptyText="https://… (veřejná adresa obrázku)"
				monospace
				onchange={(v) => {
					set('image.url', v ?? '');
					imagePreview.type(v ?? '');
				}}
				onblur={() => imagePreview.flush(step.image?.url ?? '')}
			/>
			<FocusField
				label="Popis obrázku pro čtečku obrazovky"
				value={step.image?.alt}
				emptyText="Popiš, co je na obrázku — přečte to čtečka obrazovky"
				invalid={issues.warnings.some((i) => i.code === 'W_IMAGE_NO_ALT')}
				onchange={(v) => set('image.alt', v)}
			/>
			{#if imagePreview.value}
				<img src={imagePreview.value} alt={step.image?.alt ?? ''} />
			{/if}
		</div>
	{:else if step.type === 'video'}
		<div class="media">
			<FocusField
				label="Adresa videa"
				value={step.video?.url}
				emptyText="https://… přímý odkaz na MP4 (YouTube a Vimeo přehrávač nenačte)"
				monospace
				onchange={(v) => {
					set('video.url', v ?? '');
					videoPreview.type(v ?? '');
				}}
				onblur={() => videoPreview.flush(step.video?.url ?? '')}
			/>
			{#if videoIsPageLink}
				<!--
					§14 E_MEDIA_NOT_DIRECT fires on export, but by then the teacher has
					already pasted the wrong thing and moved on. Catching it here, next to
					the field, is what turns "proč se to nepřehrává" into a one-line fix.
				-->
				<p class="field-hint warning">
					Tohle je odkaz na stránku YouTube/Vimeo, ne na video samotné — přehrávač
					v kurzu ho nenačte. Otevři video, najdi jeho přímý soubor (.mp4) a vlož
					adresu toho.
				</p>
			{/if}
			{#if videoPreview.value}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={videoPreview.value} controls></video>
			{/if}
		</div>
	{:else if step.type === 'audio'}
		<div class="media">
			<FocusField
				label="Adresa zvuku"
				value={step.audio?.url}
				emptyText="https://… MP3, WAV nebo OGG"
				monospace
				onchange={(v) => {
					set('audio.url', v ?? '');
					audioPreview.type(v ?? '');
				}}
				onblur={() => audioPreview.flush(step.audio?.url ?? '')}
			/>
			{#if audioPreview.value}<audio src={audioPreview.value} controls></audio>{/if}
		</div>
	{:else if step.type === 'question'}
		<div class="question">
			<div
				class="markdown"
				use:markdownEditor={{
					value: step.content ?? '',
					placeholder: 'Zadání otázky.',
					onchange: (v) => set('content', v === '' ? undefined : v)
				}}
			></div>

			<div class="question-type">
				<Segmented
					label="Typ otázky"
					options={QUESTION_TYPES}
					value={step.question?.type ?? 'multiple_choice'}
					onchange={requestQuestionType}
				/>
			</div>

			{#if step.question?.type === 'open'}
				<div class="field-row">
					<span class="field-label">Správná odpověď</span>
					<FocusField
						label="Správná odpověď"
						value={step.question.correct_answer}
						emptyText="Jedno slovo nebo číslo — porovnává se bez ohledu na velikost písmen"
						invalid={issues.errors.some((i) => i.code === 'E_OPEN_NO_CORRECT_ANSWER')}
						onchange={(v) => set('question.correct_answer', v)}
					/>
				</div>
			{:else if step.question?.type === 'numeric'}
				<div class="field-row">
					<span class="field-label">Správný výsledek</span>
					<FocusField
						label="Správný výsledek"
						value={step.question.correct_number === undefined ? undefined : String(step.question.correct_number)}
						emptyText="Číslo"
						monospace
						invalid={issues.errors.some((i) => i.code === 'E_NUMERIC_NO_CORRECT_NUMBER')}
						onchange={(v) => set('question.correct_number', v === undefined ? undefined : Number(v))}
					/>
				</div>
				<div class="field-row">
					<span class="field-label">Tolerance ±</span>
					<FocusField
						label="Tolerance"
						value={step.question.tolerance === undefined ? undefined : String(step.question.tolerance)}
						emptyText="0 — vyžaduje přesnou shodu"
						monospace
						onchange={(v) => set('question.tolerance', v === undefined ? undefined : Number(v))}
					/>
				</div>
			{:else}
				<AnswerTable {doc} {block} {step} />
				{#if step.question?.type === 'multiple_choice'}
					<Toggle
						label="Žák může vybrat víc možností"
						hint="Hodnotí se přesná shoda celé sady — za částečně správný výběr nejsou body."
						checked={step.question.allow_multiple === true}
						onchange={(v) => set('question.allow_multiple', v || undefined)}
					/>
				{/if}
			{/if}

			<div class="field-row">
				<span class="field-label">Řešení</span>
				<FocusField
					label="Vysvětlení řešení"
					value={step.question?.solution}
					multiline
					emptyText="Napiš postup, ne jen výsledek — tohle je nejčtenější text v kurzu."
					onchange={(v) => set('question.solution', v)}
				/>
			</div>

		</div>
	{/if}

	<!--
		The help ladder, on screen. Two rungs: the hint narrows the search, the help
		teaches the method. The app's question mark offers the second only after the
		first, and shows nothing at all if these are empty.
	-->
	<div class="help-ladder">
		<!--
			The consequence of each rung lives in the tooltip, not under the field. It
			is the same two sentences on every step of every card, and printed out it
			buries the step's own content under its footnotes. The card's own pair
			spells them out once, where they teach something.
		-->
		<div class="field-row">
			<span class="field-label" title={hintSpec?.hint}>{hintSpec?.label ?? 'Nápověda'}</span>
			<FocusField
				label={hintSpec?.label ?? 'Nápověda'}
				value={step.hint}
				multiline
				emptyText="nevyplněno — žák uvidí otazník jen když tu něco je"
				onchange={(v) => set('hint', v)}
			/>
		</div>
		<div class="field-row">
			<span class="field-label" title={helpSpec?.hint}>{helpSpec?.label ?? 'Podrobná pomoc'}</span>
			<FocusField
				label={helpSpec?.label ?? 'Podrobná pomoc'}
				value={step.help}
				multiline
				emptyText="nevyplněno — druhá úroveň otazníku"
				onchange={(v) => set('help', v)}
			/>
		</div>
	</div>

	{#if extraFields.length > 0 || questionExtras.length > 0}
		<div class="step-extras">
			<h4>Nastavení kroku</h4>
			<div class="extras">
				<FieldGroup fields={extraFields} {read} write={set} />
				{#if step.type === 'question' && questionExtras.length > 0}
					<FieldGroup fields={questionExtras} read={readQuestion} write={setQuestion} />
				{/if}
			</div>
		</div>
	{/if}

	{#each [...issues.errors, ...issues.warnings] as issue (issue.code + refKey(issue.ref))}
		{#if issue.ref.optionId === undefined}
			<p class="issue" class:warning={issue.severity === 'warning'}>{issue.message}</p>
		{/if}
	{/each}

	{#if pendingTypeChange}
		<Modal title="Změnit typ otázky?" onclose={cancelQuestionTypeChange}>
			<p>{typeChangeMessage(pendingTypeChange.loss)}</p>
			{#snippet footer()}
				<Button variant="ghost" onclick={cancelQuestionTypeChange}>Zrušit</Button>
				<Button variant="danger-solid" onclick={confirmQuestionTypeChange}>Přesto změnit</Button>
			{/snippet}
		</Modal>
	{/if}
</article>

<style>
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


	.markdown {
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		padding: 2px 10px;
		background: var(--info-bg);
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

	.step-extras,
	.help-ladder {
		margin-top: 14px;
		padding-top: 10px;
		border-top: 1px dashed var(--e-border);
	}

	h4 {
		margin: 0;
		color: var(--e-text-muted);
		font-family: var(--font-heading);
		font-size: var(--text-s);
	}


	.extras {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 10px;
	}

	.question-type {
		display: flex;
	}

	.field-row {
		display: grid;
		grid-template-columns: 130px 1fr;
		gap: 12px;
		align-items: start;
		font-size: var(--text-m);
	}

	.field-label {
		padding-top: 6px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}


	.issue {
		margin: 10px 0 0;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	.issue.warning {
		color: var(--e-warning);
	}

	.field-hint {
		margin: 0;
		font-size: var(--text-xs);
	}

	.field-hint.warning {
		color: var(--e-warning);
	}
</style>
