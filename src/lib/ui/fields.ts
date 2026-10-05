/**
 * Which field belongs to which editing mode, declared once.
 *
 * The three modes are **cumulative** — `teacher` ⊂ `metodik` ⊂ `advanced` — so a
 * spec's `mode` is the *lowest* mode in which that field is editable. The partition
 * follows one question: what does the student actually experience because of this
 * field? Fields with a direct, visible consequence are the teacher's; fields that
 * shape how the platform *measures* the student are the metodik's; everything the
 * format can carry is the advanced author's.
 *
 * `fields.test.ts` asserts that every key in `KEY_ORDER` appears here exactly once,
 * or in `NOT_EDITABLE` with a reason. That is what makes "the advanced mode shows
 * everything the other two do not" a tested property rather than an intention: a
 * field added to the schema without a home fails the suite.
 */

import type { Ref } from '$lib/domain/ref';

/**
 * The three editing modes, in increasing order of exposure. They are cumulative:
 * a mode shows everything the modes below it show, plus its own additions.
 *
 *  - `teacher`  the bare minimum that makes a course work — content and answers.
 *  - `metodik`  adds the didactics: practice enrolment and the knowledge vector.
 *  - `advanced` adds everything else the format can carry, ids included.
 */
export const MODES = ['teacher', 'metodik', 'advanced'] as const;

export type Mode = (typeof MODES)[number];

export const MODE_RANK: Record<Mode, number> = {
	teacher: 0,
	metodik: 1,
	advanced: 2
};

export const MODE_LABELS: Record<Mode, { label: string; title: string }> = {
	teacher: {
		label: 'Učitel',
		title: 'Jen to, co je potřeba, aby kurz fungoval — obsah, odpovědi, větvení'
	},
	metodik: {
		label: 'Metodik',
		title: 'Navíc didaktika: zařazení do cvičení a znalostní vektor'
	},
	advanced: {
		label: 'Pokročilý',
		title: 'Vše ostatní, co formát umí — identifikátory, FSRS, adaptace, předpoklady'
	}
};

/** Where in the document a field lives. Decides which editor renders it. */
export type FieldLevel = 'course' | 'lesson' | 'binding' | 'block' | 'step' | 'question' | 'option';

export type FieldKind = 'text' | 'multiline' | 'number' | 'toggle' | 'select' | 'custom';

export interface FieldSpec {
	level: FieldLevel;
	/** Dotted path relative to its level — exactly what `setField` takes. */
	path: string;
	/** The lowest mode in which this field is editable. */
	mode: Mode;
	/**
	 * Which fold of its dialog the field sits in: an `id` from `SECTIONS[level]`.
	 * `main` is the part that is always open; the rest are named by what they do,
	 * never by the mode that first shows them.
	 */
	section: string;
	label: string;
	kind: FieldKind;
	/** What it does to the student. Shown under the control; house style is consequences. */
	hint?: string;
	/** For `select`. */
	options?: readonly { value: string; label: string }[];
	/** For `select`: the document stores the chosen option as a number, not a string. */
	numeric?: true;
	/** Set when a hand-written component owns this field rather than `FieldGroup`. */
	custom?: true;
	/**
	 * Nothing downstream reads this key today — neither the app nor the API
	 * (`docs/spec/COURSE-EDITOR-SPEC.md` marks it ⚪). It is kept and exported, because
	 * the format carries it and it documents intent, and none may be offered in
	 * teacher mode. The screen does not say so (the owner plans to make them work,
	 * OPEN-PROBLEMS #41); the flag is the record of what the app still has to read.
	 * `fields.test.ts` checks this flag against the spec in both directions.
	 */
	unread?: true;
	/**
	 * Told to the pupil aside from the question: explanations, hints, solution. The
	 * Zpětná vazba toggle hides it while a teacher is shaping the flow of a course.
	 * Never on a field needed to make a question correct.
	 */
	feedback?: true;
	ref?: Ref;
	/**
	 * What the player does when the field is empty, as the teacher would read it
	 * (`'1 den'`, `'0,3'`). Shown as "výchozí …" instead of "nevyplněno". Every field
	 * whose hint names a default has one (`fields.test.ts`).
	 */
	default?: string;
	/**
	 * `datetime`: an ISO timestamp that nothing in the editor writes and nobody should
	 * type. Shown read-only, in Czech form.
	 *
	 * `segmented`: for a `select` with a few short options (the rule of thumb: five or
	 * fewer, set by hand per field, not inferred). Drawn as a Segmented; clicking the
	 * chosen segment again clears the field.
	 */
	display?: 'datetime' | 'segmented';
}

/**
 * What a field's help line says. A field nothing reads (`unread`) is offered as if it
 * worked, so its line is the same as any other's; the flag stays on the spec.
 */
export function hintFor(spec: Pick<FieldSpec, 'hint'>): string | undefined {
	return spec.hint;
}

/**
 * One section of a settings dialog. From Metodik up a dialog lists its sections by
 * name on the left and shows one at a time; in Učitel the first section is the page
 * and the rest are folds under it. Either way a section is titled by what it holds,
 * never by the mode that first shows it.
 */
export interface SectionSpec {
	id: string;
	/** The heading, and the section's name in the dialog's list. */
	label: string;
	/** The first section of a level: the page in Učitel, the one a dialog opens on. */
	open?: true;
	/** Which icon stands beside the name in the list; `ui/section-icons.ts` draws it. */
	icon: string;
	/**
	 * Words the search finds this section by, beyond its label and its fields' labels
	 * and hints: what its hand-written controls are about.
	 */
	keywords?: string;
	/**
	 * For a section whose content is not a field (the lesson's percentages): the lowest
	 * mode that shows it. A section with fields needs no mode, it follows them.
	 */
	mode?: Mode;
}

const MAIN: SectionSpec = { id: 'main', label: 'Základní', open: true, icon: 'main' };

/** The sections of each level, in the order a dialog lists them. */
export const SECTIONS: Record<FieldLevel, readonly SectionSpec[]> = {
	course: [
		{ ...MAIN, keywords: 'typ kurzu test cvičení viditelnost kdo uvidí' },
		{ id: 'ai', label: 'Pro AI lektora', icon: 'ai' },
		{ id: 'run', label: 'Průběh kurzu', icon: 'run' },
		{ id: 'meta', label: 'Údaje o kurzu', icon: 'meta', keywords: 'identifikátor' }
	],
	lesson: [
		{ ...MAIN, keywords: 'počet karet délka' },
		{
			id: 'didactics',
			label: 'Didaktika lekce',
			icon: 'didactics',
			mode: 'metodik',
			keywords: 'zpětná vazba chybné odpovědi karty ve cvičení podíl'
		},
		{ id: 'ai', label: 'Pro AI lektora', icon: 'ai' },
		{ id: 'meta', label: 'Údaje o lekci', icon: 'meta', keywords: 'identifikátor' }
	],
	binding: [{ id: 'lesson', label: 'V této lekci', icon: 'lesson' }],
	block: [
		MAIN,
		{ id: 'ladder', label: 'Nápověda pro celou kartu', icon: 'ladder' },
		{
			id: 'topics',
			label: 'Co karta procvičuje',
			icon: 'topics',
			keywords: 'dovednost dovednosti úroveň je o tom využívá obtížnost RVP výstupy'
		},
		{
			id: 'review',
			label: 'Opakování',
			icon: 'review',
			keywords: 'jak často se karta vrací interval cvičení FSRS'
		},
		{ id: 'followup', label: 'Návaznost', icon: 'followup', keywords: 'předpoklady' },
		{
			id: 'meta',
			label: 'Údaje o kartě',
			icon: 'meta',
			keywords: 'identifikátor více otázek v jedné kartě'
		}
	],
	step: [MAIN, { id: 'extras', label: 'Další nastavení kroku', icon: 'main' }],
	question: [MAIN, { id: 'extras', label: 'Další nastavení kroku', icon: 'main' }],
	option: [MAIN, { id: 'detail', label: 'Podrobnosti odpovědi', icon: 'main' }]
};

export const STATUS_OPTIONS = [
	{ value: 'draft', label: 'Rozpracováno' },
	{ value: 'private', label: 'Soukromé' },
	{ value: 'locked', label: 'Uzamčeno' },
	{ value: 'approved', label: 'Schváleno' },
	{ value: 'published', label: 'Publikováno' }
] as const;

const POSITION_OPTIONS = [
	{ value: 'above', label: 'Nad textem' },
	{ value: 'below', label: 'Pod textem' },
	{ value: 'inline', label: 'V textu' }
] as const;

export const FIELDS: readonly FieldSpec[] = [
	// ── Course ────────────────────────────────────────────────────────────────
	{
		level: 'course',
		path: 'name',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Název kurzu',
		hint: 'Titulek na dlaždici kurzu i v hlavičce přehrávače.'
	},
	{
		level: 'course',
		path: 'description',
		section: 'main',
		mode: 'teacher',
		kind: 'multiline',
		label: 'Popis',
		hint: 'Podtitulek dlaždice. Vidí ho i žák, který si kurz ještě nestáhl.'
	},
	{
		level: 'course',
		path: 'emoji',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Emoji',
		hint: 'Ikona dlaždice. Když ji nevyplníš, odhadne ji server z názvu.'
	},
	{
		level: 'course',
		path: 'pin',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'PIN',
		hint: 'Šest znaků, kterými se žák do kurzu dostane.'
	},

	{
		level: 'course',
		path: 'ai_context',
		section: 'ai',
		unread: true,
		mode: 'metodik',
		kind: 'multiline',
		label: 'Kontext pro AI',
		hint: 'Didaktické poznámky pro doučující AI. Zatím je tutor nečte.'
	},

	// "Cvičení" names two different things in the tool — this one, which is a whole
	// course, and a card type inside a lesson. The hint says which, because a teacher
	// who has just added a Cvičení *card* has no reason to guess that the same word
	// in course settings changes every lesson at once.
	{
		level: 'course',
		path: 'export_type',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Typ kurzu',
		hint: 'Platí pro celý kurz, ne pro jednu kartu: Cvičení vypne větvení ve všech lekcích, Test navíc skryje nápovědy a řešení.',
		custom: true
	},
	{
		level: 'course',
		path: 'status',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Kdo kurz uvidí',
		hint: 'Nastavuje se ve verzích kurzu, spolu se zveřejněním. Žák v knihovně najde jen zveřejněný kurz; soukromý otevře s PINem.',
		custom: true
	},
	{
		level: 'course',
		path: 'version',
		section: 'meta',
		mode: 'advanced',
		kind: 'number',
		label: 'Verze',
		hint: 'Bez zvýšení se aktualizace k už stáhnutým žákům nedostane.'
	},
	{
		level: 'course',
		path: 'language',
		section: 'meta',
		mode: 'advanced',
		kind: 'text',
		label: 'Jazyk',
		hint: 'Filtr v knihovně, například cs. Nepřepíná jazyk aplikace.'
	},
	{
		level: 'course',
		path: 'author',
		section: 'meta',
		mode: 'advanced',
		kind: 'text',
		label: 'Autor',
		hint: 'Jméno uvedené u kurzu v knihovně.'
	},
	{
		level: 'course',
		path: 'updated',
		section: 'meta',
		mode: 'advanced',
		kind: 'text',
		label: 'Naposledy upraveno',
		hint: 'Razítko poslední úpravy; doplní se při uložení.',
		display: 'datetime'
	},
	{
		level: 'course',
		path: 'estimated_minutes',
		section: 'run',
		mode: 'advanced',
		kind: 'number',
		label: 'Odhad délky',
		hint: 'Délka uvedená v knihovně. Bez ní se spočítá z lekcí.'
	},
	{
		level: 'course',
		path: 'max_xp',
		section: 'run',
		mode: 'advanced',
		kind: 'number',
		label: 'Strop XP',
		hint: 'Nejvyšší možný zisk za celý kurz.'
	},
	{
		level: 'course',
		path: 'logged_only',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Jen pro přihlášené',
		hint: 'Jedna z voleb „Kdo kurz uvidí“ ve verzích kurzu. Host kurz uvidí, ale nespustí.',
		custom: true
	},
	{
		level: 'course',
		path: 'only_once',
		section: 'run',
		mode: 'advanced',
		kind: 'toggle',
		label: 'Jen jednou',
		hint: 'Po dokončení se žák do kurzu už nikdy nedostane. Nelze vzít zpět.'
	},
	{
		level: 'course',
		path: 'only_quiz',
		section: 'run',
		mode: 'advanced',
		kind: 'toggle',
		label: 'Kurz je jen kvíz',
		hint: 'Kurz bez lekcí; zobrazí se mezi rychlými kvízy.'
	},
	{
		level: 'course',
		path: 'starts_with_quiz',
		section: 'run',
		mode: 'advanced',
		kind: 'toggle',
		label: 'Začíná kvízem',
		hint: 'Všechny lekce zůstanou zamčené, dokud žák kvíz nedokončí.'
	},
	{
		level: 'course',
		path: 'quiz_evaluate',
		section: 'run',
		mode: 'advanced',
		kind: 'toggle',
		label: 'Vyhodnocovat kvíz',
		hint: 'Bez toho žák odpovídá naslepo — neuvidí, co měl správně.'
	},
	{
		level: 'course',
		path: 'stop_gambling',
		section: 'run',
		unread: true,
		mode: 'advanced',
		kind: 'toggle',
		label: 'Hlídat náhodné klikání',
		hint: 'Zatím nemá v aplikaci žádný účinek.'
	},
	{
		level: 'course',
		path: 'stop_notice',
		section: 'run',
		unread: true,
		mode: 'advanced',
		kind: 'multiline',
		label: 'Hláška při náhodném klikání',
		hint: 'Prázdné použije systémový text.'
	},
	{
		level: 'course',
		path: 'header_image',
		section: 'run',
		mode: 'advanced',
		kind: 'custom',
		label: 'Obrázek v hlavičce',
		hint: 'Banner nad kurzem, zhruba 3:1.',
		custom: true
	},

	// ── Lesson ────────────────────────────────────────────────────────────────
	{
		level: 'lesson',
		path: 'name',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Název lekce',
		hint: 'Titulek karty lekce.'
	},
	{
		level: 'lesson',
		path: 'description',
		section: 'main',
		mode: 'teacher',
		kind: 'multiline',
		label: 'Popis lekce',
		hint: 'Napiš ho jako slib: co žák po lekci zvládne.'
	},

	{
		level: 'lesson',
		path: 'ai_context',
		section: 'ai',
		unread: true,
		mode: 'metodik',
		kind: 'multiline',
		label: 'Kontext pro AI',
		hint: 'Přidá se ke kontextu kurzu. Zatím ho tutor nečte.'
	},

	{
		level: 'lesson',
		path: 'version',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Verze lekce',
		hint: 'Jen pro evidenci; aplikace čte verzi kurzu.'
	},
	{
		level: 'lesson',
		path: 'header_image',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'custom',
		label: 'Obrázek lekce',
		hint: 'Dnes se nevykresluje — použije se banner kurzu.',
		custom: true
	},

	// ── Lesson → block binding ────────────────────────────────────────────────
	// Legacy, and it sits next to the card's own flag — two controls with the same
	// label is exactly the confusion the modes exist to remove. The spec says new
	// content sets the flag on the card, so the metodik only ever sees that one.
	{
		level: 'binding',
		path: 'default_practice',
		section: 'lesson',
		mode: 'advanced',
		kind: 'toggle',
		label: 'Zařadit do cvičení (jen v této lekci)',
		hint: 'Starší způsob. U nového obsahu nastav příznak rovnou na kartě.'
	},
	{
		level: 'binding',
		path: 'bg_color',
		section: 'lesson',
		unread: true,
		mode: 'advanced',
		kind: 'text',
		label: 'Barva karty',
		hint: 'Používej systematicky — třeba jedna barva pro řešené příklady.'
	},
	{
		level: 'binding',
		path: 'bg_image',
		section: 'lesson',
		unread: true,
		mode: 'advanced',
		kind: 'text',
		label: 'Pozadí karty',
		hint: 'Musí být nízkokontrastní, jinak se text přestane dát číst.'
	},

	// ── Block ─────────────────────────────────────────────────────────────────
	// `custom` because the control is the card's own heading in the editor column,
	// not a row in the settings modal: the complaint it answers is about scanning the
	// sidebar, and a title a teacher has to open a dialog to reach is a title nobody
	// sets. `FieldGroup` must therefore not render a second copy of it.
	{
		level: 'block',
		path: 'name',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Název karty',
		hint: 'Jak se karta jmenuje ve stromu vlevo. Prázdné pole vezme první řádek textu karty.',
		custom: true
	},
	{
		level: 'block',
		path: 'duration',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Délka',
		hint: 'Například 3 min. Počítá se z toho čas lekce i tempo v opakování.'
	},
	{
		level: 'block',
		path: 'hint',
		section: 'ladder',
		feedback: true,
		mode: 'teacher',
		kind: 'multiline',
		label: 'Nápověda ke kartě',
		hint: 'Otazník ji ukáže u každého kroku, který nemá vlastní nápovědu. Použití srazí skóre na 0,75.'
	},
	{
		level: 'block',
		path: 'help',
		section: 'ladder',
		feedback: true,
		mode: 'teacher',
		kind: 'multiline',
		label: 'Podrobná pomoc',
		hint: 'Druhá úroveň otazníku, když nápověda nestačila. Použití srazí skóre na 0,5.'
	},

	{
		level: 'block',
		path: 'default_practice',
		section: 'main',
		mode: 'metodik',
		kind: 'toggle',
		label: 'Zařadit do cvičení',
		hint: 'Vhodné pro definice, postupy a fakta — ne pro úvody a přechody. Zhruba pětina až třetina karet.'
	},
	{
		level: 'block',
		path: 'gpf.domain',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'custom',
		label: 'Oblast',
		custom: true
	},
	{
		level: 'block',
		path: 'gpf.construct',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'custom',
		label: 'Konstrukt',
		custom: true
	},
	{
		level: 'block',
		path: 'gpf.subconstruct',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'custom',
		label: 'Téma',
		custom: true
	},
	{
		level: 'block',
		path: 'gpf.relation_vector',
		section: 'topics',
		mode: 'metodik',
		kind: 'custom',
		label: 'Co karta procvičuje',
		custom: true
	},
	{
		level: 'block',
		path: 'gpf.elo_vector',
		section: 'topics',
		mode: 'metodik',
		kind: 'custom',
		label: 'Obtížnost po dovednostech',
		custom: true
	},
	{
		level: 'block',
		path: 'gpf.grade',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'select',
		numeric: true,
		label: 'Ročník',
		hint: 'Pro koho je karta určená.',
		options: [
			{ value: '1', label: '1. ročník' },
			{ value: '2', label: '2. ročník' },
			{ value: '3', label: '3. ročník' },
			{ value: '4', label: '4. ročník' },
			{ value: '5', label: '5. ročník' },
			{ value: '6', label: '6. ročník' },
			{ value: '7', label: '7. ročník' },
			{ value: '8', label: '8. ročník' },
			{ value: '9', label: '9. ročník' },
			{ value: '10', label: '10. ročník' }
		]
	},
	{
		level: 'block',
		path: 'gpf.level',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'select',
		display: 'segmented',
		numeric: true,
		// Not just „Úroveň“: the skills right above it have levels of their own.
		label: 'Úroveň zvládnutí',
		hint: 'Kam karta míří vůči očekávání pro ročník.',
		options: [
			{ value: '1', label: '1 – pod očekáváním' },
			{ value: '2', label: '2 – částečně splňuje' },
			{ value: '3', label: '3 – splňuje' },
			{ value: '4', label: '4 – nad očekáváním' }
		]
	},
	{
		level: 'block',
		path: 'learning.concepts',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'custom',
		label: 'Pojmy',
		hint: 'Klíčové pojmy, oddělené čárkou.',
		custom: true
	},
	{
		level: 'block',
		path: 'learning.competencies',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'custom',
		label: 'Výstupy RVP',
		hint: 'Kód výstupu a jeho váha v procentech.',
		custom: true
	},
	{
		level: 'block',
		path: 'learning.bloom_level',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'select',
		numeric: true,
		label: 'Bloomova úroveň',
		hint: 'Jakou myšlenkovou práci karta po žákovi chce.',
		options: [
			{ value: '1', label: '1 – zapamatovat' },
			{ value: '2', label: '2 – porozumět' },
			{ value: '3', label: '3 – aplikovat' },
			{ value: '4', label: '4 – analyzovat' },
			{ value: '5', label: '5 – hodnotit' },
			{ value: '6', label: '6 – tvořit' }
		]
	},
	{
		level: 'block',
		path: 'learning.difficulty',
		section: 'topics',
		unread: true,
		mode: 'metodik',
		kind: 'select',
		display: 'segmented',
		numeric: true,
		label: 'Odhad obtížnosti',
		hint: 'Jen odhad autora; živý signál je obtížnost po dovednostech.',
		options: [
			{ value: '1', label: '1 – velmi snadná' },
			{ value: '2', label: '2 – snadná' },
			{ value: '3', label: '3 – střední' },
			{ value: '4', label: '4 – obtížná' },
			{ value: '5', label: '5 – velmi obtížná' }
		]
	},

	{
		level: 'block',
		path: 'block_id',
		section: 'meta',
		mode: 'advanced',
		kind: 'custom',
		label: 'Identifikátor',
		hint: 'Klíč, na který jsou navázané odpovědi žáků. Po publikaci se nemění.',
		custom: true
	},
	{
		level: 'block',
		path: 'type',
		section: 'meta',
		mode: 'advanced',
		kind: 'custom',
		label: 'Typ karty',
		hint: 'Volí se přidáním karty, ne přepsáním pole.',
		custom: true
	},
	{
		level: 'block',
		path: 'xp',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'XP',
		hint: 'vlastní odměna místo dopočtu z kroků. Aplikace ale XP počítá z kroků vždy.'
	},
	{
		level: 'block',
		path: 'version',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Verze karty'
	},
	{
		level: 'block',
		path: 'language',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'text',
		label: 'Jazyk karty',
		hint: 'Bez vyplnění se použije jazyk kurzu.'
	},
	{
		level: 'block',
		path: 'author',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'text',
		label: 'Autor karty'
	},
	{
		level: 'block',
		path: 'updated',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'text',
		label: 'Upraveno',
		display: 'datetime'
	},
	{
		level: 'block',
		path: 'export_type',
		section: 'meta',
		mode: 'advanced',
		kind: 'custom',
		label: 'Typ exportu karty',
		hint: 'Drží se na block_v2, aby šla karta vyexportovat samostatně.',
		custom: true
	},
	{
		level: 'block',
		path: 'gpf.vector',
		section: 'topics',
		unread: true,
		mode: 'advanced',
		kind: 'custom',
		label: 'Taxonomický vektor',
		hint: 'Strojová klasifikace pro vyhledávání obsahu.',
		custom: true
	},
	{
		level: 'block',
		path: 'gpf.kb_vector',
		section: 'topics',
		unread: true,
		mode: 'advanced',
		kind: 'custom',
		label: 'Vektor znalostní báze',
		hint: 'Napojení na bázi, ze které čerpá tutor.',
		custom: true
	},
	{
		level: 'block',
		path: 'learning.prerequisites',
		section: 'followup',
		unread: true,
		mode: 'advanced',
		kind: 'custom',
		label: 'Předpoklady',
		hint: 'Co musí žák zvládat, než kartu dostane. Aplikace je zatím nevynucuje.',
		custom: true
	},
	{
		level: 'block',
		path: 'learning.d_data',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'custom',
		label: 'Výzkumná data',
		custom: true
	},
	{
		level: 'block',
		path: 'learning.l_data',
		section: 'meta',
		unread: true,
		mode: 'advanced',
		kind: 'custom',
		label: 'Data o učení',
		custom: true
	},
	{
		level: 'block',
		path: 'fsrs.initial_difficulty',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Počáteční obtížnost',
		hint: '0–1, výchozí 0,3. Jak těžké je si to udržet.',
		default: '0,3'
	},
	{
		level: 'block',
		path: 'fsrs.initial_stability',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Počáteční stabilita',
		hint: 'Ve dnech, výchozí 2,5.',
		default: '2,5 dne'
	},
	{
		level: 'block',
		path: 'fsrs.initial_recall',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Počáteční vybavení',
		hint: '0–1, výchozí 0,65.',
		default: '0,65'
	},
	{
		level: 'block',
		path: 'fsrs.forgetting_rate',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Rychlost zapomínání',
		hint: 'Výchozí 0,25.',
		default: '0,25'
	},
	{
		level: 'block',
		path: 'fsrs.repetitions',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Počet opakování',
		hint: 'Jen pro import už rozpracovaného obsahu.'
	},
	{
		level: 'block',
		path: 'fsrs.weight',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Priorita v opakování',
		hint: 'přednost karty v nabitém dni opakování.'
	},
	{
		level: 'block',
		path: 'fsrs.min_interval',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Nejkratší odstup',
		hint: 'Ve dnech, výchozí 1.',
		default: '1 den'
	},
	{
		level: 'block',
		path: 'fsrs.max_interval',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Nejdelší odstup',
		hint: 'Ve dnech, výchozí 90.',
		default: '90 dní'
	},
	{
		level: 'block',
		path: 'fsrs.skip_condition',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'text',
		label: 'Podmínka vynechání',
		hint: 'přestat drilovat, co žák prokazatelně umí — například GPF_mastery > 0.8.'
	},
	{
		level: 'block',
		path: 'fsrs.time_limit_sec',
		section: 'review',
		unread: true,
		mode: 'advanced',
		kind: 'number',
		label: 'Časový limit',
		hint: 'po vypršení limitu (v sekundách) by se karta zavřela.'
	},
	{
		level: 'block',
		path: 'adaptation.scaffolded',
		section: 'followup',
		mode: 'advanced',
		kind: 'text',
		label: 'Podmínka pro podporu',
		hint: 'Kdy žák dostane vedenou variantu.'
	},
	{
		level: 'block',
		path: 'adaptation.full',
		section: 'followup',
		mode: 'advanced',
		kind: 'text',
		label: 'Podmínka pro plnou úlohu',
		hint: 'Kdy žák dostane holé zadání.'
	},

	// ── Step ──────────────────────────────────────────────────────────────────
	{
		level: 'step',
		path: 'content',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Text',
		hint: 'Markdown a $LaTeX$ fungují.',
		custom: true
	},
	{
		level: 'step',
		path: 'image.url',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Adresa obrázku'
	},
	{
		level: 'step',
		path: 'image.alt',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Popis obrázku',
		hint: 'Přečte ho čtečka obrazovky.'
	},
	{
		level: 'step',
		path: 'video.url',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Adresa videa',
		hint: 'Přímý odkaz na MP4, ne YouTube.'
	},
	{
		level: 'step',
		path: 'audio.url',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Adresa zvuku'
	},
	{
		level: 'step',
		path: 'hint',
		section: 'main',
		feedback: true,
		mode: 'teacher',
		kind: 'multiline',
		label: 'Nápověda',
		hint: 'Zúží hledání, neprozradí výsledek. Použití srazí skóre na 0,75.'
	},
	{
		level: 'step',
		path: 'help',
		section: 'main',
		feedback: true,
		mode: 'teacher',
		kind: 'multiline',
		label: 'Podrobná pomoc',
		hint: 'Naučí metodu, když nápověda nestačila. Použití srazí skóre na 0,5.'
	},

	{
		level: 'step',
		path: 'default_practice',
		section: 'extras',
		mode: 'metodik',
		kind: 'toggle',
		label: 'Zařadit do cvičení',
		hint: 'U výkladu se příznak dává na krok; zařadí se celá karta.'
	},

	{
		level: 'step',
		path: 'id',
		section: 'main',
		mode: 'advanced',
		kind: 'custom',
		label: 'Identifikátor kroku',
		hint: 'Cíl větvení a klíč uložené odpovědi. Nikdy se nepoužije podruhé.',
		custom: true
	},
	{
		level: 'step',
		path: 'type',
		section: 'main',
		mode: 'advanced',
		kind: 'custom',
		label: 'Typ kroku',
		hint: 'Volí se přidáním kroku.',
		custom: true
	},
	{
		level: 'step',
		path: 'order',
		section: 'main',
		mode: 'advanced',
		kind: 'custom',
		label: 'Pořadí',
		hint: 'Přepisuje se přetažením kroku.',
		custom: true
	},
	{
		level: 'step',
		path: 'image.position',
		section: 'extras',
		mode: 'advanced',
		kind: 'select',
		display: 'segmented',
		label: 'Umístění obrázku',
		options: POSITION_OPTIONS
	},
	{
		level: 'step',
		path: 'video.position',
		section: 'extras',
		mode: 'advanced',
		kind: 'select',
		display: 'segmented',
		label: 'Umístění videa',
		options: POSITION_OPTIONS
	},

	// ── Question ──────────────────────────────────────────────────────────────
	{
		level: 'question',
		path: 'type',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Typ otázky',
		custom: true
	},
	{
		level: 'question',
		path: 'correct_answer',
		section: 'main',
		mode: 'teacher',
		kind: 'text',
		label: 'Správná odpověď',
		hint: 'Porovnává se bez ohledu na velikost písmen.'
	},
	{
		level: 'question',
		path: 'correct_number',
		section: 'main',
		mode: 'teacher',
		kind: 'number',
		label: 'Správný výsledek'
	},
	{
		level: 'question',
		path: 'tolerance',
		section: 'main',
		mode: 'teacher',
		kind: 'number',
		label: 'Tolerance ±',
		hint: '0 vyžaduje přesnou shodu.'
	},
	{
		level: 'question',
		path: 'allow_multiple',
		section: 'main',
		mode: 'teacher',
		kind: 'toggle',
		label: 'Víc správných možností',
		hint: 'Hodnotí se přesná shoda celé sady — za částečný výběr nejsou body.'
	},
	{
		level: 'question',
		path: 'solution',
		section: 'main',
		feedback: true,
		mode: 'teacher',
		kind: 'multiline',
		label: 'Řešení',
		hint: 'Napiš postup, ne jen výsledek — tohle je nejčtenější text v kurzu.'
	},
	{
		level: 'question',
		path: 'options',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Možnosti',
		custom: true
	},

	{
		level: 'question',
		path: 'show_solution',
		section: 'extras',
		feedback: true,
		mode: 'advanced',
		kind: 'toggle',
		label: 'Ukázat řešení po odpovědi',
		hint: 'Vypni, když by řešení prozradilo další otázku.'
	},
	{
		level: 'question',
		path: 'show_answers',
		section: 'extras',
		mode: 'advanced',
		kind: 'toggle',
		label: 'Vyhodnocovat odpovědi',
		hint: 'Vypni pro reflexi a anketu — odpověď se neoznačí jako správná ani chybná.'
	},
	{
		level: 'question',
		path: 'allow_photo',
		section: 'extras',
		unread: true,
		mode: 'advanced',
		kind: 'toggle',
		label: 'Dovolit odpověď fotkou',
		hint: 'Zatím nemá v aplikaci žádný účinek.'
	},
	{
		level: 'question',
		path: 'solution_image',
		section: 'main',
		feedback: true,
		mode: 'advanced',
		kind: 'custom',
		label: 'Obrázek k řešení',
		hint: 'Nákres postupu.',
		custom: true
	},

	// ── Option ────────────────────────────────────────────────────────────────
	{
		level: 'option',
		path: 'text',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Znění možnosti',
		custom: true
	},
	{
		level: 'option',
		path: 'is_correct',
		section: 'main',
		mode: 'teacher',
		kind: 'custom',
		label: 'Je správně',
		custom: true
	},
	{
		level: 'option',
		path: 'feedback',
		section: 'main',
		feedback: true,
		mode: 'teacher',
		kind: 'custom',
		label: 'Zpětná vazba',
		hint: 'Řekni žákovi, kde udělal chybu.',
		custom: true
	},
	{
		level: 'option',
		path: 'go_to',
		section: 'detail',
		mode: 'teacher',
		kind: 'custom',
		label: 'Kam dál',
		custom: true
	},
	{
		level: 'option',
		path: 'mark',
		section: 'detail',
		mode: 'teacher',
		kind: 'custom',
		label: 'Známka',
		custom: true
	},

	{
		level: 'option',
		path: 'id',
		section: 'main',
		mode: 'advanced',
		kind: 'custom',
		label: 'Identifikátor možnosti',
		hint: 'Klíč uložené odpovědi.',
		custom: true
	},
	{
		level: 'option',
		path: 'score_koef',
		section: 'detail',
		mode: 'advanced',
		kind: 'number',
		label: 'Podíl bodů',
		hint: '0–1. Uplatní se jen u správné odpovědi.'
	},
	{
		level: 'option',
		path: 'feedback_image',
		section: 'main',
		feedback: true,
		mode: 'advanced',
		kind: 'custom',
		label: 'Obrázek ke zpětné vazbě',
		hint: 'Nákres chyby.',
		custom: true
	}
] as const;

/**
 * Keys that are deliberately not editable anywhere, each with the reason. The
 * coverage test accepts these in place of a `FieldSpec`, so the list is a record
 * of decisions rather than a hole.
 */
export const NOT_EDITABLE: Record<string, string> = {
	'course.course_id': 'Klíč úložiště a zápisu žáka. Po založení se nemění (§3 invariant 1).',
	'course.lessons': 'Struktura, ne pole — přidává se a přesouvá v postranním panelu.',
	'course.blocks': 'Struktura, ne pole — karty se přidávají v lekci.',
	'lesson.lesson_id': 'Klíč postupu žáka. Po publikaci se nemění (§3 invariant 1).',
	'lesson.order': 'Přepisuje se přetažením lekce; ruční zápis by rozbil hustotu pořadí.',
	'lesson.blocks': 'Struktura, ne pole — vazby se přidávají přetažením karty do lekce.',
	'binding.block_id': 'Odkaz na kartu; mění se přesunem karty, ne přepsáním.',
	'block.group':
		'Píše ho editor: bloky, na které se rozdělila jedna karta s více otázkami (domain/groups.ts).',
	'block.multi_question':
		'Mění se přepínačem „Více otázek v jedné kartě“ v nastavení karty (pokročilý režim), protože zapnutí slučuje bloky karty a vypnutí je rozděluje.',
	'binding.order': 'Přepisuje se přetažením karty.',
	'step.question':
		'Otázka má vlastní úroveň v registru — její pole jsou uvedená pod level: question.',
	'block.steps': 'Struktura, ne pole — kroky se přidávají tlačítkem v kartě.',
	'block.status':
		'Stav karty nečte aplikace ani API — karta s jakýmkoli stavem se žákovi zobrazí. Hodnota z načteného souboru se zachová; o zveřejnění rozhoduje stav kurzu.',
	'image.url':
		'Obrázek se needituje sám o sobě — vždy patří ke kroku, k řešení nebo ke zpětné vazbě, a tam je uvedený.',
	'image.alt':
		'Popis obrázku se edituje tam, kde se edituje jeho adresa — u kroku, řešení nebo zpětné vazby.',
	'image.position':
		'Umístění obrázku je vlastnost kroku, který ho zobrazuje; uvedeno jako step.image.position.',
	'video.url':
		'Video se needituje samo o sobě — patří ke kroku, a tam je uvedené jako step.video.url.',
	'video.position':
		'Umístění videa je vlastnost kroku, který ho zobrazuje; uvedeno jako step.video.position.',
	'audio.url':
		'Zvuk se needituje sám o sobě — patří ke kroku, a tam je uvedený jako step.audio.url.',
	'prerequisite.block_id':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.prerequisite.block_id.',
	'prerequisite.skill':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.prerequisite.skill.',
	'prerequisite.min_level':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.prerequisite.min_level.',
	'prerequisite.weight':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.prerequisite.weight.',
	'gpf.grade':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.grade.',
	'gpf.level':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.level.',
	'gpf.domain':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.domain.',
	'gpf.construct':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.construct.',
	'gpf.subconstruct':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.subconstruct.',
	'gpf.vector':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.vector.',
	'gpf.kb_vector':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.kb_vector.',
	'gpf.relation_vector':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.relation_vector.',
	'gpf.elo_vector':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.elo_vector.',
	'learning.concepts':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.concepts.',
	'learning.competencies':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.competencies.',
	'learning.bloom_level':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.bloom_level.',
	'learning.difficulty':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.difficulty.',
	'learning.prerequisites':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.prerequisites.',
	'learning.d_data':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.d_data.',
	'learning.l_data':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.l_data.',
	'fsrs.initial_difficulty':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.initial_difficulty.',
	'fsrs.initial_stability':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.initial_stability.',
	'fsrs.initial_recall':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.initial_recall.',
	'fsrs.forgetting_rate':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.forgetting_rate.',
	'fsrs.repetitions':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.repetitions.',
	'fsrs.weight':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.weight.',
	'fsrs.min_interval':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.min_interval.',
	'fsrs.max_interval':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.max_interval.',
	'fsrs.skip_condition':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.skip_condition.',
	'fsrs.time_limit_sec':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.time_limit_sec.',
	'adaptation.scaffolded':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.adaptation.scaffolded.',
	'adaptation.full':
		'Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.adaptation.full.'
};

/**
 * Cumulative: a field shows in its own mode and every mode above it. A `feedback`
 * field also needs `feedback` (the Zpětná vazba toggle) to be on.
 */
export const visible = (spec: FieldSpec, mode: Mode, feedback: boolean = true): boolean =>
	MODE_RANK[mode] >= MODE_RANK[spec.mode] && (feedback || spec.feedback !== true);

/** The fields of one level that `mode` may edit, minus the hand-written ones. */
export function fieldsFor(level: FieldLevel, mode: Mode, feedback: boolean = true): FieldSpec[] {
	return FIELDS.filter(
		(spec) => spec.level === level && spec.custom !== true && visible(spec, mode, feedback)
	);
}

/**
 * The sections of one level that hold something `mode` can see, in order. A mode can
 * add a section but a heading never shows over nothing: a section needs a visible
 * field (hand-written ones included, they are in the table too) or its own `mode`.
 */
export function sectionsFor(
	level: FieldLevel,
	mode: Mode,
	feedback: boolean = true
): SectionSpec[] {
	return SECTIONS[level].filter(
		(section) =>
			(section.mode !== undefined && MODE_RANK[mode] >= MODE_RANK[section.mode]) ||
			FIELDS.some(
				(spec) =>
					spec.level === level && spec.section === section.id && visible(spec, mode, feedback)
			)
	);
}

/**
 * Whether a settings dialog lists its sections on the left and shows one at a time.
 * Decided by the mode and never by how many sections there are, so turning Zpětná
 * vazba on or off cannot rearrange the dialog: Učitel's dialogs are short enough to
 * be one page, and from Metodik up the list is always there to say where things are.
 */
export const listsSections = (mode: Mode): boolean => mode !== 'teacher';

/** Lower case without diacritics, so „opakovani“ finds „Opakování“. */
const fold = (text: string): string =>
	text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

/**
 * What the settings search finds: the sections whose name, keywords, or a visible
 * field's label or hint contain every word typed, and those fields (`level.path`).
 * A section that matches by its own name or keywords matches without naming a field.
 * An empty query matches nothing; the dialog then shows every section.
 */
export function matchSections(
	levels: readonly FieldLevel[],
	query: string,
	mode: Mode,
	feedback: boolean = true
): { sections: Set<string>; fields: Set<string> } {
	const words = fold(query)
		.split(/\s+/)
		.filter((w) => w !== '');
	const sections = new Set<string>();
	const fields = new Set<string>();
	if (words.length === 0) return { sections, fields };
	const hits = (text: string) => {
		const folded = fold(text);
		return words.every((w) => folded.includes(w));
	};
	for (const level of levels) {
		for (const section of sectionsFor(level, mode, feedback)) {
			if (hits(`${section.label} ${section.keywords ?? ''}`)) sections.add(section.id);
		}
		for (const spec of FIELDS) {
			if (spec.level !== level || !visible(spec, mode, feedback)) continue;
			if (!hits(`${spec.label} ${spec.hint ?? ''}`)) continue;
			sections.add(spec.section);
			if (spec.custom !== true) fields.add(`${spec.level}.${spec.path}`);
		}
	}
	return { sections, fields };
}

/**
 * What the card's settings dialog holds in `mode`, as a sentence for a tooltip: the
 * open fields by name, then the folds by their headings. Read off the same tables the
 * dialog renders, so a button that says what is behind it cannot drift from the dialog.
 */
export function cardSettingsSummary(mode: Mode, feedback: boolean = true): string {
	const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
	const open = FIELDS.filter(
		(spec) =>
			spec.level === 'block' &&
			spec.custom !== true &&
			spec.section === 'main' &&
			visible(spec, mode, feedback)
	).map((spec) => lower(spec.label));
	const folds = sectionsFor('block', mode, feedback)
		.filter((section) => section.id !== 'main')
		.map((section) => lower(section.label));
	const parts = [...open, ...folds];
	return parts.length === 0 ? 'Nastavení karty' : `Nastavení karty: ${parts.join(', ')}`;
}

/** One field, by level and path — for the hand-written editors that want its label. */
export function fieldSpec(level: FieldLevel, path: string): FieldSpec | undefined {
	return FIELDS.find((spec) => spec.level === level && spec.path === path);
}

/** Whether a hand-written control should render at all. */
export function allows(
	level: FieldLevel,
	path: string,
	mode: Mode,
	feedback: boolean = true
): boolean {
	const spec = fieldSpec(level, path);
	return spec === undefined ? true : visible(spec, mode, feedback);
}

/**
 * The registry entry an issue's `ref.field` addresses: its level, read off the ref
 * (an option, a question, a step, a card, a lesson or the course), and its path with
 * any list index dropped (`learning.prerequisites.1` → `learning.prerequisites`).
 */
export function fieldOf(ref: Ref): { level: FieldLevel; path: string } | null {
	if (ref.field === undefined) return null;
	const path = ref.field.replace(/\.\d+(?=\.|$)/g, '');
	if (ref.optionId !== undefined) return { level: 'option', path };
	if (ref.stepId !== undefined) {
		return path.startsWith('question.')
			? { level: 'question', path: path.slice('question.'.length) }
			: { level: 'step', path };
	}
	if (ref.blockId !== undefined) return { level: 'block', path };
	if (ref.lessonId !== undefined) return { level: 'lesson', path };
	return { level: 'course', path };
}

/**
 * Whether a ref points at a `feedback` field (or inside one, as
 * `question.solution_image.url` does): the fields the Zpětná vazba toggle hides.
 */
export function isFeedbackRef(ref: Ref): boolean {
	const field = fieldOf(ref);
	if (field === null) return false;
	return FIELDS.some(
		(spec) =>
			spec.feedback === true &&
			spec.level === field.level &&
			(field.path === spec.path || field.path.startsWith(`${spec.path}.`))
	);
}

/**
 * The lowest mode in which what an issue points at can be fixed.
 *
 * An issue shown to a teacher whose field only Metodik or Pokročilý draws — a
 * duplicate id, a vector — used to send "Přejít" to a card where nothing could be
 * changed. The review asks this, says which mode the fix is in, and switches to it on
 * the jump. A key that is not editable at all (`NOT_EDITABLE`) is structure, fixed in
 * the tree, which every mode has. `undefined` means the ref names a field the
 * registry does not know — `fields.test.ts` fails on that.
 */
export function fixModeOf(ref: Ref): Mode | undefined {
	const field = fieldOf(ref);
	if (field === null) return 'teacher';
	const spec = fieldSpec(field.level, field.path);
	if (spec !== undefined) return spec.mode;
	if (`${field.level}.${field.path}` in NOT_EDITABLE) return 'teacher';
	return undefined;
}

/**
 * The registry entry an issue or a selection addresses, by the longest path it
 * starts with (`learning.competencies.weight` is inside `learning.competencies`).
 * A card ref that no card field matches is tried as a lesson binding's.
 */
export function specOf(ref: Ref): FieldSpec | undefined {
	const field = fieldOf(ref);
	if (field === null) return undefined;
	const inside = (spec: FieldSpec) =>
		field.path === spec.path || field.path.startsWith(`${spec.path}.`);
	const find = (level: FieldLevel) =>
		FIELDS.filter((spec) => spec.level === level && inside(spec)).sort(
			(a, b) => b.path.length - a.path.length
		)[0];
	return find(field.level) ?? (field.level === 'block' ? find('binding') : undefined);
}
