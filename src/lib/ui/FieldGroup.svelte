<script lang="ts">
	/**
	 * Renders a list of `FieldSpec`s through the existing primitives.
	 *
	 * This exists so that the advanced mode can expose the whole remaining format
	 * without forty hand-written rows — and so that adding a field to `fields.ts` is
	 * enough to make it editable. Fields marked `custom` are owned by a real
	 * component and are never handed here; `fieldsFor` filters them out.
	 *
	 * The hint is rendered under the control and stays there. It used to be passed as
	 * the field's placeholder, which meant the sentence explaining what a field does
	 * to the student vanished the moment anyone used the field — and where a spec had
	 * no hint, the empty string fell through to the label, printing it twice.
	 */
	import FocusField from './FocusField.svelte';
	import Toggle from './Toggle.svelte';
	import type { FieldSpec } from './fields';

	interface Props {
		fields: FieldSpec[];
		/** Current value at a path, already resolved by the owning editor. */
		read: (path: string) => unknown;
		write: (path: string, value: unknown) => void;
		/** Codes of validation issues to mark, keyed by path. */
		invalid?: (path: string) => boolean;
	}
	let { fields, read, write, invalid }: Props = $props();

	const asText = (value: unknown): string | undefined =>
		value === undefined || value === null ? undefined : String(value);

	function writeNumber(path: string, raw: string | undefined) {
		if (raw === undefined || raw.trim() === '') return write(path, undefined);
		const value = Number(raw);
		// A field left unparseable would silently write NaN into the document, which
		// serialises as null and fails validation somewhere far from here.
		if (Number.isNaN(value)) return;
		write(path, value);
	}
</script>

{#each fields as spec (spec.level + spec.path)}
	{@const value = read(spec.path)}
	{#if spec.kind === 'toggle'}
		<Toggle
			label={spec.label}
			hint={spec.hint}
			checked={value === true}
			onchange={(v) => write(spec.path, v || undefined)}
		/>
	{:else if spec.kind === 'select'}
		<div class="field-row">
			<span class="field-label">{spec.label}</span>
			<div class="control">
				<select
					aria-label={spec.label}
					value={asText(value) ?? ''}
					onchange={(e) => write(spec.path, e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
				>
					<option value="">— nenastaveno —</option>
					{#each spec.options ?? [] as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
				{#if spec.hint}<span class="hint">{spec.hint}</span>{/if}
			</div>
		</div>
	{:else}
		<div class="field-row">
			<span class="field-label">{spec.label}</span>
			<div class="control">
				<FocusField
					label={spec.label}
					value={asText(value)}
					multiline={spec.kind === 'multiline'}
					monospace={spec.kind === 'number'}
					emptyText="nevyplněno"
					invalid={invalid?.(spec.path) === true}
					onchange={(v) =>
						spec.kind === 'number' ? writeNumber(spec.path, v) : write(spec.path, v)}
				/>
				{#if spec.hint}<span class="hint" title={spec.hint}>{spec.hint}</span>{/if}
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

	.hint {
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
		line-height: 1.5;
		white-space: normal;
	}
</style>
