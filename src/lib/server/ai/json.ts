/**
 * The model's text as an object: it may wrap the JSON in a code fence or a sentence.
 *
 * LaTeX written into a JSON string with one backslash (`"$\frac{1}{2}$"`) parses as a
 * control character plus the rest of the command (a form feed and "rac"). Such a
 * character never belongs in a card's text, so it is put back as the command it was.
 */
export function parseJson(text: string): unknown {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return undefined;
	try {
		return mendLatex(JSON.parse(escapeStray(text.slice(start, end + 1))));
	} catch {
		return undefined;
	}
}

/**
 * `\f` and `\b` are always LaTeX in a card (`\frac`, `\binom`, `\beta`); `\t` and `\r`
 * only before the commands named here, since a tab or a carriage return before a word
 * can be meant. `\n` is left alone: a new line before a word is ordinary text.
 */
const SWALLOWED =
	/[\f\b]|\t(?=imes|ext|heta|ilde|riangle|herefore|frac|binom|au\b|o\b|op\b|anh?\b)|\r(?=ight|angle|floor|ceil|brace|brack|[vV]ert|ho\b|m\b)/g;
/**
 * A backslash that starts no JSON escape (`\left`, `\sqrt`, `\cdot`, `\underline`) makes
 * the whole answer invalid JSON; it can only be LaTeX, so it is doubled before parsing.
 * An escaped one (two backslashes) is taken as a pair and left as it is.
 */
const escapeStray = (json: string): string =>
	json.replace(/\\(\\|["/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (whole, escape: string | undefined) =>
		escape !== undefined ? whole : '\\\\'
	);

const BACK: Record<string, string> = { '\f': '\\f', '\b': '\\b', '\t': '\\t', '\r': '\\r' };

export function mendLatex(value: unknown): unknown {
	if (typeof value === 'string') return value.replace(SWALLOWED, (c) => BACK[c]);
	if (Array.isArray(value)) return value.map(mendLatex);
	if (typeof value === 'object' && value !== null)
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mendLatex(v)]));
	return value;
}
