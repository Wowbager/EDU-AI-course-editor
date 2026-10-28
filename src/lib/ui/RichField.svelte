<script lang="ts">
	/**
	 * A Markdown + LaTeX field, edited as formatted text: bold looks bold, a formula is
	 * a formula. The document keeps Markdown (`$lib/domain/markdown` converts it the
	 * way the app reads it), and a text the visual editor cannot hold exactly — legacy
	 * HTML, a video tag — opens as source instead, so it is never rewritten.
	 *
	 * Formatting buttons show only while the field has focus, in a row inside its
	 * bottom edge: the text the teacher clicked never moves, and an untouched field is
	 * just a field. The formula and image editors open in that same row.
	 */
	import { onDestroy, tick as settled, untrack } from 'svelte';
	import {
		Bold,
		BetweenHorizontalEnd,
		BetweenVerticalEnd,
		CodeXml,
		Ellipsis,
		Heading,
		Image as ImageIcon,
		Italic,
		Keyboard,
		List,
		ListOrdered,
		Sigma,
		Table,
		Trash,
		Type,
		CircleQuestionMark
	} from '@lucide/svelte';
	import { canEditVisually, type MarkdownDialect } from '$lib/domain/markdown';
	import type { Ref } from '$lib/domain/ref';
	import type { Transaction } from '@tiptap/pm/state';
	import { markdownEditor } from './codemirror';
	import { useStore } from './context';
	import Menu from './Menu.svelte';
	import MenuItem from './MenuItem.svelte';
	import MenuSeparator from './MenuSeparator.svelte';
	import { pagePress } from './press';
	import { createRichEditor, type RichEditor } from './rich/editor';
	import { EditRun } from '$lib/state/edit-run';
	import { mathField, toggleMathKeyboard } from './rich/mathfield';
	import { isImageAddress } from './rich/paste';

	interface Props {
		value: string | undefined;
		label: string;
		/** How the app reads this field: sniffed, always Markdown, or one inline line. */
		dialect: MarkdownDialect;
		/** The cue in an empty field. */
		emptyText?: string;
		disabled?: boolean;
		invalid?: boolean;
		onchange: (value: string | undefined) => void;
		/** The teacher left the field. */
		onblur?: () => void;
		/** Enter in a one-line field, after it has ended the edit (the field blurs first). */
		onenter?: () => void;
		ref?: Ref;
		describedby?: string;
	}

	let {
		value,
		label,
		dialect,
		emptyText,
		disabled = false,
		invalid = false,
		onchange,
		onblur,
		onenter,
		ref,
		describedby
	}: Props = $props();

	const store = useStore();

	/** Leaving waits for a press that took the focus away; set while it does. */
	let leaving = false;
	// Listening from the start: the press that takes the focus away comes before `focusout`.
	$effect(() => void pagePress());

	const inline = untrack(() => dialect.inline === true);

	let wrapper = $state<HTMLElement | null>(null);
	let host = $state<HTMLElement | null>(null);
	let rich: RichEditor | null = null;
	let ready = $state(false);
	/** Bumped on every editor transaction, so the toolbar redraws its pressed buttons. */
	let tick = $state(0);
	let focused = $state(false);
	/** One line under the field for what it could not take, until the next edit. */
	let refused = $state<string | null>(null);

	/** The teacher chose the source view in the ⋯ menu. */
	let chosenSource = $state(false);
	/** The value last written by this field, so it is never pushed back in. */
	let emitted: string | undefined = untrack(() => value);
	let visualOk = $state(untrack(() => canEditVisually(value ?? '', dialect)));
	const source = $derived(chosenSource || !visualOk);

	$effect(() => {
		const next = value;
		untrack(() => {
			if (next === emitted) return;
			emitted = next;
			visualOk = canEditVisually(next ?? '', dialect);
			if (!source) rich?.setValue(next ?? '');
		});
	});

	// The editor is mounted, not rendered: it owns its DOM.
	$effect(() => {
		const element = host;
		if (!element || source) return;
		untrack(() => {
			rich = createRichEditor({
				element,
				value: value ?? '',
				dialect,
				label,
				placeholder: emptyText ?? label,
				describedby,
				editable: !disabled,
				onchange: (markdown) => emit(markdown),
				onbeginedit: begin,
				onendedit: () => typing.end(),
				onmath: openMath,
				onimage: () => openImage(),
				onrefused: (message) => (refused = message),
				onstate: (transaction) => {
					tick++;
					followRows(transaction);
				},
				onundo: (redo) => {
					// The run ends here; what is typed after the undo is a run of its own.
					typing.end();
					if (redo) store.redo();
					else store.undo();
				},
				onescape: revert,
				onenter: (shift) => {
					rich?.editor.commands.blur();
					// Shift+Enter only ends the edit, as it always did.
					if (!shift) onenter?.();
				}
			});
			ready = true;
		});
		return () => {
			rich?.destroy();
			rich = null;
			ready = false;
		};
	});

	$effect(() => {
		const editable = !disabled;
		untrack(() => rich?.setEditable(editable));
	});

	onDestroy(() => rich?.destroy());

	/** This field's run of typing, in whichever view: one undo entry, Escape's target. */
	const typing = new EditRun(store);
	const begin = () => typing.begin(value);

	function emit(markdown: string) {
		refused = null;
		const next = markdown.trim() === '' ? undefined : markdown;
		// Against what was last sent, not `value`: the prop catches up only after the tick,
		// and an input rule sends twice in one. `1. ` sent `\1. `, then the list's `1.`,
		// which matched the stale prop and was dropped; `\1. ` then came back over the list.
		const changed = next !== emitted;
		emitted = next;
		if (changed) onchange(next);
	}

	function leave() {
		closeMath();
		imagePanel = null;
		rich?.end();
		typing.end();
		if (ref) store.touchField(ref);
		onblur?.();
	}

	function onfocusin(event: FocusEvent) {
		focused = true;
		// Focus coming back into the text from the image row is leaving the row, even when
		// the click lands where the caret already was and no transaction follows.
		if (imagePanel !== null && event.target instanceof Node && host?.contains(event.target))
			imagePanel = null;
	}

	function finishLeaving() {
		leaving = false;
		if (wrapper?.contains(document.activeElement)) return;
		focused = false;
		leave();
	}

	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (next && wrapper?.contains(next)) return;
		// A menu or a panel inside the field takes focus for a moment; check again once
		// the browser has settled where it went.
		queueMicrotask(() => {
			if (wrapper?.contains(document.activeElement)) return;
			// A press that took the focus away has not ended yet. The toolbar going now
			// would shift what is under the pointer, and the release would land on
			// something else: the click on „Přidat krok“ right after typing was lost.
			const press = pagePress();
			if (!press.down) finishLeaving();
			else if (!leaving) {
				leaving = true;
				press.afterPress(finishLeaving);
			}
		});
	}

	/**
	 * Escape in the formula or image row closes it. In the source view it takes back the
	 * run of typing; the visual editor does that itself (`onescape`), before its own
	 * key bindings can claim the key.
	 */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		if (mathPos !== null || imagePanel) {
			event.preventDefault();
			event.stopPropagation();
			closeMath();
			imagePanel = null;
			focusText();
		} else if (source && revert()) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	/** Take back the run of typing, in whichever view is showing. */
	function revert(): boolean {
		return typing.revert((back) => {
			emitted = back;
			if (back !== value) onchange(back);
			rich?.setValue(back ?? '');
		});
	}

	// ─── Toolbar ────────────────────────────────────────────────────────────

	const editor = () => rich?.editor ?? null;
	const active = (name: string, attrs?: Record<string, unknown>) => {
		void tick;
		return editor()?.isActive(name, attrs) ?? false;
	};
	/**
	 * Back into the text at once. Tiptap's own `focus()` waits a frame, and a row that
	 * closes in between would look like the teacher leaving the field.
	 */
	const focusText = () => rich?.editor.view.focus();
	const run = (
		command: (chain: ReturnType<NonNullable<ReturnType<typeof editor>>['chain']>) => unknown
	) => {
		const e = editor();
		if (!e) return;
		e.view.focus();
		command(e.chain().focus().setMeta('teacher', true));
	};
	/** Keep the editor's selection when a toolbar button is pressed. */
	const keepFocus = (event: MouseEvent) => event.preventDefault();

	/** The list button cycles: none → bullets → numbers → none. Its name says where it is. */
	const LIST_STEPS = {
		none: { title: 'Odrážky (napiš - a mezeru)', label: 'Seznam' },
		bullet: { title: 'Změnit na číslování (napiš 1. a mezeru)', label: 'Seznam: odrážky' },
		ordered: { title: 'Zrušit seznam', label: 'Seznam: číslování' }
	} as const;
	const list = $derived.by((): keyof typeof LIST_STEPS => {
		void tick;
		if (active('orderedList')) return 'ordered';
		return active('bulletList') ? 'bullet' : 'none';
	});
	function cycleList() {
		// Bullets → numbers converts the list in place; numbers → none lifts it out.
		if (list === 'none') run((c) => c.toggleBulletList().run());
		else run((c) => c.toggleOrderedList().run());
	}

	const inTable = $derived.by(() => {
		void tick;
		return active('table');
	});

	// ─── Formula row ────────────────────────────────────────────────────────

	/** Marks the row's own edits, which are not the teacher leaving the formula. */
	const FORMULA_ROW = 'formula-row';
	let mathPos = $state<number | null>(null);
	let mathLatex = $state('');
	let mathDisplay = $state(false);
	let mathInput = $state<HTMLTextAreaElement | null>(null);
	let mathHost = $state<HTMLElement | null>(null);
	/** The raw LaTeX box under the visual one, for whoever wants it. */
	let showLatex = $state(false);

	function openMath(pos: number) {
		const node = editor()?.state.doc.nodeAt(pos);
		if (node?.type.name !== 'math') return;
		imagePanel = null;
		mathPos = pos;
		mathLatex = node.attrs.latex;
		mathDisplay = node.attrs.display === true;
		showLatex = false;
	}

	function insertMath() {
		const e = editor();
		if (!e) return;
		const pos = e.state.selection.from;
		const selected = e.state.doc.textBetween(e.state.selection.from, e.state.selection.to);
		run((c) => c.insertContent({ type: 'math', attrs: { latex: selected, display: false } }).run());
		openMath(pos);
	}

	function updateMath() {
		const e = editor();
		if (!e || mathPos === null) return;
		const node = e.state.doc.nodeAt(mathPos);
		if (node?.type.name !== 'math') return;
		// A formula has no dollars inside, and an inline one no line break.
		const latex = mathLatex.replace(/\$/g, '');
		begin();
		e.view.dispatch(
			e.state.tr
				.setNodeMarkup(mathPos, undefined, {
					latex: mathDisplay ? latex : latex.replace(/\n/g, ' '),
					display: mathDisplay
				})
				.setMeta('teacher', true)
				.setMeta(FORMULA_ROW, true)
		);
	}

	/**
	 * `caret`: put the caret back after the formula. Not when the teacher has already
	 * put it somewhere else — that would undo their click.
	 */
	function closeMath(caret = true) {
		const e = editor();
		const pos = mathPos;
		// Cleared first: what is dispatched below comes back through `followFormula`.
		mathPos = null;
		if (!e || pos === null) return;
		const node = e.state.doc.nodeAt(pos);
		// An empty formula is no formula.
		if (node?.type.name === 'math' && String(node.attrs.latex).trim() === '')
			e.view.dispatch(e.state.tr.delete(pos, pos + 1).setMeta('teacher', true));
		else if (node && caret) e.commands.setTextSelection(pos + 1);
	}

	/**
	 * The row edits one formula while the teacher is on it. A click or an arrow back
	 * into the text, or a change made elsewhere (undo), is leaving it: focus stays
	 * inside the field, so `onfocusout` never sees it. The position is mapped first,
	 * since the text around the formula may have just moved.
	 */
	function followFormula(transaction: Transaction) {
		if (mathPos === null || transaction.getMeta(FORMULA_ROW)) return;
		mathPos = transaction.mapping.map(mathPos);
		if (transaction.selectionSet || transaction.docChanged) closeMath(false);
	}

	/**
	 * One rule for every inline row (OPEN-PROBLEMS #58): a transaction that moves the
	 * selection or changes the text is the teacher leaving it. The image row's own focus
	 * is outside the editor, so a click back into the text reaches here, not `onfocusout`.
	 */
	function followRows(transaction: Transaction) {
		followFormula(transaction);
		if (imagePanel !== null && (transaction.selectionSet || transaction.docChanged))
			imagePanel = null;
	}

	function mathKeys(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			closeMath();
			focusText();
		}
	}

	// ─── Image row ──────────────────────────────────────────────────────────

	let imagePanel = $state<{
		src: string;
		alt: string;
		editing: boolean;
		error: string | null;
	} | null>(null);

	function openImage() {
		closeMath();
		const e = editor();
		const selected = e?.isActive('image') ? e.getAttributes('image') : null;
		imagePanel = {
			src: selected?.src ?? '',
			alt: selected?.alt ?? '',
			editing: selected !== null,
			error: null
		};
	}

	function placeImage(event: SubmitEvent) {
		event.preventDefault();
		if (!imagePanel) return;
		const src = imagePanel.src.trim();
		if (!isImageAddress(src)) {
			imagePanel.error = 'Adresa obrázku musí začínat https:// — jinak se v aplikaci nenačte.';
			return;
		}
		const attrs = { src, alt: imagePanel.alt.trim() };
		run((c) =>
			imagePanel?.editing
				? c.updateAttributes('image', attrs).run()
				: c.insertContent({ type: 'image', attrs }).run()
		);
		imagePanel = null;
	}

	// ─── Source view ────────────────────────────────────────────────────────

	/**
	 * Whether the source editor has mounted. It loads on first use (`codemirror.ts`),
	 * so a tick after the source view opens it may not be there yet.
	 */
	let sourceReady = $state(false);
	/** The teacher asked for the source view, so it takes focus once it is there. */
	let focusSource = false;
	$effect(() => {
		if (!source) sourceReady = false;
	});
	function sourceMounted() {
		sourceReady = true;
		if (!focusSource) return;
		focusSource = false;
		wrapper?.querySelector<HTMLElement>('.cm-content')?.focus();
	}

	function showSource() {
		chosenSource = true;
		focusSource = true;
	}

	function showVisual() {
		chosenSource = false;
		queueMicrotask(() => rich?.editor.commands.focus('end'));
	}

	let issues = $derived(ref ? store.issuesAt(ref) : { errors: [], warnings: [] });
	const flagged = $derived(invalid || issues.errors.length > 0);

	// The text is the editor's DOM; it carries the field's state for assistive tech.
	$effect(() => {
		const invalidNow = flagged;
		void source;
		void ready;
		void sourceReady;
		// The visual editor's text, or the Markdown view's: whichever is showing, once
		// its editor has mounted.
		void settled().then(() => {
			const surface = wrapper?.querySelector('.rich-content, .cm-content');
			if (invalidNow) surface?.setAttribute('aria-invalid', 'true');
			else surface?.removeAttribute('aria-invalid');
		});
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="rich-field"
	class:focused
	class:inline
	class:invalid={flagged}
	class:disabled
	bind:this={wrapper}
	{onfocusin}
	{onfocusout}
	{onkeydown}
>
	{#if source}
		<div
			class="source"
			data-source="markdown"
			use:markdownEditor={{
				value: value ?? '',
				placeholder: emptyText ?? label,
				label,
				describedby,
				onchange: (v) => emit(v),
				onbeginedit: begin,
				onendedit: () => typing.end(),
				onready: sourceMounted
			}}
		></div>
	{:else}
		<div class="surface" bind:this={host}>
			{#if !ready}
				<!-- Until the editor is mounted: the same words, so nothing jumps. -->
				<div class="rich-content waiting" aria-hidden="true">{value ?? ''}</div>
			{/if}
		</div>
	{/if}

	{#if focused && !disabled}
		{#if mathPos !== null}
			{#key mathPos}
				<div class="row panel" role="group" aria-label="Vzorec">
					<div
						class="math-field"
						bind:this={mathHost}
						use:mathField={{
							latex: mathLatex,
							label: 'Vzorec',
							oninput: (latex) => {
								mathLatex = latex;
								updateMath();
							},
							ondone: () => {
								closeMath();
								focusText();
							},
							onunreadable: () => (showLatex = true)
						}}
					></div>
					<button
						type="button"
						class="icon-button keyboard"
						title="Klávesnice se značkami"
						aria-label="Klávesnice se značkami"
						onmousedown={keepFocus}
						onclick={() => toggleMathKeyboard(mathHost)}><Keyboard size={16} /></button
					>
					<div class="panel-actions">
						{#if !inline}
							<label class="check">
								<input type="checkbox" bind:checked={mathDisplay} onchange={updateMath} />
								Na samostatný řádek
							</label>
						{/if}
						<button
							type="button"
							class="text-button"
							aria-pressed={showLatex}
							title="Upravit vzorec jako LaTeX"
							onclick={() => {
								showLatex = !showLatex;
								if (showLatex) queueMicrotask(() => mathInput?.focus());
							}}>LaTeX</button
						>
						<button
							type="button"
							class="text-button"
							onclick={() => {
								closeMath();
								focusText();
							}}>Hotovo</button
						>
					</div>
					{#if showLatex}
						<div class="math-source">
							<label>
								<span>Vzorec v LaTeXu</span>
								<textarea
									bind:this={mathInput}
									bind:value={mathLatex}
									rows={mathDisplay ? 2 : 1}
									spellcheck="false"
									data-undo="course"
									oninput={updateMath}
									onkeydown={mathKeys}></textarea>
							</label>
							<button
								type="button"
								class="icon-button"
								onclick={() =>
									window.open('https://katex.org/docs/supported.html', '_blank', 'noopener')}
								title="Nápověda k LaTeXu"
								aria-label="Nápověda k LaTeXu"
							>
								<CircleQuestionMark size={14}></CircleQuestionMark>
							</button>
						</div>
					{/if}
				</div>
			{/key}
		{:else if imagePanel}
			<form class="row panel" aria-label="Obrázek" onsubmit={placeImage}>
				<label class="grow">
					<span>Webová adresa obrázku</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="url"
						bind:value={imagePanel.src}
						placeholder="https://…/obrazek.jpg"
						autofocus
					/>
				</label>
				<label class="grow">
					<span>Popis (nepovinný)</span>
					<input bind:value={imagePanel.alt} placeholder="Co na obrázku je" />
				</label>
				<div class="panel-actions">
					<button type="submit" class="text-button primary"
						>{imagePanel.editing ? 'Uložit' : 'Vložit'}</button
					>
					<button
						type="button"
						class="text-button"
						onclick={() => {
							imagePanel = null;
							focusText();
						}}>Zrušit</button
					>
				</div>
				{#if imagePanel.error}<p class="note error">{imagePanel.error}</p>{/if}
			</form>
		{:else if source}
			{#if chosenSource}
				<div class="row">
					<button
						type="button"
						class="text-button"
						disabled={!visualOk}
						title={visualOk
							? undefined
							: 'Text obsahuje něco, co se dá upravit jen jako text (například HTML).'}
						onclick={showVisual}><Type size={14} aria-hidden="true" /> Upravit vizuálně</button
					>
				</div>
			{/if}
		{:else}
			<div class="row" role="toolbar" aria-label="Formátování textu">
				<button
					type="button"
					class="tool"
					class:on={active('bold')}
					aria-pressed={active('bold')}
					title="Tučně (Ctrl+B)"
					aria-label="Tučně"
					onmousedown={keepFocus}
					onclick={() => run((c) => c.toggleBold().run())}><Bold size={16} /></button
				>
				<button
					type="button"
					class="tool"
					class:on={active('italic')}
					aria-pressed={active('italic')}
					title="Kurzíva (Ctrl+I)"
					aria-label="Kurzíva"
					onmousedown={keepFocus}
					onclick={() => run((c) => c.toggleItalic().run())}><Italic size={16} /></button
				>
				{#if !inline}
					<button
						type="button"
						class="tool"
						class:on={active('heading')}
						aria-pressed={active('heading')}
						title="Nadpis (napiš ## a mezeru)"
						aria-label="Nadpis"
						onmousedown={keepFocus}
						onclick={() => run((c) => c.toggleHeading({ level: 2 }).run())}
						><Heading size={16} /></button
					>
					<button
						type="button"
						class="tool"
						class:on={list !== 'none'}
						title={LIST_STEPS[list].title}
						aria-label={LIST_STEPS[list].label}
						onmousedown={keepFocus}
						onclick={cycleList}
						>{#if list === 'ordered'}<ListOrdered size={16} />{:else}<List size={16} />{/if}</button
					>
					<button
						type="button"
						class="tool"
						class:on={active('blockquote')}
						aria-pressed={active('blockquote')}
						title="Citace (napiš > a mezeru)"
						aria-label="Citace"
						onmousedown={keepFocus}
						onclick={() => run((c) => c.toggleBlockquote().run())}
						><span class="quote-glyph" aria-hidden="true">„“</span></button
					>
				{/if}
				<button
					type="button"
					class="tool"
					title="Vzorec (napiš $x^2$)"
					aria-label="Vzorec"
					onmousedown={keepFocus}
					onclick={insertMath}><Sigma size={16} /></button
				>
				{#if !inline}
					<button
						type="button"
						class="tool"
						class:on={active('image')}
						title="Obrázek z webu"
						aria-label="Obrázek"
						onmousedown={keepFocus}
						onclick={openImage}><ImageIcon size={16} /></button
					>
				{/if}
				<Menu label="Další formátování" icon={Ellipsis} placement="bottom-end">
					{#if !inline}
						{#if inTable}
							<MenuItem
								icon={BetweenHorizontalEnd}
								onclick={() => run((c) => c.addRowAfter().run())}>Přidat řádek</MenuItem
							>
							<MenuItem
								icon={BetweenVerticalEnd}
								onclick={() => run((c) => c.addColumnAfter().run())}>Přidat sloupec</MenuItem
							>
							<MenuItem icon={Trash} onclick={() => run((c) => c.deleteRow().run())}
								>Smazat řádek</MenuItem
							>
							<MenuItem icon={Trash} onclick={() => run((c) => c.deleteColumn().run())}
								>Smazat sloupec</MenuItem
							>
							<MenuItem icon={Trash} onclick={() => run((c) => c.deleteTable().run())}
								>Smazat tabulku</MenuItem
							>
						{:else}
							<MenuItem
								icon={Table}
								onclick={() =>
									run((c) => c.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run())}
								>Tabulka</MenuItem
							>
						{/if}
						<MenuSeparator />
					{/if}
					<MenuItem icon={CodeXml} onclick={showSource}>Upravit jako text (Markdown)</MenuItem>
				</Menu>
			</div>
		{/if}
	{/if}

	{#if refused}<p class="note quiet" role="status">{refused}</p>{/if}
	{#each issues.errors as error, i (i)}
		<p class="note error">{error.message}</p>
	{/each}
	{#each issues.warnings as warning, i (i)}
		<p class="note warning">{warning.message}</p>
	{/each}
</div>

<style>
	.icon-button {
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
	}

	.rich-field {
		display: flex;
		flex-direction: column;
		min-width: 0;
		border: 1px solid transparent;
		border-bottom-color: var(--e-field-rest-rule);
		border-radius: var(--radius-xs);
		background: var(--e-field-rest);
		color: var(--e-text);
	}
	.rich-field:hover:not(.disabled):not(.focused) {
		background: var(--e-field-hover);
	}
	.rich-field.focused {
		background: var(--surface);
		border-color: var(--e-focus-ring);
		outline: 2px solid var(--primary);
		outline-offset: 0;
	}
	.rich-field.invalid {
		box-shadow: inset 2px 0 0 var(--e-error);
	}

	.surface,
	.source {
		min-width: 0;
		padding: 0 8px;
	}
	.source {
		padding: 0 8px;
	}

	/* The text itself: the editor's DOM, so styled through :global. */
	.surface :global(.rich-content) {
		min-height: calc(3lh + 12px);
		max-height: 60vh;
		overflow-y: auto;
		padding: 6px 0;
		outline: none;
		line-height: 1.5;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.inline .surface :global(.rich-content) {
		min-height: 0;
		padding: 6px 0;
	}
	.surface :global(.rich-content > :first-child) {
		margin-top: 0;
	}
	.surface :global(.rich-content > :last-child) {
		margin-bottom: 0;
	}
	.surface :global(.rich-content p) {
		margin: 0 0 0.6em;
	}
	.surface :global(.rich-content [data-level]) {
		margin: 0.6em 0 0.3em;
		line-height: 1.3;
	}
	.surface :global(.rich-content [data-level='1']) {
		font-size: 1.35em;
	}
	.surface :global(.rich-content [data-level='2']) {
		font-size: 1.2em;
	}
	.surface :global(.rich-content [data-level='3']) {
		font-size: 1.05em;
	}
	.surface :global(.rich-content ul),
	.surface :global(.rich-content ol) {
		margin: 0 0 0.6em;
		padding-left: 1.4em;
	}
	.surface :global(.rich-content li p) {
		margin: 0;
	}
	.surface :global(.rich-content blockquote) {
		margin: 0 0 0.6em;
		padding-left: 10px;
		border-left: 3px solid var(--e-border);
		font-style: italic;
		color: var(--e-text-muted);
	}
	.surface :global(.rich-content code) {
		font-family: var(--font-code);
		font-size: 0.9em;
		background: var(--e-field-rest);
		border-radius: 3px;
		padding: 0 3px;
	}
	.surface :global(.rich-content pre) {
		font-family: var(--font-code);
		background: var(--e-field-rest);
		border-radius: var(--radius-xs);
		padding: 6px 8px;
		white-space: pre-wrap;
	}
	.surface :global(.rich-content pre code) {
		background: none;
		padding: 0;
	}
	.surface :global(.rich-content table) {
		border-collapse: collapse;
		margin: 0 0 0.6em;
	}
	.surface :global(.rich-content td),
	.surface :global(.rich-content th) {
		border: 1px solid var(--e-border);
		padding: 2px 8px;
		min-width: 3em;
		vertical-align: top;
	}
	.surface :global(.rich-content th) {
		font-weight: 600;
		text-align: left;
	}
	.surface :global(.rich-content td p),
	.surface :global(.rich-content th p) {
		margin: 0;
	}
	.surface :global(.rich-content img) {
		max-width: 100%;
		max-height: 220px;
		vertical-align: middle;
		border-radius: var(--radius-xs);
	}
	.surface :global(.rich-content img.ProseMirror-selectednode),
	.surface :global(.rich-content .math.ProseMirror-selectednode) {
		outline: 2px solid var(--primary);
	}
	.surface :global(.rich-content hr) {
		border: 0;
		border-top: 1px solid var(--e-border);
	}
	.surface :global(.math) {
		cursor: pointer;
		border-radius: 3px;
		padding: 0 1px;
	}
	.surface :global(.math:hover) {
		background: var(--e-field-hover);
	}
	.surface :global(.math-display) {
		display: block;
		text-align: center;
		margin: 0.3em 0;
	}
	.surface :global(.math-empty),
	.surface :global(.math-error) {
		font-family: var(--font-code);
		font-size: 0.9em;
		color: var(--e-text-muted);
	}
	/* A placeholder is a cue, not something the teacher wrote: faint and italic. */
	.surface :global(.rich-content p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
		color: var(--e-text-faint);
		font-style: italic;
	}
	.waiting {
		color: var(--e-text);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px;
		padding: 3px 4px;
		border-top: 1px solid var(--e-border);
	}
	.tool {
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
	}
	.tool:hover {
		background: var(--e-field-hover);
		color: var(--e-text);
	}
	.quote-glyph {
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 20px;
		font-weight: 400;
		line-height: 1;
		letter-spacing: -1px;
		/* The low „ and the high “ together sit centred, like an icon. */
		transform: translateY(-1px);
	}
	.tool.on {
		background: var(--e-field-rest);
		color: var(--primary);
	}
	.row :global(.menu) {
		margin-left: auto;
	}

	.panel {
		gap: 8px 12px;
		padding: 8px;
		align-items: end;
	}
	.panel label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-xs);
		color: var(--e-text-muted);
	}
	.panel label.grow {
		flex: 1 1 12rem;
	}
	.panel label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.math-field {
		flex: 1 1 14rem;
		min-width: 0;
	}
	.math-field :global(math-field) {
		display: block;
		width: 100%;
		min-height: 32px;
		padding: 2px 6px;
		font-size: 1.15em;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text);
		--caret-color: var(--primary);
		--selection-background-color: var(--e-field-hover);
		--contains-highlight-background-color: transparent;
	}
	.math-field :global(math-field:focus-within) {
		outline: 2px solid var(--primary);
		outline-offset: -1px;
	}
	/* One keyboard button and no menu: the row's own controls. */
	.math-field :global(math-field::part(virtual-keyboard-toggle)),
	.math-field :global(math-field::part(menu-toggle)) {
		display: none;
	}
	.keyboard {
		align-self: center;
	}
	.math-source {
		flex-basis: 100%;
		display: flex;
		align-items: end;
		gap: 4px;
	}
	.math-source label {
		flex: 1;
	}
	.panel textarea,
	.panel input:not([type='checkbox']) {
		font: inherit;
		font-size: var(--text-s);
		padding: 4px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text);
	}
	.panel textarea {
		font-family: var(--font-code);
		resize: vertical;
	}
	.panel-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}
	.text-button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font: inherit;
		font-size: var(--text-s);
		padding: 4px 10px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text);
		cursor: pointer;
	}
	.text-button.primary {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--e-text);
	}
	.text-button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.note {
		margin: 0;
		padding: 2px 8px 4px;
		font-size: var(--text-xs);
		line-height: 1.45;
	}
	.panel .note {
		flex-basis: 100%;
		padding: 0;
	}
	.note.quiet {
		color: var(--e-text-muted);
	}
	.note.error {
		color: var(--e-error-text);
	}
	.note.warning {
		color: var(--e-warning-text);
	}
	.disabled {
		background: none;
		color: var(--e-text-muted);
	}
</style>
