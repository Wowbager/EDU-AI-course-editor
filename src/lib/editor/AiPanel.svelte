<script lang="ts">
	/**
	 * The AI tab of the right column. Top to bottom: what the AI has proposed, or how
	 * its writing goes, or one line inviting the teacher; and the box, pinned at the
	 * bottom. There is no history: only the last instruction, as one quiet line above
	 * the box.
	 *
	 * The box does what the state asks: with nothing proposed it asks for a proposal;
	 * with one on screen it asks for it to be changed. The proposal lives in `aiPanel`
	 * and is not in the course until „Vytvořit vybrané“ — then the left tree is the
	 * outline, and every later edit happens there.
	 */
	import { tick } from 'svelte';
	import { ArrowUp, Check, Circle, CircleAlert, LoaderCircle } from '@lucide/svelte';
	import Button from '$lib/ui/Button.svelte';
	import ProposalTree from './ProposalTree.svelte';
	import { useStore } from '$lib/ui/context';
	import { aiPanel } from '$lib/state/ai-panel.svelte';
	import { ai } from '$lib/state/ai.svelte';
	import { anyTicked } from '$lib/domain/outline';
	import { blockPreview } from '$lib/domain/derive';

	const store = useStore();

	let text = $state('');
	let field = $state<HTMLTextAreaElement>();

	const draft = $derived(aiPanel.draft);
	const queue = aiPanel.queue;

	/** What the box is for now, in the words it shows. */
	const placeholder = $derived(draft !== null ? 'Co změnit?' : 'Co mám vytvořit?');

	async function send() {
		const asked = text.trim();
		if (asked === '' || aiPanel.asking) return;
		text = '';
		await aiPanel.send(store, asked);
		// A request that failed gives the words back, to be tried again.
		if (aiPanel.problem !== '' && text === '') text = asked;
		await tick();
		field?.focus();
	}

	/** The queue's rows whose card is still in the course, with the lesson's name. */
	const rows = $derived(
		queue.rows.flatMap((row) => {
			const card = store.doc.blocks.find((b) => b.block_id === row.blockId);
			if (card === undefined) return [];
			const lesson = store.doc.lessons.find((l) => l.lesson_id === row.lessonId);
			return [
				{
					row,
					name: card.name?.trim() || blockPreview(card, 40),
					lesson: lesson?.name?.trim() ?? ''
				}
			];
		})
	);
	const manyLessons = $derived(new Set(rows.map((r) => r.row.lessonId)).size > 1);

	const open = (lessonId: string, blockId: string) => (store.selection = { lessonId, blockId });

	const showRows = $derived(draft === null && rows.length > 0);
	const stateLabel = {
		waiting: 'Čeká na řadu',
		writing: 'Píšu…',
		done: 'Hotovo',
		failed: 'Nepodařilo se dopsat'
	} as const;
</script>

<section class="panel" aria-label="AI">
	<div class="body">
		{#if draft !== null}
			<div class="scroll" aria-busy={aiPanel.asking}>
				<div class:busy={aiPanel.asking}>
					<ProposalTree {draft} />
				</div>
			</div>
			<div class="actions">
				<Button
					variant="primary"
					disabled={aiPanel.asking || !anyTicked(draft)}
					onclick={() => aiPanel.create(store)}>Vytvořit vybrané</Button
				>
				<Button variant="ghost" size="s" onclick={() => aiPanel.discard()}>Zahodit návrh</Button>
			</div>
		{:else if showRows}
			<div class="scroll">
				<ul class="queue">
					{#each rows as { row, name, lesson }, i (row.blockId)}
						{#if manyLessons && (i === 0 || rows[i - 1].row.lessonId !== row.lessonId)}
							<li class="group" aria-hidden="true">{lesson}</li>
						{/if}
						<li>
							<button
								type="button"
								class="queue-row {row.state}"
								onclick={() => open(row.lessonId, row.blockId)}
							>
								<span class="mark" title={stateLabel[row.state]}>
									{#if row.state === 'done'}
										<Check size={14} aria-hidden="true" />
									{:else if row.state === 'writing'}
										<LoaderCircle size={14} class="spin" aria-hidden="true" />
									{:else if row.state === 'failed'}
										<CircleAlert size={14} aria-hidden="true" />
									{:else}
										<Circle size={14} aria-hidden="true" />
									{/if}
								</span>
								<span class="row-name">{name}</span>
								<span class="state">{stateLabel[row.state]}</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
			{#if queue.stoppedBy === 'budget'}
				<p class="quiet">Dnešní příděl pro AI je vyčerpaný. Zítra to půjde znovu.</p>
			{/if}
			{#if queue.running}
				<div class="actions">
					<Button variant="secondary" onclick={() => aiPanel.stop()}>Zastavit</Button>
				</div>
			{:else if queue.rest.length > 0}
				<div class="actions">
					<Button variant="primary" onclick={() => aiPanel.resume(store)}>Dopsat zbytek</Button>
				</div>
			{/if}
		{:else if aiPanel.asking}
			<p class="empty"><LoaderCircle size={16} class="spin" aria-hidden="true" /> Navrhuji…</p>
		{:else}
			<p class="empty">
				Napiš, co chceš vytvořit. Třeba celý kurz, nebo jen pár karet do vybrané lekce.
			</p>
		{/if}
	</div>

	<div class="foot">
		{#if aiPanel.asking && draft !== null}
			<p class="quiet">
				<LoaderCircle size={14} class="spin" aria-hidden="true" /> Upravuji návrh…
			</p>
		{/if}
		{#if aiPanel.problem !== ''}
			<p class="quiet" role="status">{aiPanel.problem}</p>
		{/if}
		{#if aiPanel.last !== '' && (draft !== null || showRows)}
			<p class="last" title={aiPanel.last}>{aiPanel.last}</p>
		{/if}
		<form
			class="box"
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<textarea
				bind:this={field}
				bind:value={text}
				rows="1"
				aria-label={draft !== null ? 'Co změnit?' : 'Co mám vytvořit?'}
				{placeholder}
				disabled={!ai.available}
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						void send();
					}
				}}></textarea>
			<button
				type="submit"
				class="send"
				aria-label="Odeslat"
				title="Odeslat (Enter)"
				disabled={text.trim() === '' || aiPanel.asking}
			>
				<ArrowUp size={16} aria-hidden="true" />
			</button>
		</form>
	</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--surface);
	}

	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 10px 12px;
	}

	.busy {
		opacity: 0.55;
		pointer-events: none;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-top: 1px solid var(--e-border);
	}

	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		flex: 1;
		margin: 0;
		padding: 24px 32px;
		color: var(--e-text-faint);
		font: var(--type-body-small);
		text-align: center;
	}

	.queue {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.group {
		margin: 8px 0 2px;
		padding: 0 4px;
		color: var(--e-text-faint);
		font: var(--type-caption-bold);
	}

	.group:first-child {
		margin-top: 0;
	}

	.queue-row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 6px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		font: var(--type-body-small);
		color: var(--e-text);
		text-align: left;
		cursor: pointer;
	}

	.queue-row:hover {
		background: var(--primary-dark-06);
	}

	.mark {
		display: inline-flex;
		flex: none;
		color: var(--e-text-faint);
	}

	.done .mark {
		color: var(--e-ok-text);
	}

	.waiting {
		color: var(--e-text-faint);
	}

	.row-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The state in words only where there is something to say; done and waiting say it by their mark. */
	.state {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	.writing .state,
	.failed .state {
		position: static;
		width: auto;
		height: auto;
		clip-path: none;
		color: var(--e-text-faint);
		font: var(--type-caption);
	}

	.queue-row :global(.spin),
	.quiet :global(.spin),
	.empty :global(.spin) {
		animation: ai-spin 1.2s linear infinite;
	}

	@keyframes ai-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.foot {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 12px 12px;
		border-top: 1px solid var(--e-border);
	}

	.last,
	.quiet {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		overflow: hidden;
		color: var(--e-text-faint);
		font: var(--type-caption);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.quiet {
		padding: 0 12px 8px;
		white-space: normal;
	}

	.foot .quiet {
		padding: 0;
	}

	.last {
		display: block;
		font-style: italic;
	}

	.box {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		padding: 6px 6px 6px 10px;
		border: 1px solid var(--e-border-strong);
		border-radius: var(--radius-m, 14px);
		background: var(--surface);
	}

	.box:focus-within {
		border-color: var(--primary);
	}

	textarea {
		flex: 1;
		box-sizing: border-box;
		min-width: 0;
		min-height: 24px;
		max-height: calc(6lh + 4px);
		padding: 2px 0;
		border: none;
		outline: none;
		resize: none;
		background: none;
		field-sizing: content;
		font: var(--type-body-small);
		color: var(--e-text);
	}

	.send {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-pill);
		background: var(--header-gradient);
		color: var(--surface);
		cursor: pointer;
	}

	.send:disabled {
		background: var(--disabled-button);
		cursor: default;
	}

	@media (prefers-reduced-motion: reduce) {
		.queue-row :global(.spin),
		.quiet :global(.spin),
		.empty :global(.spin) {
			animation: none;
		}
	}
</style>
