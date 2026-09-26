<script lang="ts">
    import type { CourseV2 } from "$lib/domain/schema";
    import Chip from "$lib/ui/Chip.svelte";
    import Segmented from "$lib/ui/Segmented.svelte";
    import FocusField from "$lib/ui/FocusField.svelte";
    import Button from "$lib/ui/Button.svelte";
    import { useStore } from "$lib/ui/context";
    import { setField } from "$lib/domain/commands";
    import { serialiseToJson } from "$lib/domain/document";
    import { MODES, MODE_LABELS } from "$lib/ui/fields";
    import Modal from "$lib/ui/Modal.svelte";
    import ExportDialog from "./ExportDialog.svelte";
    import { errorsCount, warningsCount } from "$lib/ui/plural";

    import type { DraftSession } from "$lib/state/draft-session.svelte";
    import { CircleCheck, Download, Redo, Undo, Upload } from "@lucide/svelte";
    import { courseFileName } from "$lib/domain/filename";
    interface Props {
        doc: CourseV2;
        recovery: DraftSession | null;
        onvalidation: () => void;
        onimport: (file: File) => void;
        /** The export review; bindable so the page can open it from its own banner. */
        reviewOpen?: boolean;
    }
    let {
        doc,
        recovery,
        onvalidation,
        onimport,
        reviewOpen = $bindable(false),
    }: Props = $props();

    const store = useStore();
    let fileInput = $state<HTMLInputElement | null>(null);
    let explainStorage = $state(false);

    /**
     * The exact JSON handed to the browser by the last „Stáhnout JSON“.
     *
     * The draft lives in `localStorage` and nowhere else — no server holds a copy, so
     * clearing site data, a private window closing, or moving to another machine loses
     * everything that was never exported. The top bar said „Uloženo v tomto
     * prohlížeči“, which reads to a teacher like „saved“ and buries the
     * „in this browser“ half. So the bar now also says whether the work on screen has
     * ever left the browser, which is the part that can actually be lost.
     *
     * Comparing the serialised text rather than counting edits is what makes it
     * honest: type a sentence and undo it, and the file on disk is current again.
     */
    let exportedJson = $state<string | null>(null);
    const currentJson = $derived(serialiseToJson(store.doc));
    const backedUp = $derived(
        exportedJson !== null && exportedJson === currentJson,
    );

    function download() {
        // The dialog only offers a download without errors; this is the backstop.
        if (!store.canPublish) return;
        const json = currentJson;
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = courseFileName(doc.name, doc.course_id || "kurz");
        link.click();
        URL.revokeObjectURL(url);
        exportedJson = json;
    }

    /**
     * A clean course downloads at once. Anything else opens the review first: with
     * errors it says what to finish and where, with warnings only it offers
     * „Stáhnout i tak“. The button itself is never disabled — a greyed-out download
     * is a refusal that does not say why.
     */
    function requestDownload() {
        const { errors, warnings } = store.validation;
        if (errors.length === 0 && warnings.length === 0) download();
        else reviewOpen = true;
    }

    // Having seen the review, the author is fixing rather than writing: every issue
    // may now show where it is (`ui/issue-visibility.ts`).
    $effect(() => {
        if (reviewOpen) store.reviewing = true;
    });

    /** The chip shows a bare number; the accessible name has to say what it counts. */
    const checkLabel = $derived(
        store.validation.errors.length > 0
            ? `Kontrola kurzu: ${errorsCount(store.validation.errors.length)}`
            : store.validation.warnings.length > 0
              ? `Kontrola kurzu: ${warningsCount(store.validation.warnings.length)}`
              : "Kontrola kurzu: v pořádku",
    );
</script>

<header class="topbar">
    <div class="title">
        <FocusField
            label="Název kurzu"
            value={doc.name}
            density="compact"
            emptyText="Název kurzu"
            onchange={(v) =>
                store.apply((d) => setField(d, { field: "name" }, v))} />
    </div>

    <Chip tone="quiet" title="Verze, kterou dostane žák při aktualizaci"
        >v{doc.version ?? 1}</Chip>
    <button
        type="button"
        class="save-status"
        class:at-risk={!backedUp}
        onclick={() => (explainStorage = true)}
        title="Kurz je jen v tomto prohlížeči, ne na serveru. Klikni pro vysvětlení.">
        <span class="save-state" role="status">
            {#if recovery?.status === "saved"}Uloženo jen v tomto prohlížeči
            {:else if recovery?.status === "error"}Koncept se nepodařilo uložit
            {:else if recovery?.status === "blocked"}Ukládání pozastaveno
            {:else}Ukládání…{/if}
        </span>
        <span class="backup">
            {#if backedUp}Stáhnuto do souboru{:else}Bez zálohy v souboru{/if}
        </span>
    </button>

    <div class="spacer"></div>

    <Chip tone="quiet" title="Celkový čas kurzu"
        >{store.totals.durationMinutes} min</Chip>
    <Chip tone="quiet" title="Nejvyšší možný zisk XP za celý kurz"
        >{store.totals.cappedXp} XP</Chip>

    <button
        type="button"
        class="chip-button"
        onclick={onvalidation}
        aria-label={checkLabel}
        title={checkLabel}>
        <!--
            Quiet while the course is being written: an unfinished draft is not an
            emergency. It turns red once the author has asked to export and seen
            what is left, which is when the count starts to mean "still to fix".
        -->
        {#if store.validation.errors.length > 0 && !store.reviewing}
            <Chip tone="quiet"
                >{store.validation.errors.length} k dokončení</Chip>
        {:else if store.validation.errors.length > 0}
            <Chip tone="error">{store.validation.errors.length}</Chip>
        {:else if store.validation.warnings.length > 0 && !store.reviewing}
            <Chip tone="quiet"
                >{store.validation.warnings.length} doporučení</Chip>
        {:else if store.validation.warnings.length > 0}
            <Chip tone="warning">{store.validation.warnings.length}</Chip>
        {:else}
            <Chip tone="ok"><CircleCheck size={16}></CircleCheck> 0</Chip>
        {/if}
    </button>

    <Segmented
        label="Režim editoru"
        value={store.mode}
        options={MODES.map((mode) => ({ value: mode, ...MODE_LABELS[mode] }))}
        onchange={(mode) => (store.mode = mode)} />

    <!-- The glyph is the label a mouse reads; the accessible name has to be a word. -->
    <Button
        variant="ghost"
        onclick={() => store.undo()}
        disabled={!store.canUndo}
        title="Zpět"
        ariaLabel="Zpět">
        <Undo size={16}></Undo>
    </Button>
    <Button
        variant="ghost"
        onclick={() => store.redo()}
        disabled={!store.canRedo}
        title="Vpřed"
        ariaLabel="Vpřed">
        <Redo size={16}></Redo>
    </Button>

    <Button variant="ghost" onclick={() => fileInput?.click()}>
        <Upload size={16}></Upload> Nahrát
    </Button>
    <input
        bind:this={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onchange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) onimport(file);
            e.currentTarget.value = "";
        }} />

    <Button
        variant="primary"
        onclick={requestDownload}
        title={store.canPublish
            ? "Stáhnout kurz jako soubor JSON"
            : "Ukáže, co je v kurzu ještě potřeba dokončit"}>
        <Download size={16}></Download> Stáhnout
    </Button>
</header>

{#if reviewOpen}
    <ExportDialog ondownload={download} onclose={() => (reviewOpen = false)} />
{/if}

{#if explainStorage}
    <Modal title="Kde je kurz uložený" onclose={() => (explainStorage = false)}>
        <div class="storage">
            <p>
                Rozepsaný kurz se průběžně ukládá <strong
                    >do tohoto prohlížeče</strong
                >, ne na server. Nikdo jiný k němu nemá přístup a ty se k němu
                nedostaneš z jiného počítače ani z jiného prohlížeče.
            </p>
            <p>
                Vymazání dat stránky, anonymní okno nebo přeinstalace prohlížeče
                kurz nenávratně smaže. Jediná záloha, kterou máš, je stažený
                soubor JSON — ten si můžeš kdykoli zase načíst tlačítkem <strong
                    >Nahrát</strong
                >.
            </p>
            <p class:at-risk={!backedUp}>
                {#if backedUp}
                    Stažený soubor odpovídá tomu, co je teď na obrazovce.
                {:else if exportedJson === null}
                    Tento kurz jsi ještě ani jednou nestáhl/a. Udělej to teď —
                    stojí to jedno kliknutí.
                {:else}
                    Od posledního stažení jsi kurz změnil/a. Ty změny nejsou v
                    žádném souboru.
                {/if}
            </p>
            {#if !store.canPublish}
                <p>
                    Stáhnout teď nejde — v kurzu je ještě potřeba něco dokončit,
                    jinak by žákovi lekce nefungovala. Tlačítko Stáhnout ukáže
                    co a kde; zálohu si stáhni hned poté.
                </p>
            {/if}
        </div>
    </Modal>
{/if}

<style>
    .topbar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: var(--e-topbar-height);
        padding: 0 16px;
        border-bottom: 1px solid var(--e-border);
        background: var(--surface);
    }

    .title {
        min-width: 160px;
        max-width: 260px;
        overflow: hidden;
        font: var(--type-card-title-alt);
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .spacer {
        flex: 1;
    }

    .chip-button {
        border: none;
        background: none;
        padding: 0;
        cursor: pointer;
    }

    .save-status {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
        padding: 2px 6px;
        border: none;
        border-radius: var(--radius-xs);
        background: none;
        color: var(--e-text-muted);
        font: inherit;
        font-size: var(--text-xs);
        line-height: 1.25;
        text-align: left;
        cursor: pointer;
    }

    .save-status:hover {
        background: var(--e-field-hover);
        color: var(--e-text);
    }

    .save-status .backup {
        color: var(--e-text-faint);
    }

    .save-status.at-risk .backup {
        color: var(--e-warning);
    }

    .storage {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 52ch;
        line-height: 1.55;
    }

    .storage p {
        margin: 0;
    }

    .storage p.at-risk {
        color: var(--e-warning);
    }
</style>
