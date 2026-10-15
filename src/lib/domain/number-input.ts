/**
 * What a number field means when a teacher has typed into it.
 *
 * An emptied field is "not set", never 0: 0 is a value (a difficulty of 0, a limit of
 * 0 s) and writing it for an empty box silently changes the course. Czech teachers type
 * a decimal comma, which `Number()` reads as NaN. Anything that is not a finite number
 * is "not set" too, so the caller never has to write NaN into the document.
 *
 * `undefined` means "leave it unset" — the caller deletes the key (or, where the field
 * has a baseline such as `ELO_BASELINE`, writes that).
 */
export function parseNumberInput(raw: string | number | undefined | null): number | undefined {
	if (raw === undefined || raw === null) return undefined;
	// A `type="number"` input bound with `bind:value` hands over a number, not text.
	if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
	const text = raw.replace(/\s/g, '').replace(',', '.');
	if (text === '') return undefined;
	const value = Number(text);
	return Number.isFinite(value) ? value : undefined;
}

/**
 * How a stored number is shown in a field a teacher types into: every digit the
 * document holds, with a decimal comma. Never rounded — a field that showed 3,142 for
 * 3.14159 wrote 3.142 back the next time it was left. `parseNumberInput` reads every
 * string this returns back to the same number.
 */
export function formatNumberInput(value: number | undefined): string | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return String(value).replace('.', ',');
}
