/**
 * `learning.concepts`: the key terms a card is about, kept in the course's spelling.
 *
 * One rule for the whole course — a term is spelled as its first use spells it — so the
 * suggestions under the field, the term typed out and the one picked from the list all
 * come to the same text. `ConceptsEditor` used to work these out itself.
 */
import type { BlockV2 } from './schema';

/** "a, b,, c" → ["a", "b", "c"]; commas, semicolons and line breaks all separate. */
export const splitTerms = (raw: string): string[] =>
	raw
		.split(/[,;\n]/)
		.map((part) => part.trim())
		.filter((part) => part !== '');

/** Whether the text holds more than one term (a pasted list), which has no suggestions. */
export const isTermList = (text: string): boolean => /[,;\n]/.test(text);

/** Every term used in the course, first spelling wins, in document order. */
export function courseTerms(blocks: readonly BlockV2[]): Map<string, string> {
	const seen = new Map<string, string>();
	for (const block of blocks) {
		for (const term of block.learning?.concepts ?? []) {
			if (!seen.has(term.toLowerCase())) seen.set(term.toLowerCase(), term);
		}
	}
	return seen;
}

/** What the course has that this card has not, and that contains what is being typed. */
export function suggestTerms(
	terms: ReadonlyMap<string, string>,
	own: readonly string[],
	draft: string
): string[] {
	const typed = draft.trim().toLowerCase();
	if (typed === '' || isTermList(typed)) return [];
	const mine = new Set(own.map((c) => c.toLowerCase()));
	return [...terms]
		.filter(([key]) => !mine.has(key) && key.includes(typed) && key !== typed)
		.map(([, term]) => term)
		.slice(0, 6);
}

/**
 * The terms of `raw` added to `own`, each in the course's spelling; the ones the card
 * already has are `refused` and not added twice.
 */
export function addTerms(
	own: readonly string[],
	raw: string,
	terms: ReadonlyMap<string, string>
): { next: string[]; refused: string[] } {
	const next = [...own];
	const refused: string[] = [];
	for (const typed of splitTerms(raw)) {
		const term = terms.get(typed.toLowerCase()) ?? typed;
		if (next.some((c) => c.toLowerCase() === term.toLowerCase())) refused.push(term);
		else next.push(term);
	}
	return { next, refused };
}

/** What a refusal says under the list. */
export function refusalText(refused: readonly string[]): string {
	if (refused.length === 0) return '';
	return refused.length === 1
		? `Pojem „${refused[0]}“ už karta má.`
		: 'Některé z těch pojmů už karta má.';
}
