import { describe, expect, it } from 'vitest';
import {
	FULL_TEXT_TOKENS,
	fitsFully,
	displayName,
	locationOf,
	materialFileSchema,
	materialsIndex,
	MAX_FILES,
	MAX_FILE_BYTES,
	MAX_PAGES,
	MAX_PICTURES,
	pictureKeys,
	picturesFor,
	picturesIn,
	refusal,
	renderMaterials,
	sectionKey,
	sectionsOf,
	sourceLine,
	splitMarkdown,
	type Section
} from '../materials';
import { addBlock, addLesson } from '../commands';
import { emptyCourse } from '../document';
import { buildGenRequest, sourceRefsOf } from '../authoring';
import { buildOutlineRequest, toOutline, draftOf, keyMaker } from '../outline';
import { insertOutline } from '../outline-insert';

const section = (over: Partial<Section> = {}): Section => ({
	key: 'aaaaaaaa.0',
	file: 'Učebnice.pdf',
	title: 'Strana 1',
	unit: 'page',
	from: 1,
	to: 1,
	text: 'Zlomek má čitatele a jmenovatele.',
	...over
});

/** A section of about `tokens` tokens (3 characters each). */
const big = (n: number, tokens: number, over: Partial<Section> = {}): Section =>
	section({
		key: `aaaaaaaa.${n}`,
		title: `Kapitola ${n}`,
		from: n + 1,
		to: n + 1,
		text: `Začátek kapitoly ${n}. ${'a'.repeat(tokens * 3)}`,
		...over
	});

describe('where a section came from', () => {
	it('says pages and slides in the way a teacher would, ranges joined', () => {
		expect(locationOf([section({ from: 3, to: 4 })])).toBe('str. 3–4');
		expect(locationOf([section({ from: 3, to: 3 }), section({ from: 4, to: 4 })])).toBe('str. 3–4');
		expect(locationOf([section({ from: 3, to: 3 }), section({ from: 7, to: 7 })])).toBe(
			'str. 3, 7'
		);
		expect(locationOf([section({ unit: 'slide', from: 5, to: 5 })])).toBe('snímek 5');
		expect(locationOf([section({ unit: 'slide', from: 2, to: 4 })])).toBe('snímky 2–4');
		expect(locationOf([section({ unit: undefined, from: undefined, to: undefined })])).toBe('');
	});

	it('makes the quiet line under a proposed card, per file, without the extension', () => {
		const sections = [
			section({ key: 'a.0', from: 3, to: 3 }),
			section({ key: 'a.1', from: 4, to: 4 }),
			section({ key: 'b.0', file: 'Prezentace.pptx', unit: 'slide', from: 5, to: 5 }),
			section({ key: 'c.0', file: 'Zápis.docx', unit: undefined, from: undefined, to: undefined })
		];
		expect(sourceLine(sections, ['a.0', 'a.1'])).toBe('Učebnice · str. 3–4');
		expect(sourceLine(sections, ['b.0', 'c.0'])).toBe('Prezentace · snímek 5; Zápis');
		// A key that is not there (a file taken out since) is left out, and with none left, no line.
		expect(sourceLine(sections, ['a.0', 'gone'])).toBe('Učebnice · str. 3');
		expect(sourceLine(sections, ['gone'])).toBe('');
		expect(sourceLine(sections, [])).toBe('');
	});
});

describe('a file name', () => {
	it('is shown without its extension, and a name that is only an extension stays', () => {
		expect(displayName('Učebnice.pdf')).toBe('Učebnice');
		expect(displayName('a.b.docx')).toBe('a.b');
		expect(displayName('.pdf')).toBe('.pdf');
		expect(displayName('bez-pripony')).toBe('bez-pripony');
	});
});

describe('keys and sections of a file', () => {
	it('keys are the file hash and the place in the file', () => {
		const hash = 'abcdef0123456789';
		expect(sectionKey(hash, 4)).toBe('abcdef01.4');
		const sections = sectionsOf(hash, 'x.docx', [
			{ title: 'A', text: 'a' },
			{ title: 'B', text: 'b', unit: 'page', from: 2, to: 3 }
		]);
		expect(sections.map((s) => s.key)).toEqual(['abcdef01.0', 'abcdef01.1']);
		expect(sections[1]).toMatchObject({ unit: 'page', from: 2, to: 3, file: 'x.docx' });
		expect(materialFileSchema.safeParse({ hash, name: 'x.docx', pages: 1, sections }).success).toBe(
			true
		);
	});

	it('a stored file whose sections belong to another file is not a file', () => {
		const sections = sectionsOf('abcdef0123456789', 'x.docx', [{ title: 'A', text: 'a' }]);
		expect(
			materialFileSchema.safeParse({ hash: '1111111122222222', name: 'x.docx', pages: 1, sections })
				.success
		).toBe(false);
	});
});

describe('cutting a text into sections', () => {
	it('cuts at headings, names what comes before the first one, and skips empty parts', () => {
		const pieces = splitMarkdown(
			'Úvodní věta.\n\n# Rovnice\n\nText.\n\n## Příklad\n\n$x=1$\n\n# Prázdné\n'
		);
		expect(pieces.map((p) => p.title)).toEqual(['Úvod', 'Rovnice', 'Příklad']);
		expect(pieces[1].text).toContain('# Rovnice');
	});

	it('cuts a heading that is too long into parts, and does not take a # in code for a heading', () => {
		const text = `# Dlouhé\n\n${Array.from({ length: 12 }, () => 'b'.repeat(900)).join('\n\n')}`;
		const pieces = splitMarkdown(text);
		expect(pieces.length).toBeGreaterThan(1);
		expect(pieces[1].title).toBe('Dlouhé (2)');
		expect(splitMarkdown('```\n# komentář\n```').map((p) => p.title)).toEqual(['Úvod']);
	});
});

describe('what the model reads', () => {
	const small = [big(0, 100), big(1, 100), big(2, 100)];

	it('knows when everything fits', () => {
		expect(fitsFully(small)).toBe(true);
		expect(fitsFully([big(0, FULL_TEXT_TOKENS), big(1, 10)])).toBe(false);
	});

	it('an index entry has the key, file, title, place, the first 200 characters and a token estimate', () => {
		const [entry] = materialsIndex([big(0, 1000)]);
		expect(entry).toMatchObject({
			key: 'aaaaaaaa.0',
			file: 'Učebnice.pdf',
			title: 'Kapitola 0',
			location: 'str. 1',
			tokens: expect.any(Number)
		});
		expect(entry.start.length).toBeLessThanOrEqual(201);
		expect(entry.start.endsWith('…')).toBe(true);
	});

	it('a proposal gets the index and, when it fits, every section in full', () => {
		const text = renderMaterials(small, { for: 'outline' });
		expect(text).toContain('Index of the materials:');
		expect(text).toContain('[aaaaaaaa.2] Učebnice.pdf, str. 3 — Kapitola 2');
		expect(text).toContain('The materials in full:');
		expect(text).toContain('a'.repeat(300));
	});

	it('a proposal gets only the index when the materials are too long', () => {
		const text = renderMaterials([big(0, FULL_TEXT_TOKENS), big(1, 10)], { for: 'outline' });
		expect(text).toContain('too long to send');
		expect(text).not.toContain('The materials in full:');
		expect(text).not.toContain('a'.repeat(300));
	});

	it('a card gets everything when it fits, and what it draws on is said last, so the rest is the same for every card', () => {
		const withRefs = renderMaterials(small, { for: 'card', refs: ['aaaaaaaa.1'] });
		const without = renderMaterials(small, { for: 'card' });
		expect(withRefs.startsWith(without)).toBe(true);
		expect(withRefs).toContain('This card draws mainly on: [aaaaaaaa.1].');
		expect(without).toContain('a'.repeat(300));
	});

	const long = [big(0, 40_000), big(1, 40_000), big(2, 40_000)];
	it('a card gets the sections it names in full and only the titles of the others when the materials are too long', () => {
		const text = renderMaterials(long, { for: 'card', refs: ['aaaaaaaa.1'] });
		expect(text).toContain('Začátek kapitoly 1.');
		expect(text).not.toContain('Začátek kapitoly 0.');
		expect(text).not.toContain('Začátek kapitoly 2.');
		expect(text).toContain('- [aaaaaaaa.0] Učebnice.pdf, str. 1 — Kapitola 0');
		expect(text).toContain('- [aaaaaaaa.2] Učebnice.pdf, str. 3 — Kapitola 2');
	});

	it('a card that names none gets the index when the materials are too long, and nothing when there are none', () => {
		const text = renderMaterials(long, { for: 'card' });
		expect(text).toContain('Index of the materials');
		expect(text).not.toContain('The sections this card draws on, in full');
		expect(renderMaterials([], { for: 'card', refs: ['x'] })).toBe('');
		expect(renderMaterials([], { for: 'outline' })).toBe('');
	});

	it('named sections too long to all fit go in as far as they fit, the rest by title', () => {
		const text = renderMaterials(long, {
			for: 'card',
			refs: ['aaaaaaaa.0', 'aaaaaaaa.1', 'aaaaaaaa.2']
		});
		expect(text).toContain('Začátek kapitoly 0.');
		expect(text).not.toContain('Začátek kapitoly 1.');
		expect(text).toContain('- [aaaaaaaa.1]');
	});
});

describe('which files are taken', () => {
	it('refuses a big file, too many files and too many pages, each in one line', () => {
		const ok = { name: 'a.pdf', size: 1000 };
		expect(refusal(ok, { files: 0, pages: 0 })).toBeUndefined();
		expect(refusal({ ...ok, size: MAX_FILE_BYTES + 1 }, { files: 0, pages: 0 })).toBe(
			'Soubor a.pdf je větší než 50 MB.'
		);
		expect(refusal(ok, { files: MAX_FILES, pages: 0 })).toMatch(/příliš mnoho/);
		expect(refusal(ok, { files: 1, pages: 90 }, 11)).toBe(
			`Podklady mohou mít nejvýše ${MAX_PAGES} stran nebo snímků.`
		);
		expect(refusal(ok, { files: 1, pages: 90 }, 10)).toBeUndefined();
	});
});

describe('pictures among the materials', () => {
	const ID = '0123abcd-0000-4000-8000-000000000001-pizza.jpg';
	const pic = (n: number) =>
		section({
			key: `bbbbbbbb.${n}`,
			file: `obrazek${n}.jpg`,
			title: `obrazek${n}`,
			unit: undefined,
			from: undefined,
			to: undefined,
			text: '',
			picture: ID
		});
	const sections = [section(), pic(0), pic(1)];

	it('is said in the text by its key, the picture itself going with the request', () => {
		const text = renderMaterials(sections, { for: 'outline' });
		expect(text).toContain('[bbbbbbbb.0] obrazek0.jpg — obrazek0 (~0 tokens): (a picture)');
		expect(text).toContain('follows as picture [bbbbbbbb.1]');
	});

	it('all go with a proposal or a plan, only the ones they draw on with cards', () => {
		expect(picturesFor(sections, { for: 'outline' })).toEqual([
			{ key: 'bbbbbbbb.0', id: ID },
			{ key: 'bbbbbbbb.1', id: ID }
		]);
		expect(picturesFor(sections, { for: 'lesson', refs: ['bbbbbbbb.1', 'aaaaaaaa.0'] })).toEqual([
			{ key: 'bbbbbbbb.1', id: ID }
		]);
		expect(picturesFor(sections, { for: 'card' })).toEqual([]);
		expect(pictureKeys(sections)).toEqual(['bbbbbbbb.0', 'bbbbbbbb.1']);
	});

	it('are kept with their file and counted against their own limit', () => {
		const file = materialFileSchema.parse({
			hash: 'bbbbbbbb00',
			name: 'obrazek0.jpg',
			pages: 1,
			sections: [{ ...pic(0), file: 'obrazek0.jpg' }]
		});
		expect(file.sections[0].picture).toBe(ID);
		expect(picturesIn([file, file])).toBe(2);
		const photo = { name: 'c.jpg', size: 1000 };
		const have = { files: 3, pages: 3, pictures: MAX_PICTURES };
		expect(refusal(photo, have, undefined, true)).toContain(`nejvýše ${MAX_PICTURES}`);
		// A document is not a picture: the limit is not its.
		expect(refusal(photo, have)).toBeUndefined();
	});
});

describe('a proposal and a card with materials', () => {
	const sections = [big(0, 10), big(1, 10)];

	it('the proposal request carries the materials and their keys, and none without materials', () => {
		const doc = emptyCourse('K', 'Zlomky');
		const plain = buildOutlineRequest(doc, null, 'Kurz');
		expect(plain.materials).toBeUndefined();
		expect(plain.material_keys).toBeUndefined();
		const request = buildOutlineRequest(doc, null, 'Kurz', undefined, sections);
		expect(request.material_keys).toEqual(['aaaaaaaa.0', 'aaaaaaaa.1']);
		expect(request.materials).toContain('Kapitola 1');
	});

	it('keeps the sources of a card through the draft and back, and puts only keys on the inserted card', () => {
		const outline = {
			scope: 'lessons' as const,
			lessons: [
				{
					name: 'Lekce',
					cards: [
						{ kind: 'display' as const, name: 'S podklady', sources: ['aaaaaaaa.0', 'aaaaaaaa.1'] },
						{ kind: 'display' as const, name: 'Bez podkladů' }
					]
				}
			]
		};
		const draft = draftOf(outline, keyMaker());
		expect(toOutline(draft)).toEqual(outline);

		const doc = emptyCourse('K', 'Zlomky');
		const result = insertOutline(doc, outline);
		const [first, second] = result.added.map((a) =>
			result.doc.blocks.find((b) => b.block_id === a.blockId)
		);
		expect(sourceRefsOf(first)).toEqual(['aaaaaaaa.0', 'aaaaaaaa.1']);
		expect(JSON.stringify(first)).not.toContain('Začátek kapitoly');
		expect(sourceRefsOf(second)).toEqual([]);
		expect('source_refs' in second!).toBe(false);
	});

	it('the card request carries the rendered materials when there are some', () => {
		let doc = addLesson(emptyCourse('K', 'Zlomky'), 'Lekce').doc;
		const added = addBlock(doc, doc.lessons[0].lesson_id, 'display');
		doc = added.doc;
		const id = added.ref!.blockId!;
		expect(buildGenRequest(doc, id, undefined, 'dossier')?.materials).toBeUndefined();
		expect(buildGenRequest(doc, id, undefined, 'dossier', 'MATERIALS')?.materials).toBe(
			'MATERIALS'
		);
	});
});

describe('materials for the cards of one lesson', () => {
	const small = [big(0, 100), big(1, 100), big(2, 100)];
	const long = [big(0, 40_000), big(1, 40_000), big(2, 40_000)];

	it('never says which section a card draws mainly on', () => {
		const text = renderMaterials(small, { for: 'lesson', refs: ['aaaaaaaa.1'] });
		expect(text).not.toContain('draws mainly on');
	});

	it('when everything fits is the card text without that line, whatever the refs, so it is a cached prefix', () => {
		const card = renderMaterials(small, { for: 'card' });
		expect(renderMaterials(small, { for: 'lesson' })).toBe(card);
		expect(renderMaterials(small, { for: 'lesson', refs: ['aaaaaaaa.1'] })).toBe(card);
		expect(renderMaterials(small, { for: 'lesson', refs: ['aaaaaaaa.0', 'aaaaaaaa.2'] })).toBe(
			card
		);
		expect(renderMaterials(small, { for: 'card', refs: ['aaaaaaaa.1'] }).startsWith(card)).toBe(
			true
		);
	});

	it('when it does not fit, gives the named sections in full and the rest by title, worded "these cards"', () => {
		const text = renderMaterials(long, { for: 'lesson', refs: ['aaaaaaaa.1'] });
		expect(text).toContain('The sections these cards draw on, in full:');
		expect(text).not.toContain('this card draws');
		expect(text).toContain('Začátek kapitoly 1.');
		expect(text).not.toContain('Začátek kapitoly 0.');
		expect(text).not.toContain('Začátek kapitoly 2.');
		expect(text).toContain('- [aaaaaaaa.0] Učebnice.pdf, str. 1 — Kapitola 0');
		expect(text).toContain('- [aaaaaaaa.2] Učebnice.pdf, str. 3 — Kapitola 2');
	});

	it('when it does not fit and nothing is named, gives the index, worded "these cards"', () => {
		const text = renderMaterials(long, { for: 'lesson' });
		expect(text).toContain('no section is named for these cards');
		expect(text).not.toContain('this card');
		expect(text).toContain('[aaaaaaaa.1]');
		expect(text).not.toContain('The sections these cards draw on, in full');
	});

	it('named sections too long to all fit go in as far as they fit, the rest by title', () => {
		const text = renderMaterials(long, {
			for: 'lesson',
			refs: ['aaaaaaaa.0', 'aaaaaaaa.1', 'aaaaaaaa.2']
		});
		expect(text).toContain('Začátek kapitoly 0.');
		expect(text).not.toContain('Začátek kapitoly 1.');
		expect(text).toContain('- [aaaaaaaa.1]');
	});

	it('is empty when there are no materials', () => {
		expect(renderMaterials([], { for: 'lesson', refs: ['x'] })).toBe('');
	});
});
