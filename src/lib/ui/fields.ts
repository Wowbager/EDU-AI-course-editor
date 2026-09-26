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

import type { Ref } from "$lib/domain/ref";

/**
 * The three editing modes, in increasing order of exposure. They are cumulative:
 * a mode shows everything the modes below it show, plus its own additions.
 *
 *  - `teacher`  the bare minimum that makes a course work — content and answers.
 *  - `metodik`  adds the didactics: practice enrolment and the knowledge vector.
 *  - `advanced` adds everything else the format can carry, ids included.
 */
export const MODES = ["teacher", "metodik", "advanced"] as const;

export type Mode = (typeof MODES)[number];

export const MODE_RANK: Record<Mode, number> = {
    teacher: 0,
    metodik: 1,
    advanced: 2,
};

export const MODE_LABELS: Record<Mode, { label: string; title: string }> = {
    teacher: {
        label: "Učitel",
        title: "Jen to, co je potřeba, aby kurz fungoval — obsah, odpovědi, větvení",
    },
    metodik: {
        label: "Metodik",
        title: "Navíc didaktika: zařazení do cvičení a znalostní vektor",
    },
    advanced: {
        label: "Pokročilý",
        title: "Vše ostatní, co formát umí — identifikátory, FSRS, adaptace, předpoklady",
    },
};

/** Where in the document a field lives. Decides which editor renders it. */
export type FieldLevel =
    | "course"
    | "lesson"
    | "binding"
    | "block"
    | "step"
    | "question"
    | "option";

export type FieldKind =
    | "text"
    | "multiline"
    | "number"
    | "toggle"
    | "select"
    | "custom";

export interface FieldSpec {
    level: FieldLevel;
    /** Dotted path relative to its level — exactly what `setField` takes. */
    path: string;
    /** The lowest mode in which this field is editable. */
    mode: Mode;
    label: string;
    kind: FieldKind;
    /** What it does to the student. Shown under the control; house style is consequences. */
    hint?: string;
    /** For `select`. */
    options?: readonly { value: string; label: string }[];
    /** Set when a hand-written component owns this field rather than `FieldGroup`. */
    custom?: true;
    /**
     * Nothing downstream reads this key today — neither the app nor the API
     * (`docs/spec/COURSE-EDITOR-SPEC.md` marks it ⚪). It is kept and exported, because
     * the format carries it and it documents intent, but the field says so wherever
     * it is shown (`hintFor`), and none may be offered in teacher mode.
     * `fields.test.ts` checks this flag against the spec in both directions.
     */
    unread?: true;
    ref?: Ref;
}

/**
 * What a field's help line says. For a field nothing reads, the first thing it says
 * is that — so a hint describing what the field is *for* is never read as a promise
 * of what it *does*.
 */
export function hintFor(spec: Pick<FieldSpec, "hint" | "unread">): string | undefined {
    if (!spec.unread) return spec.hint;
    const intent = spec.hint ? ` Zamýšleno: ${spec.hint}` : "";
    return `Zatím bez účinku — aplikace ani API tuto hodnotu nečtou, jen se uloží.${intent}`;
}

export const STATUS_OPTIONS = [
    { value: "draft", label: "Rozpracováno" },
    { value: "private", label: "Soukromé" },
    { value: "locked", label: "Uzamčeno" },
    { value: "approved", label: "Schváleno" },
    { value: "published", label: "Publikováno" },
] as const;

const POSITION_OPTIONS = [
    { value: "above", label: "Nad textem" },
    { value: "below", label: "Pod textem" },
    { value: "inline", label: "V textu" },
] as const;

export const FIELDS: readonly FieldSpec[] = [
    // ── Course ────────────────────────────────────────────────────────────────
    {
        level: "course",
        path: "name",
        mode: "teacher",
        kind: "text",
        label: "Název kurzu",
        hint: "Titulek na dlaždici kurzu i v hlavičce přehrávače.",
    },
    {
        level: "course",
        path: "description",
        mode: "teacher",
        kind: "multiline",
        label: "Popis",
        hint: "Podtitulek dlaždice. Vidí ho i žák, který si kurz ještě nestáhl.",
    },
    {
        level: "course",
        path: "emoji",
        mode: "teacher",
        kind: "text",
        label: "Emoji",
        hint: "Ikona dlaždice. Když ji nevyplníš, odhadne ji server z názvu.",
    },
    {
        level: "course",
        path: "pin",
        mode: "teacher",
        kind: "text",
        label: "PIN",
        hint: "Šest znaků, kterými se žák do kurzu dostane.",
    },

    {
        level: "course",
        path: "ai_context",
        unread: true,
        mode: "metodik",
        kind: "multiline",
        label: "Kontext pro AI",
        hint: "Didaktické poznámky pro doučující AI. Zatím je tutor nečte.",
    },

    // "Cvičení" names two different things in the tool — this one, which is a whole
    // course, and a card type inside a lesson. The hint says which, because a teacher
    // who has just added a Cvičení *card* has no reason to guess that the same word
    // in course settings changes every lesson at once.
    {
        level: "course",
        path: "export_type",
        mode: "teacher",
        kind: "custom",
        label: "Typ kurzu",
        hint: "Platí pro celý kurz, ne pro jednu kartu: Cvičení vypne větvení ve všech lekcích, Test navíc skryje nápovědy a řešení.",
        custom: true,
    },
    {
        level: "course",
        path: "status",
        mode: "teacher",
        kind: "custom",
        label: "Kdo kurz uvidí",
        hint: "Nastavuje se ve verzích kurzu, spolu se zveřejněním. Žák v knihovně najde jen zveřejněný kurz; soukromý otevře s PINem.",
        custom: true,
    },
    {
        level: "course",
        path: "version",
        mode: "advanced",
        kind: "number",
        label: "Verze",
        hint: "Bez zvýšení se aktualizace k už stáhnutým žákům nedostane.",
    },
    {
        level: "course",
        path: "language",
        mode: "advanced",
        kind: "text",
        label: "Jazyk",
        hint: "Filtr v knihovně, například cs. Nepřepíná jazyk aplikace.",
    },
    {
        level: "course",
        path: "author",
        mode: "advanced",
        kind: "text",
        label: "Autor",
        hint: "Jméno uvedené u kurzu v knihovně.",
    },
    {
        level: "course",
        path: "updated",
        mode: "advanced",
        kind: "text",
        label: "Naposledy upraveno",
        hint: "Razítko poslední úpravy; doplní se při uložení.",
    },
    {
        level: "course",
        path: "estimated_minutes",
        mode: "advanced",
        kind: "number",
        label: "Odhad délky",
        hint: "Délka uvedená v knihovně. Bez ní se spočítá z lekcí.",
    },
    {
        level: "course",
        path: "max_xp",
        mode: "advanced",
        kind: "number",
        label: "Strop XP",
        hint: "Nejvyšší možný zisk za celý kurz.",
    },
    {
        level: "course",
        path: "logged_only",
        mode: "teacher",
        kind: "custom",
        label: "Jen pro přihlášené",
        hint: "Jedna z voleb „Kdo kurz uvidí“ ve verzích kurzu. Host kurz uvidí, ale nespustí.",
        custom: true,
    },
    {
        level: "course",
        path: "only_once",
        mode: "advanced",
        kind: "toggle",
        label: "Jen jednou",
        hint: "Po dokončení se žák do kurzu už nikdy nedostane. Nelze vzít zpět.",
    },
    {
        level: "course",
        path: "only_quiz",
        mode: "advanced",
        kind: "toggle",
        label: "Kurz je jen kvíz",
        hint: "Kurz bez lekcí; zobrazí se mezi rychlými kvízy.",
    },
    {
        level: "course",
        path: "starts_with_quiz",
        mode: "advanced",
        kind: "toggle",
        label: "Začíná kvízem",
        hint: "Všechny lekce zůstanou zamčené, dokud žák kvíz nedokončí.",
    },
    {
        level: "course",
        path: "quiz_evaluate",
        mode: "advanced",
        kind: "toggle",
        label: "Vyhodnocovat kvíz",
        hint: "Bez toho žák odpovídá naslepo — neuvidí, co měl správně.",
    },
    {
        level: "course",
        path: "stop_gambling",
        unread: true,
        mode: "advanced",
        kind: "toggle",
        label: "Hlídat náhodné klikání",
        hint: "Zatím nemá v aplikaci žádný účinek.",
    },
    {
        level: "course",
        path: "stop_notice",
        unread: true,
        mode: "advanced",
        kind: "multiline",
        label: "Hláška při náhodném klikání",
        hint: "Prázdné použije systémový text.",
    },
    {
        level: "course",
        path: "header_image",
        mode: "advanced",
        kind: "custom",
        label: "Obrázek v hlavičce",
        hint: "Banner nad kurzem, zhruba 3:1.",
        custom: true,
    },

    // ── Lesson ────────────────────────────────────────────────────────────────
    {
        level: "lesson",
        path: "name",
        mode: "teacher",
        kind: "text",
        label: "Název lekce",
        hint: "Titulek karty lekce.",
    },
    {
        level: "lesson",
        path: "description",
        mode: "teacher",
        kind: "multiline",
        label: "Popis lekce",
        hint: "Napiš ho jako slib: co žák po lekci zvládne.",
    },

    {
        level: "lesson",
        path: "ai_context",
        unread: true,
        mode: "metodik",
        kind: "multiline",
        label: "Kontext pro AI",
        hint: "Přidá se ke kontextu kurzu. Zatím ho tutor nečte.",
    },

    {
        level: "lesson",
        path: "version",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Verze lekce",
        hint: "Jen pro evidenci; aplikace čte verzi kurzu.",
    },
    {
        level: "lesson",
        path: "header_image",
        unread: true,
        mode: "advanced",
        kind: "custom",
        label: "Obrázek lekce",
        hint: "Dnes se nevykresluje — použije se banner kurzu.",
        custom: true,
    },

    // ── Lesson → block binding ────────────────────────────────────────────────
    // Legacy, and it sits next to the card's own flag — two controls with the same
    // label is exactly the confusion the modes exist to remove. The spec says new
    // content sets the flag on the card, so the metodik only ever sees that one.
    {
        level: "binding",
        path: "default_practice",
        mode: "advanced",
        kind: "toggle",
        label: "Zařadit do cvičení (jen v této lekci)",
        hint: "Starší způsob. U nového obsahu nastav příznak rovnou na kartě.",
    },
    {
        level: "binding",
        path: "bg_color",
        unread: true,
        mode: "advanced",
        kind: "text",
        label: "Barva karty",
        hint: "Používej systematicky — třeba jedna barva pro řešené příklady.",
    },
    {
        level: "binding",
        path: "bg_image",
        unread: true,
        mode: "advanced",
        kind: "text",
        label: "Pozadí karty",
        hint: "Musí být nízkokontrastní, jinak se text přestane dát číst.",
    },

    // ── Block ─────────────────────────────────────────────────────────────────
    // `custom` because the control is the card's own heading in the editor column,
    // not a row in the settings modal: the complaint it answers is about scanning the
    // sidebar, and a title a teacher has to open a dialog to reach is a title nobody
    // sets. `FieldGroup` must therefore not render a second copy of it.
    {
        level: "block",
        path: "name",
        mode: "teacher",
        kind: "custom",
        label: "Název karty",
        hint: "Jak se karta jmenuje ve stromu vlevo. Prázdné pole vezme první řádek textu karty.",
        custom: true,
    },
    {
        level: "block",
        path: "duration",
        mode: "teacher",
        kind: "text",
        label: "Délka",
        hint: "Například 3 min. Počítá se z toho čas lekce i tempo v opakování.",
    },
    {
        level: "block",
        path: "hint",
        mode: "teacher",
        kind: "multiline",
        label: "Nápověda ke kartě",
        hint: "Otazník ji ukáže u každého kroku, který nemá vlastní nápovědu. Použití srazí skóre na 0,75.",
    },
    {
        level: "block",
        path: "help",
        mode: "teacher",
        kind: "multiline",
        label: "Podrobná pomoc",
        hint: "Druhá úroveň otazníku, když nápověda nestačila. Použití srazí skóre na 0,5.",
    },

    {
        level: "block",
        path: "default_practice",
        mode: "metodik",
        kind: "toggle",
        label: "Zařadit do cvičení",
        hint: "Vhodné pro definice, postupy a fakta — ne pro úvody a přechody. Zhruba pětina až třetina karet.",
    },
    {
        level: "block",
        path: "gpf.domain",
        unread: true,
        mode: "metodik",
        kind: "custom",
        label: "Oblast",
        custom: true,
    },
    {
        level: "block",
        path: "gpf.construct",
        unread: true,
        mode: "metodik",
        kind: "custom",
        label: "Konstrukt",
        custom: true,
    },
    {
        level: "block",
        path: "gpf.subconstruct",
        unread: true,
        mode: "metodik",
        kind: "custom",
        label: "Téma",
        custom: true,
    },
    {
        level: "block",
        path: "gpf.relation_vector",
        mode: "metodik",
        kind: "custom",
        label: "Co karta procvičuje",
        custom: true,
    },
    {
        level: "block",
        path: "gpf.elo_vector",
        mode: "metodik",
        kind: "custom",
        label: "Obtížnost po dovednostech",
        custom: true,
    },
    {
        level: "block",
        path: "gpf.grade",
        unread: true,
        mode: "metodik",
        kind: "number",
        label: "Ročník",
        hint: "Pro koho je karta určená, 1–10.",
    },
    {
        level: "block",
        path: "gpf.level",
        unread: true,
        mode: "metodik",
        kind: "number",
        label: "Úroveň",
        hint: "1 pod očekáváním … 4 nad očekáváním.",
    },
    {
        level: "block",
        path: "learning.concepts",
        unread: true,
        mode: "metodik",
        kind: "custom",
        label: "Pojmy",
        hint: "Klíčové pojmy, oddělené čárkou.",
        custom: true,
    },
    {
        level: "block",
        path: "learning.competencies",
        unread: true,
        mode: "metodik",
        kind: "custom",
        label: "Výstupy RVP",
        hint: "Kód výstupu a jeho váha v procentech.",
        custom: true,
    },
    {
        level: "block",
        path: "learning.bloom_level",
        unread: true,
        mode: "metodik",
        kind: "number",
        label: "Bloomova úroveň",
        hint: "1 zapamatovat … 6 tvořit.",
    },
    {
        level: "block",
        path: "learning.difficulty",
        unread: true,
        mode: "metodik",
        kind: "number",
        label: "Odhad obtížnosti",
        hint: "1–5. Jen odhad autora; živý signál je obtížnost po dovednostech.",
    },

    {
        level: "block",
        path: "block_id",
        mode: "advanced",
        kind: "custom",
        label: "Identifikátor",
        hint: "Klíč, na který jsou navázané odpovědi žáků. Po publikaci se nemění.",
        custom: true,
    },
    {
        level: "block",
        path: "type",
        mode: "advanced",
        kind: "custom",
        label: "Typ karty",
        hint: "Volí se přidáním karty, ne přepsáním pole.",
        custom: true,
    },
    {
        level: "block",
        path: "xp",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "XP",
        hint: "vlastní odměna místo dopočtu z kroků. Aplikace ale XP počítá z kroků vždy.",
    },
    {
        level: "block",
        path: "version",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Verze karty",
    },
    {
        level: "block",
        path: "language",
        unread: true,
        mode: "advanced",
        kind: "text",
        label: "Jazyk karty",
        hint: "Bez vyplnění se použije jazyk kurzu.",
    },
    {
        level: "block",
        path: "author",
        unread: true,
        mode: "advanced",
        kind: "text",
        label: "Autor karty",
    },
    {
        level: "block",
        path: "updated",
        unread: true,
        mode: "advanced",
        kind: "text",
        label: "Upraveno",
    },
    {
        level: "block",
        path: "export_type",
        mode: "advanced",
        kind: "custom",
        label: "Typ exportu karty",
        hint: "Drží se na block_v2, aby šla karta vyexportovat samostatně.",
        custom: true,
    },
    {
        level: "block",
        path: "gpf.vector",
        unread: true,
        mode: "advanced",
        kind: "custom",
        label: "Taxonomický vektor",
        hint: "Strojová klasifikace pro vyhledávání obsahu.",
        custom: true,
    },
    {
        level: "block",
        path: "gpf.kb_vector",
        unread: true,
        mode: "advanced",
        kind: "custom",
        label: "Vektor znalostní báze",
        hint: "Napojení na bázi, ze které čerpá tutor.",
        custom: true,
    },
    {
        level: "block",
        path: "learning.prerequisites",
        unread: true,
        mode: "advanced",
        kind: "custom",
        label: "Předpoklady",
        hint: "Co musí žák zvládat, než kartu dostane. Aplikace je zatím nevynucuje.",
        custom: true,
    },
    {
        level: "block",
        path: "learning.d_data",
        unread: true,
        mode: "advanced",
        kind: "custom",
        label: "Výzkumná data",
        custom: true,
    },
    {
        level: "block",
        path: "learning.l_data",
        unread: true,
        mode: "advanced",
        kind: "custom",
        label: "Data o učení",
        custom: true,
    },
    {
        level: "block",
        path: "fsrs.initial_difficulty",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Počáteční obtížnost",
        hint: "0–1, výchozí 0,3. Jak těžké je si to udržet.",
    },
    {
        level: "block",
        path: "fsrs.initial_stability",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Počáteční stabilita",
        hint: "Ve dnech, výchozí 2,5.",
    },
    {
        level: "block",
        path: "fsrs.initial_recall",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Počáteční vybavení",
        hint: "0–1, výchozí 0,65.",
    },
    {
        level: "block",
        path: "fsrs.forgetting_rate",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Rychlost zapomínání",
        hint: "Výchozí 0,25.",
    },
    {
        level: "block",
        path: "fsrs.repetitions",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Počet opakování",
        hint: "Jen pro import už rozpracovaného obsahu.",
    },
    {
        level: "block",
        path: "fsrs.weight",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Priorita v opakování",
        hint: "přednost karty v nabitém dni opakování.",
    },
    {
        level: "block",
        path: "fsrs.min_interval",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Nejkratší odstup",
        hint: "Ve dnech, výchozí 1.",
    },
    {
        level: "block",
        path: "fsrs.max_interval",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Nejdelší odstup",
        hint: "Ve dnech, výchozí 90.",
    },
    {
        level: "block",
        path: "fsrs.skip_condition",
        unread: true,
        mode: "advanced",
        kind: "text",
        label: "Podmínka vynechání",
        hint: "přestat drilovat, co žák prokazatelně umí — například GPF_mastery > 0.8.",
    },
    {
        level: "block",
        path: "fsrs.time_limit_sec",
        unread: true,
        mode: "advanced",
        kind: "number",
        label: "Časový limit",
        hint: "po vypršení limitu (v sekundách) by se karta zavřela.",
    },
    {
        level: "block",
        path: "adaptation.scaffolded",
        mode: "advanced",
        kind: "text",
        label: "Podmínka pro podporu",
        hint: "Kdy žák dostane vedenou variantu.",
    },
    {
        level: "block",
        path: "adaptation.full",
        mode: "advanced",
        kind: "text",
        label: "Podmínka pro plnou úlohu",
        hint: "Kdy žák dostane holé zadání.",
    },

    // ── Step ──────────────────────────────────────────────────────────────────
    {
        level: "step",
        path: "content",
        mode: "teacher",
        kind: "custom",
        label: "Text",
        hint: "Markdown a $LaTeX$ fungují.",
        custom: true,
    },
    {
        level: "step",
        path: "image.url",
        mode: "teacher",
        kind: "text",
        label: "Adresa obrázku",
    },
    {
        level: "step",
        path: "image.alt",
        mode: "teacher",
        kind: "text",
        label: "Popis obrázku",
        hint: "Přečte ho čtečka obrazovky.",
    },
    {
        level: "step",
        path: "video.url",
        mode: "teacher",
        kind: "text",
        label: "Adresa videa",
        hint: "Přímý odkaz na MP4, ne YouTube.",
    },
    {
        level: "step",
        path: "audio.url",
        mode: "teacher",
        kind: "text",
        label: "Adresa zvuku",
    },
    {
        level: "step",
        path: "hint",
        mode: "teacher",
        kind: "multiline",
        label: "Nápověda",
        hint: "Zúží hledání, neprozradí výsledek. Použití srazí skóre na 0,75.",
    },
    {
        level: "step",
        path: "help",
        mode: "teacher",
        kind: "multiline",
        label: "Podrobná pomoc",
        hint: "Naučí metodu, když nápověda nestačila. Použití srazí skóre na 0,5.",
    },

    {
        level: "step",
        path: "default_practice",
        mode: "metodik",
        kind: "toggle",
        label: "Zařadit do cvičení",
        hint: "U výkladu se příznak dává na krok; zařadí se celá karta.",
    },

    {
        level: "step",
        path: "id",
        mode: "advanced",
        kind: "custom",
        label: "Identifikátor kroku",
        hint: "Cíl větvení a klíč uložené odpovědi. Nikdy se nepoužije podruhé.",
        custom: true,
    },
    {
        level: "step",
        path: "type",
        mode: "advanced",
        kind: "custom",
        label: "Typ kroku",
        hint: "Volí se přidáním kroku.",
        custom: true,
    },
    {
        level: "step",
        path: "order",
        mode: "advanced",
        kind: "custom",
        label: "Pořadí",
        hint: "Přepisuje se přetažením kroku.",
        custom: true,
    },
    {
        level: "step",
        path: "image.position",
        mode: "advanced",
        kind: "select",
        label: "Umístění obrázku",
        options: POSITION_OPTIONS,
    },
    {
        level: "step",
        path: "video.position",
        mode: "advanced",
        kind: "select",
        label: "Umístění videa",
        options: POSITION_OPTIONS,
    },

    // ── Question ──────────────────────────────────────────────────────────────
    {
        level: "question",
        path: "type",
        mode: "teacher",
        kind: "custom",
        label: "Typ otázky",
        custom: true,
    },
    {
        level: "question",
        path: "correct_answer",
        mode: "teacher",
        kind: "text",
        label: "Správná odpověď",
        hint: "Porovnává se bez ohledu na velikost písmen.",
    },
    {
        level: "question",
        path: "correct_number",
        mode: "teacher",
        kind: "number",
        label: "Správný výsledek",
    },
    {
        level: "question",
        path: "tolerance",
        mode: "teacher",
        kind: "number",
        label: "Tolerance ±",
        hint: "0 vyžaduje přesnou shodu.",
    },
    {
        level: "question",
        path: "allow_multiple",
        mode: "teacher",
        kind: "toggle",
        label: "Víc správných možností",
        hint: "Hodnotí se přesná shoda celé sady — za částečný výběr nejsou body.",
    },
    {
        level: "question",
        path: "solution",
        mode: "teacher",
        kind: "multiline",
        label: "Řešení",
        hint: "Napiš postup, ne jen výsledek — tohle je nejčtenější text v kurzu.",
    },
    {
        level: "question",
        path: "options",
        mode: "teacher",
        kind: "custom",
        label: "Možnosti",
        custom: true,
    },

    {
        level: "question",
        path: "show_solution",
        mode: "advanced",
        kind: "toggle",
        label: "Ukázat řešení po odpovědi",
        hint: "Vypni, když by řešení prozradilo další otázku.",
    },
    {
        level: "question",
        path: "show_answers",
        mode: "advanced",
        kind: "toggle",
        label: "Vyhodnocovat odpovědi",
        hint: "Vypni pro reflexi a anketu — odpověď se neoznačí jako správná ani chybná.",
    },
    {
        level: "question",
        path: "allow_photo",
        unread: true,
        mode: "advanced",
        kind: "toggle",
        label: "Dovolit odpověď fotkou",
        hint: "Zatím nemá v aplikaci žádný účinek.",
    },
    {
        level: "question",
        path: "solution_image",
        mode: "advanced",
        kind: "custom",
        label: "Obrázek k řešení",
        hint: "Nákres postupu.",
        custom: true,
    },

    // ── Option ────────────────────────────────────────────────────────────────
    {
        level: "option",
        path: "text",
        mode: "teacher",
        kind: "custom",
        label: "Znění možnosti",
        custom: true,
    },
    {
        level: "option",
        path: "is_correct",
        mode: "teacher",
        kind: "custom",
        label: "Je správně",
        custom: true,
    },
    {
        level: "option",
        path: "feedback",
        mode: "teacher",
        kind: "custom",
        label: "Zpětná vazba",
        hint: "Řekni žákovi, kde udělal chybu.",
        custom: true,
    },
    {
        level: "option",
        path: "go_to",
        mode: "teacher",
        kind: "custom",
        label: "Kam dál",
        custom: true,
    },
    {
        level: "option",
        path: "mark",
        mode: "teacher",
        kind: "custom",
        label: "Známka",
        custom: true,
    },

    {
        level: "option",
        path: "id",
        mode: "advanced",
        kind: "custom",
        label: "Identifikátor možnosti",
        hint: "Klíč uložené odpovědi.",
        custom: true,
    },
    {
        level: "option",
        path: "score_koef",
        mode: "advanced",
        kind: "number",
        label: "Podíl bodů",
        hint: "0–1. Uplatní se jen u správné odpovědi.",
    },
    {
        level: "option",
        path: "feedback_image",
        mode: "advanced",
        kind: "custom",
        label: "Obrázek ke zpětné vazbě",
        hint: "Nákres chyby.",
        custom: true,
    },
] as const;

/**
 * Keys that are deliberately not editable anywhere, each with the reason. The
 * coverage test accepts these in place of a `FieldSpec`, so the list is a record
 * of decisions rather than a hole.
 */
export const NOT_EDITABLE: Record<string, string> = {
    "course.course_id":
        "Klíč úložiště a zápisu žáka. Po založení se nemění (§3 invariant 1).",
    "course.lessons":
        "Struktura, ne pole — přidává se a přesouvá v postranním panelu.",
    "course.blocks": "Struktura, ne pole — karty se přidávají v lekci.",
    "lesson.lesson_id":
        "Klíč postupu žáka. Po publikaci se nemění (§3 invariant 1).",
    "lesson.order":
        "Přepisuje se přetažením lekce; ruční zápis by rozbil hustotu pořadí.",
    "lesson.blocks":
        "Struktura, ne pole — vazby se přidávají přetažením karty do lekce.",
    "binding.block_id": "Odkaz na kartu; mění se přesunem karty, ne přepsáním.",
    "binding.order": "Přepisuje se přetažením karty.",
    "step.question":
        "Otázka má vlastní úroveň v registru — její pole jsou uvedená pod level: question.",
    "block.steps": "Struktura, ne pole — kroky se přidávají tlačítkem v kartě.",
    "block.status":
        "Stav karty nečte aplikace ani API — karta s jakýmkoli stavem se žákovi zobrazí. Hodnota z načteného souboru se zachová; o zveřejnění rozhoduje stav kurzu.",
    "image.url":
        "Obrázek se needituje sám o sobě — vždy patří ke kroku, k řešení nebo ke zpětné vazbě, a tam je uvedený.",
    "image.alt":
        "Popis obrázku se edituje tam, kde se edituje jeho adresa — u kroku, řešení nebo zpětné vazby.",
    "image.position":
        "Umístění obrázku je vlastnost kroku, který ho zobrazuje; uvedeno jako step.image.position.",
    "video.url":
        "Video se needituje samo o sobě — patří ke kroku, a tam je uvedené jako step.video.url.",
    "video.position":
        "Umístění videa je vlastnost kroku, který ho zobrazuje; uvedeno jako step.video.position.",
    "audio.url":
        "Zvuk se needituje sám o sobě — patří ke kroku, a tam je uvedený jako step.audio.url.",
    "prerequisite.block_id":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.prerequisite.block_id.",
    "prerequisite.skill":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.prerequisite.skill.",
    "prerequisite.min_level":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.prerequisite.min_level.",
    "prerequisite.weight":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.prerequisite.weight.",
    "gpf.grade":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.grade.",
    "gpf.level":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.level.",
    "gpf.domain":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.domain.",
    "gpf.construct":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.construct.",
    "gpf.subconstruct":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.subconstruct.",
    "gpf.vector":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.vector.",
    "gpf.kb_vector":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.kb_vector.",
    "gpf.relation_vector":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.relation_vector.",
    "gpf.elo_vector":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.gpf.elo_vector.",
    "learning.concepts":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.concepts.",
    "learning.competencies":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.competencies.",
    "learning.bloom_level":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.bloom_level.",
    "learning.difficulty":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.difficulty.",
    "learning.prerequisites":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.prerequisites.",
    "learning.d_data":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.d_data.",
    "learning.l_data":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.learning.l_data.",
    "fsrs.initial_difficulty":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.initial_difficulty.",
    "fsrs.initial_stability":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.initial_stability.",
    "fsrs.initial_recall":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.initial_recall.",
    "fsrs.forgetting_rate":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.forgetting_rate.",
    "fsrs.repetitions":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.repetitions.",
    "fsrs.weight":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.weight.",
    "fsrs.min_interval":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.min_interval.",
    "fsrs.max_interval":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.max_interval.",
    "fsrs.skip_condition":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.skip_condition.",
    "fsrs.time_limit_sec":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.fsrs.time_limit_sec.",
    "adaptation.scaffolded":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.adaptation.scaffolded.",
    "adaptation.full":
        "Patří ke kartě, ne k samostatnému uzlu — v registru je uvedeno jako block.adaptation.full.",
};

/** Cumulative: a field shows in its own mode and every mode above it. */
export const visible = (spec: FieldSpec, mode: Mode): boolean =>
    MODE_RANK[mode] >= MODE_RANK[spec.mode];

/** The fields of one level that `mode` may edit, minus the hand-written ones. */
export function fieldsFor(level: FieldLevel, mode: Mode): FieldSpec[] {
    return FIELDS.filter(
        (spec) =>
            spec.level === level && spec.custom !== true && visible(spec, mode),
    );
}

/** One field, by level and path — for the hand-written editors that want its label. */
export function fieldSpec(
    level: FieldLevel,
    path: string,
): FieldSpec | undefined {
    return FIELDS.find((spec) => spec.level === level && spec.path === path);
}

/** Whether a hand-written control should render at all. */
export function allows(level: FieldLevel, path: string, mode: Mode): boolean {
    const spec = fieldSpec(level, path);
    return spec === undefined ? true : visible(spec, mode);
}

/**
 * The registry entry an issue's `ref.field` addresses: its level, read off the ref
 * (an option, a question, a step, a card, a lesson or the course), and its path with
 * any list index dropped (`learning.prerequisites.1` → `learning.prerequisites`).
 */
export function fieldOf(ref: Ref): { level: FieldLevel; path: string } | null {
    if (ref.field === undefined) return null;
    const path = ref.field.replace(/\.\d+(?=\.|$)/g, "");
    if (ref.optionId !== undefined) return { level: "option", path };
    if (ref.stepId !== undefined) {
        return path.startsWith("question.")
            ? { level: "question", path: path.slice("question.".length) }
            : { level: "step", path };
    }
    if (ref.blockId !== undefined) return { level: "block", path };
    if (ref.lessonId !== undefined) return { level: "lesson", path };
    return { level: "course", path };
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
    if (field === null) return "teacher";
    const spec = fieldSpec(field.level, field.path);
    if (spec !== undefined) return spec.mode;
    if (`${field.level}.${field.path}` in NOT_EDITABLE) return "teacher";
    return undefined;
}
