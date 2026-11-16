<script lang="ts">
	/**
	 * „Moje kurzy“ — the quiet door to the teacher's other courses, opened from the
	 * chevron beside the course name. A native popover like the shared pickers:
	 * Escape and a click outside close it, focus goes back to the trigger.
	 *
	 * A row is a name and one muted line saying when it was last touched — enough
	 * to tell two „Nový kurz“ apart, nothing more (DESIGN.md: no counts, no ids,
	 * no statuses). The open course carries a check. Below the list: the two ways
	 * another course arrives, „Nový kurz“ and „Nahrát ze souboru…“.
	 */
	import { flushSync } from 'svelte';
	import { Check, Plus, Upload } from '@lucide/svelte';
	import { placeMenu, VIEWPORT_MARGIN } from '$lib/ui/placement';
	import type { CourseEntry } from '$lib/state/courses';

	interface Props {
		entries: CourseEntry[];
		openId: string;
		onopen: (courseId: string) => void;
		onnew: () => void;
		onimport: () => void;
		onshowchange?: (open: boolean) => void;
	}
	let { entries, openId, onopen, onnew, onimport, onshowchange }: Props = $props();

	let panel = $state<HTMLDivElement | null>(null);
	let anchorRef: HTMLElement | null = null;
	const isShowing = () => panel?.matches(':popover-open') ?? false;

	/** Opens below the trigger; the content is rendered before it is measured. */
	export function show(anchor: HTMLElement) {
		if (panel === null || isShowing()) return;
		flushSync();
		panel.showPopover();
		place(anchor);
		anchorRef = anchor;
		const current = panel.querySelector<HTMLElement>('.course.current');
		(current ?? panel.querySelector<HTMLElement>('.course'))?.focus();
	}

	function place(anchor: HTMLElement) {
		if (panel === null) return;
		const at = anchor.getBoundingClientRect();
		panel.style.maxHeight = '';
		const room = window.innerHeight - at.bottom - 4 - VIEWPORT_MARGIN;
		if (panel.getBoundingClientRect().height > room && room >= 180) {
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

	// The list can grow while the box is open (the server's histories arrive);
	// keep the box under its trigger as it does.
	$effect(() => {
		entries.length;
		if (anchorRef !== null && isShowing()) place(anchorRef);
	});

	let open = $state(false);
	const ontoggle = (event: Event) => {
		open = (event as ToggleEvent).newState === 'open';
		if (!open) anchorRef = null;
		onshowchange?.(open);
	};

	$effect(() => {
		if (!open) return;
		// A box anchored to a rectangle that has moved is worse than no box.
		const dismiss = (event: Event) => {
			if (event.target instanceof Node && panel?.contains(event.target)) return;
			panel?.hidePopover();
		};
		window.addEventListener('scroll', dismiss, true);
		window.addEventListener('resize', dismiss);
		return () => {
			window.removeEventListener('scroll', dismiss, true);
			window.removeEventListener('resize', dismiss);
		};
	});

	function onkeydown(event: KeyboardEvent) {
		const rows = [...(panel?.querySelectorAll<HTMLElement>('.course') ?? [])];
		const at = rows.indexOf(document.activeElement as HTMLElement);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const down = event.key === 'ArrowDown';
			const next =
				at === -1
					? down
						? rows[0]
						: rows[rows.length - 1]
					: rows[Math.min(rows.length - 1, Math.max(0, at + (down ? 1 : -1)))];
			next?.focus();
			next?.scrollIntoView({ block: 'nearest' });
		}
	}

	function choose(courseId: string) {
		panel?.hidePopover();
		onopen(courseId);
	}

	const day = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' });
	const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

	/** One muted line: when the course was last touched, in the teacher's words. */
	function when(entry: CourseEntry): string {
		const then = new Date(entry.savedAt);
		if (Number.isNaN(then.getTime())) return '';
		const verb = entry.where === 'draft' ? 'upraveno' : 'uloženo';
		const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);
		if (days <= 0) return `${verb} dnes`;
		if (days === 1) return `${verb} včera`;
		if (days < 7) return `${verb} před ${days} dny`;
		return `${verb} ${day.format(then)}`;
	}
</script>

<div
	class="courses"
	popover="auto"
	role="dialog"
	tabindex="-1"
	aria-label="Moje kurzy"
	bind:this={panel}
	{ontoggle}
	{onkeydown}
>
	<div class="list">
		{#each entries as entry (entry.courseId)}
			<button
				type="button"
				class="course"
				class:current={entry.courseId === openId}
				aria-current={entry.courseId === openId ? 'true' : undefined}
				onclick={() => choose(entry.courseId)}
			>
				<span class="line">
					<span class="name">{entry.name || 'Nový kurz'}</span>
					{#if entry.courseId === openId}
						<Check size={14} aria-hidden="true"></Check>
						<span class="sr">(otevřeno)</span>
					{/if}
				</span>
				<span class="when">{when(entry)}</span>
			</button>
		{:else}
			<p class="empty">Zatím tu žádné další kurzy nejsou.</p>
		{/each}
	</div>
	<div class="actions">
		<button
			type="button"
			class="action"
			onclick={() => {
				panel?.hidePopover();
				onnew();
			}}
		>
			<Plus size={14} aria-hidden="true"></Plus>
			Nový kurz
		</button>
		<button
			type="button"
			class="action"
			onclick={() => {
				panel?.hidePopover();
				onimport();
			}}
		>
			<Upload size={14} aria-hidden="true"></Upload>
			Nahrát ze souboru…
		</button>
	</div>
</div>

<style>
	/* `display` only while open, or it would beat the UA's `display: none`. */
	.courses:popover-open {
		display: flex;
		flex-direction: column;
		position: fixed;
		inset: auto;
		top: 0;
		left: 0;
		margin: 0;
		box-sizing: border-box;
		width: 320px;
		max-width: calc(100vw - 16px);
		max-height: min(420px, calc(100vh - 16px));
		padding: 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--e-text);
		box-shadow: var(--shadow-strong);
		animation: courses-in 140ms ease-out;
	}

	@keyframes courses-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.courses:popover-open {
			animation: none;
		}
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
		min-height: 0;
	}

	.course {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 7px 10px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text);
		font-family: var(--font-body);
		font-size: var(--text-s);
		text-align: left;
		cursor: pointer;
	}

	.course:hover,
	.course:focus-visible {
		background: var(--e-field-hover);
	}

	.line {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: var(--weight-semibold);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.line :global(svg) {
		flex: none;
		color: var(--e-text-muted);
	}

	.when {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.empty {
		margin: 6px 10px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 4px;
		padding-top: 6px;
		border-top: 1px solid var(--e-border);
	}

	.action {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-muted);
		font-family: var(--font-body);
		font-size: var(--text-s);
		text-align: left;
		cursor: pointer;
	}

	.action:hover,
	.action:focus-visible {
		background: var(--e-field-hover);
		color: var(--e-text);
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
