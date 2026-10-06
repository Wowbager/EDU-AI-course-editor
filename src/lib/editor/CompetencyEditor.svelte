<script lang="ts">
	/**
	 * `learning.competencies` — curriculum codes with percentage weights (§6.4).
	 *
	 * A map, not a list, so a card can serve several outcomes and say how much of it
	 * serves each. The plan's RVP → GPF mapping table does not exist yet (§9.3), so
	 * codes are typed rather than picked; when the table arrives this becomes its
	 * front end and nothing else has to move.
	 *
	 * The entries, their total and the add row are the model's (`screen/settings.ts`);
	 * what is being typed in the add row, which code is being renamed and what was
	 * refused are `store.ui.competency`. A weight is a bounded number like any other
	 * (`clampNumber`, its spec in `ui/fields.ts`), with a draft and a line under it
	 * when what was typed is no number.
	 */
	import { withUndoNotice } from './undo-notice';
	import type { BlockV2 } from '$lib/domain/schema';
	import type { CompetenciesView } from '$lib/screen/types';
	import { Plus, Trash2 } from '@lucide/svelte';
	import { tick } from 'svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import { useStore } from '$lib/ui/context';
	import { setField } from '$lib/domain/commands';

	interface Props {
		block: BlockV2;
		view: CompetenciesView;
		/** Where `view` is in the model, for `data-screen`. */
		screen: string;
	}
	let { block, view, screen }: Props = $props();

	const store = useStore();
	const form = $derived(store.ui.competency);
	const current = () => block.learning?.competencies ?? {};

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

	function add() {
		const code = form.code.trim();
		if (code === '') return;
		if (code in current()) {
			form.problem = DUPLICATE;
			return;
		}
		if (form.weight === undefined) {
			form.problem = 'Doplň váhu výstupu v procentech.';
			return;
		}
		form.problem = '';
		write({ ...current(), [code]: form.weight });
		cancel();
	}

	function cancel() {
		store.discardDraft(view.add_weight.ref);
		store.ui.competency = {
			adding: false,
			code: '',
			weight: 50,
			problem: '',
			editing: null,
			rename: ''
		};
	}

	function remove(key: string) {
		form.problem = '';
		const next = { ...current() };
		delete next[key];
		withUndoNotice(store, 'Výstup odebrán.', () => write(next), {
			lessonId: store.open.lesson?.lesson_id,
			blockId: block.block_id
		});
	}

	function reweight(key: string, value: number | undefined) {
		if (value === undefined) {
			// Emptying the field must not mean "0 %": the previous weight stays.
			form.problem = 'Váha musí být číslo od 0 do 100, zůstala původní.';
			return;
		}
		form.problem = '';
		write({ ...current(), [key]: value });
	}

	async function startRename(key: string) {
		form.editing = key;
		form.rename = key;
		await tick();
		const field = document.querySelector<HTMLInputElement>('input.rename');
		field?.focus();
		field?.select();
	}

	function finishRename(key: string) {
		if (form.editing !== key) return;
		form.editing = null;
		const next = form.rename.trim();
		if (next === '' || next === key) return;
		const entries = current();
		if (next in entries) {
			form.problem = DUPLICATE;
			return;
		}
		form.problem = '';
		// Rebuilt in place so the row keeps its position.
		write(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k === key ? next : k, v])));
	}
</script>

<section class="competencies">
	<header>
		<span class="title">Výstupy RVP</span>
		<!-- ⚪ in COURSE-EDITOR-SPEC §6.4: stored and exported, read by nothing yet. -->
		<span class="note">Aplikace je zatím nečte — slouží jako dokumentace, co karta rozvíjí.</span>
		{#if view.total}
			<Chip tone={view.total.tone} title="Součet vah">
				<span data-screen="{screen}.total.text">{view.total.text}</span>
			</Chip>
		{/if}
	</header>

	{#if view.entries.length > 0}
		<ul>
			{#each view.entries as entry, i (entry.code)}
				<li>
					{#if entry.renaming}
						<input
							type="text"
							class="rename"
							aria-label={entry.rename_label}
							value={form.rename}
							oninput={(e) => (form.rename = e.currentTarget.value)}
							onblur={() => finishRename(entry.code)}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									e.currentTarget.blur();
								} else if (e.key === 'Escape') {
									e.preventDefault();
									form.editing = null;
								}
							}}
						/>
					{:else}
						<button
							type="button"
							class="code"
							title="Změnit kód"
							aria-label={entry.change_label}
							onclick={() => startRename(entry.code)}
							><span data-screen="{screen}.entries[{i}].code">{entry.code}</span></button
						>
					{/if}
					<span class="weight">
						<NumberField
							label={entry.weight.label}
							value={entry.weight.value}
							ref={entry.weight.ref}
							bounds={entry.weight}
							screen="{screen}.entries[{i}].weight.value"
							onwrite={(v) => reweight(entry.code, v)}
						/>
					</span>
					<span class="unit">%</span>
					<button
						type="button"
						class="remove"
						title="Odebrat výstup"
						aria-label={entry.remove_label}
						onclick={() => remove(entry.code)}
						><Trash2 size={15} aria-hidden="true"></Trash2></button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if view.adding}
		<div class="add" role="group" aria-label="Nový výstup">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="text"
				placeholder="M-5-1-02"
				aria-label="Kód výstupu RVP"
				autofocus
				value={view.add_code}
				oninput={(e) => (form.code = e.currentTarget.value)}
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
			<span class="weight">
				<NumberField
					label={view.add_weight.label}
					value={view.add_weight.value}
					emptyText={view.add_weight.empty_text}
					ref={view.add_weight.ref}
					bounds={view.add_weight}
					screen="{screen}.add_weight.value"
					onwrite={(v) => (form.weight = v)}
				/>
			</span>
			<span class="unit">%</span>
			<Button variant="secondary" size="s" onclick={add}>Přidat</Button>
			<Button variant="ghost" size="s" onclick={cancel}>Zrušit</Button>
		</div>
	{:else}
		<Button variant="secondary" size="s" onclick={() => (form.adding = true)}>
			<Plus size={14} aria-hidden="true"></Plus>
			Přidat výstup
		</Button>
	{/if}
	{#if view.problem !== ''}
		<p class="problem" role="alert" data-screen="{screen}.problem">{view.problem}</p>
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

	.weight {
		display: inline-block;
		width: 84px;
		font-size: var(--text-s);
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
