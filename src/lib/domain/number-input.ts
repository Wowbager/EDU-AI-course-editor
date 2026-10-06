/**
 * What a number field means when a teacher has typed into it.
 *
 * An emptied field is "not set", never 0: 0 is a value (a difficulty of 0, a limit of
 * 0 s) and writing it for an empty box silently changes the course. Czech teachers type
 * a decimal comma and group thousands with a space ("1 000,5", often a non-breaking
 * one), which `Number()` reads as NaN. Anything that is not a finite number never
 * reaches the document: callers that keep the typed text (`parseNumberDraft`) say so
 * to the teacher, callers that cannot treat it as "not set".
 *
 * `undefined` means "leave it unset" — the caller deletes the key (or, where the field
 * has a baseline such as `ELO_BASELINE`, writes that).
 */
export type NumberDraft =
	{ status: 'empty' } | { status: 'ok'; value: number } | { status: 'invalid'; text: string };

export function parseNumberDraft(raw: string | number | undefined | null): NumberDraft {
	if (raw === undefined || raw === null) return { status: 'empty' };
	// A `type="number"` input bound with `bind:value` hands over a number, not text.
	if (typeof raw === 'number') {
		return Number.isFinite(raw) ? { status: 'ok', value: raw } : { status: 'invalid', text: '' };
	}
	// Every kind of space (NBSP and the narrow one included), the typographic minus,
	// and the comma as the decimal separator.
	const text = raw
		.replace(/[\s\u00a0\u202f]/g, '')
		.replace(/\u2212/g, '-')
		.replaceAll(',', '.');
	if (text === '') return { status: 'empty' };
	// Not `Number(text)` alone: it also reads "0x10" and "" as numbers.
	const value = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text) ? Number(text) : Number.NaN;
	return Number.isFinite(value) ? { status: 'ok', value } : { status: 'invalid', text: raw.trim() };
}

export function parseNumberInput(raw: string | number | undefined | null): number | undefined {
	const parsed = parseNumberDraft(raw);
	return parsed.status === 'ok' ? parsed.value : undefined;
}

/** What the teacher is told under a field whose text is not a number. */
export function notANumberMessage(text: string): string {
	return `„${text}“ není číslo, proto se neuložilo a v kurzu zůstala původní hodnota. Napiš ho číslicemi, třeba 2,5.`;
}

/** What a number field accepts: the range its spec declares (`FieldSpec.min` / `max`). */
export interface NumberBounds {
	min?: number | null;
	max?: number | null;
}

/**
 * The one clamp rule of every bounded number field: a number outside the range is
 * written as the nearest end, never refused and never written as it was typed. The
 * range is the field's spec (`ui/fields.ts`), so a difficulty, a weight and a required
 * mastery no longer each carry a rule of their own.
 */
export function clampNumber(bounds: NumberBounds, value: number): number {
	let result = value;
	if (bounds.max !== undefined && bounds.max !== null) result = Math.min(bounds.max, result);
	if (bounds.min !== undefined && bounds.min !== null) result = Math.max(bounds.min, result);
	return result;
}
