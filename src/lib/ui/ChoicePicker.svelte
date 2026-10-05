<script lang="ts">
	/**
	 * One way to pick from a list: a small box in the style of „Přidat dovednost“
	 * (`TopicPicker`) and the folded sidebar's hover panel (`RailPeek`), instead of a
	 * native select that runs off the screen. Cards, skills and "Kam dál" all use it.
	 *
	 * It is the box only: the owner has the trigger and calls `show(anchor)`. A native
	 * popover placed once with `placeMenu`, so it closes on Escape and on a click
	 * outside, and gives focus back to the trigger. The data is `PickerStep`s
	 * (`choice-picker.ts`): groups of two-line items, a disabled item that says why, a
	 * marked current one, and an item that opens a next step with a „Zpět“ link.
	 *
	 * Keys: arrows move through the items, Enter picks, and typing anywhere goes to the
	 * search field, which exists only when the list is longer than eight items.
	 */
	import { flushSync, tick } from 'svelte';
	import { Check, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { placeMenu, VIEWPORT_MARGIN } from './placement';
	import {
		filterGroups,
		firstToFocus,
		followPath,
		needsSearch,
		pickable,
		type PickerItem,
		type PickerStep
	} from './choice-picker';

	interface Props {
		/** The accessible name of the box. */
		label: string;
		root: PickerStep;
		/** The ids of the items picked, first step to last. */
		onpick: (path: string[]) => void;
	}
	let { label, root, onpick }: Props = $props();

	let panel = $state<HTMLElement | null>(null);
	/** The ids walked through so far; the step shown is the one they lead to. */
	let path = $state<string[]>([]);
	let query = $state('');
	/** Where the walk started, so „Zpět“ never goes above it. */
	const trail = $derived(followPath(root, path));
	const step = $derived(trail[trail.length - 1]);
	const searchable = $derived(needsSearch(step.groups));
	const shown = $derived(filterGroups(step.groups, searchable ? query : ''));

	const isShowing = () => panel?.matches(':popover-open') ?? false;

	/**
	 * Opens below `anchor` (above it only when there is no room below), on `at` (item
	 * ids from the first step) when given. Everything happens in the click that calls
	 * it, with no `await`: the content is rendered with `flushSync` so it can be
	 * measured, and focus is inside the box before the browser handles the next key.
	 * A teacher who clicks and types at once, as a teacher who knows the card does,
	 * loses no letters; a `tick()` here once cost the first ones.
	 */
	export function show(anchor: HTMLElement, at: string[] = []) {
		if (panel === null || isShowing()) return;
		path = at;
		query = '';
		// Rendered before it is measured, or the box is placed by its previous size.
		flushSync();
		panel.showPopover();
		place(anchor);
		anchorRef = anchor;
		focusStart();
	}

	export function close() {
		if (isShowing()) panel?.hidePopover();
	}

	let anchorRef: HTMLElement | null = null;
	/**
	 * Below the trigger. A box that is taller than the room under it shrinks and scrolls
	 * as long as that room is worth having (`MIN_BELOW`); only when there is hardly any
	 * does it open above — otherwise it would sit on the answers over the trigger.
	 */
	const MIN_BELOW = 180;
	function place(anchor: HTMLElement) {
		if (panel === null) return;
		const at = anchor.getBoundingClientRect();
		panel.style.maxHeight = '';
		const room = window.innerHeight - at.bottom - 4 - VIEWPORT_MARGIN;
		if (panel.getBoundingClientRect().height > room && room >= MIN_BELOW) {
			panel.style.maxHeight = `${room}px`;
		}
		const box = panel.getBoundingClientRect();
		const spot = placeMenu(
			at,
			{ width: box.width, height: box.height },
			{ width: window.innerWidth, height: window.innerHeight },
			'bottom-start'
		);
		panel.style.top = `${spot.top}px`;
		panel.style.left = `${spot.left}px`;
	}

	const items = () => [...(panel?.querySelectorAll<HTMLElement>('.choice') ?? [])];

	/** Synchronous: the DOM already shows the step (`show` flushes, `enter` ticks). */
	function focusStart() {
		const current = panel?.querySelector<HTMLElement>('.choice.current');
		if (current) {
			current.focus();
			current.scrollIntoView({ block: 'nearest' });
		} else if (searchable) panel?.querySelector<HTMLElement>('.search')?.focus();
		else (items()[0] ?? panel?.querySelector<HTMLElement>('.back'))?.focus();
	}

	/** A step change can make the box taller or shorter; keep it where it was anchored. */
	async function enter(next: string[]) {
		path = next;
		query = '';
		await tick();
		if (anchorRef) place(anchorRef);
		focusStart();
	}

	function choose(item: PickerItem) {
		if (item.disabledReason !== undefined) return;
		if (item.next !== undefined) return void enter([...path, item.id]);
		const picked = [...path, item.id];
		close();
		onpick(picked);
	}

	const back = () => enter(path.slice(0, -1));

	function onkeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		const list = items();
		const at = list.indexOf(target);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const down = event.key === 'ArrowDown';
			if (at === -1) {
				(down ? list[0] : list[list.length - 1])?.focus();
			} else if (!down && at === 0 && searchable) {
				panel?.querySelector<HTMLElement>('.search')?.focus();
			} else {
				list[Math.min(list.length - 1, Math.max(0, at + (down ? 1 : -1)))]?.focus();
			}
			list.find((el) => el === document.activeElement)?.scrollIntoView({ block: 'nearest' });
		} else if (event.key === 'Enter' && target.classList.contains('search')) {
			event.preventDefault();
			const first = pickable(shown)[0];
			if (first) choose(first);
		} else if (
			searchable &&
			!target.classList.contains('search') &&
			event.key.length === 1 &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			event.key !== ' '
		) {
			// The character lands in the field because focus moves before the key's default.
			panel?.querySelector<HTMLElement>('.search')?.focus();
		}
	}

	let open = $state(false);
	const ontoggle = (event: Event) => (open = (event as ToggleEvent).newState === 'open');

	$effect(() => {
		if (!open) return;
		// A box anchored to a rectangle that has moved is worse than no box.
		const dismiss = (event: Event) => {
			if (event.target instanceof Node && panel?.contains(event.target)) return;
			close();
		};
		window.addEventListener('scroll', dismiss, true);
		window.addEventListener('resize', dismiss);
		return () => {
			window.removeEventListener('scroll', dismiss, true);
			window.removeEventListener('resize', dismiss);
		};
	});
</script>

<div
	class="picker"
	popover="auto"
	role="dialog"
	tabindex="-1"
	aria-label={label}
	bind:this={panel}
	{ontoggle}
	{onkeydown}
>
	<h4>{step.title}</h4>
	{#if trail.length > 1}
		<button type="button" class="back" onclick={back}>
			<ChevronLeft size={14} aria-hidden="true"></ChevronLeft>
			Zpět
		</button>
	{/if}
	{#if step.subject}
		<div class="subject">{step.subject}</div>
	{/if}
	{#if searchable}
		<input
			class="search"
			type="search"
			placeholder="Hledat"
			aria-label="Hledat v nabídce"
			autocomplete="off"
			bind:value={query}
		/>
	{/if}
	{#each shown as group, g (`${g}-${group.heading ?? ''}`)}
		{#if group.heading}<div class="area">{group.heading}</div>{/if}
		{#each group.items as item (item.id)}
			<button
				type="button"
				class="choice"
				class:current={item.current}
				class:disabled={item.disabledReason !== undefined}
				aria-disabled={item.disabledReason !== undefined ? 'true' : undefined}
				aria-current={item.current ? 'true' : undefined}
				onclick={() => choose(item)}
			>
				<span class="line">
					<span class="choice-title">{item.name}</span>
					{#if item.hint}<span class="hint">{item.hint}</span>{/if}
					{#if item.current}
						<Check size={14} aria-hidden="true"></Check>
						<span class="sr">(vybráno)</span>
					{:else if item.next}
						<ChevronRight size={14} aria-hidden="true"></ChevronRight>
					{/if}
				</span>
				{#if item.detail}<span class="choice-desc">{item.detail}</span>{/if}
				{#if item.disabledReason}<span class="reason">{item.disabledReason}</span>{/if}
			</button>
		{/each}
	{:else}
		<p class="empty">
			{query.trim() !== '' ? 'Nic takového tu není.' : (step.empty ?? 'Není z čeho vybírat.')}
		</p>
	{/each}
</div>

<style>
	/* `display` only while open, or it would beat the UA's `display: none`. */
	.picker:popover-open {
		display: flex;
		flex-direction: column;
		gap: 2px;
		position: fixed;
		inset: auto;
		top: 0;
		left: 0;
		margin: 0;
		box-sizing: border-box;
		width: 360px;
		max-width: calc(100vw - 16px);
		max-height: min(420px, calc(100vh - 16px));
		overflow-y: auto;
		padding: 10px 12px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--e-text);
		box-shadow: var(--shadow-strong);
		animation: picker-in 140ms ease-out;
	}

	@keyframes picker-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.picker:popover-open {
			animation: none;
		}
	}

	h4 {
		margin: 0 0 6px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.area {
		margin: 8px 0 2px;
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
	}

	.subject {
		margin: 6px 0 4px;
		color: var(--e-text);
		font-size: var(--text-s);
		font-weight: var(--weight-semibold);
	}

	/* The search stays in view while a long list scrolls under it. */
	.search {
		position: sticky;
		top: 0;
		z-index: 1;
		box-sizing: border-box;
		width: 100%;
		margin: 0 0 4px;
		padding: 5px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text);
		font-family: var(--font-body);
		font-size: var(--text-s);
	}

	.empty {
		margin: 4px 0;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.choice,
	.back {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		padding: 6px 8px;
		border: 1px solid transparent;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text);
		font-family: var(--font-body);
		font-size: var(--text-s);
		text-align: left;
		cursor: pointer;
	}

	.choice:hover,
	.choice:focus-visible,
	.back:hover {
		background: var(--surface-light);
	}

	.line {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
	}

	.line :global(svg) {
		flex: none;
		margin-left: auto;
		color: var(--e-text-muted);
	}

	.choice-title {
		font-weight: var(--weight-semibold);
		overflow-wrap: anywhere;
	}

	.hint {
		color: var(--e-text-faint);
		font-family: var(--font-code);
		font-size: var(--text-xs);
	}

	.choice-desc {
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.reason {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		font-style: italic;
	}

	.choice.current {
		border-color: var(--e-border);
		background: var(--surface-light);
	}

	/* Not hidden — a card that cannot be picked still says why. */
	.choice.disabled {
		cursor: not-allowed;
	}

	.choice.disabled .choice-title {
		color: var(--e-text-muted);
		font-weight: 400;
	}

	.choice.disabled:hover {
		background: none;
	}

	.back {
		flex-direction: row;
		align-items: center;
		gap: 4px;
		width: auto;
		align-self: flex-start;
		padding: 2px 6px 2px 2px;
		color: var(--e-text-muted);
		font-size: var(--text-xs);
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
