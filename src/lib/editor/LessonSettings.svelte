<script lang="ts">
	/**
	 * Everything about a lesson that is not one of its cards.
	 *
	 * The lesson used to own the top of the editor column — a title, five chips and a
	 * row of fields, above the cards the author actually came to write. It is a
	 * container, and a container's settings are worth one click, not permanent
	 * residence at the top of the screen.
	 *
	 * Which fields exist, and which fold each sits in, is decided by the mode, from
	 * `$lib/ui/fields.ts`. What is added here is the lesson's own removal, which was
	 * reachable only by hovering a sidebar row, and one quiet line that says what is in
	 * the lesson.
	 */
	import type { CourseV2 } from '$lib/domain/schema';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import SettingsSection from '$lib/ui/SettingsSection.svelte';
	import { useStore } from '$lib/ui/context';
	import { fieldsFor, sectionsFor } from '$lib/ui/fields';
	import { sectionTargeted } from '$lib/ui/settings-target';
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
	const folds = $derived(
		new Map(sectionsFor('lesson', store.mode).map((section) => [section.id, section]))
	);
	const inSection = (id: string) => fields.filter((f) => f.section === id);
	const targeted = (id: string) => sectionTargeted(store, ['lesson'], id, { lessonId });

	const set = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { lessonId, field }, value));
	const read = (path: string): unknown => (lesson as Record<string, unknown> | undefined)?.[path];
</script>

{#snippet body()}
	{#if lesson === undefined}
		<p>Tato lekce v kurzu není.</p>
	{:else}
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

		<div class="folds">
			{#if folds.has('didactics') && didactics !== undefined}
				<SettingsSection label={folds.get('didactics')!.label} autoOpen={targeted('didactics')}>
					<dl>
						<dt title="Podíl chybných odpovědí, které žákovi řeknou, kde udělal chybu">
							Zpětná vazba u chybných odpovědí
						</dt>
						<dd>{Math.round(didactics.wrongOptionFeedbackShare * 100)} %</dd>
						<dt title="Podíl karet zařazených do denního opakování">Karty zařazené do cvičení</dt>
						<dd>{Math.round(didactics.practiceShare * 100)} %</dd>
					</dl>
				</SettingsSection>
			{/if}

			{#if folds.has('ai')}
				<SettingsSection label={folds.get('ai')!.label} autoOpen={targeted('ai')}>
					<FieldGroup fields={inSection('ai')} {read} write={set} />
				</SettingsSection>
			{/if}

			{#if folds.has('meta')}
				<SettingsSection label={folds.get('meta')!.label} autoOpen={targeted('meta')}>
					<div class="row">
						<span class="label">Identifikátor</span>
						<code>{lesson.lesson_id}</code>
					</div>
					<FieldGroup fields={inSection('meta')} {read} write={set} />
				</SettingsSection>
			{/if}
		</div>
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

<Modal title="Nastavení lekce" {onclose} children={body} footer={actions} />

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.totals {
		margin: 14px 0 0;
		color: var(--e-text-faint);
		font-size: var(--text-s);
	}

	.folds {
		margin-top: 16px;
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
