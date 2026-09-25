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
	 * „Stáhnout i tak“. What changed is that the refusal explains itself. This is also
	 * where fixing a problem with AI will go, per row, once that exists.
	 */
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useStore } from '$lib/ui/context';
	import { groupIssues, type IssueGroup, type IssueRow } from '$lib/domain/issue-groups';
	import { counted, warningsCount } from '$lib/ui/plural';
	import { ArrowRight, Download } from '@lucide/svelte';

	interface Props {
		ondownload: () => void;
		onclose: () => void;
	}
	let { ondownload, onclose }: Props = $props();

	const store = useStore();

	const errors = $derived(groupIssues(store.doc, store.index, store.validation.errors));
	const warnings = $derived(groupIssues(store.doc, store.index, store.validation.warnings));
	const warningTotal = $derived(store.validation.warnings.length);
	const blocked = $derived(errors.length > 0);

	/** How many cards are unfinished, which is the unit a teacher plans their time in. */
	const cardGroups = $derived(errors.filter((g) => g.kind === 'card').length);

	function jump(row: IssueRow) {
		store.revealAt(row.target);
		onclose();
	}

	function download() {
		ondownload();
		onclose();
	}
</script>

{#snippet groupList(groups: IssueGroup[], tone: 'error' | 'warning')}
	<ul class="groups">
		{#each groups as group (group.key)}
			<li class="group {tone}">
				<div class="group-head">
					<span class="group-title">{group.title}</span>
					{#if group.context}<span class="context">{group.context}</span>{/if}
				</div>
				<ul class="rows">
					{#each group.rows as row, i (i)}
						<li>
							<div class="text">
								{#if row.detail}<span class="detail">{row.detail}</span>{/if}
								<span class="message">{row.issue.message}</span>
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

<Modal title={blocked ? 'Než kurz stáhneš' : 'Stáhnout kurz'} size="l" {onclose}>
	<div class="review">
		{#if blocked}
			<p class="lead">
				{#if cardGroups > 0}
					Ještě je potřeba dokončit {counted(cardGroups, 'kartu', 'karty', 'karet')}{errors.length > cardGroups ? ' a pár věcí v kurzu' : ''}.
				{:else}
					Ještě je potřeba dokončit pár věcí v kurzu.
				{/if}
				Bez nich by žák narazil na lekci, která nefunguje, a proto se kurz zatím nedá stáhnout.
			</p>
			{@render groupList(errors, 'error')}

			{#if warningTotal > 0}
				<details class="advice">
					<summary>Doporučení ({warningTotal}) — stažení nebrání</summary>
					{@render groupList(warnings, 'warning')}
				</details>
			{/if}
		{:else}
			<p class="lead">
				Kurz je hotový a dá se stáhnout. Našlo se k němu {warningsCount(warningTotal)} — nic z toho žákovi
				lekci nerozbije, ale stojí za to se na ně podívat.
			</p>
			{@render groupList(warnings, 'warning')}
		{/if}
	</div>

	{#snippet footer()}
		<div class="spacer"></div>
		<Button variant="secondary" onclick={onclose}>Zpět k úpravám</Button>
		{#if !blocked}
			<Button variant="primary" onclick={download}>
				<Download size={16} /> Stáhnout i tak
			</Button>
		{/if}
	{/snippet}
</Modal>

<style>
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

	.detail {
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
