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
	 * The hint is the field's own sentence about what it does to the student. It is
	 * always on screen, small and faint, under the field's name in the label column:
	 * never under the control and never only while the field has focus, so nothing
	 * shifts when a field is used and an open select covers nothing. It used to be a
	 * tooltip, which nobody read, and before that the field's placeholder, which
	 * vanished the moment anyone used the field. A field with no hint prints none.
	 *
	 * A `select` spec with `display: 'segmented'` is drawn as a Segmented. Clicking the
	 * chosen segment again clears the field ("nenastaveno"), so the state a select
	 * offered as its first option stays reachable without an extra button.
	 */
	import FocusField from './FocusField.svelte';
	import Toggle from './Toggle.svelte';
	import Segmented from './Segmented.svelte';
	import { parseNumberInput } from '$lib/domain/number-input';
	import NumberField from './NumberField.svelte';
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

	const uid = $props.id();
	const hintId = (spec: FieldSpec) => `${uid}-${spec.level}-${spec.path}`;

	const asText = (value: unknown): string | undefined =>
		value === undefined || value === null ? undefined : String(value);

	/** An option list's value as the number it stands for; text that is no number is not written. */
	function writeChoice(path: string, spec: FieldSpec, raw: string) {
		if (!spec.numeric) return write(path, raw);
		const value = parseNumberInput(raw);
		if (value !== undefined) write(path, value);
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
	{:else if spec.kind === 'select' && spec.display === 'segmented'}
		{@const current = asText(value) ?? ''}
		<!-- The number in "3 – splňuje" is the order the segments already show; without it
		     a four- or five-step scale fits on one row. -->
		{@const options = (spec.options ?? []).map((o) => ({
			value: o.value,
			label: o.label.replace(/^\d+ – /, '')
		}))}
		<div class="field-row" class:match>
			<div class="field-label">
				<span>{spec.label}</span>
				{#if hint}<span class="hint" id={hintId(spec)}>{hint}</span>{/if}
			</div>
			<div class="control wide">
				<Segmented
					wrap
					label={spec.label}
					options={current !== '' && !options.some((o) => o.value === current)
						? [...options, { value: current, label: current }]
						: options}
					value={current}
					describedby={hint ? hintId(spec) : undefined}
					onchange={(v) => {
						if (v === current) return write(spec.path, undefined);
						writeChoice(spec.path, spec, v);
					}}
				/>
			</div>
		</div>
	{:else if spec.kind === 'select'}
		<div class="field-row" class:match>
			<div class="field-label">
				<span>{spec.label}</span>
				{#if hint}<span class="hint" id={hintId(spec)}>{hint}</span>{/if}
			</div>
			<div class="control">
				<select
					aria-label={spec.label}
					aria-describedby={hint ? hintId(spec) : undefined}
					value={asText(value) ?? ''}
					onchange={(e) => {
						const raw = e.currentTarget.value;
						if (raw === '') return write(spec.path, undefined);
						writeChoice(spec.path, spec, raw);
					}}
				>
					<option value="">— nenastaveno —</option>
					{#each spec.options ?? [] as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
					<!-- A value outside the list stays visible as it is, not lost. -->
					{#if asText(value) !== undefined && !(spec.options ?? []).some((o) => o.value === asText(value))}
						<option value={asText(value)}>{asText(value)}</option>
					{/if}
				</select>
			</div>
		</div>
	{:else if spec.display === 'datetime'}
		<div class="field-row" class:match>
			<div class="field-label">
				<span>{spec.label}</span>
				{#if hint}<span class="hint" id={hintId(spec)}>{hint}</span>{/if}
			</div>
			<div class="control">
				<span class="read-only">{asText(value) ? formatDateTimeCs(asText(value)!) : '—'}</span>
			</div>
		</div>
	{:else}
		<div class="field-row" class:match>
			<div class="field-label">
				<span>{spec.label}</span>
				{#if hint}<span class="hint" id={hintId(spec)}>{hint}</span>{/if}
			</div>
			<div class="control">
				{#if spec.kind === 'number'}
					<NumberField
						label={spec.label}
						value={typeof value === 'number' || typeof value === 'string' ? value : undefined}
						emptyText={spec.default === undefined ? 'nevyplněno' : `výchozí ${spec.default}`}
						ref={spec.ref}
						describedby={hint ? hintId(spec) : undefined}
						invalid={invalid?.(spec.path) === true}
						onwrite={(v) => write(spec.path, v)}
					/>
				{:else}
					<FocusField
						label={spec.label}
						value={asText(value)}
						multiline={spec.kind === 'multiline'}
						emptyText={spec.default === undefined ? 'nevyplněno' : `výchozí ${spec.default}`}
						ref={spec.ref}
						describedby={hint ? hintId(spec) : undefined}
						invalid={invalid?.(spec.path) === true}
						onchange={(v) => write(spec.path, v)}
					/>
				{/if}
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
		display: flex;
		flex-direction: column;
		gap: 2px;
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

	/* Segments need the row: the name and its hint above, the choices under them. */
	.wide {
		grid-column: 1 / -1;
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

	/* Always drawn, under the field's name; the type-meta size keeps it a footnote. */
	.hint {
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--e-text-faint);
		font: var(--type-meta);
		font-weight: var(--weight-regular, 400);
		line-height: 1.5;
		white-space: normal;
	}
</style>
