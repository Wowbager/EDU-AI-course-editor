<script lang="ts">
	/**
	 * The validation panel (§14, M8). It lives behind the topbar chip, and every row
	 * jumps to the place it is about — an issue you cannot reach is an issue nobody
	 * fixes.
	 */
	import { fixModeOf, MODE_RANK } from '$lib/ui/fields';
	import type { IssueItem } from '$lib/screen';
	import { useStore } from '$lib/ui/context';
	import Button from '$lib/ui/Button.svelte';
	import { CircleX, X } from '@lucide/svelte';
	import Crumbs from '$lib/ui/Crumbs.svelte';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	const store = useStore();
	/**
	 * Everything on this panel — the lists, their headings, the place of each issue and
	 * the note about skipped checks — is `store.screen.issues`; nothing is worked out
	 * here. A warning about a field the Zpětná vazba toggle has hidden is said once,
	 * quietly, with the way to see it — not dropped, and not counted.
	 */
	const issues = $derived(store.screen.issues);
	const panel = $derived(issues.panel);

	function jump(issue: IssueItem) {
		// Fixed in a mode above this one: switch first, or the jump lands on nothing.
		const need = fixModeOf(issue.ref) ?? 'advanced';
		const ref =
			MODE_RANK[need] > MODE_RANK[store.mode] ? store.switchMode(need, issue.ref) : issue.ref;
		store.revealAt({ ...ref, lessonId: issue.target.lessonId });
		onclose();
	}
</script>

<aside class="panel" aria-label="Kontrola kurzu">
	<header>
		<h2>Kontrola kurzu</h2>
		<button type="button" class="close" onclick={onclose} aria-label="Zavřít">
			<CircleX size={16}></CircleX>
		</button>
	</header>

	{#if panel.clean}
		<p class="clean" data-screen="issues.panel.clean_text">{panel.clean_text}</p>
	{/if}

	{#if panel.errors.length > 0}
		<h3 class="error" data-screen="issues.panel.errors_heading">{panel.errors_heading}</h3>
		<ul>
			{#each panel.errors as issue, i (issue.key)}
				<li>
					<button type="button" class="issue" onclick={() => jump(issue)}>
						<span class="message" data-screen="issues.panel.errors[{i}].message"
							>{issue.message}</span
						>
						<Crumbs
							class="issue-where"
							parts={issue.where}
							screen="issues.panel.errors[{i}].where"
						/>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if panel.warnings.length > 0}
		<h3 class="warning" data-screen="issues.panel.warnings_heading">{panel.warnings_heading}</h3>
		<ul>
			{#each panel.warnings as issue, i (issue.key)}
				<li>
					<button type="button" class="issue" onclick={() => jump(issue)}>
						<span class="message" data-screen="issues.panel.warnings[{i}].message"
							>{issue.message}</span
						>
						<Crumbs
							class="issue-where"
							parts={issue.where}
							screen="issues.panel.warnings[{i}].where"
						/>
					</button>
					<button
						type="button"
						class="dismiss"
						onclick={() => store.ui.dismissIssue(issue.key)}
						title="Skrýt upozornění"
					>
						<X size={14}></X>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if panel.held_text !== null}
		<p class="held">
			<span data-screen="issues.panel.held_text">{panel.held_text}</span>
			<Button variant="ghost" size="s" onclick={() => (store.showFeedback = true)}>Ukázat</Button>
		</p>
	{/if}

	{#if issues.skipped_checks !== null}
		<p class="skipped" data-screen="issues.skipped_checks">{issues.skipped_checks}</p>
	{/if}
</aside>

<style>
	.panel {
		position: absolute;
		top: var(--e-topbar-height);
		right: 16px;
		z-index: 20;
		width: 460px;
		max-height: 70vh;
		padding: 16px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-l);
		background: var(--surface);
		box-shadow: var(--shadow-strong);
		overflow-y: auto;
	}

	header {
		display: flex;
		align-items: center;
		margin-bottom: 8px;
	}

	h2 {
		flex: 1;
		margin: 0;
		font: var(--type-subtitle);
		color: var(--e-text);
	}

	h3 {
		margin: 16px 0 6px;
		font: var(--type-badge);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	h3.error {
		color: var(--e-error);
	}

	h3.warning {
		color: var(--e-warning);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: flex-start;
		gap: 4px;
	}

	.issue {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		border: none;
		border-radius: var(--radius-s);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.issue:hover {
		background: var(--info-bg);
	}

	.message {
		color: var(--e-text);
		font: var(--type-body-small);
	}

	:global(.issue-where) {
		color: var(--e-text-faint);
		font: var(--type-code);
	}

	.close,
	.dismiss {
		border: none;
		background: none;
		color: var(--e-text-faint);
		font-size: var(--text-l);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.close:hover,
	.dismiss:hover {
		color: var(--e-error);
	}

	.held {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 16px 0 0;
		color: var(--e-text-faint);
		font: var(--type-body-small);
	}

	.skipped {
		margin: 16px 0 0;
		color: var(--e-text-faint);
		font: var(--type-body-small);
	}

	.clean {
		margin: 12px 0;
		color: var(--e-ok);
		font-size: var(--text-m);
	}
</style>
