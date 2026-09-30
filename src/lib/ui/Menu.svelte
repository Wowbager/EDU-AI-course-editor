<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import Button from './Button.svelte';
	import { setMenu } from './context';
	import { placeMenu, type Placement } from './placement';

	/**
	 * A button that opens a list of actions.
	 *
	 * The list is a native popover (`popover="auto"`), not an absolutely positioned
	 * div: it lives in the top layer, so the sidebar's `overflow` cannot clip it, and
	 * Escape, click-outside and focus going back to the trigger are the browser's
	 * rather than three things we hand-roll and get wrong. The only thing left to us is
	 * where it goes, which `placeMenu` computes from the trigger's rectangle.
	 *
	 * The rule for what goes in one: **a menu holds actions, never fields a teacher
	 * must fill in.** A choice that changes the course and needs a value (a name, a
	 * number) is a dialog; a menu item does something when you press it, and closes.
	 */
	interface Props {
		/** The trigger's accessible name and the menu's; it must be a word, not a glyph. */
		label: string;
		/** Visible trigger text. Without it the trigger is icon-only. */
		text?: string;
		icon?: Component;
		variant?: 'primary' | 'secondary' | 'ghost';
		size?: 's' | 'm';
		/** Defaults to `label`. */
		title?: string;
		placement?: Placement;
		open?: boolean;
		disabled?: boolean;
		/** Extra classes for the wrapper around the trigger. */
		class?: string;
		onclose?: () => void;
		/** The items: `MenuItem` and `MenuSeparator`. */
		children: Snippet;
	}
	let {
		label,
		text,
		icon: Icon,
		variant = 'ghost',
		size = 's',
		title,
		placement = 'bottom-start',
		open = $bindable(false),
		disabled = false,
		class: extraClass = '',
		onclose,
		children
	}: Props = $props();

	const uid = $props.id();
	const id = `menu-${uid}`;

	let wrapper = $state<HTMLElement | null>(null);
	let panel = $state<HTMLElement | null>(null);

	/**
	 * Light-dismiss closes an open popover on the *pointerdown* that lands on the
	 * trigger, and the click that follows would open it again. So the trigger
	 * remembers what it saw at pointerdown, and that click is then ignored.
	 */
	let wasOpenAtPointerDown = false;

	const trigger = () => wrapper?.querySelector<HTMLElement>('.menu-trigger') ?? null;
	const isShowing = () => panel?.matches(':popover-open') ?? false;

	function show() {
		const anchor = trigger();
		if (panel === null || anchor === null || isShowing()) return;
		panel.showPopover();
		// Measured in the same task as `showPopover()`, so the menu is never painted
		// in the wrong place first.
		const box = panel.getBoundingClientRect();
		const spot = placeMenu(
			anchor.getBoundingClientRect(),
			{ width: box.width, height: box.height },
			{ width: window.innerWidth, height: window.innerHeight },
			placement
		);
		panel.style.top = `${spot.top}px`;
		panel.style.left = `${spot.left}px`;
		panel.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
	}

	function close() {
		if (isShowing()) panel?.hidePopover();
	}

	setMenu({ close });

	// `open` is also how a parent opens or closes the menu from outside.
	$effect(() => {
		if (panel === null) return;
		if (open) show();
		else close();
	});

	function ontoggle(event: Event) {
		const opened = (event as ToggleEvent).newState === 'open';
		if (opened === open) return;
		open = opened;
		if (!opened) onclose?.();
	}

	function onpointerdown() {
		wasOpenAtPointerDown = open;
	}

	function onclick() {
		if (wasOpenAtPointerDown) {
			wasOpenAtPointerDown = false;
			return;
		}
		open = !open;
	}

	$effect(() => {
		if (!open) return;
		// A menu anchored to a rectangle that has moved is worse than no menu.
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

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Tab') {
			// Focus goes back to the trigger, and the Tab then moves on from there.
			close();
			return;
		}
		const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
		if (!keys.includes(event.key) || panel === null) return;
		const items = [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
		if (items.length === 0) return;
		event.preventDefault();
		const at = items.indexOf(document.activeElement as HTMLElement);
		let next: number;
		if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = items.length - 1;
		else if (event.key === 'ArrowDown') next = at + 1 >= items.length ? 0 : at + 1;
		else next = at <= 0 ? items.length - 1 : at - 1;
		items[next].focus();
	}
</script>

<div class="menu {extraClass}" bind:this={wrapper}>
	<Button
		class="menu-trigger"
		{variant}
		{size}
		{disabled}
		title={title ?? label}
		ariaLabel={label}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={id}
		{onpointerdown}
		{onclick}
	>
		{#if Icon}<Icon size={16} aria-hidden="true" />{/if}
		{#if text}{text}{/if}
	</Button>
	<div
		{id}
		class="menu-panel"
		popover="auto"
		role="menu"
		tabindex="-1"
		aria-label={label}
		bind:this={panel}
		{ontoggle}
		{onkeydown}
	>
		{@render children()}
	</div>
</div>

<style>
	.menu {
		display: inline-flex;
	}

	/* `display` only while open: a bare `display: flex` would beat the UA's
	   `[popover]:not(:popover-open) { display: none }`. */
	.menu-panel:popover-open {
		display: flex;
		flex-direction: column;
		gap: 1px;
		/* The UA centres popovers with `inset: 0; margin: auto`; the script sets top/left. */
		position: fixed;
		inset: auto;
		top: 0;
		left: 0;
		margin: 0;
		box-sizing: border-box;
		min-width: 12rem;
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		padding: 4px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--e-text);
		box-shadow: var(--shadow-strong);
		outline: none;
	}
</style>
