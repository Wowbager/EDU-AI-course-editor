<script lang="ts">
	/**
	 * A number a teacher types, the same in every number field. While they type, the
	 * field keeps their text ("3," or "-" is half a number, not a wrong one) and every
	 * text that reads as a number is written at once (`typedNumber`), so the preview and
	 * the checks follow. Once they leave it, it shows the document's number again: text
	 * that was not a number wrote nothing and goes, and undo, redo and import show what
	 * the course really holds.
	 */
	import FocusField from './FocusField.svelte';
	import { formatNumberInput, typedNumber } from '$lib/domain/number-input';
	import type { Ref } from '$lib/domain/ref';

	interface Props {
		value: number | undefined;
		label: string;
		emptyText?: string;
		monospace?: boolean;
		ref?: Ref;
		describedby?: string;
		invalid?: boolean;
		/** Called with every readable number, and with `undefined` for an emptied field. */
		onchange: (value: number | undefined) => void;
	}
	let { value, label, emptyText, monospace, ref, describedby, invalid, onchange }: Props = $props();

	/** The teacher's text while they type; `null` when they are not typing. */
	let typed = $state<string | undefined | null>(null);
	const shown = $derived(typed !== null ? typed : formatNumberInput(value));

	function type(text: string | undefined) {
		typed = text;
		const number = typedNumber(text);
		if (number !== null) onchange(number.value);
	}
</script>

<FocusField
	{label}
	value={shown}
	{emptyText}
	{monospace}
	{ref}
	{describedby}
	{invalid}
	onchange={type}
	onblur={() => (typed = null)}
/>
