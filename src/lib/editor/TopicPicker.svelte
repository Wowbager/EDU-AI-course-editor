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
	 */
	import { parseNumberInput } from '$lib/domain/number-input';
	import { withUndoNotice } from './undo-notice';
	import { tick } from 'svelte';
	import type { BlockV2 } from '$lib/domain/schema';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { placeMenu } from '$lib/ui/placement';
	import { useStore } from '$lib/ui/context';
	import { blockTopics, setTopics, type BlockTopic } from '$lib/domain/commands';
	import {
		dimensionCount,
		ELO_BASELINE,
		ELO_MAX,
		ELO_MIN,
		skillTree,
		type SkillDimension,
		type SkillTreeSkill
	} from '$lib/domain/skill-config';
	import { ChevronLeft, Pencil, Plus, Trash2 } from '@lucide/svelte';

	interface Props {
		block: BlockV2;
	}
	let { block }: Props = $props();

	const store = useStore();
	const uid = $props.id();
	const panelId = `skill-picker-${uid}`;

	const count = $derived(dimensionCount(store.skillConfig));
	const tree = $derived(skillTree(store.skillConfig));
	const topics = $derived(blockTopics(block));
	const chosen = $derived(new Set(topics.map((t) => t.dimensionIndex)));
	/** The row being changed, or null when the box adds a new one. */
	let editing = $state<number | null>(null);
	/** What is taken by another row: when editing, the edited row's own level is free. */
	const taken = $derived(new Set([...chosen].filter((i) => i !== editing)));
	const strongCount = $derived(topics.filter((t) => t.relation === 2).length);

	/** Where each dimension sits in the tree, for the rows. */
	const place = $derived(
		new Map(
			tree.flatMap((area) =>
				area.skills.flatMap((skill) =>
					skill.levels.map((l) => [l.dimension.dimension_index, { skill, level: l.level }] as const)
				)
			)
		)
	);

	const RELATIONS = [
		{ value: '2', label: 'Je o tom', title: 'Karta tuhle dovednost učí' },
		{ value: '1', label: 'Využívá', title: 'Karta ji potřebuje mimochodem' }
	] as const;

	function dimensionAt(index: number): SkillDimension | undefined {
		return store.skillConfig?.vector?.dimensions?.find((d) => d.dimension_index === index);
	}

	/** The classification the strongest topic implies. */
	function naming(index: number) {
		const dimension = dimensionAt(index);
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
	let flashed = $state<number | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	const FLASH_MS = 1200;

	async function flash(index: number) {
		flashed = index;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flashed = null), FLASH_MS);
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
			{ lessonId: store.selection?.lessonId, blockId: block.block_id }
		);

	const setRelation = (index: number, relation: 1 | 2) =>
		commit(topics.map((t) => (t.dimensionIndex === index ? { ...t, relation } : t)));

	/** An emptied (or unreadable) field gives back the default, never 0 clamped to the minimum. */
	function setElo(index: number, raw: string) {
		const parsed = parseNumberInput(raw);
		const elo = parsed === undefined ? ELO_BASELINE : Math.min(ELO_MAX, Math.max(ELO_MIN, parsed));
		commit(topics.map((t) => (t.dimensionIndex === index ? { ...t, elo } : t)));
	}

	// The box: a native popover, placed once by `placeMenu` as `Menu` does.
	type Step = 'skill' | 'level' | 'relation';
	let step = $state<Step>('skill');
	let skill = $state<SkillTreeSkill | null>(null);
	let dimension = $state<SkillDimension | null>(null);
	let wrapper = $state<HTMLElement | null>(null);
	let panel = $state<HTMLElement | null>(null);
	/** Which trigger's box was open when the press began: a click on that one only closes it. */
	let openAtPointerDown: number | null | undefined = undefined;
	let open = $state(false);

	/** Skills with something left to choose, under their area. */
	const available = $derived(
		tree
			.map((area) => ({
				...area,
				skills: area.skills.filter((s) =>
					s.levels.some((l) => !taken.has(l.dimension.dimension_index))
				)
			}))
			.filter((area) => area.skills.length > 0)
	);
	/** Adding offers only the free levels; changing lists all, the taken ones disabled. */
	const levelChoices = $derived(
		(skill?.levels ?? []).filter((l) => editing !== null || !taken.has(l.dimension.dimension_index))
	);

	const isShowing = () => panel?.matches(':popover-open') ?? false;

	async function focusFirst() {
		await tick();
		(
			panel?.querySelector<HTMLElement>('.choice') ?? panel?.querySelector<HTMLElement>('button')
		)?.focus();
	}

	/** `index` is the row to change; without it the box adds a skill. */
	function show(anchor: HTMLElement | null | undefined, index: number | null = null) {
		if (panel === null || !anchor || isShowing()) return;
		editing = index;
		const current = index === null ? undefined : place.get(index);
		step = current ? 'level' : 'skill';
		skill = current?.skill ?? null;
		dimension = null;
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
		open = (event as ToggleEvent).newState === 'open';
	}

	function onpointerdown() {
		openAtPointerDown = open ? editing : undefined;
	}

	function onclick(event: MouseEvent, index: number | null = null) {
		const sameBox = openAtPointerDown === index;
		openAtPointerDown = undefined;
		if (sameBox) return;
		// Another row's box: the press already closed it, and this one opens straight away.
		show(event.currentTarget as HTMLElement, index);
	}

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

	function pickSkill(next: SkillTreeSkill) {
		skill = next;
		const free = next.levels.filter((l) => !taken.has(l.dimension.dimension_index));
		if (editing === null && free.length === 1) pickLevel(free[0].dimension, 'skill');
		else {
			step = 'level';
			focusFirst();
		}
	}

	/** `from` is the step the back link of the relation step returns to. */
	let relationBack: Step = 'level';
	function pickLevel(next: SkillDimension, from: Step = 'level') {
		if (editing !== null) return replaceRow(next);
		dimension = next;
		relationBack = from;
		step = 'relation';
		focusFirst();
	}

	function back() {
		step = step === 'relation' ? relationBack : 'skill';
		focusFirst();
	}

	/** Changing a row keeps what the teacher set on it: the relation and the difficulty. */
	function replaceRow(next: SkillDimension) {
		const from = editing;
		close();
		if (from === null || from === next.dimension_index || taken.has(next.dimension_index)) return;
		commit(
			topics.map((t) =>
				t.dimensionIndex === from ? { ...t, dimensionIndex: next.dimension_index } : t
			)
		);
		flash(next.dimension_index);
	}

	function pickRelation(relation: 1 | 2) {
		if (dimension === null || taken.has(dimension.dimension_index)) return close();
		const added = dimension.dimension_index;
		commit([...topics, { dimensionIndex: added, relation, elo: ELO_BASELINE }]);
		close();
		flash(added);
	}

	function relationHeading(dim: SkillDimension): string {
		const where = place.get(dim.dimension_index);
		if (!where) return dim.name;
		return where.skill.levels.length > 1
			? `${where.skill.name}, úroveň ${where.level}`
			: where.skill.name;
	}
</script>

<section class="topics">
	<header>
		{#if store.skillConfigStatus === 'loading'}
			<Chip tone="neutral">Dovednosti se načítají</Chip>
		{:else if count === null}
			<Chip tone="warning">Nastavení dovedností se nenačetlo</Chip>
		{:else if topics.length === 0}
			<Chip tone="warning" title="Bez vazby na dovednost se profil žáka po této kartě nepohne">
				nenastaveno
			</Chip>
		{:else if strongCount > 3}
			<Chip tone="warning" title="Jeden výsledek se rozmělní do příliš mnoha dovedností">
				{strongCount} silných vazeb
			</Chip>
		{/if}
		{#if store.skillConfigStatus === 'default'}
			<!-- Not a problem, so not amber: the course simply has no skill list of its own. -->
			<Chip tone="neutral">výchozí sada</Chip>
			<span class="default-note">
				Kurz nemá vlastní seznam dovedností, karta vybírá z obecného.
			</span>
		{/if}
	</header>

	{#if count !== null}
		{#if topics.length > 0}
			<ul class="chosen" bind:this={list}>
				{#each topics as topic (topic.dimensionIndex)}
					{@const where = place.get(topic.dimensionIndex)}
					{@const dim = dimensionAt(topic.dimensionIndex)}
					{@const skillName = where?.skill.name ?? dim?.name ?? 'neznámá dovednost'}
					<li data-dimension={topic.dimensionIndex} class:flash={flashed === topic.dimensionIndex}>
						<button
							type="button"
							class="what"
							aria-haspopup="dialog"
							aria-controls={panelId}
							title="Změnit dovednost nebo úroveň"
							aria-label={`Změnit dovednost ${skillName}${where && where.skill.levels.length > 1 ? `, úroveň ${where.level}` : ''}`}
							{onpointerdown}
							onclick={(e) => onclick(e, topic.dimensionIndex)}
						>
							<span class="line">
								<strong>{skillName}</strong>
								{#if where && where.skill.levels.length > 1}
									<span class="level">Úroveň {where.level}</span>
								{/if}
								{#if store.mode === 'advanced' && dim?.code}
									<span class="code">{dim.code}</span>
								{/if}
								<!-- The row is the way to change it; say so without hovering. -->
								<Pencil class="edit" size={13} aria-hidden="true"></Pencil>
							</span>
							{#if dim && where && dim.name !== skillName}
								<span class="desc">{dim.name}</span>
							{/if}
						</button>

						<Segmented
							label={`Jak karta pracuje s dovedností ${skillName}`}
							options={[...RELATIONS]}
							value={String(topic.relation)}
							onchange={(v) => setRelation(topic.dimensionIndex, v === '2' ? 2 : 1)}
						/>

						{#if store.mode === 'advanced'}
							<label class="elo">
								obtížnost
								<input
									type="number"
									min={ELO_MIN}
									max={ELO_MAX}
									step="0.5"
									placeholder={`výchozí ${ELO_BASELINE}`}
									value={topic.elo}
									onchange={(e) => {
										setElo(topic.dimensionIndex, e.currentTarget.value);
										// The row may not re-render when the value is unchanged.
										if (e.currentTarget.value.trim() === '') e.currentTarget.value = '';
									}}
								/>
							</label>
						{/if}

						<button
							type="button"
							class="remove"
							title="Odebrat dovednost"
							aria-label={`Odebrat ${skillName}`}
							onclick={() => remove(topic.dimensionIndex)}
						>
							<Trash2 size={15} aria-hidden="true"></Trash2>
						</button>
					</li>
				{/each}
			</ul>
			<p class="help">
				<strong>Je o tom</strong>: karta dovednost učí. <strong>Využívá</strong>: karta ji jen
				potřebuje mimochodem. Většina karet učí jednu nebo dvě.
			</p>
		{/if}

		<div class="add" bind:this={wrapper}>
			<Button
				class="add-trigger"
				variant="secondary"
				size="s"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-controls={panelId}
				{onpointerdown}
				onclick={(e) => onclick(e)}
			>
				<Plus size={14} aria-hidden="true"></Plus>
				Přidat dovednost
			</Button>

			<div
				id={panelId}
				class="picker"
				popover="auto"
				role="dialog"
				aria-label={editing === null ? 'Přidat dovednost' : 'Změnit dovednost'}
				bind:this={panel}
				{ontoggle}
			>
				{#if step === 'skill'}
					<h4>Dovednost</h4>
					{#each available as area (area.code)}
						<div class="area">{area.name}</div>
						{#each area.skills as s (s.code)}
							<button type="button" class="choice" onclick={() => pickSkill(s)}>{s.name}</button>
						{/each}
					{:else}
						<p class="empty">Všechny dovednosti už karta má.</p>
					{/each}
				{:else if step === 'level' && skill}
					<h4>Úroveň</h4>
					<button type="button" class="back" onclick={back}>
						<ChevronLeft size={14} aria-hidden="true"></ChevronLeft>
						{editing === null ? 'Zpět' : 'Jiná dovednost'}
					</button>
					<div class="subject">{skill.name}</div>
					{#each levelChoices as l (l.dimension.dimension_index)}
						{@const index = l.dimension.dimension_index}
						{@const used = taken.has(index)}
						<button
							type="button"
							class="choice"
							class:current={index === editing}
							disabled={used}
							aria-current={index === editing ? 'true' : undefined}
							onclick={() => pickLevel(l.dimension)}
						>
							<span class="choice-title">
								Úroveň {l.level}{#if index === editing}
									<span class="mark"> · teď vybráno</span>{/if}
							</span>
							<span class="choice-desc">
								{l.dimension.name}{#if used}{' '}· už je na jiném řádku{/if}
							</span>
						</button>
					{/each}
				{:else if step === 'relation' && dimension}
					<h4>Jak s ní karta pracuje</h4>
					<button type="button" class="back" onclick={back}>
						<ChevronLeft size={14} aria-hidden="true"></ChevronLeft>
						Zpět
					</button>
					<div class="subject">{relationHeading(dimension)}</div>
					{#each RELATIONS as r (r.value)}
						<button
							type="button"
							class="choice big"
							onclick={() => pickRelation(r.value === '2' ? 2 : 1)}
						>
							<span class="choice-title">{r.label}</span>
							<span class="choice-desc">{r.title}</span>
						</button>
					{/each}
				{/if}
			</div>
		</div>

		{#if topics.length === 0}
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

	input[type='number'] {
		width: 84px;
		padding: 2px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-code);
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
