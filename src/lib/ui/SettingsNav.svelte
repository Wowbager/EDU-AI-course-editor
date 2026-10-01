<script lang="ts">
	/**
	 * The body of a settings dialog: its sections, either as one page or as a list.
	 *
	 * From Metodik up (`listsSections`) the sections are listed by name down the left
	 * and one is shown at a time, under its name as a heading. Pokročilý has seven
	 * sections on a card; stacked, they were one long scroll in which a teacher told
	 * "change how often the card comes back" had to read everything to find it. The
	 * names are always written out: an icon list that names a section only on hover
	 * hides the one thing a newcomer needs.
	 *
	 * In Učitel the first section is the page and the rest are folds under it, as the
	 * dialogs are short there.
	 *
	 * The dialog opens on the section a jump or a problem points into (`targeted`), and
	 * marks a section with a problem by a dot. It switches only when opened: a section
	 * the author is reading never changes under them because an issue appeared.
	 *
	 * With a `search` (Pokročilý), typing narrows the list to the sections it finds and
	 * shows the first of them; `FieldGroup` marks the fields themselves.
	 */
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { Search } from '@lucide/svelte';
	import SettingsSection from './SettingsSection.svelte';
	import type { SectionSpec } from './fields';
	import { SECTION_ICONS } from './section-icons';
	import type { SettingsSearch } from './settings-search.svelte';

	interface Props {
		sections: SectionSpec[];
		/** List the sections and show one at a time; otherwise one page with folds. */
		list: boolean;
		/** A jump or a problem points into this section: open on it. */
		targeted: (id: string) => boolean;
		/** An issue the author can see is in this section. */
		alert: (id: string) => boolean;
		search?: SettingsSearch;
		pane: Snippet<[string]>;
	}
	let { sections, list, targeted, alert, search, pane }: Props = $props();

	const uid = $props.id();

	let current = $state(
		untrack(() => sections.find((s) => targeted(s.id))?.id ?? sections[0]?.id ?? 'main')
	);

	const shown = $derived(
		search?.active ? sections.filter((s) => search.result.sections.has(s.id)) : sections
	);
	/** The section on screen: the chosen one, unless the search has filtered it out. */
	const active = $derived(
		shown.some((s) => s.id === current) ? current : (shown[0]?.id ?? undefined)
	);
	const activeSection = $derived(sections.find((s) => s.id === active));

	const tabs: HTMLButtonElement[] = $state([]);

	function key(event: KeyboardEvent, index: number) {
		const last = shown.length - 1;
		const next =
			event.key === 'ArrowDown'
				? index === last
					? 0
					: index + 1
				: event.key === 'ArrowUp'
					? index === 0
						? last
						: index - 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? last
							: undefined;
		if (next === undefined) return;
		event.preventDefault();
		current = shown[next].id;
		tabs[next]?.focus();
	}
</script>

{#if !list}
	{#if sections[0] !== undefined}
		{@render pane(sections[0].id)}
	{/if}
	{#if sections.length > 1}
		<div class="folds">
			{#each sections.slice(1) as section (section.id)}
				<SettingsSection label={section.label} autoOpen={targeted(section.id)}>
					{@render pane(section.id)}
				</SettingsSection>
			{/each}
		</div>
	{/if}
{:else}
	<div class="shell">
		<div class="layout">
			<nav class="nav" aria-label="Části nastavení">
				{#if search}
					<label class="search">
						<Search size={14} aria-hidden="true"></Search>
						<input
							type="search"
							placeholder="Hledat nastavení"
							aria-label="Hledat nastavení"
							bind:value={search.query}
						/>
					</label>
				{/if}
				<div role="tablist" aria-orientation="vertical" aria-label="Části nastavení">
					{#each shown as section, index (section.id)}
						{@const Icon = SECTION_ICONS[section.icon]}
						{@const selected = section.id === active}
						<button
							type="button"
							role="tab"
							id="{uid}-tab-{section.id}"
							aria-selected={selected}
							aria-controls="{uid}-pane"
							aria-describedby={alert(section.id) ? `${uid}-alert` : undefined}
							tabindex={selected ? 0 : -1}
							class:selected
							bind:this={tabs[index]}
							onclick={() => (current = section.id)}
							onkeydown={(event) => key(event, index)}
						>
							{#if Icon}<Icon size={16} aria-hidden="true"></Icon>{/if}
							<span class="name">{section.label}</span>
							{#if alert(section.id)}<span class="dot" aria-hidden="true"></span>{/if}
						</button>
					{/each}
				</div>
				{#if shown.length === 0}
					<p class="none">Nic takového tu není.</p>
				{/if}
				<span id="{uid}-alert" hidden>Je tu něco k opravě.</span>
			</nav>

			{#if active !== undefined && activeSection !== undefined}
				<div
					class="pane"
					role="tabpanel"
					id="{uid}-pane"
					aria-labelledby="{uid}-heading"
					tabindex="-1"
				>
					<h3 id="{uid}-heading">{activeSection.label}</h3>
					{#key active}
						<div class="content">
							{@render pane(active)}
						</div>
					{/key}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.folds {
		margin-top: 16px;
	}

	.shell {
		container: settings-nav / inline-size;
		margin: -18px -20px;
	}

	/* A fixed height, so the dialog does not jump as the author goes between sections;
	   the section scrolls inside it instead. */
	.layout {
		display: grid;
		grid-template-columns: 196px minmax(0, 1fr);
		height: min(560px, 62vh);
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
		padding: 14px 10px;
		overflow-y: auto;
		border-right: 1px solid var(--e-border);
		background: var(--primary-dark-06);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text-faint);
	}

	.search:focus-within {
		border-color: var(--primary);
	}

	.search input {
		min-width: 0;
		flex: 1;
		border: 0;
		outline: none;
		background: none;
		color: var(--e-text);
		font: var(--type-meta);
	}

	[role='tablist'] {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	/* The tiles of the folded sidebar, with their name written beside the icon. */
	[role='tab'] {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 36px;
		padding: 6px 10px;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-muted);
		font-family: var(--font-body);
		font-size: var(--text-s);
		text-align: left;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	[role='tab'] :global(svg) {
		flex: none;
	}

	[role='tab']:hover {
		background: var(--surface);
		color: var(--e-text);
	}

	[role='tab']:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}

	[role='tab'].selected {
		background: color-mix(in srgb, var(--primary) 26%, var(--surface));
		box-shadow: inset 0 0 0 1.5px var(--primary);
		color: var(--gradient-purple);
		font-weight: var(--weight-medium);
	}

	.name {
		flex: 1;
		min-width: 0;
	}

	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--e-error);
	}

	.none {
		margin: 4px 10px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.pane {
		min-width: 0;
		min-height: 0;
		padding: 16px 22px 20px;
		overflow-y: auto;
		outline: none;
	}

	h3 {
		margin: 0 0 14px;
		font: var(--type-subtitle);
		font-size: var(--text-l);
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* A phone, or a narrow window: the list becomes a row of names above the section. */
	@container settings-nav (max-width: 600px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}

		.nav {
			padding: 10px 12px;
			border-right: 0;
			border-bottom: 1px solid var(--e-border);
		}

		[role='tablist'] {
			flex-direction: row;
			overflow-x: auto;
		}

		[role='tab'] {
			width: auto;
			flex: none;
			white-space: nowrap;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		[role='tab'] {
			transition: none;
		}
	}
</style>
