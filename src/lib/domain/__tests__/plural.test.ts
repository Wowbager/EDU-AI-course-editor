import { describe, expect, it } from 'vitest';
import { answersCount, counted, errorsCount, plural } from '$lib/ui/plural';

describe('Czech noun agreement', () => {
	it('picks the three forms a count can take', () => {
		expect(plural(1, 'chyba', 'chyby', 'chyb')).toBe('chyba');
		expect(plural(2, 'chyba', 'chyby', 'chyb')).toBe('chyby');
		expect(plural(4, 'chyba', 'chyby', 'chyb')).toBe('chyby');
		expect(plural(5, 'chyba', 'chyby', 'chyb')).toBe('chyb');
		// Zero takes the same form as five, which is why "0 chyb" reads correctly.
		expect(plural(0, 'chyba', 'chyby', 'chyb')).toBe('chyb');
	});

	it('writes the count and its noun together', () => {
		expect(counted(3, 'karta', 'karty', 'karet')).toBe('3 karty');
	});

	it('is what the chips and the type-switch dialog print', () => {
		// The bug this replaced: the chip said „1 chyb“, which is not Czech.
		expect(errorsCount(1)).toBe('1 chyba');
		expect(errorsCount(3)).toBe('3 chyby');
		expect(errorsCount(12)).toBe('12 chyb');
		expect(answersCount(1)).toBe('1 odpověď');
		expect(answersCount(4)).toBe('4 odpovědi');
		expect(answersCount(5)).toBe('5 odpovědí');
	});
});
