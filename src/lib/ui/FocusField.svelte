<script lang="ts">
  /**
   * A stable native field: its full visible rectangle is always editable. Values
   * reach the document on input so recovery includes an unfinished edit. The store
   * groups typing until blur/Enter; Escape reverts that editing session. No DOM
   * swap, negative margins, or focus effect can swallow the author's first click.
   */
  interface Props {
    value: string | undefined;
    label: string;
    placeholder?: string;
    multiline?: boolean;
    /** Shown instead of the value when it is empty — the author's cue to fill it. */
    emptyText?: string;
    monospace?: boolean;
    /**
     * `compact` keeps the writing line and drops the fill. For headings: a 6 %
     * wash under 20px heavy type stops being a hint and starts being a form.
     */
    density?: "normal" | "compact";
    disabled?: boolean;
    invalid?: boolean;
    onchange: (value: string | undefined) => void;
    /**
     * Fires when an editing session ends (blur, Enter, Escape, or the ctrl+z/y
     * shortcut committing first) — not on every keystroke like `onchange`. For a
     * caller that only cares "the author is done for now, not just mid-word", such
     * as settling a debounced preview immediately instead of waiting out its pause.
     */
    onblur?: () => void;
  }

  let {
    value,
    label,
    placeholder = "",
    multiline = false,
    emptyText,
    monospace = false,
    density = "normal",
    disabled = false,
    invalid = false,
    onchange,
    onblur,
  }: Props = $props();

  import { untrack } from "svelte";
  import { useStore } from "./context";

  const store = useStore();
  let draft = $state("");
  let baseline = "";
  let lastEmitted: string | undefined;
  let editing = false;
  let element = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

  let mounted = false;
  // External undo/import/selection changes replace the value without echoing an edit.
  $effect(() => {
    const next = value;
    untrack(() => {
      // Text typed between SSR paint and hydration landed in the input with no
      // handler attached yet. Adopt it once instead of overwriting it — dropping
      // it would silently lose the author's first sentences on every reload.
      if (!mounted) {
        mounted = true;
        const dom = element?.value ?? "";
        if (!disabled && dom !== "" && dom !== (next ?? "")) {
          draft = dom;
          lastEmitted = dom.trim() === "" ? undefined : dom;
          onchange(lastEmitted);
          return;
        }
      }
      if (next !== lastEmitted) {
        draft = next ?? "";
        baseline = draft;
        lastEmitted = next;
        editing = false;
      }
    });
  });

  function begin() {
    if (disabled || editing) return;
    baseline = value ?? "";
    editing = true;
    store.beginEdit();
  }

  function input(event: Event) {
    begin();
    draft = (event.currentTarget as HTMLInputElement).value;
    lastEmitted = draft.trim() === "" ? undefined : draft;
    if (lastEmitted !== value) onchange(lastEmitted);
  }

  function commit() {
    store.endEdit();
    editing = false;
    baseline = draft;
    onblur?.();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y")) {
      event.preventDefault();
      event.stopPropagation();
      commit();
      if (key === "y" || event.shiftKey) store.redo();
      else store.undo();
    } else if (event.key === "Escape") {
      // Only consume Escape while this field is actually editing it; otherwise
      // it belongs to the surrounding dialog or page (e.g. closing a modal).
      if (editing) {
        event.preventDefault();
        event.stopPropagation();
        draft = baseline;
        lastEmitted = baseline.trim() === "" ? undefined : baseline;
        if (lastEmitted !== value) onchange(lastEmitted);
        commit();
      }
    } else if (event.key === "Enter" && !multiline) {
      event.preventDefault();
      commit();
    }
  }
</script>

{#if multiline}
  <textarea
    bind:this={element}
    value={draft}
    aria-label={label}
    aria-invalid={invalid || undefined}
    placeholder={emptyText ?? (placeholder || label)}
    class="field"
    class:mono={monospace}
    class:invalid
    {disabled}
    rows={Math.min(14, Math.max(3, draft.split("\n").length + 1))}
    oninput={input}
    onfocus={begin}
    onblur={commit}
    {onkeydown}
  ></textarea>
{:else}
  <input
    value={draft}
    aria-label={label}
    aria-invalid={invalid || undefined}
    placeholder={emptyText ?? (placeholder || label)}
    class="field"
    class:mono={monospace}
    class:invalid
    class:compact={density === "compact"}
    {disabled}
    oninput={input}
    onfocus={begin}
    onblur={commit}
    {onkeydown}
  />
{/if}

<style>
  .field {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 34px;
    padding: 6px 8px;
    margin: 0;
    border: 1px solid transparent;
    border-bottom-color: var(--e-field-rest-rule);
    border-radius: var(--radius-xs);
    background: var(--e-field-rest);
    font: inherit;
    color: var(--e-text);
    resize: vertical;
    overflow-wrap: anywhere;
    outline: 0px solid transparent;
  }

  .field.compact {
    background: none;
    text-overflow: ellipsis;
  }
  .field::placeholder {
    color: var(--e-text-faint);
    font-style: italic;
  }
  .field:placeholder-shown {
    border-bottom-style: dashed;
  }
  .field:hover:not(:disabled) {
    background: var(--e-field-hover);
  }
  .field:focus {
    background: var(--surface);
    border-color: var(--e-focus-ring);
    outline: 2px solid var(--primary);
    outline-offset: 0;
  }
  .field.invalid {
    box-shadow: inset 2px 0 0 var(--e-error);
  }
  .field:disabled {
    background: none;
    color: var(--e-text-muted);
  }
  /*
	 * --font-code is Fira Code, whose ligatures fold "//" into a single narrow glyph —
	 * legible in a code editor's dark gutter, but in a plain URL field it reads as one
	 * slash ("https:/"). A hair of letter-spacing is enough to keep the two strokes
	 * visually separate without widening the field's own layout or touching the value.
	 */
  .mono {
    font-family: var(--font-code);
    font-size: var(--text-s);
    letter-spacing: 0.03em;
  }
</style>
