<script lang="ts">
	/**
	 * `go_to` is always chosen, never typed (§3 invariant 9). A free-text field here
	 * produces branches that point nowhere, and the student finds out, not the author.
	 *
	 * The choice is made in the shared picker (`ChoicePicker`): „Průběh“ and the steps of
	 * this card come first, the other cards follow grouped by lesson, and a search field
	 * appears once the list is long. What the button says and what the picker lists are
	 * the model's (`screen/goto.ts`): this only draws the trigger and writes the choice.
	 *
	 * The picker is not offered for exercise blocks and exercise_v2 courses, where the
	 * player ignores branching (§9): the model has no `branch` for those answers.
	 */
	import ChoicePicker from '$lib/ui/ChoicePicker.svelte';
	import { ChevronDown } from '@lucide/svelte';

	interface Props {
		/** The model's picker for this answer and the words on its button. */
		branch: { picker_id: string; shown: string };
		/** Where the button's text is in the model, for the parity test. */
		screen: string;
		onchange: (value: string | undefined) => void;
	}

	let { branch, screen, onchange }: Props = $props();

	let picker = $state<ReturnType<typeof ChoicePicker> | null>(null);
</script>

<button
	type="button"
	class="picker"
	aria-haspopup="dialog"
	aria-label="Kam pokračovat po této odpovědi"
	title={branch.shown}
	onclick={(e) => picker?.show(e.currentTarget)}
>
	<span class="shown" data-screen={screen}>{branch.shown}</span>
	<ChevronDown size={14} aria-hidden="true"></ChevronDown>
</button>

<ChoicePicker
	id={branch.picker_id}
	onpick={(path) => onchange(path[0] === '' ? undefined : path[0])}
	bind:this={picker}
/>

<style>
	.picker {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
		max-width: 260px;
		padding: 4px 6px;
		border: 1px solid transparent;
		border-radius: var(--radius-xs);
		background: none;
		font-family: var(--font-body);
		font-size: var(--text-s);
		color: var(--e-text-muted);
		text-align: left;
		cursor: pointer;
	}

	.shown {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.picker:hover,
	.picker:focus-visible {
		border-color: var(--e-border-strong);
		background: var(--surface);
		color: var(--e-text);
	}
</style>
