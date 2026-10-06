<script lang="ts">
	/**
	 * A text field that holds a number (or nothing). What the teacher types goes through
	 * `store.enterNumber`: a number or an emptied box is written, and text that is not a
	 * number is kept in `store.drafts` with a line under the field, and is never written
	 * (NaN would export as `null`). One component, so every numeric field reads
	 * "1 000,5" and reports "abc" the same way.
	 */
	import FocusField from './FocusField.svelte';
	import { useStore } from './context';
	import type { Ref } from '$lib/domain/ref';
	import { parseNumberDraft, parseNumberInput } from '$lib/domain/number-input';
	import { clampTo, type FieldSpec } from './fields';

	interface Props {
		/** The number in the document (a stray string from an import is shown as it is). */
		value: number | string | undefined;
		label: string;
		/** Where the number lives; also the key of its draft. */
		ref?: Ref;
		emptyText?: string;
		monospace?: boolean;
		describedby?: string;
		invalid?: boolean;
		/** The field's spec, for its range: a number outside it is written as the nearest end. */
		bounds?: Pick<FieldSpec, 'min' | 'max'>;
		/** Called with a number, or undefined when the box was emptied. */
		onwrite: (value: number | undefined) => void;
	}

	let {
		value,
		label,
		ref,
		emptyText,
		monospace = true,
		describedby,
		invalid,
		bounds,
		onwrite
	}: Props = $props();

	const store = useStore();
	const draft = $derived(ref === undefined ? undefined : store.draftAt(ref));
	// What was just typed, so "2,5" is not rewritten to "2.5" under the cursor while
	// it means the number the document holds.
	let typed = $state<string | undefined>(undefined);
	const shown = $derived(
		draft ??
			(value === undefined
				? undefined
				: typed !== undefined && parseNumberInput(typed) === value
					? typed
					: String(value))
	);

	function change(text: string | undefined) {
		typed = text;
		if (ref === undefined) {
			// No key to keep the text under: parse, and write only what is a number.
			const parsed = parseDraftless(text);
			if (parsed !== null) {
				onwrite(parsed.value === undefined ? undefined : clampTo(bounds, parsed.value));
			}
			return;
		}
		const parsed = store.enterNumber(ref, text);
		if (parsed.status === 'ok') onwrite(clampTo(bounds, parsed.value));
		else if (parsed.status === 'empty') onwrite(undefined);
	}

	function parseDraftless(text: string | undefined): { value: number | undefined } | null {
		const parsed = parseNumberDraft(text);
		if (parsed.status === 'invalid') return null;
		return { value: parsed.status === 'ok' ? parsed.value : undefined };
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
	error={ref === undefined ? undefined : store.draftErrorAt(ref)}
	onchange={change}
	onrevert={() => ref !== undefined && store.discardDraft(ref)}
/>
