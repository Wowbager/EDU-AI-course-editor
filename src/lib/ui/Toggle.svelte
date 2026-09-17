<script lang="ts">
	interface Props {
		checked: boolean;
		label: string;
		/** The consequence for the student, shown under the label. */
		hint?: string;
		onchange: (checked: boolean) => void;
	}
	let { checked, label, hint, onchange }: Props = $props();
</script>

<label class="toggle">
	<input type="checkbox" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
	<span class="track" aria-hidden="true"><span class="thumb"></span></span>
	<span class="text">
		<span class="label">{label}</span>
		{#if hint}<span class="hint">{hint}</span>{/if}
	</span>
</label>

<style>
	.toggle {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		cursor: pointer;
	}

	input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.track {
		flex: none;
		width: 36px;
		height: 20px;
		margin-top: 2px;
		border-radius: var(--radius-pill);
		background: var(--progress-track);
		transition: background 120ms ease;
	}

	.thumb {
		display: block;
		width: 16px;
		height: 16px;
		margin: 2px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: var(--shadow-light);
		transition: transform 120ms ease;
	}

	input:checked + .track {
		background: var(--primary);
	}

	input:checked + .track .thumb {
		transform: translateX(16px);
	}

	input:focus-visible + .track {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 2px;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		font: var(--type-body);
		color: var(--e-text);
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--e-text-muted);
	}
</style>
