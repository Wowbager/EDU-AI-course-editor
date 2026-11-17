import { describe, expect, it } from 'vitest';
import { addBlock, addLesson, deleteBlock, setField, unbindBlock } from '../commands';
import { emptyCourse } from '../document';
import { insertOutline } from '../outline-insert';
import {
	DEFAULT_PLACE,
	insertAtOf,
	placeChoices,
	placeForModel,
	placeLabel,
	scopeOf,
	validPlace,
	type Place
} from '../placement';
import { withStarter } from '../starter';
import type { CourseV2 } from '../schema';
import type { Outline } from '../outline';

/** Two lessons with named cards, and a third the editor just added („Nová lekce“, untouched). */
function course(): { doc: CourseV2; a: string; b: string; empty: string; cards: string[] } {
	let doc = emptyCourse('K', 'Zlomky');
	doc = addLesson(doc, 'Co je zlomek').doc;
	doc = addLesson(doc, 'Sčítání').doc;
	const [a, b] = doc.lessons.map((l) => l.lesson_id);
	const cards: string[] = [];
	for (const name of ['Úvod', 'Příklad', 'Test']) {
		const r = addBlock(doc, a, 'display');
		doc = setField(r.doc, { blockId: r.ref!.blockId!, field: 'name' }, name).doc;
		cards.push(r.ref!.blockId!);
	}
	const r = addBlock(doc, b, 'display');
	doc = setField(r.doc, { blockId: r.ref!.blockId!, field: 'name' }, 'Stejný jmenovatel').doc;
	const added = addLesson(doc);
	doc = addBlock(added.doc, added.ref!.lessonId!, 'display').doc;
	return { doc, a, b, empty: added.ref!.lessonId!, cards };
}

describe('the place of a proposal', () => {
	it('is new lessons at the end of the course by default, whatever is selected', () => {
		const { doc } = course();
		expect(scopeOf(doc, DEFAULT_PLACE)).toBe('lessons');
		expect(placeLabel(doc, DEFAULT_PLACE)).toBe('Nová lekce na konec kurzu');
		expect(insertAtOf(doc, DEFAULT_PLACE, 'lessons')).toEqual({});
	});

	it('is cards for a lesson with content, and a lesson for one the editor just made', () => {
		const { doc, a, empty } = course();
		expect(scopeOf(doc, { kind: 'into', lessonId: a, at: 'end' })).toBe('cards');
		expect(scopeOf(doc, { kind: 'into', lessonId: empty, at: 'end' })).toBe('lessons');
		expect(placeLabel(doc, { kind: 'into', lessonId: empty, at: 'end' })).toBe(
			'Do prázdné lekce „Nová lekce“'
		);
		// The empty lesson is replaced in place: the lessons go after it, and it goes.
		expect(insertAtOf(doc, { kind: 'into', lessonId: empty, at: 'end' }, 'lessons')).toEqual({
			lessonId: empty
		});
	});

	it('says in words where it goes', () => {
		const { doc, a, cards } = course();
		expect(placeLabel(doc, { kind: 'new', after: a })).toBe('Nová lekce za „Co je zlomek“');
		expect(placeLabel(doc, { kind: 'into', lessonId: a, at: 'start' })).toBe(
			'Na začátek lekce „Co je zlomek“'
		);
		expect(placeLabel(doc, { kind: 'into', lessonId: a, at: 'end' })).toBe(
			'Na konec lekce „Co je zlomek“'
		);
		expect(placeLabel(doc, { kind: 'into', lessonId: a, at: { after: cards[0] } })).toBe(
			'Do lekce „Co je zlomek“ za „Úvod“'
		);
	});

	it('falls back when what it names is gone', () => {
		const { doc, a, cards } = course();
		const place: Place = { kind: 'into', lessonId: a, at: { after: cards[1] } };
		const without = deleteBlock(unbindBlock(doc, a, cards[1]).doc, cards[1]).doc;
		expect(validPlace(without, place)).toEqual({ kind: 'into', lessonId: a, at: 'end' });
		expect(validPlace(doc, { kind: 'into', lessonId: 'L99', at: 'end' })).toEqual(DEFAULT_PLACE);
		expect(validPlace(doc, { kind: 'new', after: 'L99' })).toEqual(DEFAULT_PLACE);
	});

	it('offers the places around the lesson and card the teacher has open, and the one chosen', () => {
		const { doc, a, b, cards } = course();
		const labels = (open: { lessonId?: string; blockId?: string } | null, now = DEFAULT_PLACE) =>
			placeChoices(doc, open, now).map((c) => c.label);
		expect(labels(null)).toEqual(['Nová lekce na konec kurzu']);
		expect(labels({ lessonId: a, blockId: cards[0] })).toEqual([
			'Nová lekce na konec kurzu',
			'Nová lekce za „Co je zlomek“',
			'Na začátek lekce „Co je zlomek“',
			'Do lekce „Co je zlomek“ za „Úvod“',
			'Na konec lekce „Co je zlomek“'
		]);
		// The last card: „za kartu“ would be the end, so it is not offered twice.
		expect(labels({ lessonId: a, blockId: cards[2] })).not.toContain(
			'Do lekce „Co je zlomek“ za „Test“'
		);
		// A place chosen in another lesson stays on offer, first.
		expect(labels({ lessonId: b }, { kind: 'into', lessonId: a, at: 'start' })[0]).toBe(
			'Na začátek lekce „Co je zlomek“'
		);
	});

	it('tells the model what comes before and after it', () => {
		const { doc, a, b, empty, cards } = course();
		expect(placeForModel(doc, DEFAULT_PLACE)).toEqual({
			scope: 'lessons',
			after_lesson: 'Sčítání',
			replaces_empty_lesson: 'Nová lekce'
		});
		expect(placeForModel(doc, { kind: 'new', after: a })).toEqual({
			scope: 'lessons',
			after_lesson: 'Co je zlomek',
			before_lesson: 'Sčítání'
		});
		expect(placeForModel(doc, { kind: 'into', lessonId: empty, at: 'end' })).toEqual({
			scope: 'lessons',
			after_lesson: 'Sčítání',
			replaces_empty_lesson: 'Nová lekce'
		});
		expect(placeForModel(doc, { kind: 'into', lessonId: a, at: { after: cards[0] } })).toEqual({
			scope: 'cards',
			lesson: 'Co je zlomek',
			cards_before: ['Úvod'],
			cards_after: ['Příklad', 'Test']
		});
		expect(placeForModel(doc, { kind: 'into', lessonId: b, at: 'start' })).toMatchObject({
			cards_before: [],
			cards_after: ['Stejný jmenovatel']
		});
	});
});

describe('a proposal put where it was meant to go', () => {
	const cards: Outline = { scope: 'cards', cards: [{ kind: 'question', name: 'Test předem' }] };

	it('puts cards at the start of a lesson', () => {
		const { doc, a, cards: ids } = course();
		const at = insertAtOf(doc, { kind: 'into', lessonId: a, at: 'start' }, 'cards');
		const next = insertOutline(doc, cards, at).doc;
		const lesson = next.lessons.find((l) => l.lesson_id === a)!;
		expect(lesson.blocks).toHaveLength(4);
		expect(lesson.blocks.slice(1).map((b) => b.block_id)).toEqual(ids);
	});

	it('puts new lessons at the end, in place of an empty lesson the editor made there', () => {
		const { doc } = course();
		const lessons: Outline = {
			scope: 'lessons',
			lessons: [{ name: 'Odčítání', cards: [{ kind: 'display', name: 'Úvod' }] }]
		};
		const next = insertOutline(doc, lessons, insertAtOf(doc, DEFAULT_PLACE, 'lessons')).doc;
		expect(next.lessons.map((l) => l.name)).toEqual(['Co je zlomek', 'Sčítání', 'Odčítání']);
	});

	it('replaces a new course’s starter lesson', () => {
		const doc = withStarter(emptyCourse('K', 'Zlomky')).doc;
		const lessons: Outline = {
			scope: 'lessons',
			lessons: [{ name: 'Zlomky', cards: [{ kind: 'display', name: 'Úvod' }] }]
		};
		const next = insertOutline(doc, lessons, insertAtOf(doc, DEFAULT_PLACE, 'lessons')).doc;
		expect(next.lessons.map((l) => l.name)).toEqual(['Zlomky']);
	});
});
