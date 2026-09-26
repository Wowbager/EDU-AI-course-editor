/**
 * `blockPreview` is the single rule that names a card — the tree, the card's own
 * heading and the branch labels the preview is handed all call it, so a change here
 * renames a card in three places at once. These tests hold the two things that rule
 * now promises: the author's own title wins when there is one, and nothing about the
 * name is ever written into the document.
 */
import { describe, expect, it } from 'vitest';
import type { BlockV2 } from '../schema';
import { blockPreview, derivedBlockName, mediaFileName, stepSummary } from '../derive';

const block = (over: Partial<BlockV2> = {}): BlockV2 => ({
	block_id: 'B1',
	type: 'display',
	steps: [],
	...over
});

describe('what a card is called', () => {
	it('uses the first line of its text when the author set no title', () => {
		const b = block({
			steps: [
				{ id: 's1', type: 'text', content: '   ' },
				{ id: 's2', type: 'text', content: 'Zlomek popisuje část celku.' }
			]
		});
		expect(blockPreview(b)).toBe('Zlomek popisuje část celku.');
	});

	it('prefers the author’s title over the derived one', () => {
		const b = block({
			name: 'Co je zlomek',
			steps: [{ id: 's1', type: 'text', content: 'Zlomek popisuje část celku.' }]
		});
		expect(blockPreview(b)).toBe('Co je zlomek');
		// The fallback is still available on its own, because the field that edits the
		// title shows it as the placeholder.
		expect(derivedBlockName(b)).toBe('Zlomek popisuje část celku.');
	});

	it('treats an empty or blank title as no title at all', () => {
		// Nothing should ever write `""` here, but a hand-edited document can carry
		// one, and a card named "" would be invisible in the tree.
		const steps = [{ id: 's1', type: 'text' as const, content: 'Text karty' }];
		expect(blockPreview(block({ name: '', steps }))).toBe('Text karty');
		expect(blockPreview(block({ name: '   ', steps }))).toBe('Text karty');
	});

	it('truncates the author’s title to the same budget as the derived one', () => {
		const long = 'A'.repeat(60);
		expect(blockPreview(block({ name: long }), 10)).toBe(`${'A'.repeat(10)}…`);
	});

	it('strips markdown and LaTeX delimiters out of the derived name', () => {
		const b = block({ steps: [{ id: 's1', type: 'text', content: '## Zlomek $\\frac{a}{b}$' }] });
		expect(blockPreview(b)).toBe('Zlomek \\frac{a}{b}');
	});

	it('names an empty card by its position in the lesson when it has one', () => {
		// Three cards added in a row are otherwise all "Karta bez textu".
		expect(blockPreview(block(), 70, 3)).toBe('Karta 3');
		expect(blockPreview(block())).toBe('Karta bez textu');
	});

	it('lets the author’s title win even over the position', () => {
		expect(blockPreview(block({ name: 'Rozcvička' }), 70, 3)).toBe('Rozcvička');
	});
});

describe('a card name is the author’s sentence, not a stripped one', () => {
	const card = (content: string) =>
		({
			export_type: 'block_v2',
			block_id: 'X',
			version: 1,
			type: 'display',
			steps: [{ id: 's1', type: 'text', order: 1, content }]
		}) as never;

	it('keeps > and # where they are the author’s own characters', () => {
		// Stripping them everywhere turned "Cena je > 2 Kč" into "Cena je 2 Kč",
		// which is a different claim, not a shorter one.
		expect(blockPreview(card('Cena je < 5 Kč a > 2 Kč, hotovo.'))).toBe('Cena je < 5 Kč a > 2 Kč, hotovo.');
		expect(blockPreview(card('Úloha #3 na procvičení'))).toBe('Úloha #3 na procvičení');
	});

	it('still drops them where they are Markdown', () => {
		expect(blockPreview(card('# Nadpis karty'))).toBe('Nadpis karty');
		expect(blockPreview(card('> Citát z učebnice'))).toBe('Citát z učebnice');
		expect(blockPreview(card('**Tučně** a *kurzívou*'))).toBe('Tučně a kurzívou');
	});
});

describe('a card is named by its opening line', () => {
	const card = (content: string) =>
		({
			export_type: 'block_v2',
			block_id: 'X',
			version: 1,
			type: 'display',
			steps: [{ id: 's1', type: 'text', order: 1, content }]
		}) as never;

	it('does not flatten a table into the name', () => {
		expect(
			blockPreview(card('Části zlomku\n\n| Pozice | Název |\n|---|---|\n| nahoře | čitatel |'))
		).toBe('Části zlomku');
	});

	it('skips blank opening lines rather than giving up', () => {
		expect(blockPreview(card('\n\n   \nZlomek popisuje část celku.\nDruhý řádek.'))).toBe(
			'Zlomek popisuje část celku.'
		);
	});
});

describe('a card whose text is one long paragraph', () => {
	const named = (content: string) => derivedBlockName(block({ steps: [{ id: 's1', type: 'text', content }] }));

	it('is called by its first sentence', () => {
		expect(
			named('Dnes se naučíme, co je to **fotosyntéza**. Je to proces, při kterém rostliny přeměňují světlo.')
		).toBe('Dnes se naučíme, co je to fotosyntéza.');
	});

	it('does not cut at a decimal point, an ordinal or an abbreviation', () => {
		expect(named('Číslo 3.5 je větší než tři a půl mínus nic')).toBe('Číslo 3.5 je větší než tři a půl mínus nic');
		expect(named('Viz 1. díl učebnice o zlomcích a desetinných číslech')).toBe(
			'Viz 1. díl učebnice o zlomcích a desetinných číslech'
		);
		expect(named('Voda, tj. H2O, je potřeba pro fotosyntézu')).toBe('Voda, tj. H2O, je potřeba pro fotosyntézu');
	});

	it('keeps a short opening "sentence" together with what follows', () => {
		// "Úkol 1." is a heading, not a name.
		expect(named('Úkol 1. Spočítej, kolik je polovina z osmi.')).toBe('Úkol 1. Spočítej, kolik je polovina z osmi.');
	});
});

describe('the line a folded step shows', () => {
	it('is the plain text, without Markdown', () => {
		expect(stepSummary({ id: 's1', type: 'text', content: '## Co je **fotosyntéza**\nDalší řádek' })).toBe(
			'Co je fotosyntéza'
		);
	});

	it('names a picture by its description, then by its file, never by its address', () => {
		const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Leaf%201.jpg?width=400';
		expect(stepSummary({ id: 's1', type: 'image', image: { url, alt: 'List rostliny' } })).toBe('List rostliny');
		expect(stepSummary({ id: 's1', type: 'image', image: { url } })).toBe('Leaf 1.jpg');
		expect(stepSummary({ id: 's1', type: 'video', video: { url: 'https://example.org/v/intro.mp4' } })).toBe(
			'intro.mp4'
		);
	});

	it('copes with an address that is still being typed', () => {
		expect(mediaFileName('')).toBe('');
		expect(mediaFileName('obrazky/list.png')).toBe('list.png');
		expect(mediaFileName('https://example.org/')).toBe('example.org');
		expect(mediaFileName('https://example.org/%E0%A4%A.png')).toBe('%E0%A4%A.png');
	});
});
