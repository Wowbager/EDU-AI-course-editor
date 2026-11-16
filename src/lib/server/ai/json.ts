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
		return mendLatex(JSON.parse(text.slice(start, end + 1)));
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
	/[\f\b]|\t(?=imes|ext|heta|ilde|riangle|herefore|au\b|o\b|an\b)|\r(?=ightarrow|angle|ho\b|m\b)/g;
const BACK: Record<string, string> = { '\f': '\\f', '\b': '\\b', '\t': '\\t', '\r': '\\r' };

export function mendLatex(value: unknown): unknown {
	if (typeof value === 'string') return value.replace(SWALLOWED, (c) => BACK[c]);
	if (Array.isArray(value)) return value.map(mendLatex);
	if (typeof value === 'object' && value !== null)
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mendLatex(v)]));
	return value;
}
