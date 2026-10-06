<script lang="ts">
	/**
	 * What „Stáhnout“ opens when the course is not finished yet.
	 *
	 * The download button used to be disabled whenever anything was wrong, which told
	 * a teacher only that they could not have their file — not what was missing, nor
	 * where. Now the button always answers: a clean course downloads straight away,
	 * and anything else opens this review, grouped by card, with a way to each place.
	 *
	 * The rule itself has not moved (§3 invariant 5): errors still keep the file from
	 * being written, and warnings never do — with warnings alone this dialog offers
	 * „Stáhnout i tak“. What the review says (`store.screen.dialogs.export_review`,
	 * `screen/export.ts`) is the model's; this draws it and jumps. This is also where
	 * fixing a problem with AI will go, per row, once that exists.
	 */
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Crumbs from '$lib/ui/Crumbs.svelte';
	import { useStore } from '$lib/ui/context';
	import type { ExportGroupView, ExportRowView, ExportView } from '$lib/screen/types';
	import { ArrowRight, Download } from '@lucide/svelte';

	interface Props {
		view: ExportView;
		ondownload: () => void;
		onclose: () => void;
	}
	let { view, ondownload, onclose }: Props = $props();

	const store = useStore();
	const screen = 'dialogs.export_review';

	function jump(row: ExportRowView) {
		// A jump to a field this mode does not draw lands on nothing, so go up first.
		store.revealAt(
			row.needs_mode !== null ? store.switchMode(row.needs_mode, row.target) : row.target
		);
		onclose();
	}

	function download() {
		ondownload();
		onclose();
	}
</script>

{#snippet groupList(groups: ExportGroupView[], tone: 'error' | 'warning', path: string)}
	<ul class="groups">
		{#each groups as group, g (group.key)}
			<li class="group {tone}">
				<div class="group-head">
					<span class="group-title" data-screen="{path}[{g}].title">{group.title}</span>
					{#if group.context}<span class="context" data-screen="{path}[{g}].context"
							>{group.context}</span
						>{/if}
				</div>
				<ul class="rows">
					{#each group.rows as row, i (i)}
						<li>
							<div class="text">
								{#if row.detail.length > 0}<Crumbs
										class="issue-detail"
										parts={row.detail}
										screen="{path}[{g}].rows[{i}].detail"
									/>{/if}
								<span class="message" data-screen="{path}[{g}].rows[{i}].message"
									>{row.message}</span
								>
								{#if row.mode_note}
									<span class="mode" data-screen="{path}[{g}].rows[{i}].mode_note"
										>{row.mode_note}</span
									>
								{/if}
							</div>
							<Button variant="ghost" size="s" onclick={() => jump(row)}>
								Přejít <ArrowRight size={14} />
							</Button>
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
{/snippet}

<Modal title={view.title} size="l" {onclose}>
	<div class="review">
		<p class="lead" data-screen="{screen}.lead">{view.lead}</p>
		{#if view.blocked}
			{@render groupList(view.errors, 'error', `${screen}.errors`)}

			{#if view.advice_heading}
				<details class="advice">
					<summary data-screen="{screen}.advice_heading">{view.advice_heading}</summary>
					{@render groupList(view.warnings, 'warning', `${screen}.warnings`)}
				</details>
			{/if}
		{:else}
			{@render groupList(view.warnings, 'warning', `${screen}.warnings`)}
		{/if}
	</div>

	{#snippet footer()}
		<div class="spacer"></div>
		<Button variant="secondary" onclick={onclose}>Zpět k úpravám</Button>
		{#if view.can_download}
			<Button variant="primary" onclick={download}>
				<Download size={16} /> Stáhnout i tak
			</Button>
		{/if}
	{/snippet}
</Modal>

<style>
	.mode {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.review {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.lead {
		margin: 0;
		max-width: 68ch;
		color: var(--e-text);
		line-height: 1.55;
	}

	.groups,
	.rows {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.groups {
		gap: 10px;
	}

	.group {
		padding: 10px 12px;
		border: 1px solid var(--e-border);
		border-left-width: 3px;
		border-radius: var(--radius-s);
	}

	.group.error {
		border-left-color: var(--e-error);
	}

	.group.warning {
		border-left-color: var(--e-warning);
	}

	.group-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 4px;
	}

	.group-title {
		overflow: hidden;
		color: var(--e-text);
		font: var(--type-body-semibold);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.context {
		flex-shrink: 0;
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}

	.rows li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 6px 0;
	}

	.rows li + li {
		border-top: 1px solid var(--e-border);
	}

	.text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	:global(.issue-detail) {
		color: var(--e-text-muted);
		font-size: var(--text-xs);
	}

	.message {
		color: var(--e-text);
		font: var(--type-body-small);
	}

	.advice summary {
		color: var(--e-text-muted);
		cursor: pointer;
	}

	.advice[open] summary {
		margin-bottom: 10px;
	}

	.spacer {
		flex: 1;
	}
</style>
