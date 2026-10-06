<script lang="ts">
	import Chip from './Chip.svelte';
	/**
	 * Draws a list of fields the screen model has built (`FieldView`, `screen/field-view.ts`)
	 * through the existing primitives, and writes what the teacher does to them.
	 *
	 * This exists so that the advanced mode can expose the whole remaining format
	 * without forty hand-written rows — and so that adding a field to `fields.ts` is
	 * enough to make it editable. Fields marked `custom` are owned by a real
	 * component and are never in the list the model hands over.
	 *
	 * It decides nothing about what is drawn: the text in the box, the line it says when
	 * empty, the hint, the options of a select and the number that was typed and is no
	 * number are all the row's. The hint is the field's own sentence about what it does to
	 * the student. It is always on screen, small and faint, under the field's name in the
	 * label column: never under the control and never only while the field has focus, so
	 * nothing shifts when a field is used and an open select covers nothing. A field with
	 * no hint prints none.
	 *
	 * A `select` row with `display: 'segmented'` is drawn as a Segmented. Clicking the
	 * chosen segment again clears the field ("nenastaveno"), so the state a select
	 * offered as its first option stays reachable without an extra button.
	 */
	import FocusField from './FocusField.svelte';
	import Toggle from './Toggle.svelte';
	import Segmented from './Segmented.svelte';
	import { parseNumberInput } from '$lib/domain/number-input';
	import NumberField from './NumberField.svelte';
	import type { FieldView } from '$lib/screen/types';
	import { useSettingsSearch } from './settings-search.svelte';

	interface Props {
		rows: FieldView[];
		write: (path: string, value: unknown) => void;
		/** Where `rows` is in the model, for `data-screen`: `<screen>[i].value`. */
		screen: string;
	}
	let { rows, write, screen }: Props = $props();

	/** The dialog's search, if it has one: a field it found is marked. */
	const search = useSettingsSearch();

	const uid = $props.id();
	const hintId = (row: FieldView) => `${uid}-${row.level}-${row.path}`;
	const at = (i: number, rest: string) => `${screen}[${i}].${rest}`;

	/** An option list's value as the number it stands for; text that is no number is not written. */
	function writeChoice(row: FieldView, raw: string) {
		if (!row.numeric) return write(row.path, raw);
		const value = parseNumberInput(raw);
		if (value !== undefined) write(row.path, value);
	}
</script>

{#each rows as row, i (row.key)}
	{@const match = search?.marks(row.level, row.path) === true}
	{#if row.kind === 'toggle'}
		<div class="toggle-row" class:match>
			<Toggle
				label={row.label}
				hint={row.hint ?? undefined}
				checked={row.checked === true}
				onchange={(v) => write(row.path, v || undefined)}
				screen={at(i, 'checked')}
			/>
		</div>
	{:else if row.kind === 'select' && row.display === 'segmented'}
		<div class="field-row" class:match>
			<div class="field-label">
				<span data-screen={at(i, 'label')}>{row.label}</span>
				{#if row.hint}<span class="hint" id={hintId(row)} data-screen={at(i, 'hint')}
						>{row.hint}</span
					>{/if}
			</div>
			<div class="control wide">
				<Segmented
					wrap
					label={row.label}
					options={row.options ?? []}
					value={row.value}
					describedby={row.hint ? hintId(row) : undefined}
					onchange={(v) => {
						if (v === row.value) return write(row.path, undefined);
						writeChoice(row, v);
					}}
				/>
			</div>
		</div>
	{:else if row.kind === 'select'}
		<div class="field-row" class:match>
			<div class="field-label">
				<span data-screen={at(i, 'label')}>{row.label}</span>
				{#if row.hint}<span class="hint" id={hintId(row)} data-screen={at(i, 'hint')}
						>{row.hint}</span
					>{/if}
			</div>
			<div class="control">
				<select
					aria-label={row.label}
					aria-describedby={row.hint ? hintId(row) : undefined}
					value={row.value}
					data-screen={at(i, 'value')}
					onchange={(e) => {
						const raw = e.currentTarget.value;
						if (raw === '') return write(row.path, undefined);
						writeChoice(row, raw);
					}}
				>
					<option value="">— nenastaveno —</option>
					{#each row.options ?? [] as option, o (option.value)}
						<option value={option.value} data-screen={at(i, `options[${o}].label`)}
							>{option.label}</option
						>
					{/each}
				</select>
			</div>
		</div>
	{:else if row.display === 'datetime'}
		<div class="field-row" class:match>
			<div class="field-label">
				<span data-screen={at(i, 'label')}>{row.label}</span>
				{#if row.hint}<span class="hint" id={hintId(row)} data-screen={at(i, 'hint')}
						>{row.hint}</span
					>{/if}
			</div>
			<div class="control">
				<span class="read-only" data-screen={at(i, 'value')}>{row.value}</span>
			</div>
		</div>
	{:else}
		<div class="field-row" class:match>
			<div class="field-label">
				<span data-screen={at(i, 'label')}>{row.label}</span>
				{#if row.hint}<span class="hint" id={hintId(row)} data-screen={at(i, 'hint')}
						>{row.hint}</span
					>{/if}
			</div>
			<div class="control">
				{#if row.kind === 'number'}
					<NumberField
						label={row.label}
						value={row.value === '' ? undefined : row.value}
						emptyText={row.empty_text}
						ref={row.ref}
						describedby={row.hint ? hintId(row) : undefined}
						bounds={row}
						screen={at(i, 'value')}
						onwrite={(v) => write(row.path, v)}
					/>
				{:else}
					<FocusField
						label={row.label}
						value={row.value === '' ? undefined : row.value}
						multiline={row.kind === 'multiline'}
						emptyText={row.empty_text}
						ref={row.ref}
						describedby={row.hint ? hintId(row) : undefined}
						screen={at(i, 'value')}
						onchange={(v) => write(row.path, v)}
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
