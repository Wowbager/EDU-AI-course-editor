<script lang="ts">
	/**
	 * The AI assistant: a drawer on the right, opened from the top bar.
	 *
	 * It shows the conversation, takes the teacher's message, and lists what the AI
	 * changed with a way to look at each change and to take it back. Every word it
	 * shows about the course comes from `store.screen.ai` (the names in the action log
	 * are the ones the screen uses); the loop behind it is `ChatSession`. The
	 * confirmation the AI asks for before a delete is a dialog drawn here, whether or
	 * not the drawer is open, because the AI may be waiting while it is closed.
	 */
	import { tick } from 'svelte';
	import { Send, Square, X, Undo2, Eye } from '@lucide/svelte';
	import { ChatSession } from '$lib/agent/chat.svelte';
	import { httpTransport } from '$lib/agent/chat-transport';
	import { runTool } from '$lib/agent/handlers';
	import { createBrowserContext, revertAiTo } from '$lib/state/agent-context.svelte';
	import { WORKSPACE_HEADER, workspaceKey } from '$lib/state/versions/server';
	import { useStore, useVersions } from '$lib/ui/context';
	import Button from '$lib/ui/Button.svelte';
	import AiConfirmDialog from './AiConfirmDialog.svelte';

	const store = useStore();
	const versions = useVersions();
	const ai = $derived(store.screen.ai);

	const context = createBrowserContext(store, versions);
	const session = new ChatSession({
		store,
		ctx: context,
		transport: httpTransport({
			workspace: () => {
				const key = workspaceKey();
				return key === null ? null : { header: WORKSPACE_HEADER, key };
			}
		})
	});

	let draft = $state('');
	let log = $state<HTMLElement | null>(null);

	// Another course is another conversation: the actions of the old one are gone too.
	let courseId = store.doc.course_id;
	$effect(() => {
		const id = store.doc.course_id;
		if (id === courseId) return;
		courseId = id;
		session.stop();
		session.reset();
		store.ai.clear();
	});

	// The newest words are in view while they arrive.
	$effect(() => {
		void ai.messages_count;
		void ai.messages.at(-1)?.text;
		void tick().then(() => log?.scrollTo({ top: log.scrollHeight }));
	});

	function send() {
		const text = draft.trim();
		if (text === '' || ai.running || ai.configured === false) return;
		draft = '';
		void session.send(text);
	}

	function onkeydown(event: KeyboardEvent) {
		// Zpět in the message box is the box's own, not the course's.
		if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
			event.stopPropagation();
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			send();
		}
	}

	async function revertAll() {
		const result = await runTool(
			'revert_ai_session',
			{ expected_revision: store.revision },
			context
		);
		if (!result.ok && result.error.code !== 'declined')
			store.ai.addLine('error', result.error.message);
	}

	function revertTo(actionId: string) {
		const { reached } = revertAiTo(store, actionId);
		if (!reached) {
			store.ai.addLine(
				'notice',
				'Dál vracet nejde: po té změně jsi kurz upravil sám. Použij Zpět.'
			);
		}
	}
</script>

{#if ai.panel_open}
	<aside class="drawer" aria-label="AI asistent">
		<header>
			<h2>AI asistent</h2>
			<button
				type="button"
				class="close"
				aria-label="Zavřít asistenta"
				onclick={() => (store.ai.panelOpen = false)}
			>
				<X size={18}></X>
			</button>
		</header>

		{#if ai.status_text !== null}
			<p class="unavailable" data-screen="ai.status_text">{ai.status_text}</p>
		{/if}

		<div class="log" role="log" aria-live="polite" aria-label="Konverzace" bind:this={log}>
			{#if ai.empty_text !== null}
				<p class="empty" data-screen="ai.empty_text">{ai.empty_text}</p>
			{/if}
			{#each ai.messages as message, i (message.key)}
				<div class="message {message.role}" data-role={message.role}>
					<span data-screen="ai.messages[{i}].text">{message.text}</span>
				</div>
			{/each}
			{#if ai.thinking_text !== null}
				<p class="thinking" data-screen="ai.thinking_text">{ai.thinking_text}</p>
			{/if}
		</div>

		{#if ai.actions.length > 0}
			<section class="actions" aria-label="Změny asistenta">
				<h3 data-screen="ai.actions_heading">{ai.actions_heading}</h3>
				<ul>
					{#each ai.actions as action, i (action.key)}
						<li class:undone={action.undone}>
							<span class="what" data-screen="ai.actions[{i}].text">{action.text}</span>
							{#if action.undone}<span class="tag">vráceno</span>{/if}
							<span class="row">
								{#if action.ref !== null}
									<Button
										variant="ghost"
										size="s"
										title="Ukázat toto místo v kurzu"
										onclick={() => action.ref !== null && store.follow(action.ref)}
									>
										<Eye size={14}></Eye> Ukázat
									</Button>
								{/if}
								{#if !action.undone}
									<Button
										variant="ghost"
										size="s"
										title="Vrátit tuto i všechny pozdější změny asistenta"
										onclick={() => revertTo(action.key)}
									>
										Vrátit až sem
									</Button>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
				<Button variant="secondary" size="s" disabled={!ai.can_revert} onclick={revertAll}>
					<Undo2 size={14}></Undo2> Vrátit změny AI
				</Button>
			</section>
		{/if}

		<form
			class="compose"
			onsubmit={(event) => {
				event.preventDefault();
				send();
			}}
		>
			<textarea
				aria-label="Zpráva asistentovi"
				placeholder="Zeptej se nebo zadej úkol…"
				rows="2"
				bind:value={draft}
				{onkeydown}
				disabled={ai.configured === false}></textarea>
			{#if ai.running}
				<Button variant="secondary" onclick={() => session.stop()}>
					<Square size={14}></Square> Zastavit
				</Button>
			{:else}
				<Button
					variant="primary"
					type="submit"
					disabled={ai.configured === false || draft.trim() === ''}
				>
					<Send size={14}></Send> Odeslat
				</Button>
			{/if}
		</form>
	</aside>
{/if}

{#if ai.confirm !== null}
	<AiConfirmDialog
		confirm={ai.confirm}
		onanswer={(allowed) => store.ai.confirm?.resolve(allowed)}
	/>
{/if}

<style>
	.drawer {
		position: fixed;
		top: var(--e-topbar-height);
		right: 0;
		bottom: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		width: min(420px, 100vw);
		border-left: 1px solid var(--e-border);
		background: var(--surface);
		box-shadow: var(--shadow-strong);
	}

	header {
		display: flex;
		align-items: center;
		padding: 12px 16px;
		border-bottom: 1px solid var(--e-border);
	}

	h2 {
		flex: 1;
		margin: 0;
		font: var(--type-subtitle);
	}

	h3 {
		margin: 0;
		font: var(--type-body-semibold);
	}

	.close {
		display: flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--e-text-faint);
		cursor: pointer;
	}

	.close:hover {
		color: var(--e-text);
	}

	.unavailable {
		margin: 12px 16px 0;
		padding: 8px 12px;
		border-radius: var(--radius-s);
		background: var(--e-warning-bg);
		color: var(--e-text);
		font: var(--type-body-small);
	}

	.log {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
		padding: 12px 16px;
		overflow-y: auto;
	}

	.empty,
	.thinking {
		margin: 0;
		color: var(--e-text-muted);
		font: var(--type-body-small);
		line-height: 1.5;
	}

	.thinking {
		font-style: italic;
	}

	.message {
		max-width: 92%;
		padding: 8px 12px;
		border-radius: var(--radius-m);
		font: var(--type-body);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	/* pre-wrap belongs to the text alone: on the bubble it kept the markup's own line
	   break and indent before and after the text as an empty line at the bottom. */
	.message > span {
		display: block;
		white-space: pre-wrap;
	}

	.message.user {
		align-self: flex-end;
		background: var(--primary-dark-08);
	}

	.message.assistant {
		align-self: flex-start;
		background: var(--surface-light);
		border: 1px solid var(--e-border);
	}

	.message.notice {
		align-self: center;
		color: var(--e-text-muted);
		font: var(--type-body-small);
	}

	.message.error {
		align-self: flex-start;
		background: var(--e-error-bg);
		color: var(--e-error);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 34%;
		padding: 10px 16px;
		overflow-y: auto;
		border-top: 1px solid var(--e-border);
	}

	.actions ul {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.actions li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		font: var(--type-body-small);
	}

	.actions li.undone .what {
		color: var(--e-text-faint);
		text-decoration: line-through;
	}

	.what {
		flex: 1 1 100%;
	}

	.tag {
		color: var(--e-text-faint);
	}

	.row {
		display: flex;
		gap: 4px;
	}

	.compose {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--e-border);
	}

	textarea {
		flex: 1;
		resize: none;
		padding: 8px 10px;
		border: 1px solid var(--e-border-strong);
		border-radius: var(--radius-s);
		background: var(--input-bg);
		color: var(--e-text);
		font: var(--type-body);
	}

	textarea:focus-visible {
		outline: 2px solid var(--e-focus-ring);
		outline-offset: 1px;
	}
</style>
