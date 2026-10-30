<script lang="ts">
	/**
	 * The formula row's on-screen keypad — our own, not MathLive's: plain buttons, so
	 * every glyph (the delete, arrow and enter icons included) is centred in its key
	 * and sized to fit, and no Shift layer can redraw them.
	 *
	 * The keys write what MathLive's keyboard wrote (`#@`/`#?` placeholders, commands),
	 * through the API `mathField()` binds. A press never takes the focus: `mousedown`
	 * is cancelled, so the caret stays in the formula while the keypad is used.
	 */
	import type { Component } from 'svelte';
	import {
		ChevronLeft,
		ChevronRight,
		CornerDownLeft,
		Delete,
		Radical,
		Subscript,
		Superscript
	} from '@lucide/svelte';

	interface Props {
		/** Insert LaTeX at the caret of the formula field. */
		oninsert: (latex: string) => void;
		/** An editing command of the formula field, e.g. `deleteBackward`. */
		oncommand: (command: string) => void;
		/** Enter: the formula is done, as the Enter key in the field itself. */
		ondone: () => void;
	}
	let { oninsert, oncommand, ondone }: Props = $props();

	interface Key {
		/** Writes LaTeX into the field, runs a command, or ends the edit. */
		kind: 'latex' | 'command' | 'enter';
		label: string;
		latex?: string;
		command?: string;
		icon?: Component;
		/** A small drawn glyph instead of a label. */
		glyph?: 'frac' | 'root' | 'abs';
		title?: string;
	}
	type Cell = Key | 'sep';

	const digit = (label: string): Key => ({ kind: 'latex', label, latex: label });
	const op = (label: string, latex: string, title?: string): Key => ({
		kind: 'latex',
		label,
		latex,
		title: title ?? label
	});
	const fn = (glyph: Key['glyph'], latex: string, title: string, icon?: Component): Key => ({
		kind: 'latex',
		label: '',
		latex,
		glyph,
		icon,
		title
	});
	const cmd = (icon: Component, command: string, title: string): Key => ({
		kind: 'command',
		label: '',
		icon,
		command,
		title
	});

	const BACKSPACE = cmd(Delete, 'deleteBackward', 'Smazat znak');
	const LEFT = cmd(ChevronLeft, 'moveToPreviousChar', 'Předchozí znak');
	const RIGHT = cmd(ChevronRight, 'moveToNextChar', 'Další znak');
	/** Enter, like the key in the field itself: the formula is done. */
	const ENTER: Key = { kind: 'enter', label: '', icon: CornerDownLeft, title: 'Potvrdit' };

	const TABS: { label: string; rows: Cell[][] }[] = [
		{
			label: 'Čísla',
			rows: [
				[
					digit('7'),
					digit('8'),
					digit('9'),
					op('·', '\\cdot', 'Krát tečkou'),
					'sep',
					fn('frac', '\\frac{#@}{#?}', 'Zlomek'),
					fn(undefined, '#@^{#?}', 'Mocnina', Superscript),
					fn('root', '\\sqrt{#0}', 'Odmocnina', Radical)
				],
				[
					digit('4'),
					digit('5'),
					digit('6'),
					op('÷', '\\div', 'Děleno'),
					'sep',
					digit('('),
					digit(')'),
					op('π', '\\pi', 'Pí')
				],
				[
					digit('1'),
					digit('2'),
					digit('3'),
					op('−', '-', 'Minus'),
					'sep',
					digit('x'),
					digit('y'),
					BACKSPACE
				],
				[
					digit('0'),
					digit('.'),
					op('=', '=', 'Rovná se'),
					op('+', '+', 'Plus'),
					'sep',
					LEFT,
					RIGHT,
					ENTER
				]
			]
		},
		{
			label: 'Značky',
			rows: [
				[
					op('<', '<', 'Menší'),
					op('>', '>', 'Větší'),
					op('≤', '\\le', 'Menší nebo rovno'),
					op('≥', '\\ge', 'Větší nebo rovno'),
					op('≠', '\\ne', 'Nerovná se'),
					op('≈', '\\approx', 'Přibližně')
				],
				[
					op('±', '\\pm', 'Plus minus'),
					op('×', '\\times', 'Krát křížkem'),
					op('°', '^{\\circ}', 'Stupně'),
					op('%', '\\%', 'Procento'),
					'sep',
					fn('abs', '|#0|', 'Absolutní hodnota'),
					fn('root', '\\sqrt[#0]{#?}', 'Obecná odmocnina', Radical)
				],
				[
					fn(undefined, '#@_{#?}', 'Index', Subscript),
					op('α', '\\alpha', 'Alfa'),
					op('β', '\\beta', 'Beta'),
					op('γ', '\\gamma', 'Gama'),
					LEFT,
					RIGHT
				],
				[digit('a'), digit('b'), digit('c'), digit('n'), BACKSPACE, ENTER]
			]
		}
	];

	let tab = $state(0);

	/** Keep the caret in the formula: the press must not move the focus to the key. */
	const keepFocus = (event: MouseEvent) => event.preventDefault();

	function press(key: Key) {
		if (key.kind === 'enter') ondone();
		else if (key.kind === 'command' && key.command) oncommand(key.command);
		else if (key.latex) oninsert(key.latex);
	}
</script>

<div class="keypad" role="group" aria-label="Klávesnice se značkami">
	<div class="keypad-tabs" role="group" aria-label="Skupiny kláves">
		{#each TABS as t, i (t.label)}
			<button
				type="button"
				class="keypad-tab"
				class:on={tab === i}
				aria-pressed={tab === i}
				onmousedown={keepFocus}
				onclick={() => (tab = i)}>{t.label}</button
			>
		{/each}
	</div>
	{#each TABS[tab].rows as row, r (r)}
		<div class="keypad-row">
			{#each row as key, k (k)}
				{#if key === 'sep'}
					<span class="keypad-sep" aria-hidden="true"></span>
				{:else}
					<button
						type="button"
						class="key"
						title={key.title}
						aria-label={key.title ?? key.label}
						onmousedown={keepFocus}
						onclick={() => press(key)}
					>
						{#if key.icon}
							<key.icon size={16} aria-hidden="true" />
						{:else if key.glyph === 'frac'}
							<span class="g-frac" aria-hidden="true"><i>a</i><i>b</i></span>
						{:else if key.glyph === 'root'}
							<span class="g-root" aria-hidden="true"><Radical size={16} /></span>
						{:else if key.glyph === 'abs'}
							<span class="g-abs" aria-hidden="true">|x|</span>
						{:else}
							{key.label}
						{/if}
					</button>
				{/if}
			{/each}
		</div>
	{/each}
</div>

<style>
	.keypad {
		flex-basis: 100%;
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 2px;
		padding: 6px 2px 2px;
		border-top: 1px solid var(--e-border);
	}
	.keypad-tabs {
		display: flex;
		gap: 2px;
		padding: 0 2px;
	}
	.keypad-tab {
		font: inherit;
		font-size: var(--text-xs);
		padding: 2px 10px;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--e-text-muted);
		cursor: pointer;
	}
	.keypad-tab:hover {
		background: var(--e-field-hover);
		color: var(--e-text);
	}
	.keypad-tab.on {
		background: var(--e-field-rest);
		color: var(--primary-dark);
	}
	.keypad-row {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 4px;
	}
	.keypad-sep {
		width: 1px;
		align-self: stretch;
		margin: 3px 5px;
		background: var(--e-border);
	}
	/* One key: the glyph centred by flex, whatever it is — text or icon. */
	.key {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 40px;
		height: 34px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius-xs);
		background: var(--e-field-rest);
		color: var(--e-text);
		font: inherit;
		font-size: var(--text-m);
		line-height: 1;
		cursor: pointer;
	}
	.key:hover {
		background: var(--e-field-hover);
	}
	.key:active {
		background: var(--primary-dark-12);
		color: var(--primary-dark);
	}
	.key :global(svg) {
		display: block;
	}
	/* A little stacked fraction, drawn in the key's own font and colour. */
	.g-frac {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		font-style: italic;
		font-size: 11px;
		line-height: 1.15;
	}
	.g-frac i {
		font-style: italic;
		padding: 0 4px;
	}
	.g-frac i:first-child {
		border-bottom: 1.5px solid currentColor;
	}
	.g-abs {
		font-size: 14px;
	}
	.g-root {
		display: inline-flex;
	}
</style>
