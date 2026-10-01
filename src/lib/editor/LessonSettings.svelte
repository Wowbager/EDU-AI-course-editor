<script lang="ts">
	/**
	 * Everything about a lesson that is not one of its cards.
	 *
	 * The lesson used to own the top of the editor column — a title, five chips and a
	 * row of fields, above the cards the author actually came to write. It is a
	 * container, and a container's settings are worth one click, not permanent
	 * residence at the top of the screen.
	 *
	 * Which fields exist, and which section each sits in, is decided by the mode, from
	 * `$lib/ui/fields.ts`. What is added here is the lesson's own removal, which was
	 * reachable only by hovering a sidebar row, and one quiet line that says what is in
	 * the lesson.
	 */
	import type { CourseV2 } from '$lib/domain/schema';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import SettingsNav from '$lib/ui/SettingsNav.svelte';
	import { useStore } from '$lib/ui/context';
	import { fieldsFor, listsSections, sectionsFor } from '$lib/ui/fields';
	import { sectionHasIssue, sectionTargeted } from '$lib/ui/settings-target';
	import { SettingsSearch, setSettingsSearch } from '$lib/ui/settings-search.svelte';
	import { duplicateLesson, setField } from '$lib/domain/commands';
	import { removeLesson } from './lesson-actions';
	import { lessonDidactics, lessonTotals } from '$lib/domain/derive';
	import { cardsCount } from '$lib/ui/plural';
	import { Copy, Trash } from '@lucide/svelte';

	interface Props {
		doc: CourseV2;
		lessonId: string;
		onclose: () => void;
	}
	let { doc, lessonId, onclose }: Props = $props();

	const store = useStore();
	const lesson = $derived(doc.lessons.find((l) => l.lesson_id === lessonId));
	const totals = $derived(lesson === undefined ? undefined : lessonTotals(lesson, store.index));
	const didactics = $derived(
		lesson === undefined ? undefined : lessonDidactics(lesson, store.index)
	);

	const fields = $derived(fieldsFor('lesson', store.mode));
	const sections = $derived(sectionsFor('lesson', store.mode));
	const inSection = (id: string) => fields.filter((f) => f.section === id);
	const targeted = (id: string) => sectionTargeted(store, ['lesson'], id, { lessonId });
	const alert = (id: string) => sectionHasIssue(store, ['lesson'], id, { lessonId });
	const list = $derived(listsSections(store.mode));

	const search = new SettingsSearch(['lesson'], () => ({
		mode: store.mode,
		feedback: store.showFeedback
	}));
	setSettingsSearch(search);

	const set = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { lessonId, field }, value));
	const read = (path: string): unknown => (lesson as Record<string, unknown> | undefined)?.[path];
</script>

{#snippet pane(id: string)}
	{#if lesson !== undefined}
		{#if id === 'main'}
			<div class="fields">
				<FieldGroup fields={inSection('main')} {read} write={set} />
			</div>

			{#if totals !== undefined}
				<p
					class="totals"
					title={totals.durationPartial
						? 'U některých karet délka chybí, součet je proto nižší.'
						: undefined}
				>
					{cardsCount(totals.blockCount)} · {totals.durationMinutes} min{totals.durationEstimated
						? ' (odhad)'
						: ''}
				</p>
			{/if}
		{:else if id === 'didactics' && didactics !== undefined}
			<dl>
				<dt title="Podíl chybných odpovědí, které žákovi řeknou, kde udělal chybu">
					Zpětná vazba u chybných odpovědí
				</dt>
				<dd>{Math.round(didactics.wrongOptionFeedbackShare * 100)} %</dd>
				<dt title="Podíl karet zařazených do denního opakování">Karty zařazené do cvičení</dt>
				<dd>{Math.round(didactics.practiceShare * 100)} %</dd>
			</dl>
		{:else if id === 'ai'}
			<FieldGroup fields={inSection('ai')} {read} write={set} />
		{:else if id === 'meta'}
			<div class="row">
				<span class="label">Identifikátor</span>
				<code>{lesson.lesson_id}</code>
			</div>
			<FieldGroup fields={inSection('meta')} {read} write={set} />
		{/if}
	{/if}
{/snippet}

{#snippet body()}
	{#if lesson === undefined}
		<p>Tato lekce v kurzu není.</p>
	{:else}
		<SettingsNav
			{sections}
			{list}
			{targeted}
			{alert}
			search={store.mode === 'advanced' ? search : undefined}
			{pane}
		/>
	{/if}
{/snippet}

{#snippet actions()}
	<Button
		variant="ghost"
		onclick={() => {
			store.apply((d, r) => duplicateLesson(d, lessonId, r));
			onclose();
		}}
		ariaLabel="Duplikovat lekci"
	>
		<Copy size={16}></Copy>
		Duplikovat
	</Button>
	<Button
		variant="danger"
		onclick={() => {
			removeLesson(store, lessonId);
			onclose();
		}}
		ariaLabel="Smazat lekci"
	>
		<Trash size={16}></Trash>
		Smazat
	</Button>
	<div class="spacer"></div>
	<Button variant="secondary" onclick={onclose}>Hotovo</Button>
{/snippet}

<Modal title="Nastavení lekce" size={list ? 'l' : 'm'} {onclose} children={body} footer={actions} />

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.totals {
		margin: 2px 0 0;
		color: var(--e-text-faint);
		font-size: var(--text-s);
	}

	dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px 16px;
		margin: 0;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	dd {
		margin: 0;
		text-align: right;
	}

	.row {
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 12px;
		align-items: start;
	}

	.label {
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	code {
		font-family: var(--font-code);
		font-size: var(--text-s);
		color: var(--e-text-faint);
	}

	.spacer {
		flex: 1;
	}
</style>
