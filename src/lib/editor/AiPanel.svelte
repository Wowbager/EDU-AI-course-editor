<script lang="ts">
	/**
	 * The AI tab of the right column. Top to bottom: what the AI has proposed, or how
	 * its writing goes, or one line inviting the teacher; and the box, pinned at the
	 * bottom. There is no history of instructions.
	 *
	 * The box does what the state asks: with nothing proposed it asks for a proposal;
	 * with one on screen it asks for it to be changed. The proposal lives in `aiPanel`
	 * and is not in the course until „Vytvořit vybrané“ — then the left tree is the
	 * outline, and every later edit happens there.
	 *
	 * With nothing proposed, the teacher can also start the outline by hand („+ lekce“, or
	 * „+ karta“ when the place is in a lesson).
	 *
	 * Above the box, „Kam“ says where the proposal goes, chosen before it is made
	 * (`placement.ts`); the selection only offers its lesson and card as places. A course
	 * with nothing of the teacher's yet has nowhere to choose, and shows no „Kam“. Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) inside the panel walk the outline's own
	 * history while it has one, and the course's undo stays out of it; in a text field
	 * they are the field's.
	 */
	import { tick, untrack } from 'svelte';
	import { ArrowUp, Check, Circle, CircleAlert, LoaderCircle, Paperclip, X } from '@lucide/svelte';
	import Button from '$lib/ui/Button.svelte';
	import ProposalTree from './ProposalTree.svelte';
	import { useStore } from '$lib/ui/context';
	import { aiPanel } from '$lib/state/ai-panel.svelte';
	import { ai } from '$lib/state/ai.svelte';
	import { materials } from '$lib/state/materials.svelte';
	import { ACCEPT } from '$lib/materials/read';
	import { displayName } from '$lib/domain/materials';
	import { imageInUse } from '$lib/domain/commands';
	import { anyTicked } from '$lib/domain/outline';
	import { blockPreview } from '$lib/domain/derive';
	import { hasNoContent } from '$lib/domain/starter';
	import { placeChoices, placeLabel, samePlace, scopeOf } from '$lib/domain/placement';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';

	const store = useStore();

	let text = $state('');
	let field = $state<HTMLTextAreaElement>();

	// The course's materials and outline follow the course, not every edit of it.
	const courseId = $derived(store.doc.course_id);
	$effect(() => {
		const id = courseId;
		untrack(() => {
			aiPanel.follow(id, store);
			void materials.load(id);
		});
	});

	let picker = $state<HTMLInputElement>();
	let dragging = $state(false);

	function attach(list: FileList | File[] | null | undefined) {
		const files = [...(list ?? [])];
		if (files.length > 0) void materials.add(courseId, files);
	}

	const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') === true;

	/** Everything attached: what is read and stored, then what is being read. */
	const items = $derived([
		...materials.files.map((f) => ({
			key: f.hash,
			name: f.name,
			unread: f.unread,
			hash: f.hash as string | undefined
		})),
		...materials.reading.map((r) => ({
			key: `reading-${r.id}`,
			name: r.name,
			unread: [] as string[],
			hash: undefined as string | undefined
		}))
	]);

	// One row of chips. When they do not all fit, the last thing in the row is „+N“, which
	// lets the row wrap; the same button folds it again.
	let chipRow = $state<HTMLUListElement>();
	let expanded = $state(false);
	let fit = $state(Number.POSITIVE_INFINITY);
	const MORE_WIDTH = 44;
	const CHIP_GAP = 4;

	function measure() {
		if (chipRow === undefined) return;
		const chips = [...chipRow.querySelectorAll<HTMLElement>('li.chip')];
		const room = chipRow.clientWidth;
		let used = 0;
		let shown = 0;
		for (const [i, chip] of chips.entries()) {
			const width = chip.offsetWidth + (i > 0 ? CHIP_GAP : 0);
			const more = chips.length - i - 1 > 0 ? CHIP_GAP + MORE_WIDTH : 0;
			if (used + width + more > room) break;
			used += width;
			shown = i + 1;
		}
		fit = Math.max(1, shown);
	}
	$effect(() => {
		void items;
		void expanded;
		void tick().then(measure);
	});
	$effect(() => {
		if (chipRow === undefined) return;
		const observer = new ResizeObserver(measure);
		observer.observe(chipRow);
		return () => observer.disconnect();
	});
	const hidden = $derived(Math.max(0, items.length - fit));
	/** A chip folded away is one that failed: „+N“ says so, so it is not missed. */
	/** A file being read behind „+N“ turns on its spinner, so the reading is not missed. */
	const hiddenReading = $derived(
		!expanded &&
			materials.reading.some((r) => items.findIndex((i) => i.key === `reading-${r.id}`) >= fit)
	);
	const hiddenFailed = $derived(!expanded && items.slice(fit).some((i) => i.unread.length > 0));

	/** The quiet line under the chips for a file with pages that did not read: it names the file. */
	function unreadLine(name: string, lines: readonly string[]): string {
		const first = lines[0].charAt(0).toLowerCase() + lines[0].slice(1);
		return `${displayName(name)}: ${first}${lines.length > 1 ? ` a ještě ${lines.length - 1} dalších` : ''}`;
	}

	const draft = $derived(aiPanel.draft);
	const queue = aiPanel.queue;

	/** Where the proposal goes, and the places on offer. */
	const showPlace = $derived(!hasNoContent(store.doc));
	const placeText = $derived(placeLabel(store.doc, aiPanel.place));
	const choices = $derived(placeChoices(store.doc, store.selection, aiPanel.place));
	const startScope = $derived(scopeOf(store.doc, aiPanel.place));

	/** What the box is for now, in the words it shows. */
	const placeholder = $derived(draft !== null ? 'Co změnit?' : 'Co mám vytvořit?');

	/** With files read and nothing proposed, an empty box asks for a proposal from them. */
	const canSend = $derived(
		!aiPanel.asking && (text.trim() !== '' || aiPanel.fromMaterials(store.doc))
	);

	async function send() {
		const asked = text.trim();
		if (!canSend) return;
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

	let section = $state<HTMLElement | null>(null);

	/** A field where Ctrl+Z undoes typing. */
	const typesText = (target: EventTarget | null): boolean =>
		target instanceof HTMLTextAreaElement ||
		(target instanceof HTMLInputElement &&
			!['checkbox', 'radio', 'button', 'submit', 'file'].includes(target.type)) ||
		(target instanceof HTMLElement && target.isContentEditable);

	function onkeydown(event: KeyboardEvent) {
		if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
		const key = event.key.toLowerCase();
		if ((key !== 'z' && key !== 'y') || typesText(event.target)) return;
		const done = key === 'y' || event.shiftKey ? aiPanel.redo() : aiPanel.undo();
		// Handled here, so the course's own undo does not run as well; nor while the AI is
		// writing the outline, when the key would quietly take back an edit of the course.
		if (done || aiPanel.asking) event.preventDefault();
	}

	/**
	 * Focus stays in the panel when the thing that had it goes (a row removed, a step
	 * undone, „Zahodit návrh“), so the next Ctrl+Z is still the outline's.
	 */
	let inside = false;
	$effect(() => {
		const down = (e: PointerEvent) => {
			if (!(e.target instanceof Node && section?.contains(e.target))) inside = false;
		};
		window.addEventListener('pointerdown', down, true);
		return () => window.removeEventListener('pointerdown', down, true);
	});
	$effect(() => {
		void aiPanel.draft;
		void tick().then(() => {
			const active = document.activeElement;
			if (inside && (active === null || active === document.body))
				section?.focus({ preventScroll: true });
		});
	});

	/** „Zahodit návrh“ takes a second click; it disarms when left, on Escape and after a while. */
	const ARMED_MS = 4000;
	let armed = $state(false);
	$effect(() => {
		if (!armed) return;
		const timer = setTimeout(() => (armed = false), ARMED_MS);
		return () => clearTimeout(timer);
	});
	function clickDiscard() {
		if (!armed) {
			armed = true;
			return;
		}
		armed = false;
		aiPanel.discard();
	}
	const stateLabel = {
		waiting: 'Čeká na řadu',
		writing: 'Píšu…',
		done: 'Hotovo',
		failed: 'Nepodařilo se dopsat'
	} as const;
</script>

<!-- Or the outline by hand: a lesson, or cards for the lesson the teacher is in. -->
{#snippet startByHand()}
	<div class="start">
		{#if startScope === 'lessons'}
			<button
				type="button"
				class="text-button"
				aria-label="Nová lekce"
				title="Napsat osnovu sám, bez AI: lekce"
				onclick={() => aiPanel.start('lessons')}>+ lekce</button
			>
		{:else}
			<button
				type="button"
				class="text-button"
				aria-label="Nová karta"
				title="Napsat osnovu sám, bez AI: karty"
				onclick={() => aiPanel.start('cards')}>+ karta</button
			>
		{/if}
	</div>
{/snippet}

<!-- Files are dropped anywhere on the panel; the 📎 in the box is the same thing by click. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (the key handler is the outline's undo) -->
<section
	class="panel"
	aria-label="AI"
	tabindex="-1"
	bind:this={section}
	{onkeydown}
	onfocusin={() => (inside = true)}
	onfocusout={(e) => {
		if (e.relatedTarget instanceof Node && !section?.contains(e.relatedTarget)) inside = false;
	}}
	ondragover={(e) => {
		if (!ai.available || !hasFiles(e)) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={(e) => {
		if (e.currentTarget === e.target) dragging = false;
	}}
	ondrop={(e) => {
		if (!hasFiles(e)) return;
		e.preventDefault();
		dragging = false;
		if (ai.available) attach(e.dataTransfer?.files);
	}}
>
	<div class="body">
		{#if draft !== null}
			<div class="scroll" aria-busy={aiPanel.asking}>
				<div class:busy={aiPanel.asking && !aiPanel.incoming}>
					<ProposalTree {draft} />
				</div>
				{#if aiPanel.incoming}
					<p class="writing-line">
						<LoaderCircle size={14} class="spin" aria-hidden="true" /> Píšu…
					</p>
				{/if}
			</div>
			<div class="actions">
				<Button
					variant="primary"
					disabled={aiPanel.asking || !anyTicked(draft)}
					onclick={() => aiPanel.create(store)}>Vytvořit vybrané</Button
				>
				<button
					type="button"
					class="text-button"
					class:armed
					onclick={clickDiscard}
					onblur={() => (armed = false)}
					onpointerleave={(e) => {
						// A finger leaves with every tap, before its click: only the mouse disarms.
						if (e.pointerType === 'mouse') armed = false;
					}}
					onkeydown={(e) => {
						if (e.key === 'Escape') armed = false;
					}}
				>
					{armed ? 'Opravdu zahodit? Klikni znovu' : 'Zahodit návrh'}
				</button>
			</div>
		{:else if showRows}
			<div class="scroll">
				{#if aiPanel.planning}
					<p class="writing-line planning">
						<LoaderCircle size={14} class="spin" aria-hidden="true" /> Promýšlím karty…
					</p>
				{/if}
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
								<span class="mark" aria-hidden="true">
									{#if row.state === 'done'}
										<Check size={16} />
									{:else if row.state === 'writing'}
										<LoaderCircle size={16} class="spin" />
									{:else if row.state === 'failed'}
										<CircleAlert size={16} />
									{:else}
										<Circle size={16} />
									{/if}
								</span>
								<span class="row-text">
									<span class="row-name">{name}</span>
									{#if row.state === 'writing' || row.state === 'failed'}
										<span class="state">{stateLabel[row.state]}</span>
									{:else}
										<span class="sr">{stateLabel[row.state]}</span>
									{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
			{#if queue.stoppedBy === 'budget'}
				<p class="quiet">Dnešní příděl pro AI je vyčerpaný. Zítra to půjde znovu.</p>
			{:else if queue.stoppedBy === 'rate'}
				<p class="quiet">AI má teď moc práce. Zbytek dopiš za chvíli.</p>
			{/if}
			{#if queue.running}
				<div class="actions">
					<button type="button" class="text-button" onclick={() => aiPanel.stop()}>Zastavit</button>
				</div>
			{:else if queue.rest.length > 0}
				<div class="actions">
					<Button variant="primary" onclick={() => aiPanel.resume(store)}>Dopsat zbytek</Button>
				</div>
			{:else if !aiPanel.asking}
				<!-- Every card is written: the next outline can be started by hand, as on an empty panel. -->
				<div class="actions">{@render startByHand()}</div>
			{/if}
		{:else if aiPanel.asking}
			<p class="empty"><LoaderCircle size={16} class="spin" aria-hidden="true" /> Navrhuji…</p>
		{:else}
			<div class="empty">
				<p>Napiš, co chceš vytvořit. Třeba celý kurz, nebo jen pár karet do vybrané lekce.</p>
				{@render startByHand()}
			</div>
		{/if}
	</div>

	<div class="foot">
		{#if aiPanel.asking && draft !== null && !aiPanel.incoming}
			<p class="quiet">
				<LoaderCircle size={14} class="spin" aria-hidden="true" /> Upravuji návrh…
			</p>
		{/if}
		{#if aiPanel.problem !== ''}
			<p class="quiet" role="status">{aiPanel.problem}</p>
		{/if}
		{#if items.length > 0}
			<ul class="chips" class:expanded aria-label="Podklady" bind:this={chipRow}>
				{#each items as item, i (item.key)}
					<li
						class="chip"
						class:overflowed={!expanded && i >= fit}
						class:failed={item.unread.length > 0}
						title={[item.name, ...item.unread].join('\n')}
					>
						<span class="chip-name">{displayName(item.name)}</span>
						{#if item.hash === undefined}
							<LoaderCircle size={12} class="spin" aria-hidden="true" />
							<span class="sr">Čtu soubor {item.name}</span>
						{:else}
							{#if item.unread.length > 0}<span class="chip-warn" aria-hidden="true">!</span>{/if}
							<button
								type="button"
								class="chip-x"
								aria-label={`Odebrat podklad: ${item.name}`}
								title="Odebrat"
								onclick={() =>
									void materials.remove(courseId, item.hash!, (id) => imageInUse(store.doc, id))}
							>
								<X size={12} aria-hidden="true" />
							</button>
						{/if}
					</li>
				{/each}
				{#if hidden > 0 || expanded}
					<li class="more-item">
						<button
							type="button"
							class="chip more"
							aria-expanded={expanded}
							aria-label={expanded ? 'Sbalit podklady' : `Ukázat dalších ${hidden} podkladů`}
							onclick={() => (expanded = !expanded)}
							>{expanded ? '−' : `+${hidden}`}{#if hiddenReading}<LoaderCircle
									size={12}
									class="spin"
									aria-hidden="true"
								/>{/if}{#if hiddenFailed}<span class="chip-warn" aria-hidden="true">&nbsp;!</span
								>{/if}</button
						>
					</li>
				{/if}
			</ul>
			{#each items.filter((f) => f.unread.length > 0).slice(0, 2) as file (file.key)}
				<p class="quiet">{unreadLine(file.name, file.unread)}</p>
			{/each}
		{/if}
		{#if materials.message !== ''}
			<p class="quiet" role="status">{materials.message}</p>
		{/if}
		{#if showPlace}
			<Menu
				label={`Kam: ${placeText}`}
				text={`Kam: ${placeText}`}
				class="place"
				disabled={aiPanel.asking}
			>
				{#each choices as choice (JSON.stringify(choice.place))}
					<MenuItem
						checked={samePlace(choice.place, aiPanel.place)}
						onclick={() => aiPanel.choose(store, choice.place)}>{choice.label}</MenuItem
					>
				{/each}
			</Menu>
		{/if}
		<form
			class="box"
			class:dragging
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<button
				type="button"
				class="clip"
				aria-label="Přiložit podklady"
				title="Přiložit podklady (Word, PowerPoint, PDF, tabulka, text, obrázek)"
				disabled={!ai.available}
				onclick={() => picker?.click()}
			>
				<Paperclip size={16} aria-hidden="true" />
			</button>
			<input
				bind:this={picker}
				type="file"
				class="picker"
				multiple
				accept={ACCEPT}
				tabindex="-1"
				aria-hidden="true"
				onchange={(e) => {
					attach(e.currentTarget.files);
					e.currentTarget.value = '';
				}}
			/>
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
				title={text.trim() === '' && aiPanel.fromMaterials(store.doc)
					? 'Navrhnout kurz z podkladů (Enter)'
					: 'Odeslat (Enter)'}
				disabled={!canSend}
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

	.panel:focus {
		outline: none;
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

	div.empty {
		flex-direction: column;
	}

	.empty p {
		margin: 0;
	}

	.start {
		display: flex;
		gap: 4px;
	}

	/* The place is information until pressed: quiet, one line, truncated. */
	.foot :global(.place) {
		min-width: 0;
		max-width: 100%;
	}

	.foot :global(.place .menu-trigger) {
		overflow: hidden;
		max-width: 100%;
		color: var(--e-text-muted);
		font: var(--type-meta);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* A choice, not a caption: the ▾ says it opens. */
	.foot :global(.place .menu-trigger::after) {
		content: '▾';
		margin-left: 4px;
	}

	.start .text-button {
		color: var(--e-text-faint);
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

	.row-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.row-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* What is going on, quietly under the name, like a proposal's brief. Done says it by its mark. */
	.state {
		color: var(--e-text-faint);
		font: var(--type-caption);
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	/* The card being written is the one that is alive; those waiting are fainter still. */
	.writing .mark {
		color: var(--e-accent-text);
	}

	.waiting .mark {
		opacity: 0.35;
	}

	.waiting .row-name {
		color: var(--e-text-faint);
	}

	.text-button {
		padding: 4px 6px;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-muted);
		font: var(--type-body-small);
		cursor: pointer;
	}

	.text-button:hover {
		color: var(--e-text);
		text-decoration: underline;
	}

	/* Red only once it is about to happen: after the first click. */
	.text-button.armed,
	.text-button.armed:hover {
		color: var(--e-error-text);
	}

	.queue-row :global(.spin),
	.quiet :global(.spin),
	.writing-line :global(.spin),
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

	.writing-line {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 6px 0 0;
		padding: 0 4px;
		color: var(--e-text-faint);
		font: var(--type-caption);
	}

	/* Above the rows: the room a lesson's name has below it. */
	.planning {
		margin: 0 0 10px;
	}

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

	.box {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		padding: 6px 6px 6px 10px;
		border: 1px solid var(--e-border-strong);
		border-radius: var(--radius-m, 14px);
		background: var(--surface);
	}

	.box.dragging {
		border-color: var(--primary);
		border-style: dashed;
	}

	.picker {
		display: none;
	}

	.clip {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin-left: -4px;
		border: none;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--e-text-faint);
		cursor: pointer;
	}

	.clip:hover:not(:disabled) {
		color: var(--e-text);
		background: var(--primary-dark-06);
	}

	.clip:disabled {
		cursor: default;
		opacity: 0.5;
	}

	/* Attached files: small and quiet, one row; „+N“ opens the rest. */
	.chips {
		position: relative;
		display: flex;
		flex-wrap: nowrap;
		gap: 4px;
		margin: 0;
		padding: 0;
		overflow: hidden;
		list-style: none;
	}

	.chips.expanded {
		flex-wrap: wrap;
		max-height: 100px;
		overflow-y: auto;
	}

	.chip {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		padding: 2px 4px 2px 8px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-pill);
		background: none;
		color: var(--e-text-muted);
		font: var(--type-caption);
	}

	/* Past the row, but still measured. */
	.chip.overflowed {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
	}

	.chip-name {
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip :global(.spin) {
		flex: none;
		margin-right: 4px;
		color: var(--e-text-faint);
		animation: ai-spin 1.2s linear infinite;
	}

	.chip-warn {
		flex: none;
		color: var(--e-warning-text);
		font-weight: 700;
	}

	.chip.failed {
		border-color: var(--e-warning-text);
	}

	.more-item {
		display: contents;
	}

	button.chip.more {
		padding: 2px 8px;
		cursor: pointer;
	}

	button.chip.more:hover {
		color: var(--e-text);
		background: var(--primary-dark-06);
	}

	.chip-x {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		padding: 0;
		border: none;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--e-text-faint);
		opacity: 0;
		cursor: pointer;
	}

	.chip:hover .chip-x,
	.chip-x:focus-visible {
		opacity: 1;
	}

	.chip-x:hover {
		color: var(--e-text);
		background: var(--primary-dark-06);
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
		.chip :global(.spin),
		.empty :global(.spin) {
			animation: none;
		}
	}
</style>
