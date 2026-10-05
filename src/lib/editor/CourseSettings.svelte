<script lang="ts">
	/**
	 * Course-level settings (§3).
	 *
	 * Which settings exist here, and which section each sits in, is decided by the mode,
	 * from `$lib/ui/fields.ts` — this panel renders those tables rather than keeping a
	 * second opinion about them.
	 * The two exceptions are the course type and its status: both are consequential
	 * enough to earn a segmented control and a written consequence per option.
	 */
	import type { CourseV2, ExportType } from '$lib/domain/schema';
	import { VISIBILITY_LABEL, visibilityOf } from '$lib/domain/versions';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import SettingsNav from '$lib/ui/SettingsNav.svelte';
	import { useStore, useVersions } from '$lib/ui/context';
	import { fieldsFor, listsSections, sectionsFor } from '$lib/ui/fields';
	import { sectionHasIssue, sectionTargeted } from '$lib/ui/settings-target';
	import { SettingsSearch, setSettingsSearch } from '$lib/ui/settings-search.svelte';
	import { setField } from '$lib/domain/commands';

	interface Props {
		doc: CourseV2;
		onclose: () => void;
	}
	let { doc, onclose }: Props = $props();

	const store = useStore();
	const versions = useVersions();
	const set = (field: string, value: unknown) => store.apply((d) => setField(d, { field }, value));
	const read = (path: string): unknown => (doc as Record<string, unknown>)[path];

	const fields = $derived(fieldsFor('course', store.mode));
	const sections = $derived(sectionsFor('course', store.mode));
	const inSection = (id: string) => fields.filter((f) => f.section === id);
	const targeted = (id: string) => sectionTargeted(store, ['course'], id, {});
	const alert = (id: string) => sectionHasIssue(store, ['course'], id, {});

	const search = new SettingsSearch(['course'], () => ({
		mode: store.mode,
		feedback: store.showFeedback
	}));
	setSettingsSearch(search);

	/** Visibility is set with publishing, in the versions dialog; this only leads there. */
	function openVersions() {
		versions.dialogOpen = true;
		onclose();
	}

	/**
	 * "Cvičení" is also a card type inside a lesson, and the name of the daily
	 * practice queue a single card can be enrolled in. This one is neither: it is a
	 * property of the whole document, and it silently disables branching in every
	 * card at once. The labels and titles say so, because a teacher who has just
	 * added a Cvičení card has no reason to expect the same word here to mean
	 * something else.
	 */
	const EXPORT_TYPES: { value: ExportType; label: string; title: string }[] = [
		{
			value: 'course_v2',
			label: 'Kurz',
			title: 'Celý kurz v plné podobě: nápovědy, řešení, větvení podle odpovědí, XP.'
		},
		{
			value: 'exercise_v2',
			// The qualifier is on the label and not only in the tooltip: the collision
			// is visible on screen, so the fix has to be too. The type itself is
			// untouched — this still writes `exercise_v2`.
			label: 'Cvičení (celý kurz)',
			title:
				'Celý kurz jako drilovací sada: větvení se ignoruje ve všech kartách, žák jde vždy stejným pořadím. Pozor, tohle je nastavení celého kurzu — není to karta typu Cvičení uvnitř lekce ani zařazení karty do denního opakování. V aplikaci se exportuje jako exercise_v2.'
		},
		{
			value: 'quiz_v2',
			label: 'Test',
			title: 'Celý kurz bez nápověd, řešení i zpětné vazby — žák se během něj nedozví, jak si vede.'
		}
	];
</script>

{#snippet pane(id: string)}
	{#if id === 'main'}
		<div class="settings">
			<div class="grid">
				<FieldGroup fields={inSection('main')} {read} write={set} />

				<div class="row">
					<span>Typ kurzu</span>
					<Segmented
						wrap
						explain
						label="Typ kurzu"
						options={EXPORT_TYPES}
						value={doc.export_type}
						onchange={(v) => set('export_type', v)}
					/>
				</div>

				<div class="row">
					<div class="name">
						<span>Kdo kurz uvidí</span>
						<span class="hint"
							>Viditelnost se nastavuje ve verzích kurzu, spolu se zveřejněním.</span
						>
					</div>
					<button type="button" class="link" onclick={openVersions}>
						{VISIBILITY_LABEL[visibilityOf(doc)].label}
					</button>
				</div>
			</div>
		</div>
	{:else if id === 'meta'}
		<div class="settings">
			<div class="row">
				<span>Identifikátor</span>
				<code class="id">{doc.course_id}</code>
			</div>
		</div>
		<FieldGroup fields={inSection('meta')} {read} write={set} />
	{:else}
		<FieldGroup fields={inSection(id)} {read} write={set} />
	{/if}
{/snippet}

{#snippet body()}
	<SettingsNav
		{sections}
		list={listsSections(store.mode)}
		{targeted}
		{alert}
		search={store.mode === 'advanced' ? search : undefined}
		{pane}
	/>
{/snippet}

<Modal title="Nastavení kurzu" size="l" {onclose} children={body} />

<style>
	/* Information that leads somewhere: quiet text, with a faint underline so it reads
	   as a way to the version dialog rather than as a label. */
	.link {
		justify-self: start;
		padding: 6px 0 0;
		border: 0;
		background: none;
		color: var(--e-text-muted);
		font: inherit;
		font-size: var(--text-s);
		text-align: left;
		text-decoration: underline dotted;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.link:hover {
		color: var(--e-text);
		text-decoration-style: solid;
	}

	.settings {
		container: course-settings / inline-size;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: 14px 24px;
	}

	.row {
		grid-column: 1 / -1;
		min-width: 0;
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr);
		gap: 12px;
		align-items: start;
		font-size: var(--text-m);
	}

	.row > span:first-child,
	.name {
		padding-top: 6px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.name {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.hint {
		color: var(--e-text-faint);
		font: var(--type-meta);
		font-weight: var(--weight-regular);
		line-height: 1.5;
	}

	@container course-settings (max-width: 560px) {
		.row {
			grid-template-columns: minmax(0, 1fr);
			gap: 6px;
		}
	}

	code {
		min-width: 0;
		padding-top: 6px;
		font-family: var(--font-code);
		font-size: var(--text-s);
		color: var(--e-text-faint);
	}
</style>
