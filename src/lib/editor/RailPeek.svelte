<script lang="ts">
	/**
	 * The panel that opens beside a tile or circle of the folded lesson panel, with the
	 * card's (or lesson's) name and what can be done to it. A 64 px rail has no room for
	 * four targets, so the targets come out to the side instead of crowding the tile.
	 *
	 * It is a native popover in manual mode: in the top layer, so the sidebar's
	 * `overflow` cannot clip it, but nothing light-dismisses it, since the rail decides
	 * when it opens and closes (hover, focus, a key). It stays a DOM child of the tile's
	 * `<li>`, which is what keeps `:focus-within` and scoped locators on the tile true.
	 * It is only rendered while open, and placed once with `placeMenu`, as `Menu` is.
	 *
	 * An invisible strip on each side bridges the gap to the tile, so the pointer never
	 * crosses dead space on the way in.
	 */
	import type { Snippet } from 'svelte';
	import { placeMenu } from '$lib/ui/placement';

	interface Props {
		/** The tile or circle the panel points at. */
		anchor: HTMLElement;
		label: string;
		/** The rail closes it when what it points at moves out from under it. */
		onclose: () => void;
		children: Snippet;
	}
	let { anchor, label, onclose, children }: Props = $props();

	const GAP = 10;
	let panel = $state<HTMLElement | null>(null);

	$effect(() => {
		if (panel === null) return;
		panel.showPopover();
		// Measured in the same task as `showPopover()`, so it is never painted misplaced.
		const box = panel.getBoundingClientRect();
		const rect = anchor.getBoundingClientRect();
		// A little higher than the tile, so the panel's padding lines up with its edge.
		const spot = placeMenu(
			{ top: rect.top - 8, bottom: rect.bottom, left: rect.left, right: rect.right },
			{ width: box.width, height: box.height },
			{ width: window.innerWidth, height: window.innerHeight },
			'right-start',
			GAP
		);
		panel.style.setProperty('--anchor-height', `${rect.height}px`);
		// Where the tile is within the panel, which a clamp at the window's edge changes.
		panel.style.setProperty('--anchor-top', `${rect.top - spot.top}px`);
		panel.style.top = `${spot.top}px`;
		panel.style.left = `${spot.left}px`;
	});

	$effect(() => {
		// Only a scroll of something that carries the tile moves the tile. The editor
		// column scrolling to a card that was just clicked must not shut the panel (the
		// trap `Menu` fell into, OPEN-PROBLEMS #28).
		const scrolled = (event: Event) => {
			const target = event.target;
			if (target instanceof Node && target.contains(anchor)) onclose();
		};
		window.addEventListener('scroll', scrolled, true);
		window.addEventListener('resize', onclose);
		return () => {
			window.removeEventListener('scroll', scrolled, true);
			window.removeEventListener('resize', onclose);
		};
	});

	/** Same reason as `CardActions`: a press inside must not start dragging the tile. */
	function noDrag(node: HTMLElement) {
		const stop = (event: Event) => event.stopPropagation();
		node.addEventListener('mousedown', stop);
		node.addEventListener('touchstart', stop, { passive: true });
		return {
			destroy() {
				node.removeEventListener('mousedown', stop);
				node.removeEventListener('touchstart', stop);
			}
		};
	}
</script>

<div class="peek" popover="manual" role="group" aria-label={label} bind:this={panel} use:noDrag>
	{@render children()}
</div>

<style>
	/* `display` only while open, or it would beat the UA's `display: none`. */
	.peek:popover-open {
		display: block;
		/* The UA centres popovers with `inset: 0; margin: auto`; the script sets top/left. */
		position: fixed;
		inset: auto;
		top: 0;
		left: 0;
		margin: 0;
		box-sizing: border-box;
		width: 240px;
		padding: 10px 12px 8px;
		overflow: visible;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--e-text);
		box-shadow: var(--shadow-strong);
		animation: peek-in 140ms ease-out;
	}

	/* The bridges. The panel keeps its own border, so these are outside it. */
	.peek::before,
	.peek::after {
		content: '';
		position: absolute;
		/* As tall as the tile it points at, level with it, and no taller: a strip down the
		   whole panel would take the edge of the tiles below for this one. */
		top: var(--anchor-top, 8px);
		height: var(--anchor-height, 36px);
		width: 14px;
	}

	.peek::before {
		right: 100%;
	}

	.peek::after {
		left: 100%;
	}

	@keyframes peek-in {
		from {
			opacity: 0;
			transform: translateX(-4px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.peek:popover-open {
			animation: none;
		}
	}
</style>
