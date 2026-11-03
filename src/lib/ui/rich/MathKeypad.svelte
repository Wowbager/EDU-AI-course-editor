<script lang="ts">
	/**
	 * The formula row's on-screen keypad — our own, not MathLive's: plain buttons, so
	 * every glyph is centred in its key and sized to fit, and no Shift layer can redraw
	 * them.
	 *
	 * The keys come from `keypad-data.ts` (design brief §4): tabs in the profile's order,
	 * each tab in small named groups of similar keys, the fixed keys (cursor arrows as
	 * icons, backspace, enter) in the same position on every tab, a recently-used row on
	 * top and a search field over Czech names. A press never takes the focus: `mousedown`
	 * is cancelled, so the caret stays in the formula while the keypad is used.
	 */
	import { onMount } from 'svelte';
	import {
		ChevronLeft,
		ChevronRight,
		CornerDownLeft,
		Delete,
		Ellipsis,
		Search
	} from '@lucide/svelte';
	import Menu from '../Menu.svelte';
	import MenuItem from '../MenuItem.svelte';
	import MenuSeparator from '../MenuSeparator.svelte';
	import type { MathSettings } from '$lib/domain/math-settings';
	import {
		FIXED_KEYS,
		KEY_BY_ID,
		PROFILES,
		PROFILE_BY_ID,
		TABS,
		TAB_BY_ID,
		type KeyDef,
		type ProfileId,
		keyFace,
		searchKeys,
		type TabDef
	} from './keypad-data';
	import { readRecent, writeRecent, type RecentStore } from './recent-keys';
	import { loadKatex, type Katex } from './math';

	interface Props {
		/** Insert LaTeX at the caret of the formula field. */
		oninsert: (latex: string) => void;
		/** An editing command of the formula field, e.g. `deleteBackward`. */
		oncommand: (command: string) => void;
		/** Enter: next placeholder, or the formula is done after the last one. */
		ondone: () => void;
		/** Which tabs are visible, and in what order (§4.2 subject profiles). */
		profile: ProfileId;
		/** The teacher picked another profile in the ⋯ menu. */
		onprofile: (profile: ProfileId) => void;
		/** Open straight into the search palette (the `\` key in the field, §5.3). */
		search?: boolean;
		/** The search was closed. */
		onsearchclose?: () => void;
		/**
		 * Chem mode (§4.3 tab 8): the Chemie tab opens a `\ce{…}` node; every key types
		 * its mhchem source into it, backspace edits it, leaving the tab finishes it.
		 */
		onchemstart?: () => void;
		onchem?: (token: string) => void;
		onchembackspace?: () => void;
		onchemstop?: () => void;
		/** The course's math conventions (§3), and where the ⋯ menu writes them. */
		math?: MathSettings;
		onmath?: (patch: MathSettings) => void;
	}
	let {
		oninsert,
		oncommand,
		ondone,
		profile,
		onprofile,
		search = false,
		onsearchclose,
		onchemstart,
		onchem,
		onchembackspace,
		onchemstop,
		math = {},
		onmath
	}: Props = $props();
	$effect(() => {
		if (search) searching = true;
	});

	const ICONS = {
		backspace: Delete,
		left: ChevronLeft,
		right: ChevronRight,
		enter: CornerDownLeft
	} as const;

	const tabs = $derived(
		(PROFILE_BY_ID.get(profile) ?? PROFILE_BY_ID.get('vse')!).tabs.map((id) => TAB_BY_ID.get(id)!)
	);
	let tabId = $state('zaklad');
	$effect(() => {
		if (!tabs.some((t) => t.id === tabId)) tabId = tabs[0].id;
	});
	const tab = $derived(tabs.find((t) => t.id === tabId) ?? tabs[0]);
	const chemTab = $derived(tab.id === 'chemie');
	// Entering the Chemie tab opens the `\ce{…}` node; leaving it finishes the node.
	let wasChem = false;
	$effect(() => {
		if (chemTab && !wasChem) onchemstart?.();
		if (!chemTab && wasChem) onchemstop?.();
		wasChem = chemTab;
	});
	const KEY_TAB = new Map(TABS.flatMap((t) => t.keys.map((k) => [k.id, t.id] as const)));

	let recent = $state<RecentStore>([]);
	onMount(() => {
		recent = readRecent();
	});

	let query = $state('');
	let searching = $state(false);
	$effect(() => {
		if (!searching) {
			query = '';
			onsearchclose?.();
		}
	});
	const results = $derived(searchKeys(query, tabs));

	/** Long-press variants (ε/ϵ, φ/ϕ, …): shown in a small list above the key. */
	let variantsFor = $state<KeyDef | null>(null);
	let variantsTimer = 0;
	function longPressStart(event: PointerEvent, key: KeyDef) {
		if (!key.variants?.length) return;
		variantsTimer = window.setTimeout(() => {
			variantsFor = key;
		}, 450);
	}
	function longPressEnd() {
		window.clearTimeout(variantsTimer);
	}

	/** Keep the caret in the formula: the press must not move the focus to the key. */
	const keepFocus = (event: MouseEvent) => event.preventDefault();

	function press(key: KeyDef) {
		variantsFor = null;
		// Chem mode: a key of the Chemie tab types its mhchem token into the `\ce{…}`
		// node (digits included — subscripts); `outside` keys are ordinary math and
		// leave the node.
		if (chemTab && !key.outside && tab.keys.some((k) => k.id === key.id)) {
			onchem?.(key.insert);
			return;
		}
		if (chemTab && key.outside) onchemstop?.();
		oninsert(key.insert);
		recent = writeRecent(key.id, recent);
	}
	function pressFixed(command: string | undefined, kind: 'command' | 'done') {
		if (kind === 'done') ondone();
		else if (command === 'deleteBackward' && chemTab) onchembackspace?.();
		else if (command) oncommand(command);
	}
	function pick(hit: { key: KeyDef }) {
		if (KEY_TAB.get(hit.key.id) === 'chemie' && !hit.key.outside) {
			tabId = 'chemie';
			onchemstart?.();
			onchem?.(hit.key.insert);
		} else press(hit.key);
		query = '';
		searching = false;
	}

	const groupsOf = (t: TabDef) =>
		t.groups.map((g) => ({
			name: g.name,
			columns: g.columns,
			keys: g.keys.map((id) => KEY_BY_ID.get(id)).filter((k): k is KeyDef => !!k)
		}));

	/** Key faces drawn by KaTeX (`keyFace`), once it has loaded; the text label until then. */
	let katex = $state<Katex | null>(null);
	onMount(() => {
		// Without KaTeX (a dropped connection) the keys keep their text labels.
		loadKatex().then(
			(k) => (katex = k),
			() => {}
		);
	});
	const faces = new Map<string, string>();
	function faceHtml(key: KeyDef): string | null {
		const latex = keyFace(key);
		if (latex === null || katex === null) return null;
		let html = faces.get(key.id);
		if (html === undefined) {
			try {
				html = katex.renderToString(latex, {
					throwOnError: true,
					trust: ({ command }) => command === '\\htmlClass'
				});
			} catch {
				html = '';
			}
			faces.set(key.id, html);
		}
		return html || null;
	}
	const recentKeys = $derived(
		recent.map((id) => KEY_BY_ID.get(id)).filter((k): k is KeyDef => !!k)
	);
</script>

{#snippet face(key: KeyDef)}
	{@const html = faceHtml(key)}
	{#if html}
		<span class="face" class:tall={key.insert.includes('\\\\')} aria-hidden="true"
			>{@html html}</span
		>
	{:else}
		{key.label}
	{/if}
{/snippet}

<div class="keypad" role="group" aria-label="Klávesnice se značkami">
	<div class="keypad-head">
		<div class="keypad-tabs" role="group" aria-label="Skupiny kláves">
			{#each tabs as t (t.id)}
				<button
					type="button"
					class="keypad-tab"
					class:on={tab.id === t.id}
					aria-pressed={tab.id === t.id}
					aria-label={t.name}
					title={t.name}
					onmousedown={keepFocus}
					onclick={() => {
						tabId = t.id;
						variantsFor = null;
					}}>{t.label}</button
				>
			{/each}
		</div>
		<button
			type="button"
			class="keypad-tool"
			class:on={searching}
			aria-pressed={searching}
			title="Hledat značku"
			aria-label="Hledat značku"
			onmousedown={keepFocus}
			onclick={() => (searching = !searching)}><Search size={16} aria-hidden="true" /></button
		>
		<!-- keep the a11y tree tidy: the toggle announces the state -->
		<Menu label="Nastavení klávesnice" icon={Ellipsis} placement="bottom-end">
			{#each PROFILES as p (p.id)}
				<MenuItem checked={p.id === profile} onclick={() => onprofile(p.id)}>{p.name}</MenuItem>
			{/each}
			{#if onmath}
				<MenuSeparator />
				<MenuItem
					checked={math.decimalSeparator !== '.'}
					title="3,14 — fyzická `,` i `.` mezi číslicemi píší desetinnou čárku"
					onclick={() => onmath({ decimalSeparator: math.decimalSeparator === '.' ? ',' : '.' })}
					>Desetinná čárka</MenuItem
				>
				<MenuItem
					checked={math.thousandsSeparator === true}
					title="10 000 se zapíše jako 10\,000 (tenká mezera)"
					onclick={() => onmath({ thousandsSeparator: math.thousandsSeparator !== true })}
					>Oddělovač tisíců</MenuItem
				>
				<MenuItem
					checked={math.sciNotation === 'times'}
					title="Vědecký zápis 3 × 10⁸ místo 3 · 10⁸"
					onclick={() => onmath({ sciNotation: math.sciNotation === 'times' ? 'cdot' : 'times' })}
					>Vědecký zápis krát ×</MenuItem
				>
			{/if}
		</Menu>
	</div>

	{#if searching}
		<input
			class="keypad-search"
			type="search"
			bind:value={query}
			placeholder="Hledat značku — „uhel“, „n nad k“, „rovnováha“…"
			aria-label="Hledat značku podle českého názvu"
		/>
		{#if query.trim() !== ''}
			<div class="keypad-results" role="listbox" aria-label="Výsledky hledání">
				{#each results as hit (hit.key.id)}
					<button
						type="button"
						class="keypad-result"
						role="option"
						aria-selected="false"
						aria-label="{hit.key.name}, {hit.tab.name}"
						onmousedown={keepFocus}
						onclick={() => pick(hit)}
					>
						<span class="r-glyph" aria-hidden="true">{@render face(hit.key)}</span>
						<span class="r-name">{hit.key.name}</span>
						<span class="r-tab">{hit.tab.name}</span>
					</button>
				{:else}
					<p class="keypad-empty">Nic nenalezeno.</p>
				{/each}
			</div>
		{/if}
	{:else}
		{#if recentKeys.length > 0}
			<div class="keypad-row keypad-recent" role="group" aria-label="Naposledy použité">
				{#each recentKeys as key (key.id)}
					<button
						type="button"
						class="key small"
						title={key.name}
						aria-label={key.name}
						onmousedown={keepFocus}
						onpointerdown={(e) => longPressStart(e, key)}
						onpointerup={longPressEnd}
						onpointercancel={longPressEnd}
						onclick={() => press(key)}>{@render face(key)}</button
					>
				{/each}
			</div>
		{/if}

		<div class="keypad-zones">
			{#each groupsOf(tab) as g (g.name)}
				<div class="keypad-group" role="group" aria-label={g.name}>
					<span class="keypad-group-name" aria-hidden="true">{g.name}</span>
					<div
						class="keypad-zone"
						class:pad={g.columns !== undefined}
						style:grid-template-columns={g.columns ? `repeat(${g.columns}, auto)` : undefined}
					>
						{#each g.keys as key (key.id)}
							<button
								type="button"
								class="key"
								title={key.name}
								aria-label={key.name}
								onmousedown={keepFocus}
								onpointerdown={(e) => longPressStart(e, key)}
								onpointerup={longPressEnd}
								onpointercancel={longPressEnd}
								onclick={() => press(key)}
							>
								{@render face(key)}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		{#if variantsFor?.variants}
			<div class="keypad-variants" role="menu" aria-label="Varianty {variantsFor.name}">
				{#each variantsFor.variants as v (v.label)}
					<button
						type="button"
						class="key small"
						role="menuitem"
						aria-label={v.name}
						title={v.name}
						onmousedown={keepFocus}
						onclick={() => {
							oninsert(v.insert);
							recent = writeRecent(variantsFor!.id, recent);
							variantsFor = null;
						}}>{v.label}</button
					>
				{/each}
			</div>
		{/if}

		<div class="keypad-row keypad-fixed" role="group" aria-label="Ovládání kurzoru">
			{#each FIXED_KEYS as fk (fk.id)}
				{@const Icon = ICONS[fk.icon]}
				<button
					type="button"
					class="key fixed"
					title={fk.name}
					aria-label={fk.name}
					onmousedown={keepFocus}
					onclick={() => pressFixed(fk.command, fk.kind)}
				>
					<Icon size={18} aria-hidden="true" />
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.keypad {
		flex-basis: 100%;
		/* Never wider than the row: the zones page horizontally inside instead. */
		max-width: 100%;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 2px;
		padding: 6px 2px 2px;
		border-top: 1px solid var(--e-border);
	}
	.keypad-head {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 2px;
	}
	.keypad-tabs {
		display: flex;
		gap: 2px;
		flex: 1;
		overflow-x: auto;
	}
	.keypad-tab {
		font: inherit;
		font-size: var(--text-xs);
		padding: 4px 10px;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.keypad-tab:hover {
		background: var(--e-field-hover);
		color: var(--e-text);
	}
	.keypad-tab.on {
		background: var(--e-field-rest);
		color: var(--primary-dark);
	}
	.keypad-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-muted);
		cursor: pointer;
	}
	.keypad-tool:hover,
	.keypad-tool.on {
		background: var(--e-field-hover);
		color: var(--e-text);
	}
	.keypad-search {
		font: inherit;
		font-size: var(--text-s);
		padding: 6px 10px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--e-field-rest);
		color: var(--e-text);
	}
	.keypad-results {
		display: flex;
		flex-direction: column;
		max-height: 180px;
		overflow-y: auto;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
	}
	.keypad-result {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		border: 0;
		background: none;
		font: inherit;
		color: var(--e-text);
		cursor: pointer;
		text-align: left;
	}
	.keypad-result:hover {
		background: var(--e-field-hover);
	}
	.keypad-result .r-glyph {
		min-width: 28px;
		text-align: center;
		font-size: var(--text-m);
	}
	.keypad-result .r-tab {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--e-text-muted);
	}
	.keypad-empty {
		margin: 0;
		padding: 8px 10px;
		font-size: var(--text-s);
		color: var(--e-text-muted);
	}
	.keypad-row {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 4px;
	}
	.keypad-recent .key {
		min-width: 36px;
		height: 32px;
		font-size: var(--text-s);
		color: var(--e-text-muted);
	}
	/* Named groups side by side, each 4 rows deep, in one row that scrolls sideways when
	   the tab has more than fits (§4.1). The scrollbar stays visible and a shadow sits
	   on the edge that has more keys behind it, so a group off screen is never a secret
	   (scroll shadows: the covers move with the content, the shadows stay at the edges). */
	.keypad-zones {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		min-width: 0;
		overflow-x: auto;
		padding-bottom: 6px;
		scrollbar-width: thin;
		scrollbar-color: var(--e-border-strong) transparent;
		background:
			linear-gradient(to right, var(--surface), var(--surface)) left / 24px 100% no-repeat local,
			linear-gradient(to left, var(--surface), var(--surface)) right / 24px 100% no-repeat local,
			radial-gradient(
					farthest-side at 0 50%,
					color-mix(in srgb, var(--e-text) 22%, transparent),
					transparent
				)
				left / 12px 100% no-repeat scroll,
			radial-gradient(
					farthest-side at 100% 50%,
					color-mix(in srgb, var(--e-text) 22%, transparent),
					transparent
				)
				right / 12px 100% no-repeat scroll;
	}
	.keypad-group {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	/* The group's name: a quiet caption, never wider than it needs to be. */
	.keypad-group-name {
		font-size: var(--text-xs);
		line-height: 1.3;
		color: var(--e-text-muted);
		white-space: nowrap;
		padding-left: 2px;
	}
	.keypad-zone {
		display: grid;
		grid-auto-columns: max-content;
		grid-auto-flow: column;
		grid-template-rows: repeat(4, minmax(0, auto));
		gap: 4px;
	}
	/* A number pad: row by row, as wide as the group says. */
	.keypad-zone.pad {
		grid-auto-flow: row;
		grid-template-rows: none;
	}
	/* One key: the glyph centred by flex, whatever it is — text or icon. Touch target
	   is at least 44×44 px (§7). */
	.key {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		height: 44px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius-xs);
		background: var(--e-field-rest);
		color: var(--e-text);
		font: inherit;
		font-size: var(--text-m);
		line-height: 1;
		cursor: pointer;
	}
	.key:hover {
		background: var(--e-field-hover);
	}
	.key:active {
		background: var(--primary-dark-12);
		color: var(--primary-dark);
	}
	.key:focus-visible {
		outline: 2px solid var(--primary-dark);
		outline-offset: 1px;
	}
	.key.small {
		min-width: 36px;
		height: 36px;
		font-size: var(--text-s);
	}
	.keypad-fixed {
		justify-content: flex-end;
		border-top: 1px solid var(--e-border);
		padding-top: 6px;
	}
	.keypad-variants {
		display: flex;
		gap: 4px;
		justify-content: center;
		padding: 4px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
	}
	.key :global(svg) {
		display: block;
	}
	/* A face drawn by KaTeX: the template's own shape, scaled to sit inside the key. */
	.face {
		display: inline-flex;
		align-items: center;
		font-size: 18px;
		/* KaTeX may break a line after `;`: a key never does, so its column fits the face. */
		white-space: nowrap;
	}
	/* Several rows (a matrix, a system): smaller, so it stays inside the key. */
	.face.tall {
		font-size: 11px;
	}
	.face :global(.katex) {
		font-size: 1em;
	}
	/* A box still to fill: lighter than the shape around it. */
	.face :global(.key-slot) {
		color: var(--e-text-muted);
	}
</style>
