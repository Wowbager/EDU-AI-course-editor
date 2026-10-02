<script lang="ts">
	import Chip from './Chip.svelte';
	/**
	 * Renders a list of `FieldSpec`s through the existing primitives.
	 *
	 * This exists so that the advanced mode can expose the whole remaining format
	 * without forty hand-written rows — and so that adding a field to `fields.ts` is
	 * enough to make it editable. Fields marked `custom` are owned by a real
	 * component and are never handed here; `fieldsFor` filters them out.
	 *
	 * The hint is the field's own sentence about what it does to the student. It shows
	 * under the control while the field has focus, and is a tooltip on the label the
	 * rest of the time: a dialog of thirty fields with thirty sentences under them is
	 * the clutter this replaced. It used to be passed as the field's placeholder, which
	 * meant the sentence vanished the moment anyone used the field — and where a spec
	 * had no hint, the empty string fell through to the label, printing it twice.
	 */
	import FocusField from './FocusField.svelte';
	import Toggle from './Toggle.svelte';
	import { parseNumberInput } from '$lib/domain/number-input';
	import { formatDateTimeCs } from '$lib/domain/format-date';
	import { hintFor, type FieldSpec } from './fields';
	import { useSettingsSearch } from './settings-search.svelte';

	interface Props {
		fields: FieldSpec[];
		/** Current value at a path, already resolved by the owning editor. */
		read: (path: string) => unknown;
		write: (path: string, value: unknown) => void;
		/** Codes of validation issues to mark, keyed by path. */
		invalid?: (path: string) => boolean;
	}
	let { fields, read, write, invalid }: Props = $props();

	/** The dialog's search, if it has one: a field it found is marked. */
	const search = useSettingsSearch();

	const asText = (value: unknown): string | undefined =>
		value === undefined || value === null ? undefined : String(value);

	function writeNumber(path: string, raw: string | undefined) {
		if (raw === undefined || raw.trim() === '') return write(path, undefined);
		const value = parseNumberInput(raw);
		// Text that is not a number is not written: NaN would serialise as null and fail
		// validation somewhere far from here. Empty above is "not set", never 0.
		if (value === undefined) return;
		write(path, value);
	}
</script>

{#each fields as spec (spec.level + spec.path)}
	{@const value = read(spec.path)}
	{@const hint = hintFor(spec)}
	{@const match = search?.marks(spec.level, spec.path) === true}
	{#if spec.kind === 'toggle'}
		<div class="toggle-row" class:match>
			<Toggle
				label={spec.label}
				{hint}
				checked={value === true}
				onchange={(v) => write(spec.path, v || undefined)}
			/>
		</div>
	{:else if spec.kind === 'select'}
		<div class="field-row" class:match>
			<span class="field-label" title={hint}>{spec.label}</span>
			<div class="control">
				<select
					aria-label={spec.label}
					value={asText(value) ?? ''}
					onchange={(e) =>
						write(spec.path, e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
				>
					<option value="">— nenastaveno —</option>
					{#each spec.options ?? [] as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
				{#if hint}<span class="hint">{hint}</span>{/if}
			</div>
		</div>
	{:else if spec.display === 'datetime'}
		<div class="field-row" class:match>
			<span class="field-label" title={hint}>{spec.label}</span>
			<div class="control">
				<span class="read-only">{asText(value) ? formatDateTimeCs(asText(value)!) : '—'}</span>
			</div>
		</div>
	{:else}
		<div class="field-row" class:match>
			<span class="field-label" title={hint}>{spec.label}</span>
			<div class="control">
				<FocusField
					label={spec.label}
					value={asText(value)}
					multiline={spec.kind === 'multiline'}
					monospace={spec.kind === 'number'}
					emptyText={spec.default === undefined ? 'nevyplněno' : `výchozí ${spec.default}`}
					ref={spec.ref}
					invalid={invalid?.(spec.path) === true}
					onchange={(v) =>
						spec.kind === 'number' ? writeNumber(spec.path, v) : write(spec.path, v)}
				/>
				{#if hint}<span class="hint">{hint}</span>{/if}
			</div>
		</div>
	{/if}
{/each}

<style>
	.field-row {
		min-width: 0;
		display: grid;
		/* Stack within a narrow field column, not only on narrow viewports. */
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
		gap: 12px;
		align-items: start;
		font-size: var(--text-m);
	}

	/* What the dialog's search found: a soft ring, not a colour that reads as an error. */
	.match {
		border-radius: var(--radius-xs);
		box-shadow: 0 0 0 5px color-mix(in srgb, var(--primary) 18%, transparent);
		background: color-mix(in srgb, var(--primary) 18%, transparent);
	}

	.field-label {
		min-width: 0;
		overflow-wrap: anywhere;
		padding-top: 6px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.control {
		min-width: 0;
		overflow-wrap: anywhere;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.read-only {
		padding-top: 6px;
		color: var(--e-text);
	}

	select {
		min-width: 0;
		width: 100%;
		max-width: 320px;
		padding: 5px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		font: var(--type-meta);
		color: var(--e-text);
	}

	/* Shown only while the field has focus; the label's title carries it otherwise. */
	.hint {
		display: none;
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		line-height: 1.5;
		white-space: normal;
	}

	.field-row:focus-within .hint {
		display: block;
	}
</style>
