<script lang="ts">
    /**
     * One card: a block, its steps, and the two texts the app's question mark reads.
     *
     * The editor column holds exactly one of these — the card selected in the tree —
     * so everything here is open. There is nothing to expand and no summary line,
     * because a card that is on screen is a card being worked on.
     *
     * What is *not* here is the card's configuration: length, practice enrolment, the
     * knowledge vector, the machinery. That is one click away in `CardSettings`. The
     * line between them is what the student experiences: steps, hint and help are
     * read by a pupil, so they are content and they stay visible; the rest describes
     * the card to the platform.
     */
    import { dndzone, type DndEvent } from "svelte-dnd-action";
    import type {
        BlockStep,
        BlockV2,
        CourseV2,
        LessonBlockBinding,
        StepType,
    } from "$lib/domain/schema";
    import Card from "$lib/ui/Card.svelte";
    import Chip from "$lib/ui/Chip.svelte";
    import Button from "$lib/ui/Button.svelte";
    import Modal from "$lib/ui/Modal.svelte";
    import type { UndoEntry } from "$lib/state/doc-store.svelte";
    import type { Ref } from "$lib/domain/ref";
    import FocusField from "$lib/ui/FocusField.svelte";
    import StepEditor from "./StepEditor.svelte";
    import { useStore } from "$lib/ui/context";
    import { refKey } from "$lib/domain/ref";
    import { fieldSpec } from "$lib/ui/fields";
    import {
        addStep,
        bindBlock,
        duplicateBlock,
        reorderSteps,
        setField,
        unbindBlock,
    } from "$lib/domain/commands";
    import { errorsCount } from "$lib/ui/plural";
    import {
        blockDurationMinutes,
        derivedBlockXp,
        effectiveBlockXp,
        isPracticeBlock,
    } from "$lib/domain/derive";
    import {
        BookOpenText,
        Copy,
        Dumbbell,
        ListPlus,
        ListX,
        MessageCircleQuestionMark,
        Settings,
        Trash,
    } from "@lucide/svelte";
    import { CARD_STATUSES, STEP_TYPES } from "$lib/lang";

    interface Props {
        doc: CourseV2;
        block: BlockV2;
        /** Absent for a card bound to no lesson — it is editable, just unreachable. */
        binding?: LessonBlockBinding;
        lessonId?: string;
        onsettings: () => void;
        onrepairBlock: (blockId: string) => void;
        onrepairStep: (blockId: string, stepId: string) => void;
    }
    let {
        doc,
        block,
        binding,
        lessonId,
        onsettings,
        onrepairBlock,
        onrepairStep,
    }: Props = $props();

    const store = useStore();
    const issues = $derived(store.issuesAt({ blockId: block.block_id }));
    const boundLessons = $derived(
        doc.lessons.filter((lesson) =>
            lesson.blocks.some(
                (binding) => binding.block_id === block.block_id,
            ),
        ),
    );
    const sharedWith = $derived(boundLessons.length);
    const availableLessons = $derived(
        doc.lessons.filter(
            (lesson) =>
                !lesson.blocks.some(
                    (binding) => binding.block_id === block.block_id,
                ),
        ),
    );
    let showLessonPicker = $state(false);
    let targetLessonId = $state("");
    let notice = $state<{ message: string; entry: UndoEntry; ref: Ref } | null>(
        null,
    );
    // Never let a stale notice undo a later, unrelated edit.
    const activeNotice = $derived(
        notice !== null && store.undoStack.at(-1) === notice.entry
            ? notice
            : null,
    );
    const xp = $derived(effectiveBlockXp(block));
    const xpIsDerived = $derived(typeof block.xp !== "number");
    const minutes = $derived(blockDurationMinutes(block));

    const set = (field: string, value: unknown) =>
        store.apply((d) =>
            setField(d, { blockId: block.block_id, field }, value),
        );

    const typeLabel = {
        display: "Výklad",
        question: "Otázka",
        exercise: "Cvičení",
    } as const;
    const typeIcon = {
        display: BookOpenText,
        question: MessageCircleQuestionMark,
        exercise: Dumbbell,
    } as const;

    /** What this card's type does to the student — see `stepTitle` below for why. */
    const TYPE_TITLE = {
        display:
            "Typ karty: Výklad. Žák prochází kroky po jednom a mezi nimi kliká Pokračovat.",
        question:
            "Typ karty: Otázka. Všechny kroky jsou v jedné bublině a žák je rovnou u otázky; podle odpovědi ho lze poslat jinam.",
        exercise:
            "Typ karty: Cvičení — jedna karta uvnitř lekce. Jako Otázka, ale bez větvení. Nezaměňuj s typem celého kurzu „Cvičení“ v Nastavení kurzu ani se zařazením karty do denního opakování.",
    } as const;

    /**
     * What a step does to the student depends on the card it is in, and that is the
     * one thing the two "Otázka" affordances never said. From
     * `block_step_engine.dart`: a `display` card draws one step per bubble and only
     * as far as `_currentStepIndex`, so a step is a stop the student taps through;
     * a `question` or `exercise` card draws `_buildExerciseCard()` — all steps in a
     * single bubble — and runs `_skipToNextQuestion()` on mount and after every
     * answer, so content steps are passive context and the student starts at the
     * question. Branching (`go_to`) is honoured for `question` and ignored for
     * `exercise` (`step_navigation.dart`).
     *
     * So the same question is a pause inside a reading in one case and the whole
     * point of the card in the other — which is the choice a teacher is making here
     * without being told.
     */
    const CONTENT_STEP_TITLE = $derived(
        block.type === "display"
            ? "Samostatná zastávka: žák uvidí tenhle krok, klikne Pokračovat a teprve pak se objeví další."
            : "V téhle kartě není obsahový krok zastávka — zobrazí se v jedné bublině spolu s otázkou jako její zadání a žák jde rovnou odpovídat. Když se má žák zastavit a číst, patří text do karty typu Výklad.",
    );
    const stepTitle = (type: StepType) =>
        type !== "question"
            ? CONTENT_STEP_TITLE
            : block.type === "display"
              ? "Otázka uvnitř výkladu: žák si přečte kroky nad ní, odpoví, a teprve pak se mu ukáže další krok. Slouží ke kontrole čtení. Má-li odpověď rozhodnout, co bude dál, udělej z otázky vlastní kartu typu Otázka — celou ji pak žák vidí jako jednu otázku a podle odpovědi ho lze poslat jinam."
              : block.type === "exercise"
                ? "Další úloha v téže bublině. Po odpovědi žák pokračuje rovnou na ni; větvení se v kartě typu Cvičení ignoruje, pořadí je vždy stejné."
                : "Další otázka v téže bublině. Po odpovědi žák pokračuje rovnou na ni, nebo tam, kam ho pošle větvení u zvolené možnosti.";

    const hintSpec = fieldSpec("block", "hint");
    const helpSpec = fieldSpec("block", "help");

    /**
     * Bring the card's own hint or help into view when something outside the editor
     * points at it — the question mark in the preview, or a validation jump.
     *
     * A card-level hint is addressed without a `stepId` (it belongs to the card, not
     * to any one step), so `StepEditor`'s reveal never matches it. Without this the
     * "?" in the preview reported the right field and the screen did nothing, which
     * reads exactly like a dead button.
     */
    let ladder = $state<HTMLElement | null>(null);
    const revealedField = $derived(
        store.selection?.blockId === block?.block_id &&
            store.selection?.stepId === undefined
            ? store.selection?.field
            : undefined,
    );
    $effect(() => {
        // The reveal counter, not the selection: typing also moves the selection, and
        // scrolling on every keystroke would be unusable.
        void store.reveal;
        if (
            ladder !== null &&
            (revealedField === "hint" || revealedField === "help")
        ) {
            ladder.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    });

    // svelte-dnd-action needs an `id` on each item; steps already have one.
    let dragging = $state<BlockStep[] | null>(null);
    const items = $derived(dragging ?? block.steps);

    function onconsider(event: CustomEvent<DndEvent<BlockStep>>) {
        dragging = event.detail.items;
    }

    function onfinalize(event: CustomEvent<DndEvent<BlockStep>>) {
        dragging = null;
        store.apply((d) =>
            reorderSteps(
                d,
                block.block_id,
                event.detail.items.map((s) => s.id),
            ),
        );
    }

    function showNotice(message: string, ref: Ref) {
        const entry = store.undoStack.at(-1);
        if (entry !== undefined) notice = { message, entry, ref };
    }

    function removeFromLesson() {
        if (lessonId === undefined || binding === undefined) return;
        const blockId = block.block_id;
        const fromLessonId = lessonId;
        const name =
            doc.lessons.find((lesson) => lesson.lesson_id === fromLessonId)
                ?.name ?? fromLessonId;
        // Only this binding changes. Shared cards and incoming references stay intact.
        const result = store.apply((d) => ({
            ...unbindBlock(d, fromLessonId, blockId),
            ref: { blockId },
        }));
        const remaining = result.doc.lessons.filter((lesson) =>
            lesson.blocks.some((binding) => binding.block_id === blockId),
        );
        const location =
            remaining.length === 0
                ? "Karta je nyní v části Karty mimo lekci."
                : `Karta zůstává v lekcích (${remaining.length}): ${remaining.map((lesson) => `„${lesson.name}“`).join(", ")}.`;
        showNotice(
            `Karta odebrána z lekce „${name}“. ${location} Obsah ani odkazy se nesmazaly.`,
            { lessonId: fromLessonId, blockId },
        );
    }

    function assignToLesson() {
        if (
            !availableLessons.some(
                (lesson) => lesson.lesson_id === targetLessonId,
            )
        )
            return;
        const blockId = block.block_id;
        const name = availableLessons.find(
            (lesson) => lesson.lesson_id === targetLessonId,
        )!.name;
        store.apply((d) => bindBlock(d, targetLessonId, blockId));
        showLessonPicker = false;
        showNotice(`Karta zařazena do lekce „${name}“.`, { blockId });
    }
</script>

<Card tone={binding?.bg_color}>
    <header>
        <Chip tone="accent" title={TYPE_TITLE[block.type]}>
            {@const Icon = typeIcon[block.type]}
            <Icon size={16}></Icon>
            {typeLabel[block.type]}
        </Chip>

        {#if isPracticeBlock(block, binding?.default_practice === true)}
            <!--
				This chip is the practice queue, not the card's type — and on a card of
				type Cvičení the two chips sat next to each other reading the same word.
			-->
            <Chip
                tone="quiet"
                title="Karta je zařazená do denního opakování (Cvičení) — žák ji dostane znovu podle plánu opakování. S typem karty to nesouvisí; zapíná se v Nastavení karty.">
                Opakování
            </Chip>
        {/if}
        {#if sharedWith > 1}
            <Chip
                tone="warning"
                title="Blok je i v jiné lekci — úprava se projeví všude">
                Sdílený ({sharedWith}×)
            </Chip>
        {/if}
        {#if block.status !== undefined && block.status !== "published"}
            <!--
				What this actually does to a student is not something the editor can
				claim. `block.status` is carried through the format, but neither the
				Flutter app (`block_model.dart` never parses it) nor the API filters on
				it, so the chip used to promise a skip that nothing performs. It says
				what is true — the card is not marked finished — and leaves the
				consequence to whoever starts honouring the field.
			-->
            <Chip
                tone="warning"
                title="Karta zatím není označená jako hotová. Aplikace ji žákovi zobrazí jako kteroukoli jinou — je to poznámka pro tebe, ne nastavení pro žáka.">
                {CARD_STATUSES.find((s) => s.value === block.status)?.label}
            </Chip>
        {/if}
        <Chip
            tone={minutes === undefined ? "warning" : "quiet"}
            title={minutes === undefined
                ? "Bez délky se čas lekce spočítá špatně"
                : "Očekávaný čas na kartu"}>
            {minutes === undefined ? "Bez délky" : `${minutes} min`}
        </Chip>

        {#if issues.errors.length > 0}
            <Chip tone="error">{issues.errors.length}</Chip>
        {:else if issues.warnings.length > 0}
            <Chip tone="warning">{issues.warnings.length}</Chip>
        {/if}

        <div class="spacer"></div>

        <Chip
            tone="quiet"
            title={xpIsDerived
                ? `Dopočteno z kroků (${derivedBlockXp(block)} XP). Vyplň XP, pokud chceš jinou odměnu.`
                : "Zadaná odměna"}>
            {xp} XP · {xpIsDerived ? "automaticky" : "vlastní hodnota"}
        </Chip>
        <!-- {#if xpIsDerived}
            <!--
				The counter jumps by 8 the moment a question step exists — even on a card
				that is still empty. Without this line that reads as a bug; the figure is
				the §10 default, and it counts unfinished cards the same as finished ones.
			->
            <span class="xp-note">
                automaticky z kroků: 8 XP za každý krok s otázkou, 1 XP za
                obsahový krok — platí hned, i když je karta ještě rozepsaná.
                Vlastní hodnotu nastavíš v Nastavení karty.
            </span>
        {/if} -->
    </header>
    <header>
        <!--
			Always visible, and it says what is behind it. A settings button that only
			appears on hover is a setting nobody finds; one with an unread warning on
			it — a card with no length breaks the lesson's clock — is worth opening.
		-->
        <Button
            variant="secondary"
            size="s"
            onclick={onsettings}
            title={minutes === undefined
                ? "Karta nemá délku — čas lekce se spočítá špatně"
                : "Délka, zařazení, klasifikace"}>
            <Settings size={16}></Settings>
            Nastavení karty{#if minutes === undefined}<span
                    class="dot"
                    aria-label="něco chybí"></span
                >{/if}
        </Button>
        <Button
            variant="ghost"
            size="s"
            onclick={() =>
                store.apply((d, r) =>
                    duplicateBlock(d, block.block_id, lessonId, r),
                )}>
            <Copy size={16}></Copy>
            Duplikovat
        </Button>
        {#if sharedWith === 0}
            <Button
                variant="ghost"
                size="s"
                onclick={() => {
                    targetLessonId = "";
                    showLessonPicker = true;
                }}
                disabled={availableLessons.length === 0}
                title={availableLessons.length === 0
                    ? "Nejprve vytvoř lekci"
                    : "Zařadit existující kartu do lekce bez kopírování obsahu"}>
                <ListPlus size={16}></ListPlus>
                Zařadit do lekce
            </Button>
        {:else if binding !== undefined && lessonId !== undefined}
            <Button
                variant="danger"
                size="s"
                onclick={removeFromLesson}
                title={sharedWith > 1
                    ? "Odebere kartu jen z této lekce — ostatní lekce a všechen obsah zůstanou"
                    : "Odebere kartu z této lekce. Obsah zůstává v části Karty mimo lekci; smazat jde přes Smazat kartu…"}>
                <ListX size={16}></ListX>
                Odebrat z lekce
            </Button>
        {/if}
        <Button
            variant="danger"
            size="s"
            onclick={() => onrepairBlock(block.block_id)}
            title="Otevře potvrzení smazání karty z celého kurzu a opravu odkazů">
            <Trash size={16}></Trash>
            Smazat
        </Button>
    </header>

    {#if activeNotice}
        <div class="action-notice" role="status">
            <span>{activeNotice.message}</span>
            <Button
                variant="secondary"
                size="s"
                onclick={() => {
                    const current = activeNotice;
                    if (current === null) return;
                    store.undo();
                    store.selection = current.ref;
                    notice = null;
                }}>Vrátit zpět</Button>
        </div>
    {/if}

    <div
        class="steps"
        use:dndzone={{ items, flipDurationMs: 150, dropTargetStyle: {} }}
        {onconsider}
        {onfinalize}>
        {#each items as step, i (step.id)}
            <div class="step-wrap">
                <StepEditor
                    {doc}
                    {block}
                    {step}
                    position={i + 1}
                    onrepair={onrepairStep} />
            </div>
        {/each}
    </div>

    <div class="add-step">
        <span class="add-label">Přidat krok:</span>
        {#each STEP_TYPES as option (option.type)}
            <Button
                variant="secondary"
                size="s"
                title={stepTitle(option.type)}
                onclick={() =>
                    store.apply((d, r) =>
                        addStep(d, block.block_id, option.type, undefined, r),
                    )}>
                {@const Icon = option.icon}
                <Icon size={14}></Icon>
                {option.label}
            </Button>
        {/each}
    </div>

    <!--
		The card-wide help ladder: used when a step has none of its own. Inline for the
		same reason the step's is — the app escalates to it, and a course whose help
		button leads nowhere is a course with a broken button.
	-->
    <div class="help-ladder" bind:this={ladder}>
        <h4>Nápověda pro celou kartu</h4>
        <div class="field-row" class:targeted={revealedField === "hint"}>
            <span class="field-label"
                >{hintSpec?.label ?? "Nápověda ke kartě"}</span>
            <div class="control">
                <FocusField
                    label={hintSpec?.label ?? "Nápověda ke kartě"}
                    value={block.hint}
                    multiline
                    emptyText="nevyplněno"
                    ref={{ blockId: block.block_id, field: "hint" }}
                    onchange={(v) => set("hint", v)} />
                <span class="hint">{hintSpec?.hint}</span>
            </div>
        </div>
        <div class="field-row" class:targeted={revealedField === "help"}>
            <span class="field-label"
                >{helpSpec?.label ?? "Podrobná pomoc"}</span>
            <div class="control">
                <FocusField
                    label={helpSpec?.label ?? "Podrobná pomoc"}
                    value={block.help}
                    multiline
                    emptyText="nevyplněno"
                    ref={{ blockId: block.block_id, field: "help" }}
                    onchange={(v) => set("help", v)} />
                <span class="hint">{helpSpec?.hint}</span>
            </div>
        </div>
    </div>
</Card>

{#if showLessonPicker}
    <Modal title="Zařadit do lekce" onclose={() => (showLessonPicker = false)}>
        <p>Vyber lekci pro tuto kartu. Její obsah se nebude kopírovat.</p>
        <label class="lesson-picker">
            Lekce
            <select bind:value={targetLessonId}>
                <option value="" disabled>Vyber lekci…</option>
                {#each availableLessons as lesson (lesson.lesson_id)}
                    <option value={lesson.lesson_id}>{lesson.name}</option>
                {/each}
            </select>
        </label>
        {#snippet footer()}
            <Button variant="ghost" onclick={() => (showLessonPicker = false)}
                >Zpět</Button>
            <Button
                disabled={!availableLessons.some(
                    (lesson) => lesson.lesson_id === targetLessonId,
                )}
                onclick={assignToLesson}>Zařadit</Button>
        {/snippet}
    </Modal>
{/if}

<style>
    /* .xp-note {
        color: var(--e-text-muted);
        font-size: var(--text-xs);
        line-height: 1.5;
    } */

    .action-notice {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        padding: 10px;
        border-radius: var(--radius-s);
        background: var(--info-bg);
        font-size: var(--text-s);
    }

    .lesson-picker {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .lesson-picker select {
        padding: 8px;
        border: 1px solid var(--e-border);
        border-radius: var(--radius-s);
        background: var(--surface);
        color: var(--e-text);
        font: inherit;
    }

    header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-bottom: 12px;
    }

    .spacer {
        flex: 1;
    }

    .dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-left: 5px;
        border-radius: 50%;
        background: var(--e-warning);
        vertical-align: middle;
    }

    .steps {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 12px;
    }

    .step-wrap:focus {
        outline: none;
    }

    .add-step {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
    }

    .add-label {
        margin-right: 2px;
        color: var(--e-text-faint);
        font-size: var(--text-xs);
    }

    .help-ladder {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px solid var(--e-border);
    }

    h4 {
        margin: 0;
        color: var(--e-text-muted);
        font-family: var(--font-heading);
        font-size: var(--text-s);
    }

    .field-row {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 12px;
        align-items: start;
        font-size: var(--text-m);
    }

    .field-row.targeted {
        margin: -6px -10px;
        padding: 6px 10px;
        border-radius: var(--radius-s);
        box-shadow: 0 0 0 2px var(--primary);
    }

    .field-label {
        padding-top: 6px;
        color: var(--e-text-muted);
        font-size: var(--text-s);
    }

    .control {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .hint {
        overflow: hidden;
        color: var(--e-text-faint);
        font-size: var(--text-xs);
        line-height: 1.5;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .issue {
        margin: 10px 0 0;
        color: var(--e-error);
        font-size: var(--text-xs);
    }

    .issue.warning {
        color: var(--e-warning);
    }
</style>
