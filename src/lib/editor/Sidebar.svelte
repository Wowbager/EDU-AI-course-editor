<script lang="ts">
	/**
	 * The course tree: lessons, and the cards inside the open one.
	 *
	 * This is where a lesson becomes legible. The editor column holds one card at a
	 * time, so the shape of the lesson — how many cards, of what kind, in what order,
	 * which ones are broken — has to be readable somewhere, all at once. That is this
	 * panel's whole job, and it is why the cards moved here out of the centre.
	 *
	 * Selection lives here and nowhere else. The card in the editor column is by
	 * definition the selected one, so it carries no "you are here" marker of its own;
	 * two markers for one fact is how a screen stops being scannable.
	 *
	 * Collapses to a 56px rail (plan §4) — which cannot carry two legible levels, so
	 * it keeps the lesson numbers and nothing else.
	 */
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { CourseV2, LessonBlockBinding, LessonV2 } from '$lib/domain/schema';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { addBlock, addLesson, reorderBindings, reorderLessons } from '$lib/domain/commands';
	import { blockPreview, lessonDidactics, lessonTotals } from '$lib/domain/derive';
	import { cardsCount, stepsCount } from '$lib/ui/plural';

	interface Props {
		doc: CourseV2;
		/**
		 * What the editor column is showing. Passed in rather than read off the
		 * selection, because a ref does not always name its lesson and the tree must
		 * never highlight something other than what is open.
		 */
		activeLessonId: string | undefined;
		activeBlockId: string | undefined;
		collapsed: boolean;
		ontoggle: () => void;
		oncourseSettings: () => void;
		onlessonSettings: (lessonId: string) => void;
	}
	let {
		doc,
		activeLessonId,
		activeBlockId,
		collapsed,
		ontoggle,
		oncourseSettings,
		onlessonSettings
	}: Props = $props();

	const store = useStore();
	const selectedLesson = $derived(activeLessonId);
	const selectedBlock = $derived(activeBlockId);

	// svelte-dnd-action keys items by an `id` property; a lesson is keyed by
	// `lesson_id`, so the zone is driven by a thin wrapper rather than by renaming
	// a field the format owns.
	type LessonItem = { id: string; lesson: LessonV2 };
	let draggingLessons = $state<LessonItem[] | null>(null);
	// The key carries the position as well as the id. A document with two lessons
	// sharing an id is exactly the document the validator exists to complain about,
	// and a keyed `{#each}` on the id alone throws before the author can read the
	// complaint — the tool would break on the error it is meant to report.
	const items = $derived(
		draggingLessons ?? doc.lessons.map((lesson, i) => ({ id: `${lesson.lesson_id}#${i}`, lesson }))
	);

	function onconsider(event: CustomEvent<DndEvent<LessonItem>>) {
		draggingLessons = event.detail.items;
	}
	function onfinalize(event: CustomEvent<DndEvent<LessonItem>>) {
		draggingLessons = null;
		store.apply((d) => reorderLessons(d, event.detail.items.map((item) => item.lesson.lesson_id)));
	}

	// The card zone, for the open lesson only — which is what keeps the two nested
	// drag zones from ever having to coexist.
	type CardItem = { id: string; binding: LessonBlockBinding };
	let draggingCards = $state<CardItem[] | null>(null);
	const openLesson = $derived(doc.lessons.find((l) => l.lesson_id === selectedLesson));
	const cards = $derived(
		draggingCards ??
			(openLesson?.blocks ?? []).map((binding, i) => ({ id: `${binding.block_id}#${i}`, binding }))
	);

	function oncardConsider(event: CustomEvent<DndEvent<CardItem>>) {
		draggingCards = event.detail.items;
	}
	function oncardFinalize(event: CustomEvent<DndEvent<CardItem>>) {
		draggingCards = null;
		if (openLesson === undefined) return;
		store.apply((d) =>
			reorderBindings(
				d,
				openLesson.lesson_id,
				event.detail.items.map((item) => item.binding.block_id)
			)
		);
	}

	const errorsIn = (lessonId: string) =>
		store.validation.errors.filter(
			(issue) =>
				issue.ref.lessonId === lessonId ||
				(issue.ref.blockId !== undefined &&
					(store.index.lessonsByBlock.get(issue.ref.blockId) ?? []).includes(lessonId))
		).length;

	const errorsOn = (blockId: string) =>
		store.validation.errors.filter((issue) => issue.ref.blockId === blockId).length;

	const orphans = $derived(
		doc.blocks.filter((b) => (store.index.lessonsByBlock.get(b.block_id) ?? []).length === 0)
	);

	const TYPE_LABEL = { display: 'Výklad', question: 'Otázka', exercise: 'Cvičení' } as const;

	/**
	 * The three card types, described by what the *student* does — because from the
	 * author's side all three scaffold nearly identically and the names do not say
	 * what changes. The difference is real and it is in `block_step_engine.dart`:
	 *
	 *  - `display` renders one step per card and only up to `_currentStepIndex`, so
	 *    the student is shown a step at a time and taps to continue;
	 *  - `question` and `exercise` go through `_buildExerciseCard()` — every step in
	 *    one bubble — and `_skipToNextQuestion()` runs on mount and after every
	 *    answer, so the cursor lands straight on the question and the text around it
	 *    is passive context that is never a stop;
	 *  - `exercise` additionally has `go_to` ignored (`step_navigation.dart`:
	 *    `if (blockType == BlockType.exercise) return nextStep`).
	 *
	 * "Cvičení" is also the name of a whole course type in Nastavení kurzu and of the
	 * daily practice queue, so this one says which of the three it is.
	 */
	const ADD_CARD = [
		{
			type: 'display',
			label: 'Výklad',
			title:
				'Karta typu Výklad — čtení po krocích. Žák vidí jeden krok, klikne Pokračovat a teprve pak se objeví další; hotové kroky mu zůstanou nad tím. Otázka vložená dovnitř výkladu je zastávka: dokud na ni neodpoví, další krok neuvidí.'
		},
		{
			type: 'question',
			label: 'Otázka',
			title:
				'Karta typu Otázka — jedna bublina, ve které je žák rovnou u otázky. Text, který napíšeš před ni, čte jako zadání, ne jako samostatnou zastávku. Podle zvolené odpovědi ho umí poslat na jiný krok nebo na jinou kartu. Použij, když má odpověď rozhodnout, co bude dál.'
		},
		{
			type: 'exercise',
			label: 'Cvičení',
			title:
				'Karta typu Cvičení (jedna karta v lekci — ne typ celého kurzu v Nastavení kurzu ani zařazení do denního opakování). Chová se jako Otázka, ale větvení se ignoruje: žák projde úlohy vždy ve stejném pořadí. Pro drilování postupu, který už zná.'
		}
	] as const;

	function select(lessonId: string, blockId: string) {
		store.selection = { lessonId, blockId };
	}

	function selectLesson(lessonId: string) {
		store.selection = { lessonId };
	}

	function selectOrphan(blockId: string) {
		store.selection = { blockId };
	}
</script>

<nav class="sidebar" class:collapsed aria-label="Struktura kurzu">
	<button type="button" class="rail-toggle" onclick={ontoggle} title={collapsed ? 'Rozbalit' : 'Sbalit'}>
		{collapsed ? '›' : '‹'}
	</button>

	{#if !collapsed}
		<button type="button" class="course" onclick={oncourseSettings}>
			<span class="gear" aria-hidden="true">⚙</span>
			<span class="name">{doc.name || 'Nový kurz'}</span>
			<span class="meta">Nastavení kurzu</span>
		</button>

		<h2>Lekce</h2>

		<ul use:dndzone={{ items, flipDurationMs: 150, dropTargetStyle: {} }} onconsider={onconsider} onfinalize={onfinalize}>
			{#each items as item (item.id)}
				{@const lesson = item.lesson}
				{@const totals = lessonTotals(lesson, store.index)}
				{@const didactics = lessonDidactics(lesson, store.index)}
				{@const errors = errorsIn(lesson.lesson_id)}
				{@const open = lesson.lesson_id === selectedLesson}
				<li class="tree-lesson" class:open>
					<button
						type="button"
						class="lesson"
						class:selected={open}
						onclick={() => selectLesson(lesson.lesson_id)}
					>
						<span class="name">{lesson.name ?? lesson.lesson_id}</span>
						<span class="meta">
							{cardsCount(totals.blockCount)} · {totals.durationMinutes} min · {totals.xp} XP
						</span>
						{#if errors > 0}<span class="badge">{errors}</span>{/if}
					</button>
					<div class="row-actions" class:pinned={open}>
						<button
							type="button"
							title="Nastavení lekce"
							aria-label={`Nastavení lekce ${lesson.name ?? lesson.lesson_id}`}
							onclick={() => onlessonSettings(lesson.lesson_id)}
						>
							⚙
						</button>
					</div>

					{#if open}
						{#if didactics.wrongOptionFeedbackShare < 0.5 && totals.blockCount > 0}
							<p
								class="nudge"
								title="Podíl chybných odpovědí, které žákovi řeknou, kde udělal chybu"
							>
								Zpětná vazba jen u {Math.round(didactics.wrongOptionFeedbackShare * 100)} % chybných odpovědí
							</p>
						{/if}

						<ul
							class="cards"
							use:dndzone={{ items: cards, flipDurationMs: 150, dropTargetStyle: {}, type: 'bindings' }}
							onconsider={oncardConsider}
							onfinalize={oncardFinalize}
						>
							{#each cards as card, position (card.id)}
								{@const block = doc.blocks.find((b) => b.block_id === card.binding.block_id)}
								<li>
									{#if block === undefined}
										<span class="missing" title={card.binding.block_id}>Chybějící karta</span>
									{:else}
										{@const cardErrors = errorsOn(block.block_id)}
										<button
											type="button"
											class="tree-card"
											class:selected={block.block_id === selectedBlock}
											onclick={() => select(lesson.lesson_id, block.block_id)}
										>
											<span class="type">{TYPE_LABEL[block.type]}</span>
											<!--
												The position is a fallback name for a card with no text
												yet, not a number printed next to every card: three cards
												added in a row were otherwise all "Karta bez textu" here.
											-->
											<span class="snippet">{blockPreview(block, 44, position + 1)}</span>
											<span class="steps">{stepsCount(block.steps.length)}</span>
											{#if cardErrors > 0}<span class="badge">{cardErrors}</span>{/if}
										</button>
									{/if}
								</li>
							{/each}
						</ul>

						<div class="tree-add">
							<span class="add-label">Přidat kartu:</span>
							{#each ADD_CARD as option (option.type)}
								<Button
									variant="secondary"
									size="s"
									title={option.title}
									onclick={() => store.apply((d, r) => addBlock(d, lesson.lesson_id, option.type, undefined, r))}
								>
									{option.label}
								</Button>
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<div class="add">
			<!--
				No name is passed: `addLesson` numbers the default against the lessons
				already in the course ("Nová lekce", "Nová lekce 2", …). Passing the
				literal here is what made every new lesson identical in this list.
			-->
			<Button variant="secondary" onclick={() => store.apply((d, r) => addLesson(d, undefined, r))}>
				+ Nová lekce
			</Button>
		</div>

		{#if orphans.length > 0}
			<h2 class="secondary">Karty mimo lekce</h2>
			<ul class="orphans">
				{#each orphans as block (block.block_id)}
					<li>
						<button
							type="button"
							class="tree-card"
							class:selected={block.block_id === selectedBlock}
							onclick={() => selectOrphan(block.block_id)}
						>
							<span class="type">{TYPE_LABEL[block.type]}</span>
							<span class="snippet">{blockPreview(block, 44)}</span>
							<span class="steps">žák se k ní nedostane</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		<ul class="rail">
			{#each doc.lessons as lesson, i (`${lesson.lesson_id}#${i}`)}
				<li>
					<button
						type="button"
						class="rail-item"
						class:selected={lesson.lesson_id === selectedLesson}
						title={lesson.name ?? lesson.lesson_id}
						onclick={() => selectLesson(lesson.lesson_id)}
					>
						{i + 1}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if !collapsed}
		<footer>
			<Chip tone="quiet" title="Součet přes celý kurz">{store.totals.durationMinutes} min</Chip>
			<Chip tone="quiet" title={doc.max_xp ? `Strop kurzu je ${doc.max_xp} XP` : 'Bez stropu'}>
				{store.totals.cappedXp} XP
			</Chip>
		</footer>
	{/if}
</nav>

<style>
	.sidebar {
		position: relative;
		display: flex;
		flex-direction: column;
		width: var(--e-sidebar-width);
		flex: none;
		padding: 16px 12px;
		border-right: 1px solid var(--e-border);
		background: var(--surface);
		overflow-y: auto;
	}

	.sidebar.collapsed {
		width: var(--e-sidebar-rail);
		padding: 16px 6px;
	}

	.rail-toggle {
		position: absolute;
		top: 12px;
		right: 8px;
		width: 22px;
		height: 22px;
		border: 1px solid var(--e-border);
		border-radius: 50%;
		background: var(--surface);
		color: var(--e-text-muted);
		cursor: pointer;
		z-index: 1;
	}

	.course {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0 8px;
		width: 100%;
		margin-bottom: 8px;
		padding: 8px 30px 8px 10px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.course:hover {
		border-color: var(--primary);
		background: var(--primary-dark-06);
	}

	.gear {
		grid-row: span 2;
		align-self: center;
		color: var(--e-text-faint);
	}

	h2 {
		margin: 6px 0 10px;
		color: var(--e-text-faint);
		font: var(--type-badge-small);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	h2.secondary {
		margin-top: 20px;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		position: relative;
	}

	.tree-lesson:hover .row-actions {
		display: flex;
	}

	.tree-lesson.open {
		margin-bottom: 8px;
		padding-bottom: 6px;
		border-radius: var(--radius-s);
		background: var(--primary-dark-06);
	}

	.lesson {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: var(--radius-s);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.lesson:hover {
		background: var(--info-bg);
	}

	.lesson.selected .name {
		font: var(--type-meta-bold);
	}

	.name {
		color: var(--e-text);
		font: var(--type-body-small);
	}

	.meta {
		color: var(--e-text-faint);
		font: var(--type-caption);
	}

	.badge {
		min-width: 18px;
		padding: 1px 5px;
		border-radius: var(--radius-pill);
		background: var(--e-error-bg);
		color: var(--e-error);
		font-size: var(--text-xs);
		text-align: center;
	}

	.lesson .badge {
		position: absolute;
		top: 8px;
		right: 30px;
	}

	.nudge {
		margin: 0 10px 6px;
		color: var(--e-warning);
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	/*
	 * The gear on the open lesson is always there; duplicate and delete moved into
	 * the panel it opens. An action that only exists on hover is an action nobody
	 * finds, and the one thing worth finding here is the settings.
	 */
	.row-actions {
		display: none;
		position: absolute;
		top: 8px;
		right: 6px;
		gap: 2px;
	}

	.row-actions.pinned {
		display: flex;
	}

	.row-actions button {
		width: 22px;
		height: 22px;
		border: none;
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text-faint);
		cursor: pointer;
	}

	.row-actions button:hover {
		background: var(--surface-light);
		color: var(--e-text);
	}

	.cards {
		gap: 1px;
		margin: 0 6px;
	}

	.tree-card {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 2px 6px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		border-left: 2px solid transparent;
		border-radius: var(--radius-xs);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.tree-card:hover {
		background: var(--surface);
	}

	.tree-card.selected {
		border-left-color: var(--primary);
		background: var(--surface);
		box-shadow: var(--shadow-light);
	}

	.type {
		color: var(--e-text-muted);
		font: var(--type-badge-small);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.snippet {
		overflow: hidden;
		color: var(--e-text);
		font: var(--type-caption);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tree-card .steps {
		grid-column: 2;
		color: var(--e-text-faint);
		font: var(--type-caption);
	}

	.tree-card .badge {
		grid-row: span 2;
		align-self: center;
	}

	.missing {
		display: block;
		padding: 6px 8px;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	.tree-add {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin: 6px 8px 0;
	}

	/*
	 * Three bare words — Výklad, Otázka, Cvičení — read as a filter or as the card
	 * types already present. Saying what the buttons make is also what separates the
	 * Cvičení *card* here from the Cvičení *course type* in course settings.
	 */
	.add-label {
		width: 100%;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.add {
		margin-top: 8px;
	}

	.orphans {
		gap: 1px;
	}

	.rail {
		margin-top: 28px;
		align-items: center;
	}

	.rail-item {
		width: 32px;
		height: 32px;
		border: 1px solid var(--e-border);
		border-radius: 50%;
		background: var(--surface);
		color: var(--e-text-muted);
		font-size: var(--text-s);
		cursor: pointer;
	}

	.rail-item.selected {
		border-color: transparent;
		background: var(--primary);
		color: var(--surface);
	}

	footer {
		display: flex;
		gap: 6px;
		margin-top: auto;
		padding-top: 16px;
	}
</style>
