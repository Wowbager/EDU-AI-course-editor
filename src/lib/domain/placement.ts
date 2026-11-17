/**
 * Where what the AI panel makes goes in the course: the teacher's choice („Kam“), made
 * before the proposal, because the place changes what is proposed (a test before the
 * explanation is not the test after it). The selection never decides it by itself: it
 * only offers the lesson and card it is on as places to choose.
 *
 *  - `new`: new lessons, at the end of the course or after a lesson;
 *  - `into`: cards into a lesson, at its start, at its end or after one of its cards.
 *
 * Cards into a lesson still as the editor made it („Nová lekce“ with its empty card) are a
 * lesson that stands in for it instead (`scopeOf`), so the AI names it.
 */
import type { CourseV2 } from './schema';
import { isUntouchedLesson } from './starter';
import type { InsertAt } from './outline-insert';

export type Place =
	| { kind: 'new'; after?: string }
	| { kind: 'into'; lessonId: string; at: 'start' | 'end' | { after: string } };

export const DEFAULT_PLACE: Place = { kind: 'new' };

/** The place as it still can be: a lesson or card that is gone falls back to the nearest. */
export function validPlace(doc: CourseV2, place: Place): Place {
	if (place.kind === 'new') {
		return place.after !== undefined && doc.lessons.some((l) => l.lesson_id === place.after)
			? place
			: DEFAULT_PLACE;
	}
	const lesson = doc.lessons.find((l) => l.lesson_id === place.lessonId);
	if (lesson === undefined) return DEFAULT_PLACE;
	const at = place.at;
	if (typeof at === 'object' && !lesson.blocks.some((b) => b.block_id === at.after))
		return { ...place, at: 'end' };
	return place;
}

export function samePlace(a: Place, b: Place): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** What the place asks of the proposal: lessons, or cards for one lesson. */
export function scopeOf(doc: CourseV2, place: Place): 'lessons' | 'cards' {
	const valid = validPlace(doc, place);
	return valid.kind === 'into' && !isUntouchedLesson(doc, valid.lessonId) ? 'cards' : 'lessons';
}

/** Where `insertOutline` puts a proposal of `scope` made for `place`. */
export function insertAtOf(doc: CourseV2, place: Place, scope: 'lessons' | 'cards'): InsertAt {
	const valid = validPlace(doc, place);
	if (valid.kind === 'new') return valid.after !== undefined ? { lessonId: valid.after } : {};
	if (scope === 'lessons') return { lessonId: valid.lessonId };
	const at = valid.at;
	if (at === 'start') return { lessonId: valid.lessonId, start: true };
	if (at === 'end') return { lessonId: valid.lessonId };
	return { lessonId: valid.lessonId, blockId: at.after };
}

const MAX_NAME = 32;
const short = (name: string): string =>
	name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1).trimEnd()}…` : name;
const quoted = (name: string) => `„${short(name)}“`;

/** The name the teacher sees for a lesson or card; `fallback` when it has none. */
function lessonName(doc: CourseV2, lessonId: string): string {
	return doc.lessons.find((l) => l.lesson_id === lessonId)?.name?.trim() || 'Lekce bez názvu';
}
function cardName(doc: CourseV2, blockId: string, fallback: string): string {
	return doc.blocks.find((b) => b.block_id === blockId)?.name?.trim() || fallback;
}

/** The place in the words of the „Kam“ line. */
export function placeLabel(doc: CourseV2, place: Place): string {
	const valid = validPlace(doc, place);
	if (valid.kind === 'new')
		return valid.after === undefined
			? 'Nová lekce na konec kurzu'
			: `Nová lekce za ${quoted(lessonName(doc, valid.after))}`;
	const lesson = quoted(lessonName(doc, valid.lessonId));
	if (isUntouchedLesson(doc, valid.lessonId)) return `Do prázdné lekce ${lesson}`;
	const at = valid.at;
	if (at === 'start') return `Na začátek lekce ${lesson}`;
	if (at === 'end') return `Na konec lekce ${lesson}`;
	return `Do lekce ${lesson} za ${quoted(cardName(doc, at.after, 'vybranou kartu'))}`;
}

/** One place the „Kam“ menu offers, with its words. */
export interface PlaceChoice {
	place: Place;
	label: string;
}

/**
 * The places the „Kam“ menu offers: new lessons at the end, and around the lesson and card
 * the teacher has open; the place chosen now is always among them.
 */
export function placeChoices(
	doc: CourseV2,
	open: { lessonId?: string; blockId?: string } | null | undefined,
	current: Place
): PlaceChoice[] {
	const places: Place[] = [DEFAULT_PLACE];
	const lesson = doc.lessons.find((l) => l.lesson_id === open?.lessonId);
	if (lesson !== undefined) {
		const id = lesson.lesson_id;
		if (doc.lessons.at(-1)?.lesson_id !== id) places.push({ kind: 'new', after: id });
		if (isUntouchedLesson(doc, id)) places.push({ kind: 'into', lessonId: id, at: 'end' });
		else {
			places.push({ kind: 'into', lessonId: id, at: 'start' });
			const card = lesson.blocks.findIndex((b) => b.block_id === open?.blockId);
			if (card >= 0 && card < lesson.blocks.length - 1)
				places.push({ kind: 'into', lessonId: id, at: { after: lesson.blocks[card].block_id } });
			places.push({ kind: 'into', lessonId: id, at: 'end' });
		}
	}
	const now = validPlace(doc, current);
	const all = places.some((p) => samePlace(p, now)) ? places : [now, ...places];
	return all.map((place) => ({ place, label: placeLabel(doc, place) }));
}

/** The place as the model reads it: names, and what comes before and after it. */
export interface PlaceForModel {
	/** What the proposal is: new lessons, or cards for one lesson. */
	scope: 'lessons' | 'cards';
	/** For lessons: the lesson they come after and the one after them; none at an end. */
	after_lesson?: string;
	before_lesson?: string;
	/** For lessons: they take the place of an empty lesson the teacher made. */
	replaces_empty_lesson?: string;
	/** For cards: the lesson, and the cards of it before and after the new ones. */
	lesson?: string;
	cards_before?: string[];
	cards_after?: string[];
}

const named = (doc: CourseV2, ids: readonly string[]): string[] =>
	ids.map((id, i) => cardName(doc, id, `karta ${i + 1}`));

export function placeForModel(doc: CourseV2, place: Place): PlaceForModel {
	const valid = validPlace(doc, place);
	const scope = scopeOf(doc, valid);
	const nameAt = (i: number) => {
		const name = i < 0 ? undefined : doc.lessons[i]?.name?.trim();
		return name === undefined || name === '' ? undefined : name;
	};
	if (scope === 'lessons') {
		// The lesson they go after (the last, at the end); an empty one gives way to them.
		const anchor =
			valid.kind === 'into' ? valid.lessonId : (valid.after ?? doc.lessons.at(-1)?.lesson_id);
		const i = doc.lessons.findIndex((l) => l.lesson_id === anchor);
		const replaced = i >= 0 && isUntouchedLesson(doc, doc.lessons[i].lesson_id);
		const afterName = nameAt(replaced ? i - 1 : i);
		const atEnd = valid.kind === 'new' && valid.after === undefined;
		const beforeName = atEnd ? undefined : nameAt(i + 1);
		return {
			scope,
			...(afterName !== undefined ? { after_lesson: afterName } : {}),
			...(beforeName !== undefined ? { before_lesson: beforeName } : {}),
			...(replaced ? { replaces_empty_lesson: lessonName(doc, doc.lessons[i].lesson_id) } : {})
		};
	}
	const into = valid as Extract<Place, { kind: 'into' }>;
	const lesson = doc.lessons.find((l) => l.lesson_id === into.lessonId)!;
	const ids = lesson.blocks.map((b) => b.block_id);
	const cut =
		into.at === 'start' ? 0 : into.at === 'end' ? ids.length : ids.indexOf(into.at.after) + 1;
	const names = named(doc, ids);
	return {
		scope,
		lesson: lessonName(doc, into.lessonId),
		cards_before: names.slice(0, cut),
		cards_after: names.slice(cut)
	};
}
