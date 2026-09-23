<script lang="ts">
  import { OctagonX, TriangleAlert } from "@lucide/svelte";

  /**
   * A small labelled fact.
   *
   * `quiet` exists because every chip used to be filled, so a step count shouted as
   * loudly as an error. A filled chip now means something is being claimed — this
   * is the card's type, this is broken, this is shared — and everything that is
   * merely a number reported back to you is quiet.
   */
  interface Props {
    tone?: "neutral" | "quiet" | "error" | "warning" | "ok" | "accent";
    title?: string;
    onclick?: () => void;
    children: import("svelte").Snippet;
  }
  let { tone = "neutral", title, onclick, children }: Props = $props();
</script>

{#snippet icon()}
  {#if tone === "error"}
    <OctagonX size={14}></OctagonX>
  {:else if tone === "warning"}
    <TriangleAlert size={14}></TriangleAlert>
  {/if}
{/snippet}

{#if onclick}
  <button type="button" class="chip {tone}" {title} {onclick}>
    {@render icon()}
    {@render children()}
  </button>
{:else}
  <span class="chip {tone}" {title}>
    {@render icon()}
    {@render children()}
  </span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    background: var(--surface-light);
    color: var(--e-text-muted);
    font: var(--type-chip-label);
    white-space: nowrap;
  }

  button.chip {
    cursor: pointer;
  }

  button.chip:hover {
    border-color: var(--e-border-strong);
  }

  .quiet {
    padding: 3px 4px;
    background: none;
    color: var(--e-text-faint);
    font: var(--type-caption);
  }

  .error {
    background: var(--e-error-bg);
    color: var(--e-error);
  }
  .warning {
    background: var(--e-warning-bg);
    color: var(--e-warning);
  }
  .ok {
    background: var(--e-ok-bg);
    color: var(--e-ok);
  }
  .accent {
    background: var(--info-bg);
    color: var(--gradient-purple);
  }
</style>
