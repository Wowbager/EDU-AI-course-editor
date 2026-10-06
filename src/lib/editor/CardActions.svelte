<script lang="ts">
	/**
	 * The four things a card can be told to do, as a row of round buttons. It is the
	 * body of the rail's peek panel and sits at the right of a tree row, so both say
	 * the same thing in the same order: Nastavení, Duplikovat, Odebrat z lekce, and,
	 * behind a hairline, Smazat.
	 *
	 * **Smazat takes two clicks.** Hover or focus rings it in red; the first click
	 * fills the circle (it is armed and says so in its name and in the caption); the
	 * second deletes. It disarms when the pointer or focus leaves the row, on Escape
	 * and after four seconds. The deletion is undoable from the toast anyway, so this
	 * is not a wall: it is a small speed bump against a slip of the hand, and it costs
	 * nothing when you mean it.
	 *
	 * The buttons are out of the tab order, like everything inside a card's row: the
	 * card is the one tab stop, → goes into the actions, ← and Escape come back.
	 */
	import { Copy, ListX, Settings, Trash } from '@lucide/svelte';

	interface Props {
		/** The card's 1-based place in its lesson: the number every name here carries. */
		position: number;
		/** With `caption`, the line's resting text: the model's `actions_caption`. */
		rest?: string;
		/** Where the screen model says that resting text, for `data-screen`. */
		screen?: string;
		size?: 'm' | 's';
		/**
		 * A line under the row that names the button under the pointer or focus. It is
		 * always there and keeps its height, so nothing moves when it changes. Without
		 * it the buttons carry a native title instead.
		 */
		caption?: boolean;
		onsettings: () => void;
		onduplicate: () => void;
		onremoveFromLesson: () => void;
		onremove: () => void;
		/** Escape, or ← from the first button: focus goes back to the card. */
		onexit?: () => void;
	}
	let {
		position,
		rest,
		screen,
		size = 'm',
		caption = false,
		onsettings,
		onduplicate,
		onremoveFromLesson,
		onremove,
		onexit
	}: Props = $props();

	/** How long an armed Smazat waits for its second click. */
	const ARMED_MS = 4000;

	let row = $state<HTMLElement | null>(null);
	let armed = $state(false);
	/** The short name of the button that has the pointer or focus, for the caption. */
	let hint = $state<string | null>(null);

	const names = $derived({
		settings: `Nastavení ${position}. karty`,
		duplicate: `Duplikovat ${position}. kartu`,
		remove: `Odebrat ${position}. kartu z lekce`,
		delete: `Smazat ${position}. kartu`
	});
	const deleteName = $derived(
		armed ? `Opravdu smazat ${position}. kartu? Klikni znovu` : names.delete
	);
	const captionText = $derived(armed ? 'Klikni znovu pro smazání' : (hint ?? rest ?? ''));
	/** Only the resting text is the model's; a hint or the armed line is the button's own. */
	const resting = $derived(!armed && hint === null);

	$effect(() => {
		if (!armed) return;
		const timer = setTimeout(() => (armed = false), ARMED_MS);
		return () => clearTimeout(timer);
	});

	function clickDelete() {
		if (!armed) {
			armed = true;
			return;
		}
		armed = false;
		onremove();
	}

	const buttons = () =>
		row === null ? [] : [...row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			armed = false;
			onexit?.();
			return;
		}
		const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const all = buttons();
		const at = all.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'ArrowLeft' && at <= 0) {
			onexit?.();
			return;
		}
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? all.length - 1
					: Math.min(all.length - 1, at + (event.key === 'ArrowLeft' ? -1 : 1));
		all[next]?.focus();
	}

	function onfocusout(event: FocusEvent) {
		if (!(event.relatedTarget instanceof Node && row?.contains(event.relatedTarget))) {
			armed = false;
			hint = null;
		}
	}

	/**
	 * A press on the row must not reach the card's drag: svelte-dnd-action starts a
	 * drag from any press inside the item that is not on a form control, and the icon
	 * inside a button is not one. A real listener, not `onmousedown`: Svelte delegates
	 * that to the root, after the item has already taken the press.
	 */
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

	const label = (short: string, full: string) => ({
		title: caption ? undefined : full,
		'aria-label': full,
		onpointerenter: () => (hint = short),
		onpointerleave: () => (hint = null),
		onfocus: () => (hint = short)
	});
</script>

<div class="card-actions" class:small={size === 's'}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (the key handler is the toolbar's roving focus) -->
	<div
		class="row"
		role="group"
		aria-label={`Akce ${position}. karty`}
		bind:this={row}
		use:noDrag
		{onkeydown}
		{onfocusout}
		onpointerleave={() => (armed = false)}
	>
		<button
			type="button"
			class="action"
			tabindex="-1"
			{...label('Nastavení', names.settings)}
			onclick={onsettings}
		>
			<Settings size={size === 's' ? 15 : 16} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="action"
			tabindex="-1"
			{...label('Duplikovat', names.duplicate)}
			onclick={onduplicate}
		>
			<Copy size={size === 's' ? 15 : 16} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="action"
			tabindex="-1"
			{...label('Odebrat z lekce', names.remove)}
			onclick={onremoveFromLesson}
		>
			<ListX size={size === 's' ? 15 : 16} aria-hidden="true" />
		</button>
		<span class="rule" aria-hidden="true"></span>
		<button
			type="button"
			class="action danger"
			class:armed
			tabindex="-1"
			{...label('Smazat', deleteName)}
			onclick={clickDelete}
		>
			<Trash size={size === 's' ? 15 : 16} aria-hidden="true" />
		</button>
	</div>
	{#if caption}
		<!-- Polite: arming is announced here, as the button's name changes under focus. -->
		<p class="caption" class:armed aria-live="polite" data-screen={resting ? screen : undefined}>
			{captionText}
		</p>
	{/if}
</div>

<style>
	.card-actions {
		--size: 32px;
	}

	.card-actions.small {
		--size: 28px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	/* In a tree row the buttons stay in the right half, so the middle of the row is
	   still the card: a click there selects it, however the pointer got there. */
	.small .row {
		gap: 2px;
	}

	.small .rule {
		margin: 0 2px;
	}

	.action {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: var(--size);
		height: var(--size);
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--e-text-muted);
		cursor: pointer;
		/* The ring is a shadow, not a border, so no state changes the button's size. */
		box-shadow: inset 0 0 0 1.5px transparent;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			box-shadow 120ms ease;
	}

	.action:hover {
		background: var(--primary-dark-08);
		color: var(--e-text);
	}

	.action:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}

	.rule {
		flex: none;
		width: 1px;
		height: 18px;
		margin: 0 4px;
		background: var(--e-border-strong);
	}

	/* Smazat: outlined in red on hover and focus, filled once armed. */
	.danger:hover,
	.danger:focus-visible {
		background: transparent;
		color: var(--e-error);
		box-shadow: inset 0 0 0 1.5px var(--e-error);
		outline: none;
	}

	.danger.armed,
	.danger.armed:hover,
	.danger.armed:focus-visible {
		background: var(--e-error);
		color: var(--surface);
		box-shadow: inset 0 0 0 1.5px var(--e-error);
	}

	.caption {
		height: 16px;
		margin: 6px 0 0;
		overflow: hidden;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		line-height: 16px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.caption.armed {
		color: var(--e-error);
	}

	@media (prefers-reduced-motion: reduce) {
		.action {
			transition: none;
		}
	}
</style>
