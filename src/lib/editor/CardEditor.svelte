<script lang="ts">
    /**
     * One card: a block and its steps.
     *
     * The editor column holds exactly one of these — the card selected in the tree —
     * so everything here is open. There is nothing to expand and no summary line,
     * because a card that is on screen is a card being worked on.
     *
     * What is *not* here is the card's configuration: length, practice enrolment, the
     * knowledge vector, the machinery. That is one click away in `CardSettings`. The
     * card-wide hint and help are there too: they are only the fallback for steps
     * that have none of their own, so the steps' ladders stay here and the card's
     * sits with the rest of its settings.
     */
    import {
        dragHandleZone,
        SHADOW_ITEM_MARKER_PROPERTY_NAME,
        SHADOW_PLACEHOLDER_ITEM_ID,
        type DndEvent,
    } from "svelte-dnd-action";
    import { tick } from "svelte";
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
    import { useStepView, useStore } from "$lib/ui/context";
    import { uniqueKeys } from "$lib/ui/keys";
    import {
        addStep,
        bindBlock,
        duplicateBlock,
        reorderSteps,
        setField,
        unbindBlock,
    } from "$lib/domain/commands";
    import { errorsCount, warningsCount } from "$lib/ui/plural";
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
    import { STEP_TYPES } from "$lib/lang";

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
            "Typ karty: Otázka. Kroky jsou v jedné bublině a žák je rovnou u otázky; další otázka se objeví, až odpoví na předchozí. Podle odpovědi ho lze poslat jinam.",
        exercise:
            "Typ karty: Cvičení — jedna karta uvnitř lekce. Jako Otázka, ale bez větvení. Nezaměňuj s typem celého kurzu „Cvičení“ v Nastavení kurzu ani se zařazením karty do denního opakování.",
    } as const;

    /**
     * What a step does to the student depends on the card it is in, and that is the
     * one thing the two "Otázka" affordances never said. From
     * `block_step_engine.dart`: a `display` card draws one step per bubble and only
     * as far as `_currentStepIndex`, so a step is a stop the student taps through;
     * a `question` or `exercise` card draws `_buildExerciseCard()` — one bubble that
     * grows as the student reaches each question (fork fix; it used to draw every
     * step at once) — and runs `_skipToNextQuestion()` on mount and after every
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

    /**
     * Open the card's settings when something outside the editor points at the
     * card's own hint or help — the question mark in the preview, or a validation
     * jump. Those two fields live in `CardSettings` now, and a card-level ref has no
     * `stepId`, so `StepEditor`'s reveal never matches it; without this the "?"
     * would report the right field and the screen would do nothing.
     */
    const revealedField = $derived(
        store.selection?.blockId === block?.block_id &&
            store.selection?.stepId === undefined
            ? store.selection?.field
            : undefined,
    );
    $effect(() => {
        // The reveal counter, not the selection: typing also moves the selection.
        void store.reveal;
        if (revealedField === "hint" || revealedField === "help") onsettings();
    });

    /**
     * The list `svelte-dnd-action` reorders. Each item carries a key that is unique
     * even when the document holds duplicate step ids, and the step itself.
     */
    interface StepItem {
        id: string;
        step: BlockStep;
        [SHADOW_ITEM_MARKER_PROPERTY_NAME]?: boolean;
    }
    const stepView = useStepView();
    const baseItems = $derived.by((): StepItem[] => {
        const keys = uniqueKeys(block.steps.map((s) => s.id));
        return block.steps.map((step, i) => ({ id: keys[i], step }));
    });
    let dragging = $state<StepItem[] | null>(null);
    const items = $derived(dragging ?? baseItems);
    /** The key of the step being carried — the placeholder has another id at first. */
    let carried = $state<string | null>(null);
    const keyOf = (item: StepItem) =>
        item[SHADOW_ITEM_MARKER_PROPERTY_NAME] &&
        item.id === SHADOW_PLACEHOLDER_ITEM_ID &&
        carried !== null
            ? carried
            : item.id;

    /**
     * A press on a step's handle, before the library has measured anything: fold
     * every step now, so the list it measures — and the gap it leaves for the
     * carried step — is the short one. Folding moves the handle, so the column is
     * scrolled by the same amount to keep it under the pointer; otherwise the step
     * would be picked up from wherever it landed.
     */
    async function grab(handle: HTMLElement) {
        if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
        const before = handle.getBoundingClientRect().top;
        stepView.dragging = true;
        await tick();
        const shift = handle.getBoundingClientRect().top - before;
        if (shift !== 0) scrollParent(handle)?.scrollBy({ top: shift });
        // A press that never became a drag gets no `finalize`.
        const release = () => {
            window.removeEventListener("pointerup", release);
            window.removeEventListener("keyup", release);
            if (dragging === null) stepView.dragging = false;
        };
        window.addEventListener("pointerup", release);
        window.addEventListener("keyup", release);
    }

    function scrollParent(node: HTMLElement): HTMLElement | null {
        for (let el = node.parentElement; el !== null; el = el.parentElement) {
            const overflow = getComputedStyle(el).overflowY;
            if (
                (overflow === "auto" || overflow === "scroll") &&
                el.scrollHeight > el.clientHeight
            )
                return el;
        }
        return document.scrollingElement as HTMLElement | null;
    }

    function onconsider(event: CustomEvent<DndEvent<StepItem>>) {
        carried = event.detail.info.id;
        dragging = event.detail.items;
    }

    function onfinalize(event: CustomEvent<DndEvent<StepItem>>) {
        dragging = null;
        carried = null;
        stepView.dragging = false;
        store.apply((d) =>
            reorderSteps(
                d,
                block.block_id,
                event.detail.items.map((item) => item.step.id),
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
        <!--
            A card without a length is not a mistake: the app then estimates the
            lesson at about four minutes a card, the way the XP beside this is derived
            from the steps. It was a warning on every new card, which a teacher could
            only clear by typing a number they did not have. The one case that does
            mislead a student — some cards of a lesson with a length and some without
            — is W_PARTIAL_DURATION, and it is said where the rest of the review is.
        -->
        <Chip
            tone="quiet"
            title={minutes === undefined
                ? "Délka není zadaná. Aplikace odhadne čas lekce zhruba na 4 minuty na kartu. Vlastní délku nastavíš v Nastavení karty."
                : "Očekávaný čas na kartu"}>
            {minutes === undefined ? "délka odhadem" : `${minutes} min`}
        </Chip>

        {#if issues.errors.length > 0}
            <Chip tone="error" title={errorsCount(issues.errors.length)}
                >{issues.errors.length}</Chip>
        {:else if issues.warnings.length > 0}
            <Chip
                tone="warning"
                title={warningsCount(issues.warnings.length)}
                >{issues.warnings.length}</Chip>
        {/if}

        <div class="spacer"></div>

        <Chip
            tone="quiet"
            title={xpIsDerived
                ? `Dopočteno z kroků: 8 XP za každý krok s otázkou, 1 XP za obsahový krok (${derivedBlockXp(block)} XP). Platí hned, i když je karta ještě rozepsaná. Vlastní hodnotu nastavíš v Nastavení karty.`
                : "Zadaná odměna"}>
            {xp} XP · {xpIsDerived ? "automaticky" : "vlastní hodnota"}
        </Chip>
    </header>
    <header>
        <!--
			Always visible, and it says what is behind it. A settings button that only
			appears on hover is a setting nobody finds.
		-->
        <Button
            variant="secondary"
            size="s"
            onclick={onsettings}
            title="Délka, nápověda ke kartě, zařazení, klasifikace">
            <Settings size={16}></Settings>
            Nastavení karty
        </Button>
        <Button
            variant="ghost"
            size="s"
            onclick={() =>
                store.apply((d, r) =>
                    duplicateBlock(d, block.block_id, lessonId, r),
                )}
            ariaLabel="Duplikovat kartu">
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
                    : "Odebere kartu z této lekce. Obsah zůstává v části Karty mimo lekci; smazat jde přes Smazat."}>
                <ListX size={16}></ListX>
                Odebrat z lekce
            </Button>
        {/if}
        <Button
            variant="danger"
            size="s"
            onclick={() => onrepairBlock(block.block_id)}
            title="Otevře potvrzení smazání karty z celého kurzu a opravu odkazů"
            ariaLabel="Smazat kartu">
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
        use:dragHandleZone={{
            items,
            flipDurationMs: 150,
            dropTargetStyle: {},
        }}
        {onconsider}
        {onfinalize}>
        {#each items as item, i (item.id)}
            <div class="step-wrap">
                <StepEditor
                    {doc}
                    {block}
                    step={item.step}
                    stepKey={keyOf(item)}
                    {lessonId}
                    position={i + 1}
                    ongrab={grab}
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
</style>
