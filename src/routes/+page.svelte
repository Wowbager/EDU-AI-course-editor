<script lang="ts">
	/**
	 * The editor shell: tree · one card · preview (plan §4).
	 *
	 * The centre column holds exactly one card. It used to stack every card in the
	 * lesson, with one expanded and the rest collapsed to a summary line, and the
	 * honest report was that you could not tell what was going on in a lesson: the
	 * shape of the lesson was buried in the same column as the work. The shape now
	 * lives in the tree on the left, where it can be read at a glance, and this
	 * column is only ever the thing being written.
	 *
	 * Desktop only, targeting 1440 and degrading to 1280 — a teacher builds a lesson
	 * at a desk, and the preview column is what makes the tool honest.
	 */
	import { onMount, untrack } from 'svelte';
	import { DraftSession } from '$lib/state/draft-session.svelte';
	import { DRAFT_KEY } from '$lib/state/draft';
	import { readLayout, writeLayout } from '$lib/state/layout-prefs';
	import { DocStore } from '$lib/state/doc-store.svelte';
	import { exposeScreen } from '$lib/state/screen-hook';
	import { setStepView, setStore, setVersions } from '$lib/ui/context';
	import { StepView } from '$lib/state/step-view.svelte';
	import { VersionStore } from '$lib/state/versions/version-store.svelte';
	import { BrowserBackend } from '$lib/state/versions/browser';
	import { ServerBackend, workspaceKey } from '$lib/state/versions/server';
	import { browser } from '$app/environment';
	import Sidebar from '$lib/editor/Sidebar.svelte';
	import Topbar from '$lib/editor/Topbar.svelte';
	import CardEditor from '$lib/editor/CardEditor.svelte';
	import PreviewColumn from '$lib/editor/PreviewColumn.svelte';
	import ValidationPanel from '$lib/editor/ValidationPanel.svelte';
	import RepairDialog from '$lib/editor/RepairDialog.svelte';
	import Toast from '$lib/editor/Toast.svelte';
	import CourseSettings from '$lib/editor/CourseSettings.svelte';
	import LessonSettings from '$lib/editor/LessonSettings.svelte';
	import CardSettings from '$lib/editor/CardSettings.svelte';
	import FocusField from '$lib/ui/FocusField.svelte';
	import { addBlock, setField } from '$lib/domain/commands';
	import { importCourseJson, emptyCourse } from '$lib/domain/document';
	import { newCourseId } from '$lib/domain/ids';
	import { looksLikeGpfTaxonomy, skillConfigFromGpfTaxonomy } from '$lib/domain/skill-config';
	import { cardLabel } from '$lib/domain/naming';
	import { lessonLabel } from '$lib/domain/naming';
	import { fieldSpec } from '$lib/ui/fields';
	import { loadSkillConfig } from '$lib/api/client';
	import type { ImportNote } from '$lib/domain/legacy';
	import { X } from '@lucide/svelte';
	import { cardsCount, counted } from '$lib/ui/plural';

	const store = new DocStore();
	setStore(store);
	setStepView(new StepView());
	/**
	 * The open course's version history (`state/versions/`). Loaded whenever the
	 * course changes — a new course, an import, a restored draft — and nothing else:
	 * an edit changes the working copy, never the history.
	 */
	const key = browser ? workspaceKey() : null;
	const versions = new VersionStore([
		new BrowserBackend(),
		...(key !== null ? [new ServerBackend(key)] : [])
	]);
	setVersions(versions);
	store.attachHistory(versions);
	const courseId = $derived(store.doc.course_id);
	$effect(() => {
		const id = courseId;
		untrack(() => void versions.load(id));
	});
	let recovery = $state<DraftSession | null>(null);

	$effect(() => {
		const session = recovery;
		// Track all durable values; the writer reads the freshest state at flush time.
		void JSON.stringify(store.source);
		void JSON.stringify(store.selection);
		void store.mode;
		void store.showFeedback;
		if (session) untrack(() => session.schedule());
	});

	/** The notice has buttons when saving is stuck; those stay until dealt with. */
	const recoveryStuck = $derived(recovery?.status === 'blocked' || recovery?.status === 'error');
	// "Obnoven koncept…" is news for a moment, not a state: it goes by itself unless
	// it carries a button. Only the message is tracked, so typing (which flips the
	// status) does not restart the clock.
	$effect(() => {
		const session = recovery;
		const message = session?.message;
		if (!session || !message) return;
		const timer = setTimeout(() => {
			const stuck = session.status === 'blocked' || session.status === 'error';
			if (!stuck && session.message === message) session.message = '';
		}, 8000);
		return () => clearTimeout(timer);
	});

	/**
	 * `null` until the remembered layout has been read on mount; the preview shows
	 * as expanded meanwhile. Nothing is written back while it is `null`, so the
	 * defaults of a page that has not looked yet never overwrite what was saved.
	 */
	let previewCollapsed = $state<boolean | null>(null);
	/** Set two frames after mount, so restoring a folded panel does not animate. */
	let settled = $state(false);

	$effect(() => {
		const preview = previewCollapsed;
		const sidebar = store.ui.sidebarCollapsed;
		if (preview === null) return;
		writeLayout(localStorage, {
			sidebarCollapsed: sidebar,
			previewCollapsed: preview
		});
	});

	let repairTarget = $state<{ blockId: string; stepId?: string } | null>(null);
	let importNotes = $state<ImportNote[]>([]);

	/**
	 * Set when a file was imported. Nothing in it has been "touched", so its
	 * unfinished parts would stay quiet (`ui/issue-visibility.ts`); one calm line
	 * says there is something left, instead of painting it all red. A restored draft
	 * does not set it: its unfinished parts are the teacher's own, and the top bar's
	 * "N k dokončení" already counts them.
	 */
	let inherited = $state(false);
	let importError = $state<string | null>(null);

	/**
	 * Which settings panel is open, if any. One variable rather than three booleans,
	 * because the three are mutually exclusive and a modal stack is not a thing this
	 * screen should be able to produce. It lives here and not in `DocStore`: the
	 * store carries what the domain reads, and no command has an opinion about
	 * dialogs.
	 */
	let modal = $state<
		| { kind: 'course' }
		| { kind: 'lesson'; lessonId: string; focusName?: boolean }
		| { kind: 'card'; blockId: string }
		| null
	>(null);

	const doc = $derived(store.doc);
	const lesson = $derived(store.open.lesson);
	const card = $derived(store.open.card);
	const binding = $derived(store.open.binding);
	const orphaned = $derived(store.open.orphaned);
	const nameSpec = fieldSpec('block', 'name');

	async function onimport(file: File) {
		importError = null;
		try {
			const text = await file.text();

			// The same control takes the taxonomy export from the admin page. It is a
			// list of domains, not a course, and it replaces the dimension set rather
			// than the document.
			const parsed: unknown = JSON.parse(text);
			if (looksLikeGpfTaxonomy(parsed)) {
				store.skillConfig = skillConfigFromGpfTaxonomy(parsed, file.name.replace(/\.json$/i, ''));
				importNotes = [
					{
						code: 'IMPORT_SKILL_CONFIG',
						message: `Načtena sada dovedností „${file.name}“ — ${store.skillConfig.vector?.dimension_count} dovedností. Vektory se nově kontrolují proti ní.`
					}
				];
				return;
			}

			const { doc: imported, report } = importCourseJson(text);
			if (
				store.dirty &&
				!window.confirm(
					'Nahradit rozepsaný kurz načteným souborem? Nejprve si případně stáhni jeho zálohu.'
				)
			)
				return;
			store.load(imported);
			inherited = true;
			// Every question gets its own card in the app; the teacher's cards stay
			// as they were written (`domain/groups.ts`).
			const { split, keptTogether } = store.splitQuestions();
			// A file brings its number with it: recorded as a version, so the next
			// save cannot reuse the number it was already published under. Recorded
			// after the split, as the editor holds the course: before it, the split
			// itself made the new version read "upraveno" before any edit was made.
			void versions.recordImport($state.snapshot(store.source));
			store.selection =
				imported.lessons[0] !== undefined ? { lessonId: imported.lessons[0].lesson_id } : null;
			importNotes = [...report.notes, ...splitNotes(split, keptTogether)];
			void loadConfig();
		} catch (error) {
			importError = error instanceof Error ? error.message : String(error);
		}
	}

	/** What splitting an imported course's questions did, said once and calmly. */
	function splitNotes(split: string[], keptTogether: string[]): ImportNote[] {
		const cards = cardsCount;
		return [
			...(split.length > 0
				? [
						{
							code: 'IMPORT_QUESTIONS_SPLIT',
							message: `${cards(split.length)} s více otázkami: každá otázka se teď žákovi hodnotí zvlášť. V editoru vypadají stejně.`
						}
					]
				: []),
			...(keptTogether.length > 0
				? [
						{
							code: 'IMPORT_QUESTIONS_KEPT_TOGETHER',
							message: `${cards(keptTogether.length)} s větvením mezi vlastními otázkami ${keptTogether.length === 1 ? 'zůstává celá' : 'zůstávají celé'} a hodnotí se jako celek, aby se nezměnila cesta žáka.`
						}
					]
				: [])
		];
	}

	async function loadConfig() {
		// Both the initial seed and an import fire this without awaiting it, so two
		// requests can be in flight at once. Without the recheck the slower answer
		// wins, and the course is measured against another course's dimensions.
		const courseId = store.doc.course_id;
		const config = await loadSkillConfig(courseId).catch(() => null);
		if (store.doc.course_id === courseId) store.skillConfig = config;
	}

	onMount(() => {
		exposeScreen(store);
		const session = new DraftSession(store);
		recovery = session;
		// Typing that landed before hydration finished already made the document
		// dirty; seeding or restoring now would silently discard it.
		const restored = !store.dirty && session.restore();
		if (restored) {
			store.splitQuestions();
		}
		if (!store.dirty && !restored) {
			store.load(emptyCourse(newCourseId(), 'Nový kurz'));
			store.apply((d, r) => {
				const withLesson = {
					...d,
					lessons: [
						{
							lesson_id: 'L1',
							version: 1,
							name: 'První lekce',
							order: 1,
							blocks: []
						}
					]
				};
				return addBlock(withLesson, 'L1', 'display', undefined, r);
			});
			store.dirty = false;
		}
		void loadConfig();
		const layout = readLayout(localStorage);
		store.ui.sidebarCollapsed = layout.sidebarCollapsed;
		previewCollapsed = layout.previewCollapsed;
		const flush = () => session.flush();
		const hidden = () => {
			if (document.visibilityState === 'hidden') flush();
		};
		const unload = (event: BeforeUnloadEvent) => {
			// Force a current write, including input in this same event turn.
			if (session.status !== 'blocked') session.schedule();
			flush();
			if (session.status !== 'saved') {
				event.preventDefault();
				event.returnValue = '';
			}
		};
		const changed = (event: StorageEvent) => {
			// Only DRAFT_KEY (and a cleared storage) count as another tab's edit; the
			// layout lives under its own key, so folding a panel there is not a conflict.
			if (event.key === DRAFT_KEY || event.key === null) session.conflict();
		};
		window.addEventListener('beforeunload', unload);
		window.addEventListener('pagehide', flush);
		window.addEventListener('storage', changed);
		document.addEventListener('visibilitychange', hidden);
		// Deterministic signal for tests (and the trace viewer) that hydration,
		// including draft restore and the initial seed, has finished. Set last,
		// so that it cannot be observed before the thing it claims to announce:
		// a test that types as soon as it appears must not have its first
		// keystrokes discarded by the seed that follows.
		document.documentElement.dataset.hydrated = 'true';
		const frame = requestAnimationFrame(() => requestAnimationFrame(() => (settled = true)));
		return () => {
			cancelAnimationFrame(frame);
			flush();
			session.dispose();
			window.removeEventListener('beforeunload', unload);
			window.removeEventListener('pagehide', flush);
			window.removeEventListener('storage', changed);
			document.removeEventListener('visibilitychange', hidden);
		};
	});

	const togglePreview = () => (previewCollapsed = previewCollapsed !== true);

	function onkeydown(event: KeyboardEvent) {
		if (event.defaultPrevented) return;
		const meta = event.metaKey || event.ctrlKey;
		if (!meta) return;
		// AltGr arrives as Ctrl+Alt on Czech keyboards; it types characters, not commands.
		if (event.altKey) return;
		if (event.key === 'z' && !event.shiftKey) {
			event.preventDefault();
			store.undo();
		} else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
			event.preventDefault();
			store.redo();
		} else if (event.key.toLowerCase() === 'b') {
			// Plain Ctrl+B is "bold" to anyone typing; only Ctrl+Shift+B is ours there.
			if (!event.shiftKey && typing(event.target)) return;
			event.preventDefault();
			if (event.shiftKey) togglePreview();
			else store.ui.sidebarCollapsed = !store.ui.sidebarCollapsed;
		}
	}

	/** Whether the keys go into a text: a field, a menu of choices, or the Markdown editor. */
	const typing = (target: EventTarget | null) =>
		target instanceof HTMLElement &&
		(target.isContentEditable || target.closest('input, textarea, select') !== null);
</script>

<svelte:window {onkeydown} />

<div class="shell">
	<Topbar
		{doc}
		onvalidation={() => (store.ui.validationOpen = !store.ui.validationOpen)}
		{onimport}
	/>
	{#if recovery?.message}
		<div class="recovery" class:stuck={recoveryStuck} role="status">
			<p>
				{recovery.message}
			</p>
			{#if recovery.status === 'blocked'}
				<button
					type="button"
					onclick={() => {
						if (confirm('Zálohovat původní koncept a ukládat místo něj tento kurz?'))
							recovery?.replace();
					}}>Zálohovat původní a uložit tento kurz</button
				>
			{:else if recovery.status === 'error'}
				<button type="button" onclick={() => recovery?.flush()}>Zkusit uložit znovu</button>
			{/if}

			<button
				type="button"
				class="close"
				aria-label="Skrýt oznámení"
				title="Skrýt oznámení"
				onclick={() => (recovery!.message = '')}><X size={16}></X></button
			>
		</div>
	{/if}

	{#if store.ui.validationOpen}
		<ValidationPanel onclose={() => (store.ui.validationOpen = false)} />
	{/if}

	<div class="columns" class:settled>
		<Sidebar
			collapsed={store.ui.sidebarCollapsed}
			ontoggle={() => (store.ui.sidebarCollapsed = !store.ui.sidebarCollapsed)}
			oncourseSettings={() => (modal = { kind: 'course' })}
			onlessonSettings={(lessonId, options) =>
				(modal = { kind: 'lesson', lessonId, focusName: options?.focusName })}
			oncardSettings={(blockId) => (modal = { kind: 'card', blockId })}
			onrepairBlock={(blockId) => (repairTarget = { blockId })}
		/>

		<main class="editor">
			{#if importError !== null}
				<div class="banner error">
					<strong>Soubor se nepodařilo načíst.</strong>
					{importError}
					<button type="button" aria-label="Zavřít" onclick={() => (importError = null)}
						><X size={16} aria-hidden="true"></X></button
					>
				</div>
			{/if}

			{#if inherited && !store.ui.validationOpen && !store.reviewing && store.listed.errors.length > 0}
				<div class="banner unfinished" role="status">
					V kurzu je ještě {counted(store.listed.errors.length, 'věc', 'věci', 'věcí')} k dokončení.
					<button
						type="button"
						class="show"
						onclick={() => {
							// The same list the top bar's count opens.
							store.ui.validationOpen = true;
							inherited = false;
						}}>Zobrazit</button
					>
					<button type="button" aria-label="Skrýt oznámení" onclick={() => (inherited = false)}
						><X size={16} aria-hidden="true"></X></button
					>
				</div>
			{/if}

			{#if importNotes.length > 0}
				<div class="banner">
					<strong>Při načtení se něco převedlo ({importNotes.length}):</strong>
					<ul>
						{#each importNotes.slice(0, 8) as note (note.code + (note.ref?.blockId ?? '') + note.message)}
							<li>{note.message}</li>
						{/each}
						{#if importNotes.length > 8}<li>
								…a dalších {importNotes.length - 8}.
							</li>{/if}
					</ul>
					<button type="button" aria-label="Zavřít" onclick={() => (importNotes = [])}
						><X size={16} aria-hidden="true"></X></button
					>
				</div>
			{/if}

			{#if lesson === undefined && card === undefined}
				<p class="empty">Začni přidáním lekce vlevo.</p>
			{:else if card === undefined}
				<p class="empty">
					Lekce „{lesson === undefined ? '' : lessonLabel(doc, lesson)}“ zatím nemá kartu. Přidej ji
					v seznamu vlevo — bez karty žák v lekci nic neuvidí.
				</p>
			{:else}
				<header class="card-head">
					<!--
                        A card in a lesson is named by the tree and the heading below, so
                        there is nothing to say above it. The one thing worth saying is
                        that no lesson holds it.
                    -->
					{#if orphaned}
						<p class="crumb">
							<span class="warn">Karta mimo lekce — žák se k ní nedostane</span>
						</p>
					{/if}
					<!--
						The card's heading is the field that names it. It was read-only text
						derived from the first line of the card, which is why a card with a
						paragraph of content showed up in the tree as a truncated sentence
						with no way to shorten it. The placeholder is that derived name, so
						an empty field still says what the card is called today and clearing
						the field visibly returns to it — `FocusField` emits `undefined` for
						an empty value, so clearing deletes the key rather than writing "".
					-->
					<h1>
						<FocusField
							label={nameSpec?.label ?? 'Název karty'}
							value={card.name}
							ref={{ blockId: card.block_id, field: 'name' }}
							placeholder={cardLabel(doc, card, { lessonId: lesson?.lesson_id, max: 70 })}
							placeholderKind="stand-in"
							density="compact"
							onchange={(v) =>
								store.apply((d) =>
									setField(
										d,
										{
											blockId: card.block_id,
											field: 'name'
										},
										v
									)
								)}
						/>
					</h1>
					<!-- Out of flow: it appears over what is below, so focusing the title moves nothing. -->
					<p class="card-head-hint">{nameSpec?.hint}</p>
				</header>

				<CardEditor
					{doc}
					block={card}
					{binding}
					lessonId={orphaned ? undefined : lesson?.lesson_id}
					onsettings={() => (modal = { kind: 'card', blockId: card.block_id })}
					onrepairBlock={(blockId) => (repairTarget = { blockId })}
					onrepairStep={(blockId, stepId) => (repairTarget = { blockId, stepId })}
				/>
			{/if}
		</main>

		<PreviewColumn
			{doc}
			block={card}
			lessonId={lesson?.lesson_id}
			collapsed={previewCollapsed}
			ontoggle={togglePreview}
		/>

		<!-- Over the editor column, bottom left: where the eye is after clicking a card. -->
		<div class="toast-slot" class:folded={store.ui.sidebarCollapsed}>
			<Toast />
		</div>
	</div>

	{#if modal?.kind === 'course'}
		<CourseSettings {doc} onclose={() => (modal = null)} />
	{:else if modal?.kind === 'lesson'}
		<LessonSettings
			{doc}
			lessonId={modal.lessonId}
			focusName={modal.focusName}
			onclose={() => (modal = null)}
		/>
	{:else if modal?.kind === 'card' && card !== undefined && card.block_id === modal.blockId}
		<CardSettings
			{doc}
			block={card}
			{binding}
			lessonId={orphaned ? undefined : lesson?.lesson_id}
			onclose={() => (modal = null)}
		/>
	{/if}

	{#if repairTarget !== null}
		<RepairDialog {doc} target={repairTarget} onclose={() => (repairTarget = null)} />
	{/if}
</div>

<style>
	.shell {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--background);
	}

	.columns {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.toast-slot {
		position: absolute;
		bottom: 16px;
		left: calc(var(--e-sidebar-width) + 16px);
		z-index: 5;
		transition: left 0.5s;
		pointer-events: none;
	}

	.toast-slot.folded {
		left: calc(var(--e-sidebar-rail) + 16px);
	}

	.columns:not(.settled) .toast-slot {
		transition: none;
	}

	/* A folded panel restored on load is already folded; it does not slide shut. */
	.columns:not(.settled) :global(.sidebar) {
		transition: none;
	}

	.editor {
		flex: 1;
		min-width: 0;
		padding: var(--e-gutter);
		overflow-y: auto;
	}

	/*
	 * On a wide screen the card stays a comfortable width and sits in the middle of
	 * the column, instead of stretching lines of text across it. A dialog is left
	 * out: it is drawn by the browser over the whole page, not in the column.
	 */
	.editor > :global(:not(dialog)) {
		max-width: var(--e-editor-max);
		margin-inline: auto;
	}

	.card-head {
		position: relative;
		margin-bottom: 14px;
	}

	.crumb {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 0 4px;
		color: var(--e-text-faint);
		font: var(--type-caption);
	}

	.crumb .warn {
		color: var(--e-warning);
	}

	h1 {
		margin: 0;
		font: var(--type-heading-3);
		color: var(--e-text);
	}

	/*
	 * The heading field inherits the h1's type, so it reads as a title and not as a
	 * form control; the negative inset cancels FocusField's own padding so the text
	 * keeps the alignment it had when it was a plain `<h1>`.
	 */
	h1 :global(.field) {
		padding-left: 0;
		padding-right: 0;
	}

	/* Only while the title is being edited, and over the layout rather than in it. */
	.card-head-hint {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 2;
		margin: 2px 0 0;
		padding: 2px 8px;
		border-radius: var(--radius-s);
		background: var(--surface);
		box-shadow: var(--shadow-light);
		color: var(--e-text-muted);
		font: var(--type-caption);
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms;
	}

	.card-head:focus-within .card-head-hint {
		opacity: 1;
	}

	.banner {
		position: relative;
		margin-bottom: 16px;
		padding: 12px 36px 12px 14px;
		border-radius: var(--radius-s);
		background: var(--hint-bg);
		color: var(--e-text);
		font: var(--type-body-small);
	}

	.banner.unfinished {
		background: var(--surface);
		border: 1px solid var(--e-border);
	}

	.banner button.show {
		position: static;
		margin-left: 6px;
		padding: 0;
		color: var(--primary);
		font: inherit;
		font-weight: var(--weight-semibold);
		text-decoration: underline;
	}

	.banner.error {
		background: var(--e-error-bg);
		color: var(--e-error);
	}

	.banner ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}

	.banner button {
		position: absolute;
		top: 8px;
		right: 10px;
		border: none;
		background: none;
		color: inherit;
		font-size: var(--text-l);
		cursor: pointer;
	}

	.empty {
		color: var(--e-text-faint);
		line-height: 1.6;
	}

	.recovery {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 36px 12px 14px;
		border-radius: var(--radius-s);
		background: var(--surface);
		border: 1px solid var(--e-border);
		color: var(--e-text-muted);
		font: var(--type-body-small);
	}

	.recovery.stuck {
		border-color: transparent;
		background: var(--e-warning-bg);
		color: var(--e-warning);
	}

	.recovery p {
		margin: 0;
	}

	.recovery button {
		margin-left: auto;
		border: none;
		background: none;
		color: inherit;
		font-size: var(--text-l);
		cursor: pointer;
	}
</style>
