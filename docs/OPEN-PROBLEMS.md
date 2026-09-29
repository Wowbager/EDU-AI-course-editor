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

---

## Fixes that live in the app repository and cannot ship from here

The player is `edu-ai-00/EDU-AI-asistent-APP`, which this project cannot push to. Two
round-2 fixes were written there before that was clear. What happened to each:

### A. Images — moved into the editor
The player routes every image through the Laravel proxy, which 502s for hosts that
redirect or that refuse the API server (`picsum.photos`, `upload.wikimedia.org`;
`placehold.co` works, which is why the failure looks random). The editor serves the
player's bytes, so the fix lives here instead: a same-origin `/preview-image` endpoint
that fetches the image server-side — where CORS does not apply — and falls back to the
Laravel proxy, plus a shim injected into the player's `index.html` that redirects the
player's own proxy requests to it. **The editor no longer needs a patched player for
images.**

### B. Click-to-edit hit target — shipped in the fork
The card-level opaque `PreviewTarget` is in the fork since `22b37cb`, so a click on a
step's padding in Náhled lands on the step. It is fork-only: `edu-ai-00` has no
`lib/preview/` at all, so nothing here depends on it being accepted upstream.

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

### 1. ~~An empty lesson is invisible to validation~~ — fixed (Round 4)
`W_EMPTY_LESSON` reports it in the review. The tree still says "5 min" for it, on
purpose: that is the number the app shows a student (`course_model.dart` floors the
estimate at five), and the editor's totals mirror the app's arithmetic.

### 2. ~~Dragging a card to reorder it only grabs on the text~~ — fixed (Round 8)
**Reproduced: yes** (`e2e/tree.spec.ts`, which fails without the fix). The cause was as
reported: `svelte-dnd-action` refuses to start a drag when the press lands on an element
that has a `value` and is not the draggable itself, and every `<button>` has one. The
card's row was a `<button>` inside the `<li>` the library drags, so a press on the
button's padding did nothing and only a press on the text inside it (a `<span>`) grabbed.

The cards in the open lesson are now `<div role="button" tabindex="0">`; Enter and Space
select them, and the library's own keyboard drag is off for them (`zoneItemTabIndex: -1`,
and the key is claimed before the `<li>` sees it). The list of cards outside any lesson is
not a drag zone and keeps real buttons.

### 3. ~~`block.status` is authored and read by nothing~~ — no longer offered (Round 4)
New cards carry no status, the chip is gone, and no mode offers the field. Imported
values survive. Publishing moves to the course (version control, in progress).

---

## Working as designed, but surprising

### 4. "Duplikovat lekci" shares its cards rather than copying them
**Verified: yes** — and deliberate: bindings are copied, blocks stay shared, which is
what the format is built for (§5, and the comment on `duplicateLesson`). The problem is
that the only tell is a small `Sdílený (2×)` chip on the card, so a teacher who
duplicates a lesson to make a variant edits both. Worth an explicit choice at the point
of duplication rather than a chip discovered afterwards.

### 5. A no-op import → export rewrites key order in real-world files
**Verified: yes**, and deliberate: output key order is canonical so that a publish diff
is readable (`docs/DECISIONS.md`, M1). Values round-trip deep-equal — the scripted
author confirmed that separately. The cost is that re-exporting an existing file
produces a few hundred lines of diff that are all noise, which makes "what did I
actually change" hard to answer for a course that came from somewhere else.

### 6. ~~The downloaded filename does not follow a course rename~~ — fixed (Round 4)
The file is named from the course name. Every new course also gets its own id now; it
used to be `NOVY_KURZ` for all of them.

---

## Unconfirmed

### 7. A possible transition artifact in "Vyzkoušet" — likely fixed (Round 5)
**Verified: no.** One scripted author flagged it and was explicit about not being sure
what they saw. Round 5 found three real transition bugs, and any of them would look
like this:
- a finished card was re-created as merely "completed", losing its answers and
  opening every step;
- a card a branch jumped over was drawn as finished;
- the editor opened every step of the next card.

All three are fixed and tested. Close this if nobody reproduces it again.

### 8. ~~The "draft" status has no rollup~~ — moot, card status is gone (Round 4)

### 9. The markers in Náhled print Markdown and LaTeX as typed
**Verified: yes**, seen in the browser. The hint, help and branch markers are plain
`Text`, so "Pomoc: Ve zlomku $\frac{a}{b}$ říká **b**" shows its syntax. They are
preview-only notes, so it misleads nobody about what the student sees, but it reads
badly. Fix is in the fork (render them with `MarkdownLatexWidget`), not done.

### 10. The preview's status chip says "Náhled" in Vyzkoušet too
**Verified: yes.** The green chip means "the player is running", and it is labelled
with the name of the other mode. Cosmetic; the whole browser suite waits on that chip,
so renaming it is a change to every preview test and was left for its own commit.

### 12. Server versions are reachable only from the browser that made them
**By design until sign-in.** The owner is a random key in this browser's
`localStorage`; the server stores its hash. Clear site data, or open another browser,
and that server history is out of reach — it is not deleted, nobody can find it. The
dialog and the "Kde je kurz uložený" note say so. Fix: sign-in, then
`lib/server/versions/owner.ts` resolves the session instead of the key.

### 13. Publishing marks a version and downloads it; it does not upload
**By design until sign-in.** `POST /api/courses/upload` needs a signed-in teacher.
Until then "Zveřejnit" records which version is out, for whom, and downloads that file
for the administration's upload. The API's own quirks (D, E) matter the day it is
wired.

### 14. The FSRS fields write keys the app does not read
**Verified: yes**, per `COURSE-EDITOR-SPEC.md` §6.5. The authoring spec names them
`initial_difficulty`, `initial_stability`, `repetitions`…; the app reads `difficulty`,
`stability`, `reps` and nothing else. They are marked "Zatím bez účinku" now. Which
side is wrong is a spec question for the owner; the editor writes what the authoring
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

### 16. "Přejít" can switch the editing mode
**By design, recorded because it is surprising.** A review row whose fix is in a higher
mode switches to that mode on the jump, and the mode stays switched. The alternative —
landing on a card whose field is not drawn — is what this replaced.

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

### 27. Removing the card's crumb removed the way to a lesson's settings from the card
**By design, recorded because it is a change.** The crumb's lesson name opened the lesson's
settings. A card in a lesson has no crumb now (DECISIONS Round 8); the lesson's settings
are on its row in the tree.

### 28. A menu opened while the column is still scrolling closes at once
**Reproduced in e2e, not by hand.** `Menu` closes on any scroll outside its panel, so the
menu stays anchored to its trigger. Selecting a card smooth-scrolls the editor column, and
a click on "Přidat krok" or ⋯ during that scroll opens the menu and shuts it again. The
e2e helper `openMenu` retries the click. A teacher would see a menu that flickers and
click again. A fix could ignore scrolls that start before the menu opened, or reposition
instead of closing.

### 29. The gear on a rail tile is a small target
**Seen in a screenshot, not tested with people.** In the folded lesson panel, a card
tile's settings gear is a badge of about 14px on the tile's corner. It is a second way in,
since "Nastavení karty" stays in the card header, but a tired hand will miss it. Worth
growing if teachers use the rail.

### 30. Ctrl+Shift+B leaves focus on the page when it folds the preview
**Reproduced by reading the code.** The preview goes `inert` when folded. The buttons move
focus to the other toggle, but the shortcut does not, so focus inside the preview drops
to the page body.

### 31. Ctrl+Z in a plain input undoes the course, not the text
**Reproduced by reading the code.** The page's key handler undoes the store for any Ctrl+Z
that nothing else consumed. `FocusField` consumes it, and since Round 9 the Markdown editor
leaves it to the store on purpose. The other inputs (the knowledge vector's numbers, the
topic and competency searches, the prerequisite picker, the field in the versions dialog) do not, so
Ctrl+Z inside one of them takes back the last course edit instead of the last characters
typed there. Not tried by hand. A fix is to let the page handler stand aside for an input
that keeps no store state of its own, the way Ctrl+B now does.

### 11. Folding is remembered for the session only
**By design for now.** `StepView` lives as long as the page. A reload opens every step
again. Worth persisting with the draft if authors of long cards ask for it.
