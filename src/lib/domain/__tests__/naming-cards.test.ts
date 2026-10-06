import { describe, expect, it } from 'vitest';
import type { BlockV2, CourseV2 } from '../schema';
import { cardGroups, cardLabel, cardNames, partLabel, stepName } from '../naming';
import { cardsWaitingFor, validate } from '../validate';

const card = (id: string, name?: string, prerequisites?: string[]): BlockV2 => ({
	block_id: id,
	type: 'display',
	name,
	steps: [],
	...(prerequisites
		? { learning: { prerequisites: prerequisites.map((b) => ({ block_id: b, min_level: 0.5 })) } }
		: {})
});

const course = (blocks: BlockV2[], lessons: string[][], names: (string | undefined)[] = []) =>
	({
		blocks,
		lessons: lessons.map((ids, i) => ({
			lesson_id: `L${i + 1}`,
			name: names[i],
			blocks: ids.map((block_id) => ({ block_id }))
		}))
	}) as unknown as CourseV2;

describe('card names', () => {
	const doc = course(
		[card('a', 'Kolik je?'), card('b', 'Zlomky'), card('c', 'Kolik je?'), card('d', 'Mimo')],
		[['a', 'b'], ['c']]
	);
	const names = cardNames(doc);

	it('leaves a name that is alone as it is', () => {
		expect(names.get('b')).toMatchObject({ label: 'Zlomky', collides: false, lesson: 'Lekce 1' });
	});

	it('adds the place to cards that share a name', () => {
		expect(names.get('a')?.label).toBe('Kolik je? · Lekce 1, karta 1');
		expect(names.get('c')?.label).toBe('Kolik je? · Lekce 2, karta 1');
	});

	it('says „mimo lekce“ for a card in no lesson', () => {
		expect(names.get('d')).toMatchObject({ place: 'mimo lekce', lesson: 'mimo lekce' });
	});

	it('compares names without case', () => {
		const d = course([card('a', 'Kolik je?'), card('b', 'kolik je?')], [['a', 'b']]);
		expect(cardNames(d).get('b')?.collides).toBe(true);
	});

	it('tells apart empty cards, which are named by position', () => {
		const d = course([card('a'), card('b')], [['a'], ['b']]);
		const n = cardNames(d);
		expect(n.get('a')?.label).toBe('Karta 1 · Lekce 1, karta 1');
		expect(n.get('b')?.label).toBe('Karta 1 · Lekce 2, karta 1');
	});

	it('uses a lesson’s own name in the place', () => {
		const d = course([card('a', 'X'), card('b', 'X')], [['a', 'b']], ['Úvod']);
		expect(cardNames(d).get('b')?.place).toBe('Úvod, karta 2');
	});
});

describe('card groups', () => {
	const doc = course(
		[card('a', 'A'), card('b', 'B'), card('c', 'C'), card('d', 'D')],
		[
			['a', 'b'],
			['b', 'c']
		]
	);
	it('groups by lesson, then the loose cards, listing a shared card once', () => {
		expect(cardGroups(doc).map((g) => [g.title, g.cards.map((c) => c.id)])).toEqual([
			['Lekce 1', ['a', 'b']],
			['Lekce 2', ['c']],
			['Karty mimo lekce', ['d']]
		]);
	});
	it('leaves out the excluded cards and groups that become empty', () => {
		const groups = cardGroups(doc, { exclude: new Set(['c', 'd']) });
		expect(groups.map((g) => g.title)).toEqual(['Lekce 1']);
		expect(cardGroups(doc, { exclude: 'a' })[0].cards.map((c) => c.id)).toEqual(['b']);
	});
});

describe('which cards would make a cycle', () => {
	// c waits for b, b waits for a: both wait for a, and so would a waiting for either.
	const doc = course(
		[card('a'), card('b', 'B', ['a']), card('c', 'C', ['b']), card('d')],
		[['a', 'b', 'c', 'd']]
	);
	it('lists the cards that wait for it directly or through others', () => {
		expect([...cardsWaitingFor(doc, 'a')].sort()).toEqual(['b', 'c']);
		expect([...cardsWaitingFor(doc, 'b')]).toEqual(['c']);
	});
	it('is empty for a card nobody waits for', () => {
		expect(cardsWaitingFor(doc, 'c').size).toBe(0);
		expect(cardsWaitingFor(doc, 'd').size).toBe(0);
	});
	it('ignores a prerequisite that is a skill or points nowhere', () => {
		const d = course([card('a', 'A', ['gone'])], [['a']]);
		expect(cardsWaitingFor(d, 'a').size).toBe(0);
	});
});

describe('one name for a card on every surface (M1)', () => {
	// `shared` is in two lessons (2nd in L1, 1st in L2); `empty` has no text; `loose` is in none.
	const doc = course(
		[card('loose'), card('first'), card('shared'), card('empty')],
		[
			['first', 'shared'],
			['shared', 'empty']
		]
	);

	it('names an empty card in two lessons the same in the tree, the picker and Kontrola kurzu', () => {
		// Tree, under the lesson that is listed first; picker and validation have no lesson to ask.
		const tree = cardLabel(doc, 'shared', { lessonId: 'L1', max: 50 });
		const picker = cardNames(doc, 50).get('shared')!.name;
		const message = validate(doc).errors.find(
			(i) => i.code === 'E_DISPLAY_NO_TEXT' && i.ref.blockId === 'shared'
		)!.message;
		expect(tree).toBe('Karta 2');
		expect(picker).toBe(tree);
		expect(message).toContain(`„${tree}“`);
	});

	it('counts in the lesson it is asked about, and in the first lesson when it is not asked', () => {
		expect(cardLabel(doc, 'shared', { lessonId: 'L2' })).toBe('Karta 1');
		expect(cardLabel(doc, 'shared')).toBe('Karta 2');
		// A lesson that does not hold the card is no reason to count in it.
		expect(cardLabel(doc, 'first', { lessonId: 'L2' })).toBe('Karta 1');
	});

	it('names a card in no lesson by its place among all cards, and says it is outside', () => {
		expect(cardLabel(doc, 'loose')).toBe('Karta 1');
		expect(cardNames(doc).get('loose')).toMatchObject({ name: 'Karta 1', place: 'mimo lekce' });
	});

	it('is never an id, even for a card that is not there', () => {
		expect(cardLabel(doc, 'nowhere')).not.toContain('nowhere');
	});

	it('words the parts of a split card and the steps of a card once', () => {
		expect(partLabel(0, 2)).toBe('část 1/2');
		const block = {
			block_id: 'b',
			type: 'display',
			steps: [{ id: 's7' }, { id: 's8' }]
		} as BlockV2;
		expect(stepName(block, block.steps[1])).toBe('Krok 2');
		expect(stepName(block, block.steps[1], { showIds: true })).toBe('s8');
	});
});
