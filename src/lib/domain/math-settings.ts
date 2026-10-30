/**
 * Per-course math conventions (design brief §3): the subject profile of the on-screen
 * keypad, the decimal separator, thousands separator, the scientific-notation sign and
 * the vector-coordinate separator. Stored on the course document under `math`, so the
 * whole course follows one convention; the keypad's ⋯ menu can override the profile for
 * the teacher's session.
 *
 * Defaults follow Czech school convention: decimal comma, no thousands separator,
 * `·` in scientific notation, `;` between vector coordinates.
 */

export interface MathSettings {
	/** §4.2 subject profile of the keypad's tabs. */
	profile?: string;
	/** `,` (Czech default) or `.` — physical `,` and `.` between digits both produce it. */
	decimalSeparator?: ',' | '.';
	/** Thin-space thousands separator for numbers with ≥ 5 digits; default off. */
	thousandsSeparator?: boolean;
	/** `·` (default) or `×` in scientific notation. */
	sciNotation?: 'cdot' | 'times';
	/** Separator between vector coordinates: `;` (Czech default) or `,`. */
	vectorSeparator?: ';' | ',';
}

/** The decimal separator a formula is written with: `3{,}14` for the comma. */
export function decimalLatex(settings: MathSettings | undefined): string {
	return settings?.decimalSeparator === '.' ? '.' : '{,}';
}

/** Read the settings off a course document; absent means the defaults. */
export function mathSettingsOf(doc: unknown): MathSettings {
	const math = (doc as { math?: unknown } | undefined)?.math;
	return math !== null && typeof math === 'object' ? (math as MathSettings) : {};
}
