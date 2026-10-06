import { describe, expect, it } from 'vitest';
import { addTerms, courseTerms, refusalText, splitTerms, suggestTerms } from '../concepts';
import type { BlockV2 } from '../schema';

const card = (concepts: string[]) =>
	({ block_id: 'b', type: 'display', steps: [], learning: { concepts } }) as unknown as BlockV2;

describe('the course spelling of a term', () => {
	const terms = courseTerms([card(['Čitatel', 'jmenovatel']), card(['čitatel', 'Zlomek'])]);

	it('is the first use, whatever case it was typed in', () => {
		expect([...terms.values()]).toEqual(['Čitatel', 'jmenovatel', 'Zlomek']);
	});

	it('splits a pasted list on commas, semicolons and line breaks', () => {
		expect(splitTerms('a, b,, c;d\ne')).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(splitTerms('  ')).toEqual([]);
	});

	it('suggests what the course has, this card has not, and the typed text is in', () => {
		expect(suggestTerms(terms, ['Zlomek'], 'l')).toEqual(['Čitatel', 'jmenovatel']);
		expect(suggestTerms(terms, [], 'zlo')).toEqual(['Zlomek']);
		// Typed out in full is not a suggestion, and a list is no search.
		expect(suggestTerms(terms, [], 'zlomek')).toEqual([]);
		expect(suggestTerms(terms, [], 'a, b')).toEqual([]);
		expect(suggestTerms(terms, [], '')).toEqual([]);
	});

	it('writes a typed term as the course has it and refuses one the card holds', () => {
		expect(addTerms(['Zlomek'], 'čitatel, nový', terms)).toEqual({
			next: ['Zlomek', 'Čitatel', 'nový'],
			refused: []
		});
		expect(addTerms(['Zlomek'], 'ZLOMEK', terms)).toEqual({
			next: ['Zlomek'],
			refused: ['Zlomek']
		});
	});

	it('says what was refused, in the singular or not', () => {
		expect(refusalText([])).toBe('');
		expect(refusalText(['Zlomek'])).toBe('Pojem „Zlomek“ už karta má.');
		expect(refusalText(['a', 'b'])).toBe('Některé z těch pojmů už karta má.');
	});
});
