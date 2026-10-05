<script lang="ts">
	/**
	 * `learning.prerequisites` — readiness gates (§6.4).
	 *
	 * A rule names either a card or a skill level, plus the mastery required (stored
	 * 0–1, shown as a percentage). Each rule is one sentence — „Nejdřív karta „Kolik
	 * je?“ (Lekce 2) · aspoň 50 %“ — with no selects in it. The sentence is a button:
	 * it reopens the picker on the current choice, so the card or skill can be changed
	 * in place and the percentage stays. „Přidat předpoklad“ asks „Na co karta čeká?“
	 * and offers another card (grouped by lesson) or a skill (area → skill → level, as
	 * „Přidat dovednost“ does); only then is a rule created, so there is none pointing
	 * at nothing.
	 *
	 * A card that already waits for this one, directly or through others, would make a
	 * cycle (Kontrola kurzu's „na sebe čekají navzájem“), so it is listed but cannot be
	 * picked. A card already used by another rule of this card is listed the same way.
	 *
	 * The app does not enforce these yet. The note says so rather than promising an
	 * effect the student will never experience.
	 */
	import { withUndoNotice } from './undo-notice';
	import { parseNumberInput } from '$lib/domain/number-input';
	import type { BlockV2, CourseV2, PrerequisiteRule } from '$lib/domain/schema';
	import { useStore } from '$lib/ui/context';
	import Button from '$lib/ui/Button.svelte';
	import ChoicePicker from '$lib/ui/ChoicePicker.svelte';
	import type { PickerStep } from '$lib/ui/choice-picker';
	import { setField } from '$lib/domain/commands';
	import { cardGroups, cardNames } from '$lib/domain/card-names';
	import { cardsWaitingFor } from '$lib/domain/validate';
	import { skillTree } from '$lib/domain/skill-config';
	import { Plus, Trash2 } from '@lucide/svelte';

	interface Props {
		doc: CourseV2;
		block: BlockV2;
	}
	let { doc, block }: Props = $props();

	const store = useStore();
	const rules = $derived(block.learning?.prerequisites ?? []);
	const tree = $derived(skillTree(store.skillConfig));
	const advanced = $derived(store.mode === 'advanced');
	const DEFAULT_LEVEL = 0.5;

	const names = $derived(cardNames(doc));
	/** The skill level a rule's code stands for, with where it sits in the tree. */
	const levelOf = $derived(
		new Map(
			tree.flatMap((area) =>
				area.skills.flatMap((skill) =>
					skill.levels.map((l) => [l.dimension.code, { area, skill, level: l }] as const)
				)
			)
		)
	);

	/** What a rule says before „aspoň“, in words. */
	function describe(rule: PrerequisiteRule): { text: string; where?: string; code?: string } {
		if (rule.block_id !== undefined) {
			const card = names.get(rule.block_id);
			if (card === undefined) return { text: 'Nejdřív karta, která už neexistuje' };
			return {
				text: `Nejdřív karta „${card.name}“`,
				where: card.collides ? card.place : card.lesson
			};
		}
		if (rule.skill !== undefined) {
			const found = levelOf.get(rule.skill);
			if (found === undefined) return { text: 'Nejdřív dovednost, která už není v nastavení' };
			const many = found.skill.levels.length > 1;
			return {
				text: `Nejdřív dovednost ${found.skill.name}${many ? ` · Úroveň ${found.level.level}` : ''}`,
				code: advanced ? rule.skill : undefined
			};
		}
		return { text: 'Nejdřív … (vyber kartu nebo dovednost)' };
	}

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

	const remove = (index: number) =>
		withUndoNotice(store, 'Předpoklad odebrán.', () => write(rules.filter((_, i) => i !== index)), {
			lessonId: store.selection?.lessonId,
			blockId: block.block_id
		});

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
		write(rules.map((rule, i) => (i === index ? { ...rule, min_level: level } : rule)));
		input.value = String(percent(level));
	}

	// The picker: one box, opened from „Přidat předpoklad“ (a new rule) or from a rule's
	// line (`editing` is its index, and its choice is marked).
	let picker = $state<ReturnType<typeof ChoicePicker> | null>(null);
	let editing = $state<number | null>(null);

	const waiting = $derived(cardsWaitingFor(doc, block.block_id));
	const cardStep = $derived.by((): PickerStep => {
		const own = editing === null ? undefined : rules[editing];
		const used = new Set(
			rules.flatMap((r, i) => (r.block_id !== undefined && i !== editing ? [r.block_id] : []))
		);
		return {
			title: 'Jaká karta',
			empty: 'Žádná další karta, na kterou by šlo navázat.',
			groups: cardGroups(doc, { exclude: block.block_id }).map((group) => ({
				heading: group.title,
				items: group.cards.map((card) => ({
					id: card.id,
					name: card.name,
					detail: card.collides ? card.place : undefined,
					current: own?.block_id === card.id,
					disabledReason: waiting.has(card.id)
						? 'na tuhle kartu čeká'
						: used.has(card.id)
							? 'už je v předpokladech'
							: undefined
				}))
			}))
		};
	});

	const skillStep = $derived.by((): PickerStep => {
		const own = editing === null ? undefined : rules[editing]?.skill;
		return {
			title: 'Dovednost',
			empty: 'Kurz nemá nastavené dovednosti.',
			groups: tree.map((area) => ({
				heading: area.name,
				items: area.skills.map((skill) => {
					const levelItems = skill.levels.map((l) => ({
						id: l.dimension.code,
						name: `Úroveň ${l.level}`,
						detail: l.dimension.name,
						hint: advanced ? l.dimension.code : undefined,
						current: own === l.dimension.code
					}));
					// A skill with one level has nothing to choose after it.
					return skill.levels.length === 1
						? { ...levelItems[0], name: skill.name, detail: undefined }
						: {
								id: `${area.code}/${skill.code}`,
								name: skill.name,
								current: levelItems.some((l) => l.current),
								next: { title: 'Úroveň', subject: skill.name, groups: [{ items: levelItems }] }
							};
				})
			}))
		};
	});

	const root = $derived<PickerStep>({
		title: 'Na co karta čeká?',
		groups: [
			{
				items: [
					{
						id: 'card',
						name: 'Jinou kartu',
						detail: 'Počká, až žák zvládne jinou kartu.',
						current: editing !== null && rules[editing]?.block_id !== undefined,
						next: cardStep
					},
					{
						id: 'skill',
						name: 'Dovednost',
						detail: 'Počká, až žák zvládne dovednost na určité úrovni.',
						current: editing !== null && rules[editing]?.skill !== undefined,
						next: skillStep
					}
				]
			}
		]
	});

	/** Where the picker opens for a rule: on the list its current choice is in. */
	function pathOf(rule: PrerequisiteRule): string[] {
		if (rule.block_id !== undefined) return ['card'];
		const found = rule.skill === undefined ? undefined : levelOf.get(rule.skill);
		if (found === undefined) return [];
		return found.skill.levels.length > 1
			? ['skill', `${found.area.code}/${found.skill.code}`]
			: ['skill'];
	}

	function openFor(anchor: HTMLElement, index: number | null) {
		editing = index;
		picker?.show(anchor, index === null ? [] : pathOf(rules[index]));
	}

	function picked(path: string[]) {
		const [kind, ...rest] = path;
		const choice: Partial<PrerequisiteRule> =
			kind === 'card'
				? { block_id: rest[rest.length - 1], skill: undefined }
				: { skill: rest[rest.length - 1], block_id: undefined };
		if (editing === null) write([...rules, { min_level: DEFAULT_LEVEL, ...choice }]);
		else {
			// A rule names a card or a skill, never both; the percentage stays.
			write(rules.map((rule, i) => (i === editing ? { ...rule, ...choice } : rule)));
		}
		editing = null;
	}
</script>

<section class="prerequisites">
	<header>
		<span class="title">Předpoklady</span>
		<span class="note">Aplikace je zatím nevynucuje — slouží jako dokumentace návaznosti.</span>
	</header>

	{#each rules as rule, index (index)}
		{@const said = describe(rule)}
		<div class="rule">
			<button
				type="button"
				class="what"
				aria-haspopup="dialog"
				title="Změnit, na co karta čeká"
				onclick={(e) => openFor(e.currentTarget, index)}
			>
				{said.text}{#if said.where}<span class="where">({said.where})</span
					>{/if}{#if said.code}<span class="code">{said.code}</span>{/if}
			</button>
			<span class="sep" aria-hidden="true">·</span>
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

	<Button
		class="add-trigger"
		variant="secondary"
		size="s"
		aria-haspopup="dialog"
		onclick={(e) => openFor(e.currentTarget as HTMLElement, null)}
	>
		<Plus size={14} aria-hidden="true"></Plus>
		Přidat předpoklad
	</Button>

	<ChoicePicker label="Na co karta čeká?" {root} onpick={picked} bind:this={picker} />
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
		gap: 4px 6px;
	}

	/* The sentence is the control: quiet until pointed at, like a row of the answer table. */
	.what {
		padding: 3px 6px;
		border: 1px solid transparent;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text);
		font-family: var(--font-body);
		font-size: var(--text-s);
		text-align: left;
		cursor: pointer;
	}

	.what:hover,
	.what:focus-visible {
		border-color: var(--e-border-strong);
		background: var(--surface);
	}

	.where {
		margin-left: 6px;
		color: var(--e-text-muted);
	}

	.code {
		margin-left: 6px;
		color: var(--e-text-faint);
		font-family: var(--font-code);
		font-size: var(--text-xs);
	}

	.sep {
		color: var(--e-text-faint);
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--e-text);
		font-size: var(--text-s);
	}

	/* A value, not a placeholder: full text colour. */
	input {
		width: 64px;
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text);
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
</style>
