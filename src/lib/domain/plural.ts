/**
 * Czech noun agreement for a counted thing.
 *
 * Czech has three forms after a number — 1, 2–4, and 0 or 5+ — and getting it wrong
 * is the kind of thing that makes a tool read as translated rather than written.
 * The chips said „1 chyb“, which is not a sentence in any register.
 *
 * The rule here is the plain one the editor needs: every count it shows is a small
 * whole number of countable things (errors, warnings, answers, cards). It is not the
 * full CLDR rule and does not try to be — decimals take the same form as 5+, which
 * the editor never prints anyway.
 */
export function plural(count: number, one: string, few: string, many: string): string {
	if (!Number.isInteger(count)) return many;
	if (count === 1) return one;
	if (count >= 2 && count <= 4) return few;
	return many;
}

/** `3` → `"3 chyby"`. The count and its noun are never written apart. */
export function counted(count: number, one: string, few: string, many: string): string {
	return `${count} ${plural(count, one, few, many)}`;
}

export const errorsCount = (n: number) => counted(n, 'chyba', 'chyby', 'chyb');
export const warningsCount = (n: number) => counted(n, 'upozornění', 'upozornění', 'upozornění');
export const answersCount = (n: number) => counted(n, 'odpověď', 'odpovědi', 'odpovědí');
export const cardsCount = (n: number) => counted(n, 'karta', 'karty', 'karet');
export const stepsCount = (n: number) => counted(n, 'krok', 'kroky', 'kroků');
