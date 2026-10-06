<script lang="ts">
	/**
	 * Course-level settings (§3).
	 *
	 * Which settings exist here, and which section each sits in, is decided by the mode,
	 * from `$lib/ui/fields.ts`, and said by the model (`store.screen.dialogs.course_settings`,
	 * `screen/settings.ts`) — this panel draws that and writes what the teacher does.
	 * The two exceptions are the course type and its status: both are consequential
	 * enough to earn a segmented control and a written consequence per option.
	 */
	import type { Snippet } from 'svelte';
	import type { CourseSettingsView } from '$lib/screen/types';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import SettingsNav from '$lib/ui/SettingsNav.svelte';
	import { useStore, useVersions } from '$lib/ui/context';
	import { SettingsSearch, setSettingsSearch } from '$lib/ui/settings-search.svelte';
	import { setField } from '$lib/domain/commands';

	interface Props {
		view: CourseSettingsView;
		onclose: () => void;
	}
	let { view, onclose }: Props = $props();

	const store = useStore();
	const versions = useVersions();
	const screen = 'dialogs.course_settings';
	const set = (field: string, value: unknown) => store.apply((d) => setField(d, { field }, value));

	const search = new SettingsSearch(
		() => ['course'],
		() => ({
			mode: store.mode,
			feedback: store.showFeedback
		})
	);
	setSettingsSearch(search);

	/** Visibility is set with publishing, in the versions dialog; this only leads there. */
	function openVersions() {
		versions.dialogOpen = true;
		onclose();
	}
</script>

{#snippet pane(id: string)}
	{#if id === 'main'}
		<div class="settings">
			<div class="grid">
				<FieldGroup rows={view.fields.main ?? []} write={set} screen="{screen}.fields.main" />

				<div class="row">
					<span>Typ kurzu</span>
					<Segmented
						wrap
						explain
						label="Typ kurzu"
						options={view.export_type.options}
						value={view.export_type.value}
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
						<span data-screen="{screen}.visibility_label">{view.visibility_label}</span>
					</button>
				</div>
			</div>
		</div>
	{:else if id === 'meta'}
		<div class="settings">
			<div class="row">
				<span>Identifikátor</span>
				<code class="id" data-screen="{screen}.course_id">{view.course_id}</code>
			</div>
		</div>
		<FieldGroup rows={view.fields.meta ?? []} write={set} screen="{screen}.fields.meta" />
	{:else}
		<FieldGroup rows={view.fields[id] ?? []} write={set} screen="{screen}.fields.{id}" />
	{/if}
{/snippet}

{#snippet body()}
	<SettingsNav dialog={view} {screen} {search} {pane} />
{/snippet}

{#snippet actions(notice: Snippet)}
	{@render notice()}
	<Button variant="secondary" onclick={onclose}>Hotovo</Button>
{/snippet}

<Modal title="Nastavení kurzu" size="l" {onclose} children={body} footer={actions} />

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
