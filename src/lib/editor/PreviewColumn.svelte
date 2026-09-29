<script lang="ts">
	/**
	 * The preview column: the real Flutter player in an iframe, booted once and kept
	 * warm.
	 *
	 * Two modes, and they are genuinely different things rather than two spellings of
	 * the same one:
	 *
	 *  - **Náhled** shows the selected card with every step expanded at once and
	 *    nothing to click through. It is inert: a click anywhere reports the field
	 *    behind it and the editor focuses it. It also shows what a student would not
	 *    see yet — every option's feedback, the solution, where each branch leads.
	 *  - **Vyzkoušet** plays the whole lesson from the selected card onward, exactly
	 *    as a pupil takes it, with **Zpět** so a branch can be tried and then the
	 *    other one. Nothing in the player marks a focused step — a pupil's screen has
	 *    no such thing — and clicks are the pupil's. The editor follows the run
	 *    instead: each step the player reports is selected, opened and scrolled to,
	 *    and the played card's steps the pupil has not reached yet are folded.
	 *
	 * The player is served under /player/ on this origin (§6.4). Until that build is
	 * in place the column says so rather than showing a blank frame.
	 *
	 * The player gets the course as exported (`store.source`), where each question of
	 * a card is its own block (`domain/groups.ts`). What it reports back names those
	 * blocks, and `store.toView` turns them into the card the editor shows.
	 */
	import { tick, untrack } from 'svelte';
	import { PanelRightClose, PanelRightOpen } from '@lucide/svelte';
	import type { BlockV2, CourseV2, ExportType } from '$lib/domain/schema';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { PreviewBridge, type PreviewView } from '$lib/preview/bridge';
	import { serialise } from '$lib/domain/document';
	import { useStepView, useStore } from '$lib/ui/context';
	import { allows } from '$lib/ui/fields';
	import { blockPreview } from '$lib/domain/derive';
	import { groupOf, groupsOf } from '$lib/domain/groups';

	interface Props {
		doc: CourseV2;
		block: BlockV2 | undefined;
		lessonId: string | undefined;
		/**
		 * Folded to a thin rail. `null` until the remembered layout has been read; the
		 * column is then neither shown nor hidden, and starts no player yet.
		 *
		 * Folding never resizes, hides or unmounts the player. It is clipped: the
		 * column keeps its full size inside a narrower window and is `inert`. Unmounting
		 * would cost a slow reboot and lose a run in progress; `display: none` or
		 * `visibility: hidden` pauses the frame's animation callbacks, which Flutter
		 * boots on, and the boot watchdog below would call that a failed start.
		 */
		collapsed: boolean | null;
		ontoggle: () => void;
	}
	let { doc, block, lessonId, collapsed, ontoggle }: Props = $props();

	const store = useStore();
	const stepView = useStepView();
	let view = $state<PreviewView>('expanded');
	/**
	 * What a played run was started with: the lesson and the card. Both are pinned
	 * when the mode is entered, never tracked from the selection — the run *moves*
	 * the selection (see `onstepChanged`), and a run whose inputs followed its own
	 * output would restart itself: a branch into a card shared with another lesson
	 * changed the lesson, and "Od začátku" re-pinned the start to whatever card the
	 * run had reached, which restarted it twice. The selection is the run's output
	 * and never its input.
	 */
	let playStart = $state<string | undefined>(undefined);
	let playLessonId = $state<string | undefined>(undefined);
	let frame = $state<HTMLIFrameElement | null>(null);
	let booted = $state(false);
	/**
	 * Why there is no player: its build is not served here (`missing`), or it is and
	 * never announced itself, even after the retries below (`stalled`).
	 */
	let failed = $state<false | 'missing' | 'stalled'>(false);
	/** Which load of the frame this is. Bumped to load it again. */
	let attempt = $state(0);
	let canGoBack = $state(false);
	/** Undecided until the player URL has been probed — see below. */
	let available = $state<boolean | null>(null);

	const PLAYER_URL = '/player/preview';

	/**
	 * What the header chip and the browser suite read. A running player has no chip:
	 * the segmented control beside it is the header, and a green tag naming the other
	 * mode said nothing that the picture below it did not.
	 */
	const playerState = $derived(booted ? 'ready' : failed ? 'failed' : 'starting');

	/**
	 * A column that starts folded does not boot the player until it is first opened:
	 * a teacher who keeps the preview shut should not pay for it. Once mounted it
	 * stays mounted.
	 */
	let everRevealed = $state(false);
	$effect(() => {
		if (collapsed === false) everRevealed = true;
	});

	let hideHost = $state<HTMLElement>();
	let showButton = $state<HTMLButtonElement>();

	/** A click moves the control the pointer was on out of reach; focus its counterpart. */
	async function toggle() {
		const opening = collapsed === true;
		ontoggle();
		await tick();
		if (opening) hideHost?.querySelector('button')?.focus();
		else showButton?.focus();
	}

	/**
	 * The step the author is working on, when it is in the card on screen.
	 *
	 * Sent with every `setBlock` rather than only as a separate `highlight`, because
	 * the player assigns the outline from that field unconditionally: a debounced
	 * content update carrying no step id used to *clear* the outline a quarter of a
	 * second after the author stopped typing, and only a highlight fired by the next
	 * keystroke put it back. Carrying it here means the outline and the engine's
	 * restore point are the same value and cannot drift apart.
	 */
	const selectedStepId = $derived(
		store.selection?.blockId === block?.block_id ? store.selection?.stepId : undefined
	);
	const exportMode = $derived<ExportType>(doc.export_type ?? 'course_v2');

	/** The course as the player gets it. */
	const source = $derived(store.source);
	const groups = $derived(groupsOf(source));

	/** The blocks the card on screen is made of, as exported. */
	const blocksOfCard = (cardId: string): BlockV2[] => {
		const members = groups.get(cardId);
		if (members !== undefined) return members;
		const own = source.blocks.find((b) => b.block_id === cardId);
		return own !== undefined ? [own] : [];
	};

	/**
	 * What to call the other cards a branch leads to. The player holds one card and
	 * cannot look another one up; left to itself it would print the `block_id`, which
	 * a teacher must never be shown (plan §8). So the naming is decided here, by the
	 * same rule the rest of the editor uses.
	 */
	const blockLabels = $derived.by(() => {
		const showIds = allows('block', 'block_id', store.mode);
		const labels: Record<string, string> = {};
		for (const candidate of source.blocks) {
			if (showIds) {
				labels[candidate.block_id] = candidate.block_id;
				continue;
			}
			// A branch into a card's later question names the card and the question.
			const key = groupOf(candidate);
			const members = key !== undefined ? (groups.get(key) ?? []) : [];
			const position = members.indexOf(candidate);
			const card = members[0] ?? candidate;
			labels[candidate.block_id] =
				position > 0
					? `${blockPreview(card, 30)}, ${position + 1}. část`
					: blockPreview(card, 30);
		}
		return labels;
	});

	/**
	 * The steps of a played card the pupil has met: those of the card's blocks before
	 * the one on screen, and the ones on screen. The step list folds the rest.
	 */
	function reachedSteps(blockId: string, shown: string[] | undefined): string[] | undefined {
		if (shown === undefined) return undefined;
		const key = groupOf(source.blocks.find((b) => b.block_id === blockId) ?? ({} as BlockV2));
		if (key === undefined || store.mode === 'advanced') return shown;
		const members = groups.get(key) ?? [];
		const at = members.findIndex((m) => m.block_id === blockId);
		return [...members.slice(0, Math.max(at, 0)).flatMap((m) => m.steps.map((s) => s.id)), ...shown];
	}

	/**
	 * The lesson to show a card in: the played one when the card is in it — a card
	 * shared by two lessons belongs to the one being played — and otherwise the first
	 * lesson that has it. A card in none is shown on its own.
	 */
	function lessonOf(blockId: string | undefined): string | undefined {
		if (blockId === undefined) return undefined;
		const owners = store.index.lessonsByBlock.get(blockId) ?? [];
		if (playLessonId !== undefined && owners.includes(playLessonId)) return playLessonId;
		return owners[0];
	}

	const bridge = new PreviewBridge({
		onready: () => {
			booted = true;
			failed = false;
		},
		onclicked: (ref) => {
			// Click-to-edit: a tap in Náhled selects the field behind it and brings it
			// into view — the author clicked something they want to change. A played
			// run sends one only for a branch into a card outside the lesson.
			const shown = store.toView(ref);
			const owner = view === 'play' ? lessonOf(shown.blockId) : (ref.lessonId ?? lessonId);
			store.revealAt({ ...shown, lessonId: owner });
		},
		onstepChanged: (stepId, blockId, shownStepIds) => {
			// Only a played run reports positions; one arriving after the author
			// switched back to Náhled is from a run that is over.
			if (view !== 'play') return;
			// Folding first, so the step list never draws the new card fully open.
			const card = store.toView({ blockId }).blockId!;
			stepView.followRun(card, reachedSteps(blockId, shownStepIds));
			store.follow({ lessonId: lessonOf(card), blockId: card, stepId });
		},
		onnavState: (value) => (canGoBack = value)
	});

	// Ask whether the player is there before mounting the iframe. Without this the
	// frame renders whatever the origin serves at that path — in development, a 404
	// page complete with this app's own stylesheet.
	$effect(() => {
		let cancelled = false;
		fetch(PLAYER_URL, { method: 'GET', headers: { accept: 'text/html' } })
			.then((response) => {
				if (cancelled) return;
				available = response.ok;
				failed = response.ok ? false : 'missing';
			})
			.catch(() => {
				if (cancelled) return;
				available = false;
				failed = 'missing';
			});
		return () => {
			cancelled = true;
		};
	});

	// The step list stops showing the run when the column goes away with it.
	$effect(() => () => stepView.endRun());

	/**
	 * A served player that does not announce itself is loaded again, twice, before
	 * the column gives up and says so.
	 *
	 * A Flutter boot fetches a few megabytes, and one aborted request is enough to
	 * leave it dead: "WebAssembly compilation aborted", and a blank frame for good.
	 * It happened on a plain page open, which read as "the preview is empty". A new
	 * load usually succeeds. The failure is only shown once the retries are spent, so
	 * a slow first boot does not flash an error either.
	 */
	const BOOT_TIMEOUT_MS = 20_000;
	const BOOT_ATTEMPTS = 3;

	$effect(() => {
		if (frame === null) return;
		bridge.attach(frame);
		return () => bridge.detach();
	});

	// Folded, the watchdog is off (the frame is alive but nobody is waiting on it);
	// opening the column arms a fresh 20 s.
	$effect(() => {
		if (frame === null || collapsed === true) return;
		const timeout = setTimeout(() => {
			if (bridge.ready) return;
			if (untrack(() => attempt) + 1 < BOOT_ATTEMPTS) attempt++;
			else failed = 'stalled';
		}, BOOT_TIMEOUT_MS);
		return () => clearTimeout(timeout);
	});

	function retry() {
		failed = false;
		attempt++;
	}

	// Re-send whenever the content or the chosen mode changes. The iframe is never
	// reloaded — that is the whole point of the contract.
	$effect(() => {
		if (!booted) return;
		if (view === 'play') {
			if (playLessonId === undefined) return;
			bridge.showLesson(source, playLessonId, exportMode, serialise, playStart);
		} else if (block !== undefined) {
			// A folded column draws nothing anyone can see; it catches up when opened.
			// Only here: re-sending a played lesson would restart the run.
			if (collapsed === true) return;
			bridge.showBlocks(
				blocksOfCard(block.block_id),
				exportMode,
				(blocks) => serialise({ ...source, lessons: [], blocks }).blocks,
				'expanded',
				selectedStepId,
				blockLabels
			);
		}
	});

	/**
	 * A jump — from the validation panel, or from a click inside the preview itself —
	 * outlines its step immediately, without waiting for the debounce.
	 *
	 * Driven by the reveal counter and nothing else. The previous version said so in
	 * a comment and then read `store.selection` in the effect body, which Svelte
	 * tracks: every keystroke moves the selection to a fresh ref, so it fired on
	 * every keystroke. The routine case is carried by `setBlock` above; this is only
	 * for the jumps.
	 */
	$effect(() => {
		void store.reveal;
		const selection = untrack(() => store.selection);
		if (!booted || untrack(() => view) !== 'expanded' || selection?.stepId === undefined) return;
		bridge.highlight(store.toSource(selection));
	});
</script>

<aside
	class="preview"
	class:collapsed={collapsed === true}
	data-player={playerState}
	aria-label="Náhled pro žáka"
>
	<div class="inner" inert={collapsed === true}>
	<header>
		<Segmented
			label="Co je v náhledu"
			value={view}
			options={[
				{
					value: 'expanded',
					label: 'Náhled',
					title:
						'Celá karta najednou, včetně zpětné vazby, řešení a větvení. Aktualizuje se během psaní. Kliknutím do náhledu skočíš na odpovídající pole v editoru.'
				},
				{
					value: 'play',
					label: 'Vyzkoušet',
					title:
						'Projdi lekci od vybrané karty tak, jak ji potká žák: kroky se odkrývají po jednom, další se objeví až tlačítkem pod kartou. Zpětem se vrátíš a můžeš zkusit druhou větev.'
				}
			]}
			onchange={(next) => {
				if (next === 'play') {
					playStart = block === undefined ? undefined : blocksOfCard(block.block_id)[0]?.block_id;
					playLessonId = lessonId;
					canGoBack = false;
				} else {
					stepView.endRun();
				}
				view = next;
			}}
		/>
		<!-- Running has no chip: only the two states a teacher has to wait out or act on. -->
		{#if !booted && failed}
			<Chip tone="warning">přehrávač neběží</Chip>
		{:else if !booted && available === true}
			<Chip>spouští se…</Chip>
		{/if}

		{#if view === 'play' && booted}
			<div class="spacer"></div>
			<Button
				variant="ghost"
				size="s"
				disabled={!canGoBack}
				title="O krok zpět — můžeš zkusit jinou odpověď"
				onclick={() => bridge.back()}
			>
				← Zpět
			</Button>
			<Button
				variant="ghost"
				size="s"
				title="Znovu od karty, u které jsi začal/a"
				onclick={() => {
					canGoBack = false;
					bridge.restart();
				}}
			>
				Od začátku
			</Button>
		{/if}

		<div class="hide" bind:this={hideHost}>
			<Button
				variant="ghost"
				size="s"
				ariaLabel="Skrýt náhled"
				title="Skrýt náhled (Ctrl+Shift+B)"
				onclick={toggle}
			>
				<PanelRightClose size={16}></PanelRightClose>
			</Button>
		</div>
	</header>

	<div class="frame">
		{#if failed === 'stalled' && !booted}
			<div class="fallback">
				<p><strong>Přehrávač se nespustil.</strong></p>
				<p>
					Zkusili jsme ho načíst {BOOT_ATTEMPTS}× a pokaždé se zasekl — nejspíš
					přerušené spojení při stahování. Kurz se dál ukládá, jen ho teď nevidíš
					očima žáka.
				</p>
				<Button variant="secondary" size="s" onclick={retry}>Zkusit znovu</Button>
			</div>
		{:else if failed === 'missing' && !booted}
			<div class="fallback">
				<p><strong>Náhled zatím není k dispozici.</strong></p>
				<p>
					Náhled je skutečný přehrávač z aplikace, ne jeho napodobenina — proto potřebuje
					webový build aplikace obsluhovaný na <code>/player/</code> a v něm route
					<code>/preview</code>. Dokud tam není, edituj naslepo, nebo si kurz stáhni a otevři
					v aplikaci.
				</p>
			</div>
		{/if}
		{#if available === true && everRevealed && failed !== 'stalled'}
			{#key attempt}
				<iframe bind:this={frame} src={PLAYER_URL} title="Náhled kurzu očima žáka"></iframe>
			{/key}
		{/if}
	</div>

	</div>

	{#if collapsed === true}
		<button
			type="button"
			class="rail"
			bind:this={showButton}
			aria-label="Ukázat náhled"
			title="Ukázat náhled (Ctrl+Shift+B)"
			onclick={toggle}
		>
			<PanelRightOpen size={18}></PanelRightOpen>
			<span class="rail-text" aria-hidden="true">Náhled</span>
		</button>
	{/if}
</aside>

<style>
	.preview {
		position: relative;
		display: flex;
		flex-direction: column;
		width: var(--e-preview-width);
		flex: none;
		border-left: 1px solid var(--e-border);
		background: var(--surface);
		overflow: hidden;
	}

	/* No transition: animating the width would make the player lay itself out on every frame. */
	.preview.collapsed {
		width: var(--e-preview-rail);
	}

	/* Always the column's full size, whatever the window around it is. */
	.inner {
		display: flex;
		flex: 1;
		flex-direction: column;
		width: calc(var(--e-preview-width) - 1px);
		min-height: 0;
	}

	.hide {
		margin-left: auto;
	}

	.rail {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 14px 0;
		border: none;
		background: var(--surface);
		color: var(--e-text-muted);
		cursor: pointer;
	}

	.rail:hover {
		background: var(--surface-light);
		color: var(--e-text);
	}

	.rail-text {
		font: var(--type-meta-bold);
		writing-mode: vertical-rl;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 12px;
		border-bottom: 1px solid var(--e-border);
	}

	.spacer {
		flex: 1;
	}




	.frame {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	iframe {
		width: 100%;
		height: 100%;
		border: none;
	}

	.fallback {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 10px;
		padding: 24px;
		color: var(--e-text-muted);
		font-size: var(--text-s);
		line-height: 1.55;
	}

	code {
		font-family: var(--font-code);
		font-size: var(--text-xs);
		color: var(--e-text);
	}
</style>
