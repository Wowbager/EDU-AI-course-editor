import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCourse } from '../document';
import { dropCard, parseBackpack, rewriteBackpack, saveCard, serializeBackpack } from '../backpack';
import { pasteBlock } from '../commands';

const course = parseCourse(
	JSON.parse(
		readFileSync(fileURLToPath(new URL('./fixtures/spec-16-course.json', import.meta.url)), 'utf8')
	)
);
const block = course.blocks[0];
const where = (id: string) => ({
	id,
	savedAt: '2026-11-19T10:00:00.000Z',
	from: { courseId: course.course_id, blockId: block.block_id },
	courseName: course.name
});

describe('Moje karty', () => {
	it('survives a round trip through storage, newest first', () => {
		let cards = saveCard([], block, where('a'));
		cards = saveCard(cards, course.blocks[1], where('b'));
		const back = parseBackpack(serializeBackpack(cards));
		expect(back.map((c) => c.id)).toEqual(['b', 'a']);
		expect(back[1].block).toEqual(block);
		expect(back[1].courseName).toBe(course.name);
	});

	it('keeps a copy: a later change to the course does not reach it', () => {
		const cards = saveCard([], block, where('a'));
		(block.steps[0] as { id: string }).id = 'changed';
		try {
			expect(cards[0].block.steps[0].id).not.toBe('changed');
		} finally {
			(block.steps[0] as { id: string }).id = cards[0].block.steps[0].id;
		}
	});

	it('is empty when nothing or something unreadable is stored', () => {
		expect(parseBackpack(null)).toEqual([]);
		expect(parseBackpack('{')).toEqual([]);
		expect(parseBackpack('{"version":99,"cards":[]}')).toEqual([]);
	});

	it('drops one broken entry and keeps the rest', () => {
		const good = saveCard([], block, where('a'));
		const text = JSON.stringify({ version: 1, cards: [{ id: 'x' }, ...good] });
		expect(parseBackpack(text).map((c) => c.id)).toEqual(['a']);
	});

	it('is not written over when a newer build stored it', () => {
		expect(rewriteBackpack('{"version":2,"cards":[]}', (c) => c)).toBeNull();
	});

	it('replaces storage that is not JSON at all, and starts from nothing', () => {
		const text = rewriteBackpack('{', (c) => saveCard(c, block, where('a')));
		expect(parseBackpack(text).map((c) => c.id)).toEqual(['a']);
		expect(parseBackpack(rewriteBackpack(null, (c) => c))).toEqual([]);
	});

	it('replaces another shape no build can read', () => {
		for (const stored of ['{}', '[]', 'null', '{"version":1}', '{"version":0,"cards":[]}']) {
			const text = rewriteBackpack(stored, (c) => saveCard(c, block, where('a')));
			expect(parseBackpack(text).map((c) => c.id)).toEqual(['a']);
		}
	});

	it('keeps keys a newer build added to an entry it can read', () => {
		const [entry] = saveCard([], block, where('a'));
		const stored = JSON.stringify({
			version: 1,
			cards: [{ ...entry, pinned: true, from: { ...entry.from, extra: 1 } }]
		});
		const text = rewriteBackpack(stored, (c) => saveCard(c, block, where('b')))!;
		expect(JSON.parse(text).cards[1]).toMatchObject({
			id: 'a',
			pinned: true,
			from: { extra: 1 }
		});
	});

	it('keeps what a change did to a stored card', () => {
		const [entry] = saveCard([], block, where('a'));
		const stored = JSON.stringify({ version: 1, cards: [{ ...entry, pinned: true }] });
		const text = rewriteBackpack(stored, (c) =>
			c.map((card) => ({ ...card, courseName: 'Jiný' }))
		)!;
		expect(JSON.parse(text).cards[0]).toMatchObject({ courseName: 'Jiný', pinned: true });
	});

	it('keeps an entry it cannot read when it saves another', () => {
		const odd = { id: 'z', from: {}, block: { kind: 'from a newer build' } };
		const stored = JSON.stringify({ version: 1, cards: [odd] });
		const text = rewriteBackpack(stored, (c) => saveCard(c, block, where('a')))!;
		expect(parseBackpack(text).map((c) => c.id)).toEqual(['a']);
		expect(JSON.parse(text).cards).toContainEqual(odd);
	});

	it('removes only the entry asked for', () => {
		let cards = saveCard([], block, where('a'));
		cards = saveCard(cards, block, where('b'));
		expect(dropCard(cards, 'a').map((c) => c.id)).toEqual(['b']);
	});

	it('pastes into another course as a new card, without its links to the old one', () => {
		const [saved] = saveCard([], block, where('a'));
		const other = { ...course, course_id: 'jiny-kurz' };
		const result = pasteBlock(
			other,
			saved.block,
			other.lessons[0].lesson_id,
			undefined,
			undefined,
			saved.from
		);
		const id = result.ref!.blockId!;
		expect(id).not.toBe(block.block_id);
		expect(result.doc.blocks.find((b) => b.block_id === id)?.steps.length).toBe(block.steps.length);
		expect(result.doc.lessons[0].blocks.at(-1)?.block_id).toBe(id);
	});
});
