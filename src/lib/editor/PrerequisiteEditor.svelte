<script lang="ts">
	/**
	 * `learning.prerequisites` — readiness gates (§6.4).
	 *
	 * A rule names either a card or a skill code, plus the mastery level required
	 * (stored 0–1, shown as a percentage). Adding one asks first which card the pupil
	 * has to master, in a small box like the skill picker's, and only then creates the
	 * rule: there is no half-made rule pointing at nothing. Cards are named by their
	 * own text and grouped by lesson, never by id.
	 *
	 * The app does not enforce these yet. The label says so rather than promising an
	 * effect the student will never experience.
	 */
	import { parseNumberInput } from '$lib/domain/number-input';
	import type { BlockV2, CourseV2, PrerequisiteRule } from '$lib/domain/schema';
	import { useStore } from '$lib/ui/context';
	import Button from '$lib/ui/Button.svelte';
	import { placeMenu } from '$lib/ui/placement';
	import { setField } from '$lib/domain/commands';
	import { blockPreview } from '$lib/domain/derive';
	import { lessonLabel } from '$lib/domain/naming';
	import { Plus, Trash2 } from '@lucide/svelte';
	import { tick } from 'svelte';

	interface Props {
		doc: CourseV2;
		block: BlockV2;
	}
	let { doc, block }: Props = $props();

	const store = useStore();
	const uid = $props.id();
	const panelId = `prerequisite-picker-${uid}`;
	const rules = $derived(block.learning?.prerequisites ?? []);
	const dimensions = $derived(store.skillConfig?.vector?.dimensions ?? []);
	const DEFAULT_LEVEL = 0.5;

	interface CardOption {
		id: string;
		name: string;
	}
	/** Every other card by name, in lesson order; cards in no lesson come last. */
	const groups = $derived.by(() => {
		const byId = new Map(doc.blocks.map((b) => [b.block_id, b]));
		const seen = new Set<string>();
		const result: { title: string; cards: CardOption[] }[] = [];
		for (const lesson of doc.lessons) {
			const cards: CardOption[] = [];
			lesson.blocks.forEach((binding, position) => {
				const card = byId.get(binding.block_id);
				if (!card || card.block_id === block.block_id || seen.has(card.block_id)) return;
				seen.add(card.block_id);
				cards.push({ id: card.block_id, name: blockPreview(card, 50, position + 1) });
			});
			if (cards.length > 0) result.push({ title: lessonLabel(doc, lesson), cards });
		}
		const loose = doc.blocks
			.filter((b) => b.block_id !== block.block_id && !seen.has(b.block_id))
			.map((b) => ({ id: b.block_id, name: blockPreview(b, 50) }));
		if (loose.length > 0) result.push({ title: 'Karty mimo lekce', cards: loose });
		return result;
	});
	const knownIds = $derived(new Set(groups.flatMap((g) => g.cards.map((c) => c.id))));
	const usedIds = $derived(new Set(rules.flatMap((r) => (r.block_id ? [r.block_id] : []))));
	const offered = $derived(
		groups
			.map((g) => ({ ...g, cards: g.cards.filter((c) => !usedIds.has(c.id)) }))
			.filter((g) => g.cards.length > 0)
	);

	let problem = $state('');

	function write(next: PrerequisiteRule[]) {
		store.apply((d) =>
			setField(
				d,
				{ blockId: block.block_id, field: 'learning.prerequisites' },
				next.length === 0 ? undefined : next
			)
		);
	}

	const remove = (index: number) => write(rules.filter((_, i) => i !== index));

	function update(index: number, patch: Partial<PrerequisiteRule>) {
		write(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
	}

	/** A rule names a card or a skill, never both — picking one clears the other. */
	function pickBlock(index: number, blockId: string) {
		update(
			index,
			blockId === '' ? { block_id: undefined } : { block_id: blockId, skill: undefined }
		);
	}
	function pickSkill(index: number, skill: string) {
		update(index, skill === '' ? { skill: undefined } : { skill, block_id: undefined });
	}

	/** The stored 0–1 as a whole percentage. */
	const percent = (level: number) => Math.round(level * 100);

	function setLevel(index: number, input: HTMLInputElement) {
		const value = parseNumberInput(input.value);
		if (value === undefined) {
			// The level is required by the format: emptying the field keeps the old one.
			problem = 'Doplň, kolik procent musí žák zvládat. Zůstala původní hodnota.';
			input.value = String(percent(rules[index]?.min_level ?? DEFAULT_LEVEL));
			return;
		}
		problem = '';
		const level = Math.min(100, Math.max(0, value)) / 100;
		update(index, { min_level: level });
		input.value = String(percent(level));
	}

	// The box: a native popover placed once, as the skill picker's is.
	let wrapper = $state<HTMLElement | null>(null);
	let panel = $state<HTMLElement | null>(null);
	let open = $state(false);
	let wasOpenAtPointerDown = false;

	const isShowing = () => panel?.matches(':popover-open') ?? false;

	async function show() {
		const anchor = wrapper?.querySelector<HTMLElement>('.add-trigger');
		if (panel === null || !anchor || isShowing()) return;
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
		await tick();
		panel.querySelector<HTMLElement>('.choice')?.focus();
	}

	function close() {
		if (isShowing()) panel?.hidePopover();
	}

	const ontoggle = (event: Event) => (open = (event as ToggleEvent).newState === 'open');
	const onpointerdown = () => (wasOpenAtPointerDown = open);
	function onclick() {
		if (wasOpenAtPointerDown) {
			wasOpenAtPointerDown = false;
			return;
		}
		show();
	}

	$effect(() => {
		if (!open) return;
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

	function pickCard(id: string) {
		write([...rules, { block_id: id, min_level: DEFAULT_LEVEL }]);
		close();
	}
</script>

<section class="prerequisites">
	<header>
		<span class="title">Předpoklady</span>
		<span class="note">Aplikace je zatím nevynucuje — slouží jako dokumentace návaznosti.</span>
	</header>

	{#each rules as rule, index (index)}
		<div class="rule">
			<select
				aria-label="Karta, kterou musí žák zvládat"
				value={rule.block_id ?? ''}
				onchange={(e) => pickBlock(index, e.currentTarget.value)}
			>
				<option value="">— karta —</option>
				{#each groups as group (group.title)}
					<optgroup label={group.title}>
						{#each group.cards as card (card.id)}
							<option value={card.id}>{card.name}</option>
						{/each}
					</optgroup>
				{/each}
				{#if rule.block_id !== undefined && !knownIds.has(rule.block_id)}
					<option value={rule.block_id}>Karta, která už neexistuje</option>
				{/if}
			</select>

			<select
				aria-label="Dovednost, kterou musí žák zvládat"
				value={rule.skill ?? ''}
				onchange={(e) => pickSkill(index, e.currentTarget.value)}
			>
				<option value="">— dovednost —</option>
				{#each dimensions as dimension (dimension.dimension_index)}
					<option value={dimension.code}>{dimension.code} — {dimension.name}</option>
				{/each}
			</select>

			<label>
				aspoň
				<input
					type="number"
					min="0"
					max="100"
					step="5"
					aria-label="Požadované zvládnutí v procentech"
					value={percent(rule.min_level)}
					onchange={(e) => setLevel(index, e.currentTarget)}
				/>
				%
			</label>

			<button
				type="button"
				class="remove"
				title="Odebrat předpoklad"
				aria-label="Odebrat předpoklad"
				onclick={() => remove(index)}
			>
				<Trash2 size={15} aria-hidden="true"></Trash2>
			</button>
		</div>
	{/each}

	{#if problem !== ''}
		<p class="problem" role="alert">{problem}</p>
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
			{onclick}
		>
			<Plus size={14} aria-hidden="true"></Plus>
			Přidat předpoklad
		</Button>

		<div
			id={panelId}
			class="picker"
			popover="auto"
			role="dialog"
			aria-label="Přidat předpoklad"
			bind:this={panel}
			{ontoggle}
		>
			<h4>Kterou kartu musí žák zvládat</h4>
			{#each offered as group (group.title)}
				<div class="area">{group.title}</div>
				{#each group.cards as card (card.id)}
					<button type="button" class="choice" onclick={() => pickCard(card.id)}>
						{card.name}
					</button>
				{/each}
			{:else}
				<p class="empty">Žádná další karta, na kterou by šlo navázat.</p>
			{/each}
		</div>
	</div>
</section>

<style>
	.prerequisites {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
	}

	.title {
		color: var(--e-text-muted);
		font: var(--type-meta);
	}

	.note {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.rule {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	select {
		max-width: 220px;
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font-size: var(--text-s);
		color: var(--e-text);
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	input {
		width: 64px;
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-code);
		font-size: var(--text-s);
	}

	.problem {
		margin: 0;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	/* Always visible, only quiet. */
	.remove {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-faint);
		cursor: pointer;
	}

	.remove:hover,
	.remove:focus-visible {
		color: var(--e-error);
	}

	/* The box looks like the skill picker's. */
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

	.empty {
		margin: 4px 0;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.choice {
		display: block;
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
	.choice:focus-visible {
		background: var(--surface-light);
	}
</style>
