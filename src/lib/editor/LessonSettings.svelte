<script lang="ts">
    /**
     * Everything about a lesson that is not one of its cards.
     *
     * The lesson used to own the top of the editor column — a title, five chips and a
     * row of fields, above the cards the author actually came to write. It is a
     * container, and a container's settings are worth one click, not permanent
     * residence at the top of the screen.
     *
     * Which fields exist is decided by the mode, from `$lib/ui/fields.ts`. The two
     * additions here are the didactics summary — the only place the tool tells an
     * author their lesson is under-explained — and the lesson's own removal, which
     * was reachable only by hovering a sidebar row.
     */
    import type { CourseV2 } from "$lib/domain/schema";
    import Modal from "$lib/ui/Modal.svelte";
    import Button from "$lib/ui/Button.svelte";
    import Chip from "$lib/ui/Chip.svelte";
    import FieldGroup from "$lib/ui/FieldGroup.svelte";
    import { useStore } from "$lib/ui/context";
    import { fieldsFor, allows } from "$lib/ui/fields";
    import {
        deleteLesson,
        duplicateLesson,
        setField,
    } from "$lib/domain/commands";
    import { lessonDidactics, lessonTotals } from "$lib/domain/derive";
    import { cardsCount } from "$lib/ui/plural";
    import { Copy, Trash } from "@lucide/svelte";

    interface Props {
        doc: CourseV2;
        lessonId: string;
        onclose: () => void;
    }
    let { doc, lessonId, onclose }: Props = $props();

    const store = useStore();
    const lesson = $derived(doc.lessons.find((l) => l.lesson_id === lessonId));
    const totals = $derived(
        lesson === undefined ? undefined : lessonTotals(lesson, store.index),
    );
    const didactics = $derived(
        lesson === undefined ? undefined : lessonDidactics(lesson, store.index),
    );

    const fields = $derived(fieldsFor("lesson", store.mode));
    const basics = $derived(fields.filter((f) => f.mode === "teacher"));
    const rest = $derived(fields.filter((f) => f.mode !== "teacher"));
    const showId = $derived(allows("block", "block_id", store.mode));

    const set = (field: string, value: unknown) =>
        store.apply((d) => setField(d, { lessonId, field }, value));
    const read = (path: string): unknown =>
        (lesson as Record<string, unknown> | undefined)?.[path];
</script>

{#snippet body()}
    {#if lesson === undefined}
        <p>Tato lekce v kurzu není.</p>
    {:else}
        <div class="fields">
            <FieldGroup fields={basics} {read} write={set} />
        </div>

        {#if totals !== undefined && didactics !== undefined}
            <section>
                <h3>Co v lekci je</h3>
                <div class="chips">
                    <Chip tone="quiet">{cardsCount(totals.blockCount)}</Chip>
                    <Chip tone={totals.durationPartial ? "warning" : "quiet"}>
                        {totals.durationMinutes} min{totals.durationEstimated
                            ? " (odhad)"
                            : ""}
                    </Chip>
                    <Chip tone="quiet">{totals.xp} XP</Chip>
                    <Chip
                        tone={didactics.wrongOptionFeedbackShare < 0.5
                            ? "warning"
                            : "quiet"}
                        title="Podíl chybných odpovědí, které žákovi řeknou, kde udělal chybu">
                        Zpětná vazba {Math.round(
                            didactics.wrongOptionFeedbackShare * 100,
                        )} %
                    </Chip>
                    <Chip
                        tone="quiet"
                        title="Podíl karet zařazených do denního opakování">
                        Cvičení {Math.round(didactics.practiceShare * 100)} %
                    </Chip>
                </div>
                {#if didactics.wrongOptionFeedbackShare < 0.5}
                    <p class="warn">
                        Většina chybných odpovědí žákovi neřekne, kde udělal
                        chybu. Zpětná vazba u možnosti je to jediné, co z chyby
                        udělá učení.
                    </p>
                {/if}
            </section>
        {/if}

        {#if rest.length > 0 || showId}
            <section>
                <h3>Technické</h3>
                {#if showId}
                    <div class="row">
                        <span class="label">Identifikátor</span>
                        <code>{lesson.lesson_id}</code>
                    </div>
                {/if}
                <div class="fields">
                    <FieldGroup fields={rest} {read} write={set} />
                </div>
            </section>
        {/if}
    {/if}
{/snippet}

{#snippet actions()}
    <Button
        variant="ghost"
        onclick={() => {
            store.apply((d, r) => duplicateLesson(d, lessonId, r));
            onclose();
        }}>
        <Copy size={16}></Copy>
        Duplikovat
    </Button>
    <Button
        variant="danger"
        onclick={() => {
            store.apply((d) => deleteLesson(d, lessonId));
            onclose();
        }}>
        <Trash size={16}></Trash>
        Smazat
    </Button>
    <div class="spacer"></div>
    <Button variant="secondary" onclick={onclose}>Hotovo</Button>
{/snippet}

<Modal title="Nastavení lekce" {onclose} children={body} footer={actions} />

<style>
    .fields {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    section {
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px dashed var(--e-border);
    }

    h3 {
        margin: 0 0 10px;
        color: var(--e-text-muted);
        font-family: var(--font-heading);
        font-size: var(--text-s);
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .warn {
        margin: 8px 0 0;
        color: var(--e-warning);
        font-size: var(--text-xs);
        line-height: 1.5;
    }

    .row {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 12px;
        align-items: start;
        margin-bottom: 12px;
    }

    .label {
        color: var(--e-text-muted);
        font-size: var(--text-s);
    }

    code {
        font-family: var(--font-code);
        font-size: var(--text-s);
        color: var(--e-text-faint);
    }

    .spacer {
        flex: 1;
    }
</style>
