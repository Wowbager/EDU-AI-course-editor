<script lang="ts">
	/**
	 * Everything about a lesson that is not one of its cards.
	 *
	 * The lesson used to own the top of the editor column — a title, five chips and a
	 * row of fields, above the cards the author actually came to write. It is a
	 * container, and a container's settings are worth one click, not permanent
	 * residence at the top of the screen.
	 *
	 * Which fields exist, and which section each sits in, is decided by the mode, from
	 * `$lib/ui/fields.ts`, and said by the model (`store.screen.dialogs.lesson_settings`).
	 * What is added here is the lesson's own removal, which was reachable only by
	 * hovering a sidebar row, and one quiet line that says what is in the lesson.
	 */
	import type { Snippet } from 'svelte';
	import type { LessonSettingsView } from '$lib/screen/types';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import FieldGroup from '$lib/ui/FieldGroup.svelte';
	import SettingsNav from '$lib/ui/SettingsNav.svelte';
	import { useStore } from '$lib/ui/context';
	import { SettingsSearch, setSettingsSearch } from '$lib/ui/settings-search.svelte';
	import { duplicateLesson, moveLesson, setField } from '$lib/domain/commands';
	import { removeLesson } from './lesson-actions';
	import { ARMED_MS } from '$lib/state/ui-state.svelte';
	import { ArrowDown, ArrowUp, Copy, Trash } from '@lucide/svelte';

	interface Props {
		view: LessonSettingsView;
		/** Select the name on opening: the lesson was just made and has a placeholder name. */
		focusName?: boolean;
		onclose: () => void;
	}
	let { view, focusName = false, onclose }: Props = $props();

	const store = useStore();
	const lessonId = $derived(view.lesson_id);
	const screen = 'dialogs.lesson_settings';

	const search = new SettingsSearch(
		() => ['lesson'],
		() => ({
			mode: store.mode,
			feedback: store.showFeedback
		})
	);
	setSettingsSearch(search);

	/**
	 * Smazat takes two clicks, like a card's: the first arms it (and says so in its
	 * name), the second deletes. It disarms after a few seconds and when focus leaves.
	 * Which click it is lives in `store.ui.armed`, so the model says it.
	 */
	const armedKey = $derived(`lesson:${lessonId}`);
	$effect(() => {
		if (!view.delete.armed) return;
		const key = armedKey;
		const timer = setTimeout(() => store.ui.disarm(key), ARMED_MS);
		return () => clearTimeout(timer);
	});

	function clickDelete() {
		if (!store.ui.arm(armedKey)) return;
		removeLesson(store, lessonId);
		onclose();
	}

	const move = (delta: -1 | 1) => store.apply((d) => moveLesson(d, lessonId, delta));

	let fieldsEl = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!focusName || fieldsEl === null) return;
		// After the dialog has put focus where it wants it.
		const input = fieldsEl.querySelector<HTMLInputElement>('input');
		if (input === null) return;
		const timer = setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
		return () => clearTimeout(timer);
	});

	const set = (field: string, value: unknown) =>
		store.apply((d) => setField(d, { lessonId, field }, value));
</script>

{#snippet pane(id: string)}
	{#if view.found}
		{#if id === 'main'}
			<div class="fields" bind:this={fieldsEl}>
				<FieldGroup rows={view.fields.main ?? []} write={set} screen="{screen}.fields.main" />
			</div>

			<div class="order">
				<Button variant="ghost" size="s" onclick={() => move(-1)} disabled={view.order.up_disabled}>
					<ArrowUp size={16}></ArrowUp>
					Posunout nahoru
				</Button>
				<Button
					variant="ghost"
					size="s"
					onclick={() => move(1)}
					disabled={view.order.down_disabled}
				>
					<ArrowDown size={16}></ArrowDown>
					Posunout dolů
				</Button>
			</div>

			{#if view.totals !== null}
				<p class="totals" title={view.totals.title ?? undefined}>
					<span data-screen="{screen}.totals.text">{view.totals.text}</span>
				</p>
			{/if}
		{:else if id === 'didactics' && view.didactics !== null}
			<p class="note">
				Podíly se počítají z karet lekce a tady se jen čtou. Změníš je v nastavení jednotlivých
				karet.
			</p>
			<dl>
				{#each view.didactics.rows as row, i (row.label)}
					<dt title={row.title}>{row.label}</dt>
					<dd data-screen="{screen}.didactics.rows[{i}].value">{row.value}</dd>
				{/each}
			</dl>
		{:else if id === 'ai'}
			<FieldGroup rows={view.fields.ai ?? []} write={set} screen="{screen}.fields.ai" />
		{:else if id === 'meta'}
			<div class="row">
				<span class="label">Identifikátor</span>
				<code data-screen="{screen}.lesson_id">{view.lesson_id}</code>
			</div>
			<FieldGroup rows={view.fields.meta ?? []} write={set} screen="{screen}.fields.meta" />
		{/if}
	{/if}
{/snippet}

{#snippet body()}
	{#if !view.found}
		<p>{view.gone_text}</p>
	{:else}
		<SettingsNav dialog={view} {screen} {search} {pane} />
	{/if}
{/snippet}

{#snippet actions(notice: Snippet)}
	<Button
		variant="ghost"
		onclick={() => {
			store.apply((d, r) => duplicateLesson(d, lessonId, r));
			onclose();
		}}
		ariaLabel="Duplikovat lekci"
	>
		<Copy size={16}></Copy>
		Duplikovat
	</Button>
	<Button
		variant={view.delete.armed ? 'danger-solid' : 'danger'}
		onclick={clickDelete}
		onblur={() => store.ui.disarm(armedKey)}
		ariaLabel={view.delete.label}
	>
		<Trash size={16}></Trash>
		<span data-screen="{screen}.delete.text">{view.delete.text}</span>
	</Button>
	{@render notice()}
	<Button variant="secondary" onclick={onclose}>Hotovo</Button>
{/snippet}

<Modal
	title="Nastavení lekce"
	size={view.list ? 'l' : 'm'}
	{onclose}
	children={body}
	footer={actions}
/>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.order {
		display: flex;
		gap: 4px;
	}

	.totals {
		margin: 2px 0 0;
		color: var(--e-text-faint);
		font-size: var(--text-s);
	}

	.note {
		margin: 0 0 8px;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px 16px;
		margin: 0;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	dd {
		margin: 0;
		text-align: right;
	}

	.row {
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 12px;
		align-items: start;
	}

	.label {
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	code {
		font-family: var(--font-code);
		font-size: var(--text-s);
		color: var(--e-text-faint);
	}
</style>
