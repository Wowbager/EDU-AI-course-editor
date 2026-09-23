<script lang="ts" generics="T extends string">
    interface Props {
        options: { value: T; label: string; title?: string }[];
        value: T;
        label: string;
        onchange: (value: T) => void;
        /** Settings can wrap; compact toolbar controls retain their single row. */
        wrap?: boolean;
    }
    let { options, value, label, onchange, wrap = false }: Props = $props();
</script>

<div class="segmented" class:wrap role="radiogroup" aria-label={label}>
    {#each options as option (option.value)}
        <button
            type="button"
            role="radio"
            aria-checked={option.value === value}
            class:selected={option.value === value}
            title={option.title}
            onclick={() => onchange(option.value)}>
            <span>
                {option.label}
            </span>
        </button>
    {/each}
</div>

<style>
    .segmented {
        display: inline-flex;
        padding: 3px;
        border-radius: var(--radius-pill);
        background: var(--surface-light);
    }

    .wrap {
        min-width: 0;
        max-width: 100%;
        flex-wrap: wrap;
        gap: 3px;
        border-radius: var(--radius-s);
    }

    .wrap button {
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
    }

    button {
        padding: 5px 14px;
        border: none;
        border-radius: var(--radius-pill);
        background: none;
        color: var(--e-text-muted);
        font-family: var(--font-body);
        font-size: var(--text-s);
        font-weight: var(--weight-medium);
        cursor: pointer;
        position: relative;
    }

    button::before {
        content: attr(data-label);
        font-weight: var(--weight-bold);
        visibility: hidden;
        width: max-content;
        white-space: nowrap;
    }

    button:hover {
        color: var(--e-text);
        font-weight: var(--weight-bold);
    }

    .selected {
        background: var(--surface);
        color: var(--e-text);
        font-weight: var(--weight-bold);
        box-shadow: var(--shadow-light);
    }
</style>
