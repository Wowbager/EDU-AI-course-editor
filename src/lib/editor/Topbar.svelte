<script lang="ts">
    import type { CourseV2 } from "$lib/domain/schema";
    import Chip from "$lib/ui/Chip.svelte";
    import Segmented from "$lib/ui/Segmented.svelte";
    import FocusField from "$lib/ui/FocusField.svelte";
    import Button from "$lib/ui/Button.svelte";
    import { useStore, useVersions } from "$lib/ui/context";
    import { setField } from "$lib/domain/commands";
    import { serialiseToJson } from "$lib/domain/document";
    import { MODES, MODE_LABELS } from "$lib/ui/fields";
    import Modal from "$lib/ui/Modal.svelte";
    import ExportDialog from "./ExportDialog.svelte";
    import VersionsDialog from "./VersionsDialog.svelte";
    import { errorsCount, warningsCount } from "$lib/ui/plural";

    import type { DraftSession } from "$lib/state/draft-session.svelte";
    import {
        CircleCheck,
        Download,
        Eye,
        EyeOff,
        History,
        Redo,
        Undo,
        Upload,
    } from "@lucide/svelte";
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
    const versions = useVersions();
    let fileInput = $state<HTMLInputElement | null>(null);
    let explainStorage = $state(false);
    let versionsOpen = $state(false);

    /**
     * The version button says where the working copy stands: the newest saved
     * version, and whether it has been changed since. A course with nothing saved
     * yet shows the number it will get.
     */
    const savedVersion = $derived(versions.latest);
    const workingChanged = $derived(versions.modified(store.source));
    const versionLabel = $derived(
        savedVersion === undefined
            ? `v${versions.next(store.source)} · neuloženo`
            : workingChanged
              ? `v${savedVersion.version} · upraveno`
              : `v${savedVersion.version}`,
    );

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
    // The working copy goes out under the number it will be saved as, so a file
    // downloaded after version 3 was saved is never "version 1" to the platform.
    const currentJson = $derived(
        serialiseToJson({
            ...store.source,
            version: versions.next(store.source),
        }),
    );
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

    /** Whether saving works, and whether the work has left the browser. */
    const saveLine = $derived.by((): { text: string; tone: "error" | "warning" | "faint" } => {
        const status = recovery?.status;
        if (status === "error")
            return { text: "Koncept se nepodařilo uložit", tone: "error" };
        if (status === "blocked")
            return { text: "Ukládání pozastaveno", tone: "warning" };
        if (backedUp) return { text: "Stáhnuto do souboru", tone: "faint" };
        // Nothing to lose yet on a course nobody has touched.
        return {
            text: "Bez zálohy v souboru",
            tone: store.dirty ? "warning" : "faint",
        };
    });

    /** The button's name carries all of it, the saving state too. */
    const saveLabel = $derived.by(() => {
        const backup = backedUp
            ? "Stáhnuto do souboru."
            : "Bez zálohy v souboru.";
        switch (recovery?.status) {
            case "saved":
                return `Koncept uložen v tomto prohlížeči. ${backup}`;
            case "error":
                return `Koncept se nepodařilo uložit. ${backup}`;
            case "blocked":
                return `Ukládání pozastaveno. ${backup}`;
            default:
                return `Koncept se ukládá do tohoto prohlížeče. ${backup}`;
        }
    });

    /** The chip shows a bare number; the accessible name has to say what it counts. */
    const checkLabel = $derived(
        store.listed.errors.length > 0
            ? `Kontrola kurzu: ${errorsCount(store.listed.errors.length)}`
            : store.listed.warnings.length > 0
              ? `Kontrola kurzu: ${warningsCount(store.listed.warnings.length)}`
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

    <button
        type="button"
        class="version"
        onclick={() => (versionsOpen = true)}
        title="Verze kurzu: uložit, vrátit se k dřívější, zveřejnit a nastavit, kdo kurz uvidí">
        <History size={14}></History>
        {versionLabel}
    </button>
    <!--
        One line, chosen by what is true now. It says what a teacher can act on —
        whether the work has left the browser, or that saving has stopped — and never
        "Ukládání…", which flickered on every keystroke. The full state is the name.
    -->
    <button
        type="button"
        class="save-status {saveLine.tone}"
        onclick={() => (explainStorage = true)}
        aria-label={saveLabel}
        title="Kurz je jen v tomto prohlížeči, ne na serveru. Klikni pro vysvětlení.">
        {saveLine.text}
    </button>
    <!-- A live region has to be outside the button, whose children are not announced. -->
    <span class="sr-only" role={recovery?.status === "error" ? "alert" : "status"}>
        {#if recovery?.status === "error" || recovery?.status === "blocked"}{saveLine.text}{/if}
    </span>

    <div class="spacer"></div>

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
        {#if store.listed.errors.length > 0 && !store.reviewing}
            <Chip tone="quiet"
                >{store.listed.errors.length} k dokončení</Chip>
        {:else if store.listed.errors.length > 0}
            <Chip tone="error">{store.listed.errors.length}</Chip>
        {:else if store.listed.warnings.length > 0 && !store.reviewing}
            <Chip tone="quiet"
                >{store.listed.warnings.length} doporučení</Chip>
        {:else if store.listed.warnings.length > 0}
            <Chip tone="warning">{store.listed.warnings.length}</Chip>
        {:else}
            <Chip tone="ok"><CircleCheck size={16}></CircleCheck> 0</Chip>
        {/if}
    </button>

    <Segmented
        label="Režim editoru"
        value={store.mode}
        options={MODES.map((mode) => ({ value: mode, ...MODE_LABELS[mode] }))}
        onchange={(mode) => (store.mode = mode)} />

    <!--
        A toggle keeps one label; aria-pressed carries the state. The label is the
        name of what is switched, so it never has to flip to say what a click does.
    -->
    <Button
        variant="ghost"
        size="s"
        pressed={store.showFeedback}
        ariaLabel="Zpětná vazba"
        title={store.showFeedback
            ? "Zapnuto: zpětná vazba, nápovědy a řešení jsou vidět. Vypni a soustřeď se jen na průběh kurzu."
            : "Vypnuto: zpětná vazba, nápovědy a řešení jsou skryté. Zapni, až budeš psát zpětnou vazbu."}
        onclick={() => (store.showFeedback = !store.showFeedback)}>
        {#if store.showFeedback}
            <Eye size={16}></Eye>
        {:else}
            <EyeOff size={16}></EyeOff>
        {/if}
        Zpětná vazba
    </Button>

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

{#if versionsOpen}
    <VersionsDialog
        onclose={() => (versionsOpen = false)}
        onreview={() => {
            versionsOpen = false;
            reviewOpen = true;
        }} />
{/if}

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
                rozepsaný kurz nenávratně smaže. Zálohou jsou <strong
                    >uložené verze</strong
                > (tlačítko s číslem verze vlevo nahoře) — ukládají se i na server
                editoru, ale najde je zase jen tento prohlížeč — a stažený soubor
                JSON, který si můžeš kdykoli načíst tlačítkem <strong>Nahrát</strong
                >. Jen soubor přežije i vymazání dat prohlížeče.
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

    .version {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 10px;
        border: 1px solid var(--e-border);
        border-radius: var(--radius-pill);
        background: var(--surface);
        color: var(--e-text-muted);
        font: var(--type-chip-label);
        white-space: nowrap;
        cursor: pointer;
    }

    .version:hover {
        border-color: var(--e-border-strong);
        color: var(--e-text);
    }

    .save-status {
        padding: 2px 6px;
        border: none;
        border-radius: var(--radius-xs);
        background: none;
        color: var(--e-text-faint);
        font: inherit;
        font-size: var(--text-xs);
        line-height: 1.25;
        text-align: left;
        white-space: nowrap;
        cursor: pointer;
    }

    .save-status.warning {
        color: var(--e-warning);
    }

    .save-status.error {
        color: var(--e-error);
    }

    .save-status:hover {
        background: var(--e-field-hover);
    }

    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
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
