<script lang="ts">
	/**
	 * What the card trains (§6.3) — the didactic front door, and the metodik's main
	 * control, and the only control for skills: there is no vector to edit by hand.
	 *
	 * A card can train **several** topics: `relation_vector` carries one value per
	 * subconstruct, and the spec expects "one or two `2`s and perhaps a couple of
	 * `1`s". The descriptive `gpf.subconstruct` is a single string, so it names the
	 * strongest topic and is rewritten from the set on every change (`setTopics`) — the
	 * two can no longer disagree.
	 *
	 * The teacher thinks in skills with levels, not in 35 numbered dimensions: a row
	 * reads "Zlomky · Úroveň 2", and adding walks through skill → level → "je o tom" or
	 * "využívá" in a small box. A row is editable in place: clicking its name opens the same
	 * box on the level step (current level marked, "Jiná dovednost" goes back to the skill
	 * list), and the change keeps the row's relation and difficulty. The list comes from the course's skill configuration,
	 * never from a constant here (§3 invariant 6).
	 *
	 * The rows, the chips and every step of the box are the model's (`screen/settings.ts`);
	 * where the walk has got to is `store.ui.topic`. This draws the box, places it and
	 * writes the choice.
	 */
	import { withUndoNotice } from './undo-notice';
	import { tick } from 'svelte';
	import type { BlockV2 } from '$lib/domain/schema';
	import type { TopicPanelItem, TopicsView } from '$lib/screen/types';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { placeMenu } from '$lib/ui/placement';
	import { useStore } from '$lib/ui/context';
	import { blockTopics, setTopics, type BlockTopic } from '$lib/domain/commands';
	import { dimensionCount, ELO_BASELINE } from '$lib/domain/skill-config';
	import { ChevronLeft, Pencil, Plus, Trash2 } from '@lucide/svelte';

	interface Props {
		block: BlockV2;
		view: TopicsView;
		/** Where `view` is in the model, for `data-screen`. */
		screen: string;
	}
	let { block, view, screen }: Props = $props();

	const store = useStore();
	const uid = $props.id();
	const panelId = `skill-picker-${uid}`;

	const count = $derived(dimensionCount(store.skillConfig));
	const topics = $derived(blockTopics(block));
	const flow = $derived(store.ui.topic);
	/** What is taken by another row: when editing, the edited row's own level is free. */
	const taken = $derived(
		new Set(topics.map((t) => t.dimensionIndex).filter((i) => i !== flow.editing))
	);

	const RELATIONS = [
		{ value: '2', label: 'Je o tom', title: 'Karta tuhle dovednost učí' },
		{ value: '1', label: 'Využívá', title: 'Karta ji potřebuje mimochodem' }
	];

	/** The classification the strongest topic implies. */
	function naming(index: number) {
		const dimension = store.skillConfig?.vector?.dimensions?.find(
			(d) => d.dimension_index === index
		);
		if (dimension === undefined) return {};
		return {
			domain: dimension.domain_name,
			construct: dimension.construct_name,
			subconstruct: `${dimension.code} ${dimension.name}`
		};
	}

	/**
	 * The row just added or changed: it may sit anywhere in taxonomy order, so it is
	 * scrolled into view and marked for a moment. The mark is a background that fades
	 * out; with reduced motion it is the same mark without the fade (it is simply
	 * removed after the same time), and nothing stays on screen afterwards.
	 */
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	const FLASH_MS = 1200;

	async function flash(index: number) {
		store.ui.topic.flashed = index;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (store.ui.topic.flashed = null), FLASH_MS);
		await tick();
		const row = list?.querySelector<HTMLElement>(`[data-dimension="${index}"]`);
		const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		row?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
	}
	let list = $state<HTMLElement | null>(null);

	function commit(next: BlockTopic[]) {
		if (count === null) return;
		store.apply((d) => setTopics(d, block.block_id, next, count, naming));
	}

	/** Like a removed step or answer, a removed skill says so and offers its undo. */
	const remove = (index: number) =>
		withUndoNotice(
			store,
			'Dovednost odebrána.',
			() => commit(topics.filter((t) => t.dimensionIndex !== index)),
			{ lessonId: store.open.lesson?.lesson_id, blockId: block.block_id }
		);

	const setRelation = (index: number, relation: 1 | 2) =>
		commit(topics.map((t) => (t.dimensionIndex === index ? { ...t, relation } : t)));

	/** An emptied field gives back the default, never 0 clamped to the minimum. */
	const setElo = (index: number, elo: number | undefined) =>
		commit(
			topics.map((t) => (t.dimensionIndex === index ? { ...t, elo: elo ?? ELO_BASELINE } : t))
		);

	// The box: a native popover, placed once by `placeMenu` as `Menu` does.
	let wrapper = $state<HTMLElement | null>(null);
	let panel = $state<HTMLElement | null>(null);
	/** Which trigger's box was open when the press began: a click on that one only closes it. */
	let openAtPointerDown: number | null | undefined = undefined;

	const isShowing = () => panel?.matches(':popover-open') ?? false;

	async function focusFirst() {
		await tick();
		(
			panel?.querySelector<HTMLElement>('.choice') ?? panel?.querySelector<HTMLElement>('button')
		)?.focus();
	}

	/** `index` is the row to change (with the skill it is in); without it the box adds one. */
	function show(
		anchor: HTMLElement | null | undefined,
		row: { dimension: number; skill_key: string | null } | null = null
	) {
		if (panel === null || !anchor || isShowing()) return;
		const current = row !== null && row.skill_key !== null;
		store.ui.topic = {
			...store.ui.topic,
			editing: row?.dimension ?? null,
			step: current ? 'level' : 'skill',
			skill: current ? row.skill_key : null,
			dimension: null
		};
		panel.showPopover();
		const box = panel.getBoundingClientRect();
		const spot = placeMenu(
			anchor.getBoundingClientRect(),
			{ width: box.width, height: box.height },
			{ width: window.innerWidth, height: window.innerHeight },
			'bottom-start'
		);
		panel.style.top = `${spot.top}px`;
		panel.style.left = `${spot.left}px`;
		focusFirst();
	}

	function close() {
		if (isShowing()) panel?.hidePopover();
	}

	function ontoggle(event: Event) {
		store.ui.topic.open = (event as ToggleEvent).newState === 'open';
	}

	function onpointerdown() {
		openAtPointerDown = flow.open ? flow.editing : undefined;
	}

	function onclick(event: MouseEvent, row: { dimension: number; skill_key: string | null } | null) {
		const sameBox = openAtPointerDown === (row?.dimension ?? null);
		openAtPointerDown = undefined;
		if (sameBox) return;
		// Another row's box: the press already closed it, and this one opens straight away.
		show(event.currentTarget as HTMLElement, row);
	}

	$effect(() => {
		if (!flow.open) return;
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

	function pickSkill(item: TopicPanelItem) {
		store.ui.topic.skill = item.id;
		if (item.quick !== null) pickLevel(item.quick, 'skill');
		else {
			store.ui.topic.step = 'level';
			focusFirst();
		}
	}

	/** `from` is the step the back link of the relation step returns to. */
	function pickLevel(index: number, from: 'level' | 'skill' = 'level') {
		if (flow.editing !== null) return replaceRow(index);
		store.ui.topic.dimension = index;
		store.ui.topic.back = from;
		store.ui.topic.step = 'relation';
		focusFirst();
	}

	function back() {
		store.ui.topic.step = flow.step === 'relation' ? flow.back : 'skill';
		focusFirst();
	}

	/** Changing a row keeps what the teacher set on it: the relation and the difficulty. */
	function replaceRow(next: number) {
		const from = flow.editing;
		close();
		if (from === null || from === next || taken.has(next)) return;
		commit(topics.map((t) => (t.dimensionIndex === from ? { ...t, dimensionIndex: next } : t)));
		flash(next);
	}

	function pickRelation(relation: 1 | 2) {
		const dimension = flow.dimension;
		if (dimension === null || taken.has(dimension)) return close();
		commit([...topics, { dimensionIndex: dimension, relation, elo: ELO_BASELINE }]);
		close();
		flash(dimension);
	}

	/** An item of the box was clicked: what it does depends on the step. */
	function choose(item: TopicPanelItem) {
		if (item.reason !== null) return;
		if (view.panel.step === 'skill') pickSkill(item);
		else if (view.panel.step === 'level') pickLevel(item.dimension ?? -1);
		else pickRelation(item.id === '2' ? 2 : 1);
	}
</script>

<section class="topics">
	<header>
		{#each view.chips as chip, i (chip.text)}
			<Chip tone={chip.tone} title={chip.title ?? undefined}>
				<span data-screen="{screen}.chips[{i}].text">{chip.text}</span>
			</Chip>
		{/each}
		{#if view.default_note}
			<span class="default-note" data-screen="{screen}.default_note">{view.default_note}</span>
		{/if}
	</header>

	{#if view.configured}
		{#if view.rows.length > 0}
			<ul class="chosen" bind:this={list}>
				{#each view.rows as row, r (row.dimension)}
					<li data-dimension={row.dimension} class:flash={row.flashed}>
						<button
							type="button"
							class="what"
							aria-haspopup="dialog"
							aria-controls={panelId}
							title="Změnit dovednost nebo úroveň"
							aria-label={row.label}
							{onpointerdown}
							onclick={(e) => onclick(e, row)}
						>
							<span class="line">
								<strong data-screen="{screen}.rows[{r}].skill_name">{row.skill_name}</strong>
								{#if row.level}
									<span class="level" data-screen="{screen}.rows[{r}].level">{row.level}</span>
								{/if}
								{#if row.code}
									<span class="code" data-screen="{screen}.rows[{r}].code">{row.code}</span>
								{/if}
								<!-- The row is the way to change it; say so without hovering. -->
								<Pencil class="edit" size={13} aria-hidden="true"></Pencil>
							</span>
							{#if row.description}
								<span class="desc" data-screen="{screen}.rows[{r}].description"
									>{row.description}</span
								>
							{/if}
						</button>

						<Segmented
							label={row.relation_label}
							options={RELATIONS}
							value={row.relation}
							onchange={(v) => setRelation(row.dimension, v === '2' ? 2 : 1)}
						/>

						{#if row.elo}
							<label class="elo">
								obtížnost
								<span class="elo-field">
									<NumberField
										label={row.elo.label}
										value={row.elo.value}
										emptyText={row.elo.empty_text}
										ref={row.elo.ref}
										bounds={row.elo}
										screen="{screen}.rows[{r}].elo.value"
										onwrite={(v) => setElo(row.dimension, v)}
									/>
								</span>
							</label>
						{/if}

						<button
							type="button"
							class="remove"
							title="Odebrat dovednost"
							aria-label={row.remove_label}
							onclick={() => remove(row.dimension)}
						>
							<Trash2 size={15} aria-hidden="true"></Trash2>
						</button>
					</li>
				{/each}
			</ul>
			{#if view.help === 'rows'}
				<p class="help">
					<strong>Je o tom</strong>: karta dovednost učí. <strong>Využívá</strong>: karta ji jen
					potřebuje mimochodem. Většina karet učí jednu nebo dvě.
				</p>
			{/if}
		{/if}

		<div class="add" bind:this={wrapper}>
			<Button
				class="add-trigger"
				variant="secondary"
				size="s"
				aria-haspopup="dialog"
				aria-expanded={flow.open}
				aria-controls={panelId}
				{onpointerdown}
				onclick={(e) => onclick(e, null)}
			>
				<Plus size={14} aria-hidden="true"></Plus>
				Přidat dovednost
			</Button>

			<div
				id={panelId}
				class="picker"
				popover="auto"
				role="dialog"
				aria-label={view.panel.label}
				bind:this={panel}
				{ontoggle}
			>
				<h4 data-screen="{screen}.panel.title">{view.panel.title}</h4>
				{#if view.panel.back}
					<button type="button" class="back" onclick={back}>
						<ChevronLeft size={14} aria-hidden="true"></ChevronLeft>
						<span data-screen="{screen}.panel.back">{view.panel.back}</span>
					</button>
				{/if}
				{#if view.panel.subject}
					<div class="subject" data-screen="{screen}.panel.subject">{view.panel.subject}</div>
				{/if}
				{#each view.panel.groups as group, g (g)}
					{#if group.heading}
						<div class="area" data-screen="{screen}.panel.groups[{g}].heading">{group.heading}</div>
					{/if}
					{#each group.items as item, i (item.id)}
						{#if view.panel.step === 'skill'}
							<button type="button" class="choice" onclick={() => choose(item)}>
								<span data-screen="{screen}.panel.groups[{g}].items[{i}].name">{item.name}</span>
							</button>
						{:else if view.panel.step === 'level'}
							<button
								type="button"
								class="choice"
								class:current={item.current}
								disabled={item.reason !== null}
								aria-current={item.current ? 'true' : undefined}
								onclick={() => choose(item)}
							>
								<span class="choice-title">
									<span data-screen="{screen}.panel.groups[{g}].items[{i}].name">{item.name}</span
									>{#if item.current}
										<span class="mark"> · teď vybráno</span>{/if}
								</span>
								<span class="choice-desc">
									<span data-screen="{screen}.panel.groups[{g}].items[{i}].detail"
										>{item.detail}</span
									>{#if item.reason}{' '}·
										<span data-screen="{screen}.panel.groups[{g}].items[{i}].reason"
											>{item.reason}</span
										>{/if}
								</span>
							</button>
						{:else}
							<button type="button" class="choice big" onclick={() => choose(item)}>
								<span class="choice-title" data-screen="{screen}.panel.groups[{g}].items[{i}].name"
									>{item.name}</span
								>
								<span class="choice-desc" data-screen="{screen}.panel.groups[{g}].items[{i}].detail"
									>{item.detail}</span
								>
							</button>
						{/if}
					{/each}
				{:else}
					{#if view.panel.empty}
						<p class="empty" data-screen="{screen}.panel.empty">{view.panel.empty}</p>
					{/if}
				{/each}
			</div>
		</div>

		{#if view.help === 'none'}
			<p class="help">
				Většina karet má jednu nebo dvě dovednosti, které učí. Ostatní jen využívá.
			</p>
		{/if}
	{/if}
</section>

<style>
	.topics {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		font-size: var(--text-m);
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.default-note {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	header:empty {
		display: none;
	}

	.chosen {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chosen li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 8px 10px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
	}

	.chosen li.flash {
		animation: row-flash 1200ms ease-out;
	}

	@keyframes row-flash {
		from {
			background: var(--primary-dark-12, var(--surface-light));
			border-color: var(--primary);
		}
	}

	/* A button, but not shaped like one: the row is the thing you click to change it. */
	.what {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 160px;
		padding: 2px 4px;
		margin: -2px -4px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.what:hover,
	.what:focus-visible {
		background: var(--surface-light);
	}

	.what :global(.edit) {
		align-self: center;
		color: var(--e-text-faint);
		opacity: 0.6;
	}

	.what:hover :global(.edit),
	.what:focus-visible :global(.edit) {
		color: var(--primary);
		opacity: 1;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 8px;
		font-size: var(--text-s);
		color: var(--e-text);
	}

	.level {
		color: var(--e-text-muted);
	}

	.code {
		font-family: var(--font-code);
		font-size: var(--text-xs);
		color: var(--e-text-faint);
	}

	.desc {
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.elo {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.elo-field {
		display: inline-block;
		width: 96px;
		font-size: var(--text-s);
	}

	/* Always visible, only quiet: a delete nobody can find is no delete. */
	.remove {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		cursor: pointer;
		transition: color 120ms;
	}

	.remove:hover,
	.remove:focus-visible {
		color: var(--e-error);
	}

	/* The box looks like the folded sidebar's hover panel (`RailPeek`). `display` only
	   while open, or it would beat the UA's `display: none`. */
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

	/* What the step is about: the skill picked one step back, read before the choices. */
	.subject {
		margin: 6px 0 4px;
		color: var(--e-text);
		font-size: var(--text-s);
		font-weight: var(--weight-semibold);
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

	.choice:disabled {
		color: var(--e-text-faint);
		cursor: not-allowed;
	}

	.choice:disabled:hover {
		background: none;
	}

	.current {
		border-color: var(--e-border);
		background: var(--surface-light);
	}

	.mark {
		color: var(--e-text-muted);
		font-weight: normal;
	}

	.big {
		padding: 10px;
		border-color: var(--e-border);
		margin-top: 4px;
	}

	.choice-title {
		font-weight: var(--weight-semibold);
	}

	.choice-desc {
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		line-height: 1.4;
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

	.help {
		margin: 2px 0 0;
		color: var(--e-text-muted);
		font-size: var(--text-xs);
		line-height: 1.5;
	}
</style>
