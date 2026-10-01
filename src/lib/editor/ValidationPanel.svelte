<script lang="ts">
	/**
	 * The validation panel (§14, M8). It lives behind the topbar chip, and every row
	 * jumps to the place it is about — an issue you cannot reach is an issue nobody
	 * fixes.
	 */
	import { fixModeOf, MODE_RANK } from '$lib/ui/fields';
	import type { Issue } from '$lib/domain/validate';
	import { issueLessonId, issuePlace } from '$lib/domain/issue-groups';
	import { useStore } from '$lib/ui/context';
	import { heldBack } from '$lib/ui/issue-visibility';
	import Button from '$lib/ui/Button.svelte';
	import { CircleX, X } from '@lucide/svelte';
	import Crumbs from '$lib/ui/Crumbs.svelte';
	import { plural } from '$lib/ui/plural';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	const store = useStore();
	let dismissed = $state<Set<string>>(new Set());

	const key = (issue: Issue) => `${issue.code}|${JSON.stringify(issue.ref)}`;
	const warnings = $derived(store.listed.warnings.filter((w) => !dismissed.has(key(w))));
	// Advice about a field the Zpětná vazba toggle has hidden: said once, quietly,
	// with the way to see it — not dropped, and not counted.
	const held = $derived(
		store.validation.warnings.filter(
			(w) => heldBack(w, store.showFeedback) && !dismissed.has(key(w))
		).length
	);

	function jump(issue: Issue) {
		// Fixed in a mode above this one: switch first, or the jump lands on nothing.
		const need = fixModeOf(issue.ref) ?? 'advanced';
		const lessonId = issueLessonId(store.index, issue.ref);
		const ref =
			MODE_RANK[need] > MODE_RANK[store.mode] ? store.switchMode(need, issue.ref) : issue.ref;
		store.revealAt({ ...ref, lessonId });
		onclose();
	}

	function dismiss(issue: Issue) {
		dismissed = new Set([...dismissed, key(issue)]);
	}

	// A teacher is never shown an id (§8); `issuePlace` names everything the way the
	// rest of the editor does, and prints an id only for a reference nothing resolves.
	const where = (issue: Issue): string[] => issuePlace(store.doc, issue.ref);
</script>

<aside class="panel" aria-label="Kontrola kurzu">
	<header>
		<h2>Kontrola kurzu</h2>
		<button type="button" class="close" onclick={onclose} aria-label="Zavřít">
			<CircleX size={16}></CircleX>
		</button>
	</header>

	{#if store.listed.errors.length === 0 && warnings.length === 0}
		<p class="clean">Kurz je v pořádku. Můžeš publikovat.</p>
	{/if}

	{#if store.listed.errors.length > 0}
		<h3 class="error">Chyby — brání publikaci ({store.listed.errors.length})</h3>
		<ul>
			{#each store.listed.errors as issue (key(issue))}
				<li>
					<button type="button" class="issue" onclick={() => jump(issue)}>
						<span class="message">{issue.message}</span>
						<Crumbs class="issue-where" parts={where(issue)} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if warnings.length > 0}
		<h3 class="warning">Upozornění — publikaci nebrání ({warnings.length})</h3>
		<ul>
			{#each warnings as issue (key(issue))}
				<li>
					<button type="button" class="issue" onclick={() => jump(issue)}>
						<span class="message">{issue.message}</span>
						<Crumbs class="issue-where" parts={where(issue)} />
					</button>
					<button
						type="button"
						class="dismiss"
						onclick={() => dismiss(issue)}
						title="Skrýt upozornění"
					>
						<X size={14}></X>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if held > 0}
		<p class="held">
			{plural(held, 'Skryto', 'Skryta', 'Skryto')}
			{held} doporučení ke zpětné vazbě.
			<Button variant="ghost" size="s" onclick={() => (store.showFeedback = true)}>Ukázat</Button>
		</p>
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

	.clean {
		margin: 12px 0;
		color: var(--e-ok);
		font-size: var(--text-m);
	}
</style>
