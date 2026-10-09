# Open problems

Everything found in feedback round 2 and in the two scripted author sessions after it
that is **not fixed**. Nothing here is a plan; it is the list of things a teacher can
still hit, written down so the next round starts from what is known rather than from
what is remembered.

Fixed items are not repeated here — `docs/FEEDBACK-2.md` is the report they came from
and `docs/DECISIONS.md` ("Feedback round 2") says what was decided about each.

The **Verified** column is the honest part. Two of five findings from the first scripted
author and two of six from the second did not survive checking, so a claim nobody has
reproduced is marked as such rather than quietly promoted to a fact.

## How this file is organised

Three sections hold the *live* list, so that a reader can tell a defect from a decision:

- **Defects** — something is wrong and a teacher can hit it. These want fixing.
- **Unconfirmed** — not reproduced, or reproduced only from the code. They stay until
  someone sees them, or until the round that would have shown them is long past.
- **By design, recorded because it is surprising** — the behaviour is intended; the
  entry exists so nobody "fixes" it back. These are decisions wearing a defect's
  clothes, which is why they are not under *Defects*.

**Fixes that live in the app repository** (letters A–F) is a fourth section, and it is
not live either: the player is a repository this project cannot push to, so some fixes
live there. A and B are done; C–F are recorded for the day they matter.

**Closed** at the end of the file is not live either. It keeps the entries whose headings
are cited from `docs/DECISIONS.md`, `docs/spec/COURSE-EDITOR-SPEC.md` or a source comment,
so that every existing citation still resolves.

**Entry numbers are a citation key and are stable.** `docs/spec/COURSE-EDITOR-SPEC.md`,
`src/lib/domain/validate.ts`, `src/lib/editor/RailPeek.svelte` and earlier rounds of
`docs/DECISIONS.md` cite entries by number or letter, so an entry is never renumbered to
close a gap. Numbers are unique but not contiguous (there is no 36), and the round-9 audit
entries keep their `Round 9 audit #N` names rather than being folded into the sequence.
Where an entry is cited elsewhere, the entry says so.

---

## Fixes that live in the app repository

The player is a repository this project cannot push to, so some fixes had to be written
there, or recorded for the day they matter. Two of them (A, B) are done and now sit under
*Closed*; C–F are recorded here and want nothing until the situation they describe
changes.

### C. The app's question mark was always the first step's — fixed in the fork, pending upstream
**Verified: yes**, read off the code, and the fix is tested
(`EDU-AI-asistent-APP/test/widgets/block_step_engine_reveal_test.dart`). The upstream code
on GitHub gated the "?" on `ContentBlock.hasHint`, whose `currentHint` reads the step at
`currentStepIndex`, and nothing moved that off 0. So every step of a card offered the
first step's hint, or the card's. The fork's `BlockStepEngine` keeps the index on the
step it draws, and decides the "?" itself (fork `f90a384`, DECISIONS Round 5). The
owner says production already runs a newer app with this fixed, and its source lands
upstream within days. **When it does:** merge it into the fork, keep upstream's version of
the fix, and rerun that test and `test/preview`. If upstream fixes it differently, the
editor's `W_HINT_UNREACHABLE` rule (`validate.ts`, `checkHintReach`) and Náhled's
`_appShowsHint` have to follow.

### C2. A question card's later questions looked answerable and were not — fixed in the fork, pending upstream
**Verified: yes**, reproduced in Vyzkoušet, and fixed and tested in the same place as C.
A card of type Otázka or Cvičení is one bubble (`_buildExerciseCard`). Upstream drew
every step at once, with only the current question taking input, and a field below it
ignored typing. The owner reported it as "Vyzkoušet joins steps and I cannot continue".
The fork reveals a question when it is the one to answer, and says "Nejprve napiš
odpověď" for a typed answer. Same merge note as C.

### D. API: a status change bumps the version without a new file — API-side
**Verified: yes**, read off the code. `Course::boot` (`app/Models/Course.php:91-95`)
increments `version` on any update that does not set it, so `PUT /courses/{id}` with
only `{status}` — which is how the admin publishes — raises the stored version while
the stored file stays `v{old}.json`. The app compares versions, sees an update, and
locks the course's lessons behind the update banner for a file that did not change;
the editor's next upload then has to beat a number nobody authored. Matters for the
version control the editor is getting: publishing from it must always upload the whole
document with an explicit version, never flip a status alone.

### E. API: the upload writes to storage before checking ownership — API-side
**Verified: yes**, read off the code. `CourseController::upload` writes the file to R2
(`:190-199`) before the teacher-owns-this-course check (`:201-205`). A refused upload
still leaves an object at `courses/{id}/v{n}.json`. Not reachable from the editor
today (publishing is not wired), recorded for when it is.

### F. The app's library hides `data['private']`, an undocumented key — app-side
**Verified: yes.** `knihovna_page.dart:466-470` filters out a course whose JSON has
`private: true`, a key that is in neither spec. Harmless while nothing writes it; the
editor will not, and uses `status: private` for "PIN only".

---

## Defects

Entries where something is wrong and a teacher can hit it. These want fixing. The note at
the top of this file applies: numbers are a citation key and are never renumbered.

### 41. Unread fields no longer say so on screen
**Verified by reading the code** (Round 10). Until Round 10 every field nothing reads
yet began its hint with "Zatím bez účinku — aplikace ani API tuto hodnotu nečtou, jen se
uloží." The owner plans to make them take effect and does not want them kept in one
group, so they now sit in the section they belong to (Opakování, Návaznost,
Co karta procvičuje, V této lekci, Údaje o kartě, Průběh kurzu, Pro AI lektora) with the
same hint as any other field. A teacher or metodik who fills in a `fsrs.*`, `gpf.grade`,
`learning.*`, `xp` or `stop_gambling` field is therefore no longer told that the student
sees no difference. Nothing is lost silently: the `unread: true` flag stays on the spec,
is never offered in Učitel, and `fields.test.ts` still holds it to the ⚪ / ❌ / "Inert"
rows of `docs/spec/COURSE-EDITOR-SPEC.md` in both directions, so that spec list is the
record of what the app has yet to read. Closing this is the app (or API) reading those
keys; an unread field that stays unread should say so again, or leave the editor.
Related: #14, #15.

### 14. The FSRS fields write keys the app does not read
**Verified: yes**, per `COURSE-EDITOR-SPEC.md` §6.5. The authoring spec names them
`initial_difficulty`, `initial_stability`, `repetitions`…; the app reads `difficulty`,
`stability`, `reps` and nothing else. They were marked "Zatím bez účinku" until Round 10
(see #41), and now sit unmarked in „Opakování“. Which side is wrong is a spec question for the owner; the editor writes what the authoring
spec says.

### 15. A card's own XP is shown as its reward, and the app ignores it
**Verified: yes**, per the spec (§6.1 `xp` ⚠️ Inert) and "Still open" 8. The field is
marked unread now, but the card header still says "N XP · vlastní hodnota" when one is
typed (and just "N XP" when it is derived, since Round 8 dropped "· automaticky"). Worth
showing the derived figure with the authored one crossed out, or not offering the field.

Since Round 7 it also makes the totals differ between modes. A card with its own XP
keeps it on its first block only, so the view shows the card's 20 XP while Pokročilý
adds the derived XP of the card's other blocks: the admin's test course reads 335 XP in
Učitel and 380 XP in Pokročilý. What the app awards is neither: it counts steps, which
the split does not change. Showing the derived figure everywhere would fix both.

### 17. The player still talks to other origins while it runs — app-side
**Verified: yes.** Google Fonts (the app's `google_fonts`) and `accounts.google.com`
(its Google Sign-In client). They do not block the boot, since the build carries
CanvasKit and the Microsoft sign-in script is dropped from the preview page (DECISIONS
Round 5), but a slow or unreachable host still delays the fonts, and a font that
arrives late re-wraps the text. The fix is app-side: bundle the fonts, and don't
start sign-in on `/preview`.

### 18. Náhled is a hand-drawn copy of the app's card layout
**Verified: yes.** `lib/preview/preview_expanded_block.dart` in the fork draws every card
as one box per step, each with its own button row. The app draws a `question` or
`exercise` card as one bubble with dividers and the text merged into the question after
it (`BlockStepEngine._buildExerciseCard`). So Náhled and Vyzkoušet show those cards
differently, and every per-type rule has to be copied by hand (AGENTS.md rule 2). The
fix is to render Náhled through the engine itself, as a finished card whose taps go to
click-to-edit, with a Flutter test that the two lay out every card type alike.

### 19. The app grades a block as one item — app-side, and why questions are split
**Verified: yes, by reading the upstream code.** Best score over the block's questions
(`_bestScoreKoef`), the last mark given, one Kvíz answer (`scoreKoef >= 1.0`), one ELO
update and one practice card per block. Also: XP counts every step, including ones a
branch skipped; Kvíz takes only `exercise` blocks; the engine's cards are never graded
for spaced repetition (`_recordFsrsReview` is called only for atomic questions and
self-rated display cards). The editor now writes one block per question (DECISIONS Round
7), which makes the first four right per question. The rest need the app.

### 20. A jump into a later block leaves the blocks it skipped in the lesson, unfinished
**Verified: in the fork's Vyzkoušet, which draws it as the app does.** A jump inside a
split `question` card is now a jump between its blocks, and the blocks jumped over stay
in the pupil's list, drawn unfinished on their first step. Imported cards that jump
inside themselves are kept whole for this reason; a teacher who adds such a jump to a
card now gets this behaviour. App-side: the lesson list would have to hide a block a
branch skipped.

### 21. "Ukončit blok" on a card's first question ends only that question
**Verified: by construction (Round 7).** In a card split into blocks, `END` completes
the question's own block, and the pupil goes on to the card's next question, so for a
teacher it does what "Pokračovat dál" does. The option is not relabelled. An imported
card with such an `END` is kept whole.

### 25. In quiz_v2 courses the app shows no hints, help, solution or feedback, but the editor still asks for them
**Not reproduced in the editor; read from the spec.** COURSE-EDITOR-SPEC §2 says a
`quiz_v2` course keeps only the hint button, and with `quiz_evaluate: false` it also
drops solutions and per-option feedback, so a teacher writing a test is asked for text
the pupil never sees (and `W_NO_WRONG_OPTION_FEEDBACK` says the pupil "will not learn"
what the app does not tell). The Zpětná vazba switch is the teacher's, not a rule. A
candidate fix is a domain rule, once, in `src/lib/domain/` (AGENTS.md rule 1): which of
those fields the app shows for an `export_type` and `quiz_evaluate`, cited from
`lesson_detail_page.dart` and `block_step_engine.dart`, used by validation and the
registry alike. It should be checked against the app before it is written.

### 26. Hover-hidden actions on a touch screen are unverified
**Not reproduced.** A step's Duplikovat and Smazat, its drag grip, and the + between steps
are drawn faint or invisible until hover or focus, and always drawn under
`@media (hover: none)`. Playwright's desktop Chrome has a hover, so no test runs that
query, and it has not been tried on a tablet or in device emulation with touch. If a
touch device reports `hover: hover` (some do, with a paired mouse), the actions show only
after a first tap on the step, which focuses it.

The rail's tile and the tree's row follow the same pattern, but they are the first places
where the pattern has a stated fallback: on `@media (hover: none)` tapping the selected
tile toggles its panel, and the tile's panel is also what a right-click, Shift+F10 and the
ContextMenu key pin. The tree's rows have no touch path of their own yet. Still unverified
on a device that reports `hover: hover` without a mouse.

### 28. A menu opened while the column is still scrolling closes at once
**Reproduced in e2e, not by hand.** `Menu` closes on any scroll outside its panel, so the
menu stays anchored to its trigger. Selecting a card smooth-scrolls the editor column, and
a click on "Přidat krok" or ⋯ during that scroll opens the menu and shuts it again. The
e2e helper `openMenu` retries the click. A teacher would see a menu that flickers and
click again. A fix could ignore scrolls that start before the menu opened, or reposition
instead of closing.

### 30. Ctrl+Shift+B leaves focus on the page when it folds the preview
**Reproduced by reading the code.** The preview goes `inert` when folded. The buttons move
focus to the other toggle, but the shortcut does not, so focus inside the preview drops
to the page body.

### 31. Focus does not follow what was added or deleted
**Reproduced by reading the code.** Adding a step, an answer or a card leaves focus where
it was, and deleting one leaves it on nothing. A keyboard author does Enter, Enter, Enter
to add answers and is then somewhere they did not choose. It also covers Enter adding the
*next* answer (today it does not) and the delete dialog for a plain card (#15: a card with
nothing pointing at it still asks). Left for a later round: the fix is one focus
convention across every "add" and every "delete", and half of one is worse than none.

### 34. Metodik noise
**Not reproduced by a teacher, seen in the interface.** The step part is addressed
(Round 10): the per-step practice switch is offered only when the card is not already in
practice (`stepPracticeOffered`), and sits in the folded „Další nastavení kroku“. What is
left is unread fields drawn as empty rather than as "not asked yet", now #41, and the
rule about which fields a card of a given type actually earns, which is the same one #25
is waiting on.

### 35. Changing a card's type
**Reproduced in the UI.** A card's type is chosen when it is added and there is no way to
change it afterwards, so a text card that should have been a question is deleted and
written again. Not chosen this round: it is a command, a dialog and a rule about which
fields survive the conversion.

### 37. Ctrl+Z in a plain input undoes the course, not the text
**Reproduced by reading the code.** The page's key handler undoes the store for any Ctrl+Z
that nothing else consumed. `FocusField` consumes it, and since Round 9 the Markdown editor
leaves it to the store on purpose. The other inputs (the knowledge vector's numbers, the
topic and competency searches, the prerequisite picker, the field in the versions dialog) do not, so
Ctrl+Z inside one of them takes back the last course edit instead of the last characters
typed there. Not tried by hand. A fix is to let the page handler stand aside for an input
that keeps no store state of its own, the way Ctrl+B now does.

### 38. A question with several picks still carries "Kam dál" and grades nobody can see or clear
**Reproduced in unit tests.** With "Víc správných možností" on, the table hides the
columns the app ignores (DECISIONS Round 9), so an answer's old branch and grade stay in
the file with no field to clear them, except by switching the option off and on again.
`W_OPTION_OUTCOMES_IGNORED` says so at export review. Also app-side: the multi-select
branch of `_confirmAnswer` skips an option's `score_koef` too (`block_step_engine.dart:597-601`),
which the advanced "Podíl bodů" field still offers. Not changed here.

### 46. The player takes focus from the field being typed in when it boots
**Reproduced in the browser** (Round 15, real player). About two seconds after the page
loads, the Flutter player in the preview column focuses itself, and the field the teacher
had already clicked into loses focus — any field, the course name as much as a text step.
Whatever was typed after that goes nowhere until the teacher clicks back. It happens once
per player boot (page load, and the reload of a player that did not start). Not caused by
the visual editor; found while testing it. An editor-side fix is possible (give focus back
when the preview takes it without a click in it), not done here.

### 47. A text with formatting but no `*`, `__`, `##`, ``` ``` ```, `$` or `![` is shown raw by the app
**Reproduced by reading the app** (`step_content_renderer.dart` `_looksLikeMarkdown`). The
app renders a text step, question, answer, solution or feedback as Markdown only if it
contains one of those characters; otherwise it prints it as typed. The visual editor
writes bullets as `*` and the toolbar's heading as `##` so that a list or a heading alone
still counts. What it cannot help: a text whose only formatting is a numbered list, a
quote, a table, a link or a `# ` heading typed by hand prints as `1. …`, `> …`, `| … |`.
Reloaded, the editor then shows that text plainly too, matching the app. The fix is
app-side (render these fields as Markdown always, as hints already are); the editor may
not write `expected_output_format`, which is a legacy key (spec §3 invariant 7).

### 48. Teachers cannot upload an image; the visual editor takes web addresses only
**Verified by reading the API.** The only upload is `POST /api/admin/assets/upload`
(S3, public URL), and it is admin-only. So an image in a text, like an image step, is a
public `https://` address; a pasted or dropped image *file* gets one line saying how to
copy an image's address instead. Opening that endpoint to teachers is API-side.

### 49. Links in a text cannot be tapped in the app
**Reproduced by reading the app.** `MarkdownLatexWidget` sets no `onTapLink`, so a link
is styled but dead. The visual editor keeps the links a text already has and offers no
link button; pasted links stay links. App-side.

### 50. The app turns every `\n` in a text step into a line break, including inside a formula
**Reproduced by reading the app** (`block_model.dart` `displayText`:
`replaceAll(r'\n', '\n')`). It is there for backends that double-escaped newlines, and it
also hits LaTeX: `$a \neq b$`, `\nu`, `\nabla`, `\newline` lose their command to a line
break in a text step (not in hints, answers or solutions, which do not go through it).
The editor writes what the teacher typed; the fix is app-side. Until then, `\ne` has the
same problem and `\not=` does not.

### 51. Formulas in the editor are drawn by KaTeX, in the app by flutter_math
**Not a reproduced defect; a known difference.** Both read the same LaTeX, and for school
mathematics they agree. A command one supports and the other does not would draw in the
field and fall back to orange source in the app (or the reverse). Náhled is the reference:
it is the app.

### 52. Faint text in the top bar and elsewhere fails WCAG AA colour contrast
**Reproduced by axe** (Round 15, `@axe-core/playwright`, rule `color-contrast`): 24
elements on a new course's page, among them the version chip and the save status.
`e2e/accessibility.spec.ts` gates WCAG level A only for that reason; once these pass,
add `wcag2aa` to its tags. Not caused by the visual editor.

---

## Unconfirmed

Entries not reproduced, or reproduced only from the code. They stay until someone sees
them, or until enough rounds pass that the behaviour would have surfaced.

### 7. A possible transition artifact in "Vyzkoušet" — likely fixed (Round 5)
**Verified: no.** One scripted author flagged it and was explicit about not being sure
what they saw. Round 5 found three real transition bugs, and any of them would look
like this:
- a finished card was re-created as merely "completed", losing its answers and
  opening every step;
- a card a branch jumped over was drawn as finished;
- the editor opened every step of the next card.

All three are fixed and tested. Close this if nobody reproduces it again.

### 9. The markers in Náhled print Markdown and LaTeX as typed
**Verified: yes**, seen in the browser. The hint, help and branch markers are plain
`Text`, so "Pomoc: Ve zlomku $\frac{a}{b}$ říká **b**" shows its syntax. They are
preview-only notes, so it misleads nobody about what the student sees, but it reads
badly. Fix is in the fork (render them with `MarkdownLatexWidget`), not done.

---

## By design, recorded because it is surprising

The entries whose behaviour is intended, so that none of them is read as a defect
waiting to be fixed. Each is written up **once**, here. The numbers are the citation
key, not a reading order — 4 and 5 were the first entries ever written and 11 was added
last, which is why the sequence is neither ascending nor contiguous.

### 12. Server versions are reachable only from the browser that made them
**By design until sign-in.** The owner is a random key in this browser's
`localStorage`; the server stores its hash. Clear site data, or open another browser,
and that server history is out of reach — it is not deleted, nobody can find it. The
dialog and the "Kde je kurz uložený" note say so. Fix: sign-in, then
`lib/server/versions/owner.ts` resolves the session instead of the key. The question
side of this is `DECISIONS.md` "Still open" 3.

### 13. Publishing marks a version and downloads it; it does not upload
**By design until sign-in.** `POST /api/courses/upload` needs a signed-in teacher.
Until then "Zveřejnit" records which version is out, for whom, and downloads that file
for the administration's upload. The API's own quirks (D, E) matter the day it is
wired. The blocking question is `DECISIONS.md` "Still open" 2.

### 4. "Duplikovat lekci" shares its cards rather than copying them
**Verified: yes** — and deliberate: bindings are copied, blocks stay shared, which is
what the format is built for (§5, and the comment on `duplicateLesson`). The problem is
that the only tell is a small `Sdílený (2×)` chip on the card, so a teacher who
duplicates a lesson to make a variant edits both. Worth an explicit choice at the point
of duplication rather than a chip discovered afterwards. *Cited from `DECISIONS.md`
Round 8.*

### 5. A no-op import → export rewrites key order in real-world files
**Verified: yes**, and deliberate: output key order is canonical so that a publish diff
is readable (`docs/DECISIONS.md`, M1). Values round-trip deep-equal — the scripted
author confirmed that separately. The cost is that re-exporting an existing file
produces a few hundred lines of diff that are all noise, which makes "what did I
actually change" hard to answer for a course that came from somewhere else.

### 16. "Přejít" can switch the editing mode
**By design, recorded because it is surprising.** A review row whose fix is in a higher
mode switches to that mode on the jump, and the mode stays switched. The alternative —
landing on a card whose field is not drawn — is what this replaced. *Cited from
`DECISIONS.md` Round 8, which applies the same rule to 24.*

### 22. The version button says "upraveno" right after importing a multi-question course
**Verified: by construction.** The import is recorded as the version it came with; the
split that follows is an edit, so the working copy differs from that version. True, and
undo takes it back, but a teacher who changed nothing sees "upraveno".

### 23. Editing a card overwrites settings its blocks disagree on
**Verified: by construction.** A card's settings are written to each of its blocks. If
an advanced author gave two blocks of one card different settings, the teacher's view
shows the first block's, and the next edit to the card writes them to all its blocks.
Nothing warns about the disagreement.

### 24. A jump onto a hidden feedback field switches feedback back on
**By design, recorded because it is surprising.** The twin of 16. While Zpětná vazba is
off, "Přejít" (from the panel or the export review) and a click on the "?" in Náhled that
lands on a hint, help, solution or answer feedback turns it back on, and it stays on. The
alternative, landing on a card whose field is not drawn, is what the switch replaced.
**Reproduced:** yes, in `e2e/feedback-toggle.spec.ts`.

### 27. Removing the card's crumb removed the way to a lesson's settings from the card
**By design, recorded because it is a change.** The crumb's lesson name opened the lesson's
settings. A card in a lesson has no crumb now (DECISIONS Round 8); the lesson's settings
are on its row in the tree, and since Round 9 also in the panel beside a lesson circle in
the folded rail. The lesson's own deletion and duplication are in that dialog, so nothing
a teacher needs is reachable only from a hover.

### 32. The validation panel
**Seen in a session, not fixed.** It has no Escape, a dismissal is forgotten on the next
validation run, and it says "publikovat" where the rest of the editor says "zveřejnit".
Not chosen this round: the panel is being reworked with the topbar, and the wording is part
of that.

### 33. Labels the editor uses in two senses
**By design so far, but it costs a teacher.** "Blok" and "karta" are both used for the same
thing depending on the mode; "Zpět" is the undo in one place and the way out in three
others; "Cvičení" and "Opakování" name the same property in the chip and the field. Renaming
touches every spec that locates by accessible name, so it wants its own round with the e2e
suite in hand.

### 43. What the Round 11 CRUD re-audit left
**Found by a scripted audit of every settings and editor-column flow, not fixed.**
Reproduced in the browser unless said otherwise.
- A skill's level cannot be changed in place (remove it and add it again), and neither
  skills nor answers can be reordered.
- Předpoklady: choosing a skill silently clears the card select, and the threshold stays
  disabled until one of the two is chosen, with nothing saying why. The card picker lists
  cards with the same title twice („Kolik je?“), with nothing to tell them apart.
- „Barva karty“ and „Pozadí karty“ (V této lekci) are free text with no picker, and
  „Zařadit do cvičení“ appears both in Základní and in V této lekci (the second is the
  legacy binding flag).
- Zpět is enabled right after an import and goes back to the empty „Nový kurz“.
- „Kdo kurz uvidí: Veřejný“ in course settings reads as text rather than a way to the
  version dialog.
- Playwright sees a `pageerror` with an empty message on every page load; the editor works.
  Not traced.
- Pokročilý shows block and step ids in „Kam dál“ and the step headers, and GPF codes on
  skill rows. Pokročilý is meant to show them; listed so the choice is a decision, not an
  accident.

### 44. Opakování explains too little, and waits for the newer app
**Known, deliberately not fixed yet.** The owner's call (Round 12): the fields of the card's
Opakování section need better explanations, and those are to be written once the newer
version of the app is public. The public app code is months behind the app in
development, so what it reads today is no guide to what these fields will do.

What a teacher misses today, field by field:

| Field | Missing for a teacher |
|---|---|
| Počáteční obtížnost (`fsrs.initial_difficulty`) | what a higher number does (intervals grow more slowly) and when to change it |
| Počáteční stabilita (`fsrs.initial_stability`) | that it is in effect the first gap before the card returns; "stabilita" is jargon |
| Počáteční vybavení (`fsrs.initial_recall`) | that it is the assumed chance the student still remembers |
| Rychlost zapomínání (`fsrs.forgetting_rate`) | the direction (higher = the card comes back sooner) and a range |
| Počet opakování (`fsrs.repetitions`) | that it is only for imported, already practised content; no default or unit |
| Priorita v opakování (`fsrs.weight`) | the scale, the default and that higher comes first |
| Nejkratší / Nejdelší odstup (`fsrs.min_interval`, `max_interval`) | what the gap is: the time until the card returns |
| Podmínka vynechání (`fsrs.skip_condition`) | which variables an expression may use; it is free text with one example |
| Časový limit (`fsrs.time_limit_sec`) | whether it is enforced, and what happens when it runs out |

To check against the newer app when it lands: in the public code (`block_model.dart`,
`FsrsParameters.fromJson`) the app reads `block.fsrs.stability`, `difficulty`, `reps`,
`lapses`, `last_review` and `due_date`, while the editor writes the format's
`initial_stability`, `initial_difficulty`, `repetitions` and the rest. If the newer app
keeps those names, one side has to change before any of these fields does anything.

### 45. What the Round 12 teacher test found and left
**Found by an agent doing six teacher tasks by reading only the screen. Mostly fixed in
Round 13 (`DECISIONS.md` → Round 13); what is left:**
- Pojmy typed fresh keep the case they were typed in; only a term the course already uses
  takes the course's spelling.
- The step's „Další nastavení kroku“ has no line naming what a higher mode adds there.
- From the Round 13 teacher test (all eight tasks done, these slowed it down):
  Pokročilý also changes the XP totals and names steps „s1“ instead of „Krok 1“, which
  the one-time note does not mention; the import banner says „V editoru vypadají stejně“
  while Pokročilý shows them split. The cut-off warning says „Krok 3“, not the step's
  name. „Kam dál“ groups read as jargon („Průběh“, „Krok v tomto bloku“, „Ukončit blok“).
  Answer feedback shows raw Markdown (`**nahoře**`). Search knows a few teacher words per
  section, not a thesaurus. Settings in a higher mode still need the switch: that is
  the modes' design, now signposted.
- Fixed in Round 13, kept as a record: settings hidden by the mode (a line naming what
  the next mode adds, with „Přepnout“, and search in every mode); split cards in Pokročilý
  (joined in the tree, explained once); „↳ Krok 3“ is the way to an answer's „Kam dál“,
  and the picker opens below it; a step cut off by a change is said under the answer;
  a new skill row is marked; the undo notice sits in the dialog's footer; Pojmy suggest
  the course's terms; „Kam dál“ keeps letters typed while it opens; „výchozí sada“ is a
  grey label with its meaning; the course dialog has „Hotovo“.

### 11. Folding is remembered for the session only
**By design for now.** `StepView` lives as long as the page. A reload opens every step
again. Worth persisting with the draft if authors of long cards ask for it. Appears last
because it was added after 39 and the numbers are a citation key, not a reading order.

---

## Closed

Headings kept so that a citation from `docs/DECISIONS.md`,
`docs/spec/COURSE-EDITOR-SPEC.md`, a source comment or an earlier round still resolves.
**Nothing here is open**, and the entries no longer sit in the live list above. The round
that closed it is named, and the reasoning is in that round's section of
`docs/DECISIONS.md`.

### 39. The design brief agents are told to follow is not on `main` — closed (PR #1 merged)
**Verified by reading the repo.** The standing instructions every agent on this project
gets — the workspace `AGENTS.md`, which sits outside this repository, next to the
checkouts — tell them: *"For anything a teacher sees, follow `docs/DESIGN.md`"* (in this
repo). That file does not exist on `main`. It was written by the 2026-09-29 design review
and pushed as branch `claude/design-brief`, which is open as **PR #1** and unmerged. So
the standing instructions point at a document the repository does not contain, and an
agent that checks will find nothing; one that does not check will invent a design
authority from the current UI — which is exactly what the brief was written to stop.

This is the owner's call, not a fix to make here. Either **merge PR #1** (the brief then
becomes real authority and this entry goes away), or **rewrite the instruction** to say
the brief is a *proposal pending approval* and the current UI is not yet the target.
Until one of those happens the reference in the workspace instructions is marked as
pending rather than approved, so nobody mistakes a proposal for a decision.

The same branch also rewrites `docs/DECISIONS.md` and `docs/OPEN-PROBLEMS.md` down to
their post-review state, so merging it is not a docs-only change: it is a decision about
which of those files is canonical. That is why it was not merged as part of the
2026-09-30 workspace tidy.

**Closed in Round 15.** PR #1 was merged (`842c8ad`); `docs/DESIGN.md` is on `main` and is
the authority `AGENTS.md` says it is.

### 1. An empty lesson is invisible to validation — fixed (Round 4)
`W_EMPTY_LESSON` reports it in the review. The tree still says "5 min" for it, on
purpose: that is the number the app shows a student (`course_model.dart` floors the
estimate at five), and the editor's totals mirror the app's arithmetic. *Cited from
`src/lib/domain/validate.ts`.*

### 2. Dragging a card to reorder it only grabs on the text — fixed (Round 8)
**Reproduced: yes** (`e2e/tree.spec.ts`, which fails without the fix); the heading stays
because `DECISIONS.md` Round 8 cites it. The cause was as reported: `svelte-dnd-action`
refuses to start a drag when the press lands on an element that has a `value` and is not
the draggable itself, and every `<button>` has one. The card's row was a `<button>` inside
the `<li>` the library drags, so a press on the button's padding did nothing and only a
press on the text inside it (a `<span>`) grabbed.

The cards in the open lesson are now `<div role="button" tabindex="0">`; Enter and Space
select them, and the library's own keyboard drag is off for them (`zoneItemTabIndex: -1`,
and the key is claimed before the `<li>` sees it). The list of cards outside any lesson is
not a drag zone and keeps real buttons.

### 3. `block.status` is authored and read by nothing — no longer offered (Round 4)
New cards carry no status, the chip is gone, and no mode offers the field. Imported
values survive. Publishing moves to the course (version control, in progress). *Also
under `DECISIONS.md` "Still open" → Closed from this list.*

### 6. The downloaded filename does not follow a course rename — fixed (Round 4)
The file is named from the course name. Every new course also gets its own id now; it
used to be `NOVY_KURZ` for all of them.

### 8. The "draft" status has no rollup — moot, card status is gone (Round 4)

### 10. The preview's status chip says "Náhled" in Vyzkoušet too — fixed (Round 9)
A running player has no chip now; the column's `data-player` is what tests read. *Cited
from `DECISIONS.md` Round 9.*

### 29. The gear on a rail tile is a small target — fixed (Round 9)
The folded panel's tile has no gear at all now: it is a 36×36 icon, and its four actions
(Nastavení, Duplikovat, Odebrat z lekce, Smazat) are 32px circles in a panel that opens
beside it, in the top layer so the sidebar's overflow cannot clip it. A lesson circle's
gear went the same way into its own, lighter panel. The 14px target is gone. *Cited from
`DECISIONS.md` Round 9.*

### Round 9 audit #8. A deleted lesson said nothing and left the editor in a lesson that was gone — fixed
`deleteLesson` returned no `ref`, so after deleting the lesson the editor was standing in,
the column kept showing the lesson that no longer existed. The command now returns the
neighbouring lesson (the next, else the previous), `editor/lesson-actions.ts` moves the
selection only when it was inside the deleted one, and the shared notice says "Lekce
smazána. Její karty jsou v Kartách mimo lekce." with "Vrátit zpět". The lesson's cards are
left in the course by design (`deleteLesson` never deleted blocks); the message now says so
instead of leaving the teacher to find out.

### Round 9 audit #10. A chip that computes its own warning — removed
The tree's open lesson row and Nastavení lekce drew "Zpětná vazba jen u X % chybných
odpovědí" under the "Zpětná vazba X %" chip. It broke two rules at once: no chip states a
verdict of its own, and a warning waits while the teacher is still writing. It also stayed
on screen with Zpětná vazba switched off. The chip that states the share stays, and every
question is covered by `W_NO_WRONG_OPTION_FEEDBACK`; the second line, its `.nudge` and
`.warn` rules and the `lessonDidactics` call behind them are gone.

### A. Images — moved into the editor (done)
The player routes every image through the Laravel proxy, which 502s for hosts that
redirect or that refuse the API server (`picsum.photos`, `upload.wikimedia.org`;
`placehold.co` works, which is why the failure looks random). The editor serves the
player's bytes, so the fix lives here instead: a same-origin `/preview-image` endpoint
that fetches the image server-side — where CORS does not apply — and falls back to the
Laravel proxy, plus a shim injected into the player's `index.html` that redirects the
player's own proxy requests to it. **The editor no longer needs a patched player for
images.**

### B. Click-to-edit hit target — shipped in the fork (done)
The card-level opaque `PreviewTarget` is in the fork since `22b37cb`, so a click on a
step's padding in Náhled lands on the step. It is fork-only: `edu-ai-00` has no
`lib/preview/` at all, so nothing here depends on it being accepted upstream.

### 40. Production `nginx.conf` is exercised by no test, and it has already served a blank preview once — closed (round 16)
**Verified by reading the repo and the 2026-09-30 fix** (`1bcff8d`). In the image, nginx
serves `/player/` and the editor on one origin; `vite preview` serves `/player/` a
different way (`vite-plugin-player.ts`), which is what the e2e suite runs against. So the
config that actually ships is reached by nothing in CI and nothing in `e2e/`.

That is not theoretical. On 2026-09-30 the `/player/` asset `location` matched its
requests but had **no `alias`**, so nginx served those paths from its *default* root and
every `.png` / `.ico` / `.woff` / `.wasm` under `/player/` was a 404 — CanvasKit above
all. The page loaded, the wasm did not, and the preview stayed blank. `1bcff8d` fixed it
by capturing the asset path by name (`location ~* ^/player/(?<asset>…)`) and aliasing it
into `/usr/share/nginx/player/$asset`. The player's build really does ship
`canvaskit/canvaskit.wasm`, `canvaskit/skwasm.wasm` and `sqlite3.wasm`, so every one of
them was in the failing set.

The failure class — *page loads, an asset 404s, the preview is blank* — is invisible to
`npm run check`, to `npm test`, and to the `editor` and `player` Playwright projects
alike. It was found by a person looking at an empty preview.

Two things follow, and the second is the one that bites:

- The `/player/` asset block now carries a comment saying why the `alias` and the named
  capture are both needed, because the obvious "simplification" back to
  `alias …/player/;` reintroduces a 301 whose fallback still hands Flutter the wrong
  bytes — a failure that reads as a working request.
- **Nothing would catch it if it happened again.** A guard is a Docker smoke test: build
  the image, run it, and assert a known player asset answers `200` with
  `content-type: application/wasm`, plus a representative `.woff2` and `.ico`. That test
  fails on the pre-`1bcff8d` config, which is the point of it. It needs the image build
  (which clones the player at `PLAYER_REF` and runs a Flutter build inside the image), so
  it is slow and belongs in CI rather than in the local loop. Not written yet.

Not related, but checked while looking: `docker-entrypoint.sh` expands the template with
`envsubst '$PORT $API_URL'` — an explicit allowlist — so the fix's `$asset` capture and
nginx's own `$uri` survive expansion. That part is fine.

**Closed in round 16.** CI's `run-docker` job builds the image, runs it and loads it with
`npm run smoke -- <url> --player` (`scripts/smoke.mjs`). Besides the page itself, that
needs `/player/` to be the Flutter build with the image shim, and `canvaskit.wasm`,
`favicon.ico` and `favicon.png` under it to answer 200 with their own content types. Under
the pre-`1bcff8d` config they came from nginx's default root and 404'd, so the job should
fail there; that is read from the config, not run against the old image. It checks that nginx serves the player, not that the preview draws; that is still
the `player` Playwright project, run locally.
