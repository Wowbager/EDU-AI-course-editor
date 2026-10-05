<script lang="ts">
	/**
	 * `learning.competencies` — curriculum codes with percentage weights (§6.4).
	 *
	 * A map, not a list, so a card can serve several outcomes and say how much of it
	 * serves each. The plan's RVP → GPF mapping table does not exist yet (§9.3), so
	 * codes are typed rather than picked; when the table arrives this becomes its
	 * front end and nothing else has to move.
	 */
	import { withUndoNotice } from './undo-notice';
	import { parseNumberInput } from '$lib/domain/number-input';
	import type { BlockV2 } from '$lib/domain/schema';
	import { Plus, Trash2 } from '@lucide/svelte';
	import { tick } from 'svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { setField } from '$lib/domain/commands';

	interface Props {
		block: BlockV2;
	}
	let { block }: Props = $props();

	const store = useStore();
	const entries = $derived(Object.entries(block.learning?.competencies ?? {}));
	const total = $derived(entries.reduce((sum, [, weight]) => sum + weight, 0));

	/** The add row is closed until asked for, so it never looks like a saved one. */
	let adding = $state(false);
	let code = $state('');
	let weight = $state('50');
	/** What the last action refused, in words, shown under the list. */
	let problem = $state('');
	let editing = $state<string | null>(null);
	let draft = $state('');

	const DUPLICATE = 'Tenhle výstup už karta má.';

	function write(next: Record<string, number>) {
		store.apply((d) =>
			setField(
				d,
				{ blockId: block.block_id, field: 'learning.competencies' },
				Object.keys(next).length === 0 ? undefined : next
			)
		);
	}

	/** A weight is a percentage; empty or unreadable is `undefined`, never 0. */
	function readWeight(raw: string): number | undefined {
		const value = parseNumberInput(raw);
		return value === undefined ? undefined : Math.min(100, Math.max(0, value));
	}

	function add() {
		const trimmed = code.trim();
		if (trimmed === '') return;
		if (trimmed in (block.learning?.competencies ?? {})) {
			problem = DUPLICATE;
			return;
		}
		const value = readWeight(weight);
		if (value === undefined) {
			problem = 'Doplň váhu výstupu v procentech.';
			return;
		}
		problem = '';
		write({ ...(block.learning?.competencies ?? {}), [trimmed]: value });
		cancel();
	}

	function cancel() {
		adding = false;
		code = '';
		weight = '50';
		problem = '';
	}

	function remove(key: string) {
		problem = '';
		const next = { ...(block.learning?.competencies ?? {}) };
		delete next[key];
		withUndoNotice(store, 'Výstup odebrán.', () => write(next), {
			lessonId: store.selection?.lessonId,
			blockId: block.block_id
		});
	}

	function reweight(key: string, input: HTMLInputElement) {
		const value = readWeight(input.value);
		if (value === undefined) {
			// Emptying the field must not mean "0 %": the previous weight stays.
			problem = 'Váha musí být číslo od 0 do 100, zůstala původní.';
			input.value = String(block.learning?.competencies?.[key] ?? '');
			return;
		}
		problem = '';
		write({ ...(block.learning?.competencies ?? {}), [key]: value });
	}

	async function startRename(key: string) {
		editing = key;
		draft = key;
		await tick();
		const field = document.querySelector<HTMLInputElement>('input.rename');
		field?.focus();
		field?.select();
	}

	function finishRename(key: string) {
		if (editing !== key) return;
		editing = null;
		const next = draft.trim();
		if (next === '' || next === key) return;
		const current = block.learning?.competencies ?? {};
		if (next in current) {
			problem = DUPLICATE;
			return;
		}
		problem = '';
		// Rebuilt in place so the row keeps its position.
		write(Object.fromEntries(Object.entries(current).map(([k, v]) => [k === key ? next : k, v])));
	}
</script>

<section class="competencies">
	<header>
		<span class="title">Výstupy RVP</span>
		<!-- ⚪ in COURSE-EDITOR-SPEC §6.4: stored and exported, read by nothing yet. -->
		<span class="note">Aplikace je zatím nečte — slouží jako dokumentace, co karta rozvíjí.</span>
		{#if entries.length > 0}
			<Chip tone={total > 100 ? 'warning' : 'neutral'} title="Součet vah">{total} %</Chip>
		{/if}
	</header>

	{#if entries.length > 0}
		<ul>
			{#each entries as [key, value] (key)}
				<li>
					{#if editing === key}
						<input
							type="text"
							class="rename"
							aria-label={`Kód výstupu ${key}`}
							bind:value={draft}
							onblur={() => finishRename(key)}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									e.currentTarget.blur();
								} else if (e.key === 'Escape') {
									e.preventDefault();
									editing = null;
								}
							}}
						/>
					{:else}
						<button
							type="button"
							class="code"
							title="Změnit kód"
							aria-label={`Změnit kód ${key}`}
							onclick={() => startRename(key)}>{key}</button
						>
					{/if}
					<input
						type="number"
						min="0"
						max="100"
						step="5"
						aria-label={`Váha výstupu ${key}`}
						{value}
						onchange={(e) => reweight(key, e.currentTarget)}
					/>
					<span class="unit">%</span>
					<button
						type="button"
						class="remove"
						title="Odebrat výstup"
						aria-label={`Odebrat ${key}`}
						onclick={() => remove(key)}><Trash2 size={15} aria-hidden="true"></Trash2></button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if adding}
		<div class="add" role="group" aria-label="Nový výstup">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="text"
				placeholder="M-5-1-02"
				aria-label="Kód výstupu RVP"
				autofocus
				bind:value={code}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						add();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						cancel();
					}
				}}
			/>
			<input
				type="number"
				min="0"
				max="100"
				step="5"
				placeholder="50"
				aria-label="Váha výstupu"
				bind:value={weight}
			/>
			<span class="unit">%</span>
			<Button variant="secondary" size="s" onclick={add}>Přidat</Button>
			<Button variant="ghost" size="s" onclick={cancel}>Zrušit</Button>
		</div>
	{:else}
		<Button variant="secondary" size="s" onclick={() => (adding = true)}>
			<Plus size={14} aria-hidden="true"></Plus>
			Přidat výstup
		</Button>
	{/if}
	{#if problem !== ''}
		<p class="problem" role="alert">{problem}</p>
	{/if}
</section>

<style>
	.note {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.competencies {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.title {
		color: var(--e-text-muted);
		font: var(--type-meta);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li,
	.add {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.code {
		min-width: 110px;
		padding: 2px 4px;
		border: none;
		border-bottom: 1px dashed var(--e-border);
		background: none;
		font-family: var(--font-code);
		font-size: var(--text-s);
		color: var(--e-text);
		text-align: left;
		cursor: text;
	}

	.code:hover {
		background: var(--surface-light);
	}

	.problem {
		margin: 0;
		color: var(--e-error);
		font-size: var(--text-xs);
	}

	input[type='text'] {
		width: 140px;
	}

	input[type='number'] {
		width: 68px;
	}

	input {
		padding: 3px 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-code);
		font-size: var(--text-s);
	}

	.unit {
		color: var(--e-text-faint);
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
