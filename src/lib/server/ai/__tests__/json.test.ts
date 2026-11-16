import { describe, expect, it } from 'vitest';
import { parseJson } from '../json';

describe('parseJson', () => {
	it('reads JSON wrapped in a code fence or a sentence', () => {
		expect(parseJson('Tady: ```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(parseJson('nic')).toBeUndefined();
	});

	it('puts back LaTeX written with one backslash, which JSON reads as a control character', () => {
		// As the model wrote it: one backslash before frac, times, beta and rightarrow.
		const raw = String.raw`{"brief":"Zápis $\frac{a}{b}$, $2 \times 3$, $\beta$, $a \rightarrow b$","steps":[{"t":"$\text{cm}$"}]}`;
		expect(parseJson(raw)).toEqual({
			brief: String.raw`Zápis $\frac{a}{b}$, $2 \times 3$, $\beta$, $a \rightarrow b$`,
			steps: [{ t: String.raw`$\text{cm}$` }]
		});
	});

	it('leaves a new line before a word, and correctly escaped LaTeX, as they are', () => {
		expect(parseJson('{"a":"Řádek\\nnový $\\\\frac{1}{2}$"}')).toEqual({
			a: 'Řádek\nnový $\\frac{1}{2}$'
		});
	});
});
