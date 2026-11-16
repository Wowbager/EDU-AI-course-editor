import { describe, expect, it } from 'vitest';
import { addBlock, addLesson } from '../commands';
import { emptyCourse } from '../document';
import { SOURCE_REFS_KEY, sourceRefsOf } from '../authoring';
import { FULL_TEXT_TOKENS, fitsFully, type Section } from '../materials';
import {
	buildSourcesRequest,
	cardsWithoutSources,
	setSourceRefs,
	sourcesRequestSchema,
	sourcesWanted,
	usableSources
} from '../source-assign';
import type { CourseV2 } from '../schema';

const section = (i: number, chars: number): Section => ({
	key: `abcdef01.${i}`,
	file: 'Učebnice.pdf',
	title: `Kapitola ${i}`,
	unit: 'page',
	from: i + 1,
	text: 'x'.repeat(chars)
});
/** Over the limit together (`fitsFully`), each well under it. */
const long = [section(0, FULL_TEXT_TOKENS * 2), section(1, FULL_TEXT_TOKENS * 2)];
const short = [section(0, 100), section(1, 100)];

function course(): { doc: CourseV2; cards: { blockId: string; lessonId: string }[] } {
	let doc = addLesson(emptyCourse('K', 'Zlomky'), 'Polovina').doc;
	const lessonId = doc.lessons[0].lesson_id;
	const cards: { blockId: string; lessonId: string }[] = [];
	for (const [type, name] of [
		['display', 'Co je půlka'],
		['exercise', 'Příklady']
	] as const) {
		const added = addBlock(doc, lessonId, type);
		const blockId = added.ref!.blockId!;
		doc = {
			...added.doc,
			blocks: added.doc.blocks.map((b) => (b.block_id === blockId ? { ...b, name } : b))
		};
		cards.push({ blockId, lessonId });
	}
	return { doc, cards };
}

describe('naming the sources of cards that have none', () => {
	it('is wanted only when there are materials and they do not all fit', () => {
		expect(fitsFully(long)).toBe(false);
		expect(sourcesWanted(long)).toBe(true);
		expect(sourcesWanted(short)).toBe(false);
		expect(sourcesWanted([])).toBe(false);
	});

	it('asks about the cards with no sources, by kind, name and lesson, with the index only', () => {
		const { doc, cards } = course();
		const withRefs = {
			...doc,
			blocks: doc.blocks.map((b, i) => (i === 0 ? { ...b, [SOURCE_REFS_KEY]: ['abcdef01.0'] } : b))
		};
		const wanted = cardsWithoutSources(withRefs, [...cards, { blockId: 'gone', lessonId: 'L1' }]);
		expect(wanted).toEqual([cards[1]]);
		const request = buildSourcesRequest(doc, cards, long);
		expect(sourcesRequestSchema.safeParse(request).success).toBe(true);
		expect(request.cards).toEqual([
			{ id: '1', kind: 'display', name: 'Co je půlka', lesson: 'Polovina' },
			{ id: '2', kind: 'exercise', name: 'Příklady', lesson: 'Polovina' }
		]);
		expect(request.material_keys).toEqual(['abcdef01.0', 'abcdef01.1']);
		expect(request.materials).toContain('[abcdef01.1]');
		expect(request.materials).not.toContain('x'.repeat(300));
	});

	it('keeps only known cards and keys, and no card with none', () => {
		const { doc, cards } = course();
		const request = buildSourcesRequest(doc, cards, long);
		expect(
			usableSources(request, {
				cards: [
					{ id: '1', sources: ['abcdef01.1', 'made.up', 'abcdef01.1'] },
					{ id: '2', sources: ['made.up'] },
					{ id: '9', sources: ['abcdef01.0'] }
				]
			})
		).toEqual([{ id: '1', sources: ['abcdef01.1'] }]);
		expect(usableSources(request, { nope: 1 })).toEqual([]);
	});

	it('writes them on the cards by place, never over sources a card has, and not on a card that is gone', () => {
		const { doc, cards } = course();
		const assigned = [
			{ id: '1', sources: ['abcdef01.0'] },
			{ id: '2', sources: ['abcdef01.1'] }
		];
		const result = setSourceRefs(doc, cards, assigned);
		expect(result.doc.blocks.map(sourceRefsOf)).toEqual([['abcdef01.0'], ['abcdef01.1']]);
		// Again: nothing changes, the same document.
		expect(setSourceRefs(result.doc, cards, assigned).doc).toBe(result.doc);
		const gone = { ...doc, blocks: [] };
		expect(setSourceRefs(gone, cards, assigned).doc).toBe(gone);
	});
});
