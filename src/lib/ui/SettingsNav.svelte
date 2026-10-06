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
	 * The search is in every mode. Typing narrows the list to the sections it finds and
	 * shows the first of them; `FieldGroup` marks the fields themselves. What only a
	 * higher mode has comes up as a result of its own, "je v režimu Pokročilý · Přepnout",
	 * so a search never ends empty for something that exists. Učitel has no list, so the
	 * search is one faint word at the top of the page ("Hledat nastavení") that opens
	 * into the field when clicked: its dialogs have a handful of fields, and a field
	 * standing open over them would be the loudest thing on the page.
	 *
	 * One quiet line closes the dialog while a higher mode has more in it ("Dovednosti a
	 * pojmy najdeš v režimu Metodik · Přepnout", `modeGain`); Přepnout switches the mode
	 * and opens the dialog on the first section that mode adds. Absent in Pokročilý.
	 */
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { tick } from 'svelte';
	import { Search } from '@lucide/svelte';
	import SettingsSection from './SettingsSection.svelte';
	import { MODE_LABELS, type HigherMatch } from './fields';
	import type { SettingsBaseView, SettingsSectionView } from '$lib/screen/types';
	import { useStore } from './context';
	import { SECTION_ICONS } from './section-icons';
	import type { SettingsSearch } from './settings-search.svelte';

	interface Props {
		/**
		 * The dialog as the model says it: the sections (with whether a jump or a problem
		 * points into each), whether they are listed, and what a higher mode adds.
		 */
		dialog: Pick<SettingsBaseView, 'sections' | 'list' | 'gain'>;
		/** Where `dialog` is in the model, for `data-screen`. */
		screen: string;
		search: SettingsSearch;
		pane: Snippet<[string]>;
	}
	let { dialog, screen, search, pane }: Props = $props();

	const store = useStore();
	const sections = $derived<SettingsSectionView[]>(dialog.sections);
	const list = $derived(dialog.list);
	const gain = $derived(dialog.gain ?? undefined);
	const targeted = (id: string) => sections.find((s) => s.id === id)?.targeted === true;
	const alert = (id: string) => sections.find((s) => s.id === id)?.alert === true;

	/** Switch to the mode that has it and open on the section that holds it. */
	function switchTo(mode: HigherMatch['mode'], section: string) {
		store.mode = mode;
		search.show(section);
	}

	// Učitel: the search is closed until asked for.
	let searchOpen = $state(false);
	let searchInput = $state<HTMLInputElement | null>(null);
	async function openSearch() {
		searchOpen = true;
		await tick();
		searchInput?.focus();
	}

	const uid = $props.id();

	let current = $state(
		untrack(() => sections.find((s) => targeted(s.id))?.id ?? sections[0]?.id ?? 'main')
	);

	const shown = $derived(
		search.active ? sections.filter((s) => search.result.sections.has(s.id)) : sections
	);

	// After a switch of mode the dialog opens on the section that mode added.
	$effect(() => {
		const jump = search.jump;
		if (jump === null) return;
		untrack(() => {
			if (sections.some((s) => s.id === jump.section)) current = jump.section;
		});
	});
	/** The section on screen: the chosen one, unless the search has filtered it out. */
	const active = $derived(
		shown.some((s) => s.id === current) ? current : (shown[0]?.id ?? undefined)
	);
	const activeSection = $derived(sections.find((s) => s.id === active));

	const tabs: HTMLButtonElement[] = $state([]);

	// On a narrow screen the list is a row that scrolls: keep the chosen name in sight.
	$effect(() => {
		const index = shown.findIndex((s) => s.id === active);
		tabs[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	});

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

{#snippet searchField()}
	<label class="search">
		<Search size={14} aria-hidden="true"></Search>
		<input
			type="search"
			placeholder="Hledat nastavení"
			aria-label="Hledat nastavení"
			bind:value={search.query}
			bind:this={searchInput}
			onblur={() => {
				if (!list && !search.active) searchOpen = false;
			}}
		/>
	</label>
{/snippet}

{#snippet higherResults()}
	{#if search.active && search.higher.length > 0}
		<ul class="higher" aria-label="Nalezeno v jiném režimu">
			{#each search.higher.slice(0, 5) as match (match.level + match.section)}
				<li>
					<span class="what">{match.label}</span>
					<span class="where">je v režimu {MODE_LABELS[match.mode].label}</span>
					<button type="button" class="switch" onclick={() => switchTo(match.mode, match.section)}>
						Přepnout
					</button>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet more()}
	{#if gain !== undefined}
		<p class="more">
			<span data-screen="{screen}.gain.text">{gain.text}</span> ·
			<button type="button" class="switch" onclick={() => switchTo(gain.mode, gain.section)}>
				Přepnout
			</button>
		</p>
	{/if}
{/snippet}

{#if !list}
	{#if searchOpen || search.active}
		<div class="top">
			{@render searchField()}
		</div>
		{@render higherResults()}
		{#if search.active && search.result.sections.size === 0 && search.higher.length === 0}
			<p class="none page">Nic takového tu není. Zkus jiné slovo.</p>
		{/if}
	{:else}
		<div class="top">
			<button type="button" class="find" onclick={openSearch}>
				<Search size={13} aria-hidden="true"></Search>
				Hledat nastavení
			</button>
		</div>
	{/if}
	{#if sections[0] !== undefined}
		{@render pane(sections[0].id)}
	{/if}
	{#if sections.length > 1}
		<div class="folds">
			{#each sections.slice(1) as section, index (section.id)}
				<SettingsSection
					label={section.label}
					screen="{screen}.sections[{index + 1}].label"
					autoOpen={targeted(section.id) ||
						(search.active && search.result.sections.has(section.id))}
				>
					{@render pane(section.id)}
				</SettingsSection>
			{/each}
		</div>
	{/if}
	{@render more()}
{:else}
	<div class="shell">
		<div class="layout">
			<nav class="nav" aria-label="Části nastavení">
				{@render searchField()}
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
							<span class="name" data-screen="{screen}.sections[{sections.indexOf(section)}].label"
								>{section.label}</span
							>
							{#if alert(section.id)}<span class="dot" aria-hidden="true"></span>{/if}
						</button>
					{/each}
				</div>
				{@render higherResults()}
				{#if shown.length === 0 && search.higher.length === 0}
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
					<h3
						id="{uid}-heading"
						data-screen="{screen}.sections[{sections.indexOf(activeSection)}].label"
					>
						{activeSection.label}
					</h3>
					{#key active}
						<div class="content">
							{@render pane(active)}
						</div>
					{/key}
				</div>
			{/if}
		</div>
		{@render more()}
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

	/* Učitel: one faint word until it is wanted. */
	.top {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 4px;
	}

	/* An open field is a row of its own, not pressed against the first field. */
	.top:has(.search) {
		margin-bottom: 12px;
	}

	.top .search {
		flex: 1;
	}

	.find {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 4px;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		font: var(--type-meta);
		cursor: pointer;
	}

	.find:hover {
		color: var(--e-text);
	}

	.find:focus-visible,
	.switch:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}

	.higher {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0 4px;
		list-style: none;
		font-size: var(--text-xs);
	}

	/* On the one-page dialog (Učitel) the results are the answer to the search: as large as
	   the fields, and set apart from the page under them. */
	.top + .higher {
		margin: 0 0 16px;
		padding: 10px 12px;
		border-radius: var(--radius-xs);
		background: var(--primary-dark-06);
		font-size: var(--text-s);
	}

	.top + .higher .what {
		flex-basis: auto;
		font-weight: var(--weight-medium);
	}

	.none.page {
		margin: 0 0 16px;
		font-size: var(--text-s);
	}

	.higher li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 6px;
	}

	.higher .what {
		flex-basis: 100%;
		color: var(--e-text);
	}

	.higher .where {
		color: var(--e-text-faint);
	}

	/* The line at the foot: faint, one line, part of the dialog and not a banner. */
	.more {
		margin: 0;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.shell .more {
		padding: 9px 22px;
		border-top: 1px solid var(--e-border);
	}

	.folds + .more {
		margin-top: 14px;
	}

	.switch {
		padding: 0;
		border: 0;
		background: none;
		color: var(--e-text-muted);
		font: inherit;
		text-decoration: underline dotted;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.switch:hover {
		color: var(--e-text);
		text-decoration-style: solid;
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
