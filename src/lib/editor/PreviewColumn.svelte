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
	 */
	import { untrack } from 'svelte';
	import type { BlockV2, CourseV2, ExportType } from '$lib/domain/schema';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { PreviewBridge, type PreviewView } from '$lib/preview/bridge';
	import { serialise } from '$lib/domain/document';
	import { useStepView, useStore } from '$lib/ui/context';
	import { allows } from '$lib/ui/fields';
	import { blockPreview } from '$lib/domain/derive';

	interface Props {
		doc: CourseV2;
		block: BlockV2 | undefined;
		lessonId: string | undefined;
	}
	let { doc, block, lessonId }: Props = $props();

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
	let failed = $state(false);
	let canGoBack = $state(false);
	/** Undecided until the player URL has been probed — see below. */
	let available = $state<boolean | null>(null);

	const PLAYER_URL = '/player/preview';

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

	/**
	 * What to call the other cards a branch leads to. The player holds one card and
	 * cannot look another one up; left to itself it would print the `block_id`, which
	 * a teacher must never be shown (plan §8). So the naming is decided here, by the
	 * same rule the rest of the editor uses.
	 */
	const blockLabels = $derived.by(() => {
		const showIds = allows('block', 'block_id', store.mode);
		const labels: Record<string, string> = {};
		for (const candidate of doc.blocks) {
			if (showIds) {
				labels[candidate.block_id] = candidate.block_id;
				continue;
			}
			labels[candidate.block_id] = blockPreview(candidate, 30);
		}
		return labels;
	});

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
			const owner = view === 'play' ? lessonOf(ref.blockId) : (ref.lessonId ?? lessonId);
			store.revealAt({ ...ref, lessonId: owner });
		},
		onstepChanged: (stepId, blockId, shownStepIds) => {
			// Only a played run reports positions; one arriving after the author
			// switched back to Náhled is from a run that is over.
			if (view !== 'play') return;
			// Folding first, so the step list never draws the new card fully open.
			stepView.followRun(blockId, shownStepIds);
			store.follow({ lessonId: lessonOf(blockId), blockId, stepId });
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
				failed = !response.ok;
			})
			.catch(() => {
				if (cancelled) return;
				available = false;
				failed = true;
			});
		return () => {
			cancelled = true;
		};
	});

	// The step list stops showing the run when the column goes away with it.
	$effect(() => () => stepView.endRun());

	$effect(() => {
		if (frame === null) return;
		bridge.attach(frame);
		// If the player is served but never announces itself, something is wrong
		// inside it rather than around it.
		const timeout = setTimeout(() => {
			if (!bridge.ready) failed = true;
		}, 8000);
		return () => {
			clearTimeout(timeout);
			bridge.detach();
		};
	});

	// Re-send whenever the content or the chosen mode changes. The iframe is never
	// reloaded — that is the whole point of the contract.
	$effect(() => {
		if (!booted) return;
		if (view === 'play') {
			if (playLessonId === undefined) return;
			bridge.showLesson(doc, playLessonId, exportMode, serialise, playStart);
		} else if (block !== undefined) {
			bridge.showBlock(
				block,
				exportMode,
				(b) => serialise({ ...doc, lessons: [], blocks: [b] }).blocks,
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
		bridge.highlight(selection);
	});
</script>

<aside class="preview" aria-label="Náhled pro žáka">
	<header>
		<Segmented
			label="Co je v náhledu"
			value={view}
			options={[
				{
					value: 'expanded',
					label: 'Náhled',
					title: 'Celá karta najednou, včetně zpětné vazby, řešení a větvení. Kliknutím skočíš na pole v editoru.'
				},
				{
					value: 'play',
					label: 'Vyzkoušet',
					title: 'Projdi lekci od vybrané karty tak, jak ji potká žák'
				}
			]}
			onchange={(next) => {
				if (next === 'play') {
					playStart = block?.block_id;
					playLessonId = lessonId;
					canGoBack = false;
				} else {
					stepView.endRun();
				}
				view = next;
			}}
		/>
		{#if booted}
			<Chip tone="ok">Náhled</Chip>
		{:else if failed}
			<Chip tone="warning">přehrávač neběží</Chip>
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
	</header>

	<div class="frame">
		{#if failed && !booted}
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
		{#if available === true}
			<iframe bind:this={frame} src={PLAYER_URL} title="Náhled kurzu očima žáka"></iframe>
		{/if}
	</div>

	<footer>
		<span class="hint">
			{#if view === 'expanded'}
				Náhled se aktualizuje během psaní. Kliknutím do něj skočíš na odpovídající pole v editoru.
			{:else}
				Odpovídej jako žák: kroky se odkrývají po jednom, další se objeví až tlačítkem pod
				kartou. Zpětem se vrátíš a můžeš zkusit druhou větev.
			{/if}
		</span>
	</footer>
</aside>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		width: var(--e-preview-width);
		flex: none;
		border-left: 1px solid var(--e-border);
		background: var(--surface);
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

	footer {
		padding: 10px 12px;
		border-top: 1px solid var(--e-border);
	}

	.hint {
		color: var(--e-text-faint);
		font-size: var(--text-xs);
	}
</style>
