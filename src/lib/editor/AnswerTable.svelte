<script lang="ts">
    /**
     * The answer table: one row per option, in the focus-reveal pattern. Everything is
     * read as text until the author moves into it — the point being that a question with
     * four options and four pieces of feedback should read like a question, not a form.
     *
     * Columns follow §8.2: the option text, what it is (the outcome verb), the mark
     * collected in quiz mode, the feedback the student sees after choosing it, and where
     * that answer leads.
     */
    import type { BlockStep, BlockV2, CourseV2 } from "$lib/domain/schema";
    import FocusField from "$lib/ui/FocusField.svelte";
    import Button from "$lib/ui/Button.svelte";
    import Chip from "$lib/ui/Chip.svelte";
    import GoToPicker from "./GoToPicker.svelte";
    import { useStore } from "$lib/ui/context";
    import { allows } from "$lib/ui/fields";
    import { refKey } from "$lib/domain/ref";
    import { addOption, deleteOption, setField } from "$lib/domain/commands";
    import { CircleCheck, Plus, Trash, X } from "@lucide/svelte";

    interface Props {
        doc: CourseV2;
        block: BlockV2;
        step: BlockStep;
    }
    let { doc, block, step }: Props = $props();

    const store = useStore();
    const options = $derived(step.question?.options ?? []);
    const branching = $derived(
        block.type === "question" && doc.export_type !== "exercise_v2",
    );
    const quizMarks = $derived(
        doc.export_type === "quiz_v2" || doc.quiz_evaluate === true,
    );
    const advanced = $derived(allows("option", "score_koef", store.mode));
    const fixedOptions = $derived(step.question?.type === "true_false");
    // Shared, content-independent tracks keep headings and all rows aligned.
    const tracks = $derived(
        [
            "36px",
            "minmax(0, 1.4fr)",
            ...(quizMarks ? ["3.5rem"] : []),
            "minmax(0, 1.6fr)",
            ...(branching ? ["minmax(0, 1fr)"] : []),
            advanced ? "5rem" : "2rem",
        ].join(" "),
    );

    const ref = (optionId: string, field: string) => ({
        blockId: block.block_id,
        stepId: step.id,
        optionId,
        field,
    });

    const set = (optionId: string, field: string, value: unknown) =>
        store.apply((d) => setField(d, ref(optionId, field), value));

    const issuesFor = (optionId: string) =>
        store.issuesAt({ blockId: block.block_id, stepId: step.id, optionId });

    function toggleChecked(optionId: string) {
        const option = options.find((o) => o.id === optionId);

        if (fixedOptions) {
            // True/false questions have exactly two options, one correct and one incorrect.
            // Toggling one flips the other.
            const other = options.find((o) => o.id !== optionId);
            if (option && other) {
                set(optionId, "is_correct", true);
                set(other.id, "is_correct", false);
            }
            return;
        }

        if (option) {
            if (
                option.is_correct &&
                options.filter((o) => o.is_correct).length === 1
            ) {
                // Don't allow unchecking the last correct option.
                return;
            }

            set(optionId, "is_correct", !option.is_correct);
        }
    }
</script>

<div class="answers" style:--answer-tracks={tracks}>
    <div class="head" aria-hidden="true">
        <span></span>
        <span>Odpověď</span>
        {#if quizMarks}<span>Známka</span>{/if}
        <span>Co se žák dozví</span>
        {#if branching}<span>Kam dál</span>{/if}
        <span></span>
    </div>

    {#each options as option (option.id)}
        {@const issues = issuesFor(option.id)}
        <div class="row">
            <div class="cell">
                <button
                    type="button"
                    class="verb"
                    class:correct={option.is_correct}
                    onclick={() => toggleChecked(option.id)}>
                    {#if option.is_correct}
                        <CircleCheck></CircleCheck>
                    {:else}
                        <X></X>
                    {/if}
                </button>
            </div>

            <div class="cell text">
                <FocusField
                    label="Text odpovědi"
                    value={option.text}
                    emptyText="Napiš odpověď…"
                    onchange={(v) => set(option.id, "text", v ?? "")}
                    disabled={fixedOptions}
                    ref={ref(option.id, "text")} />
            </div>

            {#if quizMarks}
                <div class="cell grade">
                    <select
                        class="mark"
                        aria-label="Známka za tuto odpověď"
                        value={option.mark ?? ""}
                        onchange={(e) =>
                            set(
                                option.id,
                                "mark",
                                e.currentTarget.value || undefined,
                            )}>
                        <option value="">—</option>
                        {#each ["1", "2", "3", "4", "5"] as mark (mark)}
                            <option value={mark}>{mark}</option>
                        {/each}
                    </select>
                </div>
            {/if}

            <div class="cell feedback">
                <FocusField
                    label="Zpětná vazba k této odpovědi"
                    value={option.feedback}
                    multiline
                    emptyText={option.is_correct === true
                        ? "Potvrď, proč je to správně…"
                        : "Pojmenuj chybu, která k této odpovědi vede…"}
                    ref={ref(option.id, "feedback")}
                    onchange={(v) => set(option.id, "feedback", v)} />
            </div>

            {#if branching}
                <div class="cell destination">
                    <GoToPicker
                        {doc}
                        {block}
                        stepId={step.id}
                        value={option.go_to}
                        onchange={(v) => set(option.id, "go_to", v)} />
                </div>
            {/if}

            <div class="cell actions">
                {#if advanced}
                    <FocusField
                        label="Podíl bodů za tuto odpověď"
                        value={option.score_koef === undefined
                            ? undefined
                            : String(option.score_koef)}
                        emptyText="1.0"
                        monospace
                        ref={ref(option.id, "score_koef")}
                        onchange={(v) =>
                            set(
                                option.id,
                                "score_koef",
                                v === undefined ? undefined : Number(v),
                            )} />
                {/if}
                {#if !fixedOptions}
                    <Button
                        variant="danger"
                        size="s"
                        onclick={() =>
                            store.apply((d) =>
                                deleteOption(
                                    d,
                                    block.block_id,
                                    step.id,
                                    option.id,
                                ),
                            )}>
                        <Trash size={14}></Trash>
                    </Button>
                {/if}
            </div>
        </div>
    {/each}

    {#if !fixedOptions}
        <div class="add">
            <Button
                variant="secondary"
                size="s"
                onclick={() =>
                    store.apply((d) => addOption(d, block.block_id, step.id))}>
                <Plus size={14} />
                Další odpověď
            </Button>
        </div>
    {/if}
</div>

<style>
    .answers {
        container: answers / inline-size;
        min-width: 0;
        overflow-wrap: anywhere;
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 12px;
    }

    .head,
    .row {
        display: grid;
        grid-template-columns: var(--answer-tracks);
        gap: 12px;
        align-items: start;
    }

    .head {
        padding: 0 8px 4px;
        color: var(--e-text-faint);
        font: var(--type-chip-label);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .row {
        padding: 8px;
        border-radius: var(--radius-s);
    }

    /*
	 * The row tint and a field's resting tint are the same colour, so a hovered row
	 * would swallow the fields inside it. Deepen the row and flip the fields to the
	 * surface colour instead — they pop out of the row rather than dissolving into
	 * it. This works only because the field reads its resting fill from a variable.
	 */
    .row:hover,
    .row:focus-within {
        background: var(--primary-dark-08);
        --e-field-rest: var(--surface);
        --e-field-hover: var(--surface);
    }

    .row.invalid {
        box-shadow: inset 2px 0 0 var(--e-error);
    }

    .cell {
        min-width: 0;
        font-size: var(--text-m);
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }

    /* The editor can be narrow even on a desktop with both sidebars open. */
    @container answers (max-width: 760px) {
        .head {
            display: none;
        }

        .row {
            grid-template-columns: minmax(0, 1fr);
            gap: 10px;
            border-bottom: 1px solid var(--e-border);
        }

        .cell::before {
            display: block;
            margin-bottom: 4px;
            color: var(--e-text-faint);
            font: var(--type-chip-label);
        }

        .text::before {
            content: "Odpověď";
        }
        .feedback::before {
            content: "Co se žák dozví";
        }
        .destination::before {
            content: "Kam dál";
        }
        .grade::before {
            content: "Známka";
        }
    }

    .verb {
        border: 1px solid var(--e-border);
        border-radius: var(--radius-pill);
        background: var(--surface);
        color: var(--e-text-muted);
        font: var(--type-chip-label);
        cursor: pointer;
        display: flex;
        align-items: center;
        width: 36px;
        height: 36px;
    }

    .verb.correct {
        border-color: transparent;
        background: var(--e-ok-bg);
        color: var(--e-ok);
    }

    .mark {
        padding: 3px 6px;
        border: 1px solid var(--e-border);
        border-radius: var(--radius-xs);
        background: var(--surface);
        font-family: var(--font-body);
        font-size: var(--text-s);
    }

    .remove {
        padding: 0 6px;
        border: none;
        border-radius: var(--radius-xs);
        background: none;
        color: var(--e-text-faint);
        font-size: var(--text-xl);
        line-height: 1;
        cursor: pointer;
    }

    .remove:hover {
        background: var(--e-error-bg);
        color: var(--e-error);
    }

    .add {
        align-self: flex-start;
        margin-top: 6px;
    }

    .issue {
        margin: 0 0 4px 8px;
        color: var(--e-error);
        font-size: var(--text-xs);
    }

    .issue.warning {
        color: var(--e-warning);
    }

    .note {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin: 8px 0 0;
        color: var(--e-text-faint);
        font-size: var(--text-xs);
    }
</style>
