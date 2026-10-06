<script lang="ts">
	import { untrack } from 'svelte';
	import type { CourseV2 } from '$lib/domain/schema';
	import Chip from '$lib/ui/Chip.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import FocusField from '$lib/ui/FocusField.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore, useVersions } from '$lib/ui/context';
	import { setField } from '$lib/domain/commands';
	import { MODES, MODE_LABELS } from '$lib/ui/fields';
	import Modal from '$lib/ui/Modal.svelte';
	import ExportDialog from './ExportDialog.svelte';
	import VersionsDialog from './VersionsDialog.svelte';

	import {
		CircleCheck,
		Download,
		Eye,
		EyeOff,
		History,
		Redo,
		Sparkles,
		Undo,
		Upload
	} from '@lucide/svelte';
	import { courseFileName } from '$lib/domain/filename';
	interface Props {
		doc: CourseV2;
		onvalidation: () => void;
		onimport: (file: File) => void;
	}
	let { doc, onvalidation, onimport }: Props = $props();

	const store = useStore();
	const versions = useVersions();
	let fileInput = $state<HTMLInputElement | null>(null);
	let explainStorage = $state(false);

	/**
	 * Everything the bar says comes from `store.screen.topbar`: the version button's
	 * words and the number a download carries from one place (`store.versionState`),
	 * the save line and the check chip from the model, so the label can never say v3
	 * while the file says v2, and an AI is told the same line the teacher reads.
	 */
	const bar = $derived(store.screen.topbar);
	const aiBar = $derived(store.screen.ai);
	/** Whether the file on disk is what is on screen (`store.backedUp`). */
	const backedUp = $derived(store.backedUp);

	function download() {
		// The dialog only offers a download without errors; this is the backstop.
		// Before the history has loaded the file's version number would be a guess.
		if (!bar.download.can_publish || !bar.version.loaded) return;
		// The working copy goes out under the number it will be saved as, so a file
		// downloaded after version 3 was saved is never "version 1" to the platform.
		const json = store.exportJson();
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = courseFileName(doc.name, doc.course_id || 'kurz');
		link.click();
		URL.revokeObjectURL(url);
		store.markExported(json);
		store.endReview();
	}

	/**
	 * A clean course downloads at once. Anything else opens the review first: with
	 * errors it says what to finish and where, with warnings only it offers
	 * „Stáhnout i tak“. The button itself is never disabled — a greyed-out download
	 * is a refusal that does not say why.
	 */
	function requestDownload() {
		const { errors, warnings } = store.validation;
		if (errors.length === 0 && warnings.length === 0) download();
		else store.ui.reviewOpen = true;
	}

	// Having seen the review, the author is fixing rather than writing: what it
	// listed may now show where it is (`ui/issue-visibility.ts`). Untracked, or every
	// edit would take a new snapshot and the review would list whatever is new too.
	$effect(() => {
		if (store.ui.reviewOpen) untrack(() => store.beginReview());
	});
</script>

<header class="topbar">
	<div class="title">
		<FocusField
			label="Název kurzu"
			value={doc.name}
			screen="topbar.course_name"
			density="compact"
			emptyText="Název kurzu"
			onchange={(v) => store.apply((d) => setField(d, { field: 'name' }, v))}
		/>
	</div>

	<button
		type="button"
		class="version"
		onclick={() => (versions.dialogOpen = true)}
		aria-label={bar.version.name ?? undefined}
		title={bar.version.title}
	>
		<History size={14}></History>
		<span data-screen="topbar.version.label">{bar.version.label}</span>
	</button>
	<!--
        One line, chosen by what is true now. It says what a teacher can act on —
        whether the work has left the browser, or that saving has stopped — and never
        "Ukládání…", which flickered on every keystroke. The full state is the name.
    -->
	<button
		type="button"
		class="save-status {bar.save.tone}"
		onclick={() => (explainStorage = true)}
		aria-label={bar.save.label}
		title="Kurz je jen v tomto prohlížeči, ne na serveru. Klikni pro vysvětlení."
	>
		<span data-screen="topbar.save.text">{bar.save.text}</span>
	</button>
	<!-- A live region has to be outside the button, whose children are not announced. -->
	<span class="sr-only" role={bar.save.draft_status === 'error' ? 'alert' : 'status'}>
		{#if bar.save.draft_status === 'error' || bar.save.draft_status === 'blocked'}{bar.save
				.text}{/if}
	</span>

	<div class="spacer"></div>

	<button
		type="button"
		class="chip-button"
		onclick={onvalidation}
		aria-label={bar.check.label}
		title={bar.check.label}
	>
		{#if bar.check.chip.tone === 'ok'}
			<Chip tone="ok"
				><CircleCheck size={16}></CircleCheck>
				<span data-screen="topbar.check.chip.text">{bar.check.chip.text}</span></Chip
			>
		{:else}
			<Chip tone={bar.check.chip.tone} screen="topbar.check.chip.text">{bar.check.chip.text}</Chip>
		{/if}
	</button>

	<Segmented
		label="Režim editoru"
		value={bar.mode}
		options={MODES.map((mode) => ({ value: mode, ...MODE_LABELS[mode] }))}
		onchange={(mode) => (store.mode = mode)}
	/>

	<!--
        A toggle keeps one label; aria-pressed carries the state. The label is the
        name of what is switched, so it never has to flip to say what a click does.
    -->
	<Button
		variant="ghost"
		size="s"
		pressed={bar.show_feedback}
		ariaLabel="Zpětná vazba"
		title={bar.feedback_title}
		onclick={() => (store.showFeedback = !store.showFeedback)}
	>
		{#if bar.show_feedback}
			<Eye size={16}></Eye>
		{:else}
			<EyeOff size={16}></EyeOff>
		{/if}
		Zpětná vazba
	</Button>

	<!-- The glyph is the label a mouse reads; the accessible name has to be a word. -->
	<Button
		variant="ghost"
		onclick={() => store.undo()}
		disabled={!bar.can_undo}
		title="Zpět"
		ariaLabel="Zpět"
	>
		<Undo size={16}></Undo>
	</Button>
	<Button
		variant="ghost"
		onclick={() => store.redo()}
		disabled={!bar.can_redo}
		title="Vpřed"
		ariaLabel="Vpřed"
	>
		<Redo size={16}></Redo>
	</Button>

	<Button
		variant="ghost"
		pressed={aiBar.button.pressed}
		disabled={aiBar.button.disabled}
		title={aiBar.button.title}
		ariaLabel={aiBar.button.label}
		onclick={() => (store.ai.panelOpen = !store.ai.panelOpen)}
	>
		<Sparkles size={16}></Sparkles>
		<span data-screen="ai.button.label">{aiBar.button.label}</span>
	</Button>

	<Button variant="ghost" onclick={() => fileInput?.click()}>
		<Upload size={16}></Upload> Nahrát
	</Button>
	<input
		bind:this={fileInput}
		type="file"
		accept="application/json,.json"
		hidden
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			if (file) onimport(file);
			e.currentTarget.value = '';
		}}
	/>

	<Button variant="primary" onclick={requestDownload} title={bar.download.title}>
		<Download size={16}></Download> Stáhnout
	</Button>
</header>

{#if versions.dialogOpen}
	<VersionsDialog
		onclose={() => (versions.dialogOpen = false)}
		onreview={() => {
			versions.dialogOpen = false;
			store.ui.reviewOpen = true;
		}}
	/>
{/if}

{#if store.ui.reviewOpen}
	<ExportDialog ondownload={download} onclose={() => (store.ui.reviewOpen = false)} />
{/if}

{#if explainStorage}
	<Modal title="Kde je kurz uložený" onclose={() => (explainStorage = false)}>
		<div class="storage">
			<p>
				Rozepsaný kurz se průběžně ukládá <strong>do tohoto prohlížeče</strong>, ne na server. Nikdo
				jiný k němu nemá přístup a ty se k němu nedostaneš z jiného počítače ani z jiného
				prohlížeče.
			</p>
			<p>
				Vymazání dat stránky, anonymní okno nebo přeinstalace prohlížeče rozepsaný kurz nenávratně
				smaže. Zálohou jsou <strong>uložené verze</strong> (tlačítko s číslem verze vlevo nahoře) —
				ukládají se i na server editoru, ale najde je zase jen tento prohlížeč — a stažený soubor
				JSON, který si můžeš kdykoli načíst tlačítkem <strong>Nahrát</strong>. Jen soubor přežije i
				vymazání dat prohlížeče.
			</p>
			<p class:at-risk={!backedUp}>
				{#if backedUp}
					Stažený soubor odpovídá tomu, co je teď na obrazovce.
				{:else if store.exportedJson === null}
					Tento kurz jsi ještě ani jednou nestáhl/a. Udělej to teď — stojí to jedno kliknutí.
				{:else}
					Od posledního stažení jsi kurz změnil/a. Ty změny nejsou v žádném souboru.
				{/if}
			</p>
			{#if !bar.download.can_publish}
				<p>
					Stáhnout teď nejde — v kurzu je ještě potřeba něco dokončit, jinak by žákovi lekce
					nefungovala. Tlačítko Stáhnout ukáže co a kde; zálohu si stáhni hned poté.
				</p>
			{/if}
		</div>
	</Modal>
{/if}

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--e-topbar-height);
		padding: 0 16px;
		border-bottom: 1px solid var(--e-border);
		background: var(--surface);
	}

	.title {
		min-width: 160px;
		max-width: 260px;
		overflow: hidden;
		font: var(--type-card-title-alt);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.spacer {
		flex: 1;
	}

	.chip-button {
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}

	.version {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--e-text-muted);
		font: var(--type-chip-label);
		white-space: nowrap;
		cursor: pointer;
	}

	.version:hover {
		border-color: var(--e-border-strong);
		color: var(--e-text);
	}

	.save-status {
		padding: 2px 6px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		font: inherit;
		font-size: var(--text-xs);
		line-height: 1.25;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}

	.save-status.warning {
		color: var(--e-warning);
	}

	.save-status.error {
		color: var(--e-error);
	}

	.save-status:hover {
		background: var(--e-field-hover);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.storage {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 52ch;
		line-height: 1.55;
	}

	.storage p {
		margin: 0;
	}

	.storage p.at-risk {
		color: var(--e-warning);
	}
</style>
