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
	import { onMount } from 'svelte';
	import { DocStore } from '$lib/state/doc-store.svelte';
	import { setStore } from '$lib/ui/context';
	import Sidebar from '$lib/editor/Sidebar.svelte';
	import Topbar from '$lib/editor/Topbar.svelte';
	import CardEditor from '$lib/editor/CardEditor.svelte';
	import PreviewColumn from '$lib/editor/PreviewColumn.svelte';
	import ValidationPanel from '$lib/editor/ValidationPanel.svelte';
	import RepairDialog from '$lib/editor/RepairDialog.svelte';
	import CourseSettings from '$lib/editor/CourseSettings.svelte';
	import LessonSettings from '$lib/editor/LessonSettings.svelte';
	import CardSettings from '$lib/editor/CardSettings.svelte';
	import { addBlock } from '$lib/domain/commands';
	import { importCourseJson, emptyCourse } from '$lib/domain/document';
	import { looksLikeGpfTaxonomy, skillConfigFromGpfTaxonomy } from '$lib/domain/skill-config';
	import { blockPreview } from '$lib/domain/derive';
	import { loadSkillConfig } from '$lib/api/client';
	import type { ImportNote } from '$lib/domain/legacy';

	const store = new DocStore();
	setStore(store);

	let sidebarCollapsed = $state(false);
	let showValidation = $state(false);
	let repairTarget = $state<{ blockId: string; stepId?: string } | null>(null);
	let importNotes = $state<ImportNote[]>([]);
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
		| { kind: 'lesson'; lessonId: string }
		| { kind: 'card'; blockId: string }
		| null
	>(null);

	const doc = $derived(store.doc);
	/**
	 * Which lesson is being worked on.
	 *
	 * A ref does not always carry a `lessonId` — `setField` returns one addressed at
	 * the block, and a click in the preview reports what it can see. So the lesson is
	 * resolved from the selected card when the ref is silent about it, and only then
	 * from the first lesson in the course. Everything else on the screen reads this
	 * one value, including the tree, which is what keeps the highlight on the left
	 * and the card in the middle from ever disagreeing.
	 */
	const lesson = $derived.by(() => {
		const selection = store.selection;
		if (selection?.lessonId !== undefined) {
			return doc.lessons.find((l) => l.lesson_id === selection.lessonId);
		}
		if (selection?.blockId !== undefined) {
			const owner = (store.index.lessonsByBlock.get(selection.blockId) ?? [])[0];
			if (owner !== undefined) return doc.lessons.find((l) => l.lesson_id === owner);
			// A card in no lesson at all. Belonging to the first lesson would be a lie.
			if (doc.blocks.some((b) => b.block_id === selection.blockId)) return undefined;
		}
		return doc.lessons[0];
	});
	const selectedBlock = $derived(
		store.selection?.blockId !== undefined
			? doc.blocks.find((b) => b.block_id === store.selection?.blockId)
			: undefined
	);
	/** The card in the editor column, and the card the preview shows. */
	const card = $derived(
		selectedBlock ??
			(lesson !== undefined
				? doc.blocks.find((b) => b.block_id === lesson.blocks[0]?.block_id)
				: undefined)
	);
	const binding = $derived(
		card === undefined ? undefined : lesson?.blocks.find((b) => b.block_id === card.block_id)
	);
	/** A card in no lesson at all: editable, but the student never reaches it. */
	const orphaned = $derived(
		card !== undefined && (store.index.lessonsByBlock.get(card.block_id) ?? []).length === 0
	);

	const TYPE_LABEL = { display: 'Výklad', question: 'Otázka', exercise: 'Cvičení' } as const;

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
			store.load(imported);
			store.selection = imported.lessons[0] !== undefined
				? { lessonId: imported.lessons[0].lesson_id }
				: null;
			importNotes = report.notes;
			void loadConfig();
		} catch (error) {
			importError = error instanceof Error ? error.message : String(error);
		}
	}

	async function loadConfig() {
		const config = await loadSkillConfig(store.doc.course_id);
		if (config !== null) store.skillConfig = config;
	}

	// A card is always open — the editor column has nothing else to show. Without
	// this, entering a lesson would land on an empty column with nothing to type into.
	$effect(() => {
		const current = lesson;
		if (current === undefined || current.blocks.length === 0) return;
		const selected = store.selection?.blockId;
		if (selected !== undefined && current.blocks.some((b) => b.block_id === selected)) return;
		// A card that belongs to no lesson was selected on purpose, from the tree's
		// orphan list. Taking the selection away from it is how that list used to be
		// unusable: the click registered and the editor immediately jumped back.
		if (
			selected !== undefined &&
			doc.blocks.some((b) => b.block_id === selected) &&
			(store.index.lessonsByBlock.get(selected) ?? []).length === 0
		) {
			return;
		}
		store.selection = { lessonId: current.lesson_id, blockId: current.blocks[0].block_id };
	});

	onMount(() => {
		store.load(emptyCourse('NOVY_KURZ', 'Nový kurz'));
		store.apply((d, r) => {
			const withLesson = { ...d, lessons: [{ lesson_id: 'L1', version: 1, name: 'První lekce', order: 1, blocks: [] }] };
			return addBlock(withLesson, 'L1', 'display', undefined, r);
		});
		store.dirty = false;
		void loadConfig();
	});

	function onkeydown(event: KeyboardEvent) {
		const meta = event.metaKey || event.ctrlKey;
		if (!meta) return;
		if (event.key === 'z' && !event.shiftKey) {
			event.preventDefault();
			store.undo();
		} else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
			event.preventDefault();
			store.redo();
		}
	}
</script>

<svelte:window onkeydown={onkeydown} />

<div class="shell">
	<Topbar {doc} onvalidation={() => (showValidation = !showValidation)} {onimport} />

	{#if showValidation}
		<ValidationPanel onclose={() => (showValidation = false)} />
	{/if}

	<div class="columns">
		<Sidebar
			{doc}
			activeLessonId={lesson?.lesson_id}
			activeBlockId={card?.block_id}
			collapsed={sidebarCollapsed}
			ontoggle={() => (sidebarCollapsed = !sidebarCollapsed)}
			oncourseSettings={() => (modal = { kind: 'course' })}
			onlessonSettings={(lessonId) => (modal = { kind: 'lesson', lessonId })}
		/>

		<main class="editor">
			{#if importError !== null}
				<div class="banner error">
					<strong>Soubor se nepodařilo načíst.</strong>
					{importError}
					<button type="button" onclick={() => (importError = null)}>×</button>
				</div>
			{/if}

			{#if importNotes.length > 0}
				<div class="banner">
					<strong>Při načtení se něco převedlo ({importNotes.length}):</strong>
					<ul>
						{#each importNotes.slice(0, 8) as note (note.code + (note.ref?.blockId ?? '') + note.message)}
							<li>{note.message}</li>
						{/each}
						{#if importNotes.length > 8}<li>…a dalších {importNotes.length - 8}.</li>{/if}
					</ul>
					<button type="button" onclick={() => (importNotes = [])}>×</button>
				</div>
			{/if}

			{#if lesson === undefined && card === undefined}
				<p class="empty">Začni přidáním lekce vlevo.</p>
			{:else if card === undefined}
				<p class="empty">
					Lekce „{lesson?.name}“ zatím nemá kartu. Přidej ji v seznamu vlevo — bez karty žák
					v lekci nic neuvidí.
				</p>
			{:else}
				<header class="card-head">
					<p class="crumb">
						{#if orphaned}
							<span class="warn">Karta mimo lekce — žák se k ní nedostane</span>
						{:else if lesson !== undefined}
							<button type="button" onclick={() => (modal = { kind: 'lesson', lessonId: lesson.lesson_id })}>
								{lesson.name ?? 'Lekce'}
							</button>
							<span aria-hidden="true">›</span>
							<span>{TYPE_LABEL[card.type]}</span>
						{/if}
					</p>
					<h1>{blockPreview(card)}</h1>
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

		<PreviewColumn {doc} block={card} lessonId={lesson?.lesson_id} />
	</div>

	{#if modal?.kind === 'course'}
		<CourseSettings {doc} onclose={() => (modal = null)} />
	{:else if modal?.kind === 'lesson'}
		<LessonSettings {doc} lessonId={modal.lessonId} onclose={() => (modal = null)} />
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
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.editor {
		flex: 1;
		min-width: 0;
		padding: var(--e-gutter);
		overflow-y: auto;
	}

	.card-head {
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

	.crumb button {
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		text-decoration-style: dotted;
		cursor: pointer;
	}

	.crumb button:hover {
		color: var(--e-text);
	}

	.crumb .warn {
		color: var(--e-warning);
	}

	h1 {
		margin: 0;
		font: var(--type-heading-3);
		color: var(--e-text);
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
</style>
