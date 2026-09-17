# Decisions taken

Per plan §5, each milestone ends with a short written record of what was decided and
why. Read this with `PLAN.md` and `docs/COURSE-AUTHORING-SPEC.md`.

---

## M1 — Domain

**"Byte-stable round-trip" is held as value-stability.** Byte-stability at the text
level is not a property JSON has: whitespace and key order are the source file's own
choices. The invariant enforced instead is stronger where it matters and testable:
`serialise(parse(x))` deep-equals `x`, and serialising twice is byte-identical
(`roundtrip.test.ts`). Key order on output is canonical and deterministic, which also
makes the publish diff readable.

**Parsing never injects defaults.** A field absent from the source stays absent. This
is what keeps "import → no-op edit → export" from growing the document, and it is why
`show_solution: true` is not written into every question on load.

**Unknown keys are preserved; legacy keys are not.** Real documents carry
`_comment_structure`, `expected_input` and other fields the editor does not model, and
losing them on a round trip would be a data loss the author never asked for. They are
emitted after the known keys. The exception is the legacy shapes of §3 invariant 7
(`content`/`image`/`video`/`question` flat on a block, `block_ids`, `modes.static`,
`evaluation_config`, `step_id`, `next_actions`, …), which are migrated on import and
deliberately never written back. `import.test.ts` asserts this over the whole corpus.

**Explicit `null` is read as absence.** Ten blocks in the corpus carry
`"author": null`, `"domain": null` and so on, and the app reads them as absent.
Carrying a third state around would leak into every field component, so nulls are
dropped on import. `gpf.grade` keeps its null, where the spec gives it a meaning.

**Validation returns a flat `Issue[]` split into errors and warnings, exactly as §14
draws the line.** Nothing is promoted or demoted. One check was *added* as a warning
because §14 does not mention it: `W_DUPLICATE_OPTION_ID`. Duplicate option ids break
saved answers (§8.2), but inventing a new blocking rule would violate §3 invariant 5 —
so it warns, and is flagged as an open question below.

**Messages are Czech and written as consequences for the student.** "Žák se nedozví,
kde udělal chybu" rather than "missing feedback". `validate.test.ts` enforces that
every message is long enough to be a sentence and is actually in Czech.

**The dimension count comes from the skill configuration or nowhere.** When no config
has loaded, vector length is not checked at all rather than checked against a guess.
`validate.test.ts` runs the same document against a 35-dimension config, a
12-dimension config and none, and expects three different outcomes.

**Fixtures.** The §16 worked course validates completely clean against the app's real
`dimensions_cs.json` — a good sign the validator matches the spec's own example. Its
broken twin (`spec-16-course-broken.json`) is generated so that every §14 rule has
exactly one cause in it, and the test asserts the exact code tallies.

---

## M2 — Document store and commands

**Commands are pure functions, the store is a thin shell.** `(doc, args) =>
{doc, ref, description}`. The invariants are therefore testable as properties without
a component runtime: `commands.test.ts` runs 40 seeded random sequences of
add/duplicate/delete/reorder and asserts after every single step that there are no
dangling `go_to`s, no duplicate ids, dense `order`, and no id ever handed to two
different things.

**Deletion is two-step and cannot be bypassed.** `planDelete*` returns every pointer at
the target; `delete*` throws unless each one carries a repair. There is no
"delete anyway" path in the domain layer, which is what §3 invariant 3 asks for.

**Ids are reserved for the session, not just for the document.** Two real holes turned
up under the property test, both invisible to a document-only implementation:

- delete every step of a block and add one, and `s{max+1}` mints `s1` again;
- delete a duplicated block and duplicate again, and `_copy` is minted again.

A student's answers, completion and practice card are keyed by `(block_id, step id)`,
so a reused id silently inherits them. Nothing in the format can record a deleted id,
so the **store** carries the set of ids it has handed out and passes it to the minting
functions. The fix is inside the editor's lifetime, which is the scope available; it
is called out below as something the format itself cannot currently solve.

**Renaming an id is a command of its own.** `setField` refuses id fields outright and
says why, because a rename has to rewrite every binding, `go_to` and prerequisite in
the same step.

**Undo stores documents, not patches.** The documents share structure, the entries are
cheap, and undo cannot drift from the forward operation.

---

## M3 / M4 — Shell and card editors

**Tokens are ported, not invented.** `src/lib/styles/tokens.css` is transcribed from
`assets/themes/default.json`, `app_decorations.dart` and `app_text_styles.dart`. The
only additions are `--e-` prefixed: the sizes the plan fixes in §4, and the semantic
roles the editor needs and the player does not.

**There is no Figma draft for the editor**, so the layout follows the numbers §4
states — sidebar 260 collapsing to a 56 rail, flexible editor column, 400 preview —
and the focus-reveal behaviour follows its written description: values read as text,
the input appears on focus. The styling is taken from the published theme guide
(`app-admin.edu-ai.eu/docs/design-tokens.html`), including its **named type scale**:
the tokens in `tokens.css` keep the app's own names (`--type-card-title`,
`--type-meta`, `--type-chip-label`) so that a change in `app_text_styles.dart` has an
obvious counterpart here.

**Focus-reveal is a real button, not a div.** The text state is a `<button>`, so the
pattern is keyboard-reachable and announced as editable; Enter or a click opens the
input, Escape abandons, blur commits.

**Teacher mode hides every id.** A step shows "Krok 3", the `go_to` picker offers
"Krok 3: Připomenutí", and `block_id` appears only under author mode. This was caught
by a browser test, not by review — and then turned into one (`a teacher is never shown
an id they must not change`).

**`go_to` is a `<select>` of keywords, steps and blocks.** There is no code path that
writes a free-text target. The control is hidden entirely for exercise blocks and
`exercise_v2` courses, where the player ignores branching.

**Block type is chosen by which card you add** ("Výklad / Otázka / Cvičení"), never
edited as a raw field.

---

## M5 — Preview

**Both halves are built, and they talk.** The player boots in the iframe, renders the
selected card, and a click on its rendered text comes back as
`{blockId, stepId, field}` — which the editor turns into a highlighted step. Three
browser tests cover it; they skip when no Flutter build is present.

**Messages are JSON strings in both directions.** The first version posted structured
objects from the editor and strings from the player, and nothing arrived. Structured
clone would work one way, but Dart hands a cloned object back as an opaque JS value,
so one encoding for both legs is what stays debuggable.

**Flutter draws to a canvas, so the tests assert the contract, not the pixels.**
There is no DOM inside the frame. What can be asserted is that the player announced
itself, that a click returns the ref of the block that was on screen, and that an
edit never produces a second `ready` — which is how "never reload the iframe" is
held to.

**The engine re-mounts, the frame does not.** `bridge.ts` debounces updates by 250 ms
and re-mounts only when the step ids change, restoring to the nearest surviving step
(`bridge.test.ts`). A reload would cost seconds of Flutter boot while the author is
mid-sentence.

**Clicking answers, clicking content edits.** The hit-targets in the player wrap the
*passive* leaves — text, media, the solution, an option's feedback. Options keep their
own tap behaviour, because "Vyzkoušet" has to mean actually trying it.

**The player URL is probed before the iframe is mounted.** Without that the frame
renders whatever the origin serves at that path — in development, a 404 page, styled
with the editor's own stylesheet. When the probe fails the column explains what is
missing instead.

**A `vite-plugin-player` serves the Flutter build at `/player/` in development**, the
same place nginx puts it in production, because the two must share an origin for the
message channel to work at all.

---

## M7 / M8 — Import, export, validation UX

**Import covers everything §15 lists** — `course_v2` / `exercise_v2` / `quiz_v2`, a
single `block_v2` file, legacy flat blocks, steps-as-a-map, `lesson.block_ids`, legacy
type names, `evaluation_config`, `next_actions`, and V1 `course` / `lecture`. Ten real
documents from the three repositories are in the corpus and each is asserted to import,
to write no legacy field back, and to be a fixed point.

**V1 import maps one lecture to one lesson holding one block**, so that a V1
`following_action: "lecture"` becomes a cross-block `go_to` that resolves — all nine of
them do, and the test checks it.

**Nothing V1 could not carry is dropped silently.** Nested sub-answers and base64
inline images have no V2 equivalent; the import report names each one, and the editor
shows the notes as a banner.

**Errors block export, warnings never do.** The download button is disabled exactly
when `validation.errors` is non-empty. The validation panel jumps to the ref behind
each issue, and warnings can be dismissed for the session.

---

## M6 — Didactics, as far as the data allows

**The GPF taxonomy is the admin's own export.** `GPF - Matematika.json` — domains →
constructs → subconstructs — is flattened in document order into the dimension list
the vectors index into. That order reproduces the ranges §6.3 states (N 0–16, M 17–21,
G 22–24, S 25–28, A 29–34) exactly, which is the check that the two documents agree;
`skill-config.test.ts` asserts it.

**The count still comes from the data.** Nothing reads 35. A taxonomy with a different
number of subconstructs — another subject — needs no change, and the test proves it by
validating the same course against a 17-dimension slice.

**Where the dimension set comes from, in order:** the course's own skill configuration
from the API, then the platform's canonical list, then the shipped taxonomy. The last
is marked `is_default` and the vector editor says so, because an author editing a
course on a different vector must load that course's own — which they can do by
dropping the admin's export onto the same **Načíst** control that takes a course.

**The subconstruct picker is the front door.** Choosing what a card trains writes
`gpf.domain`, `gpf.construct` and `gpf.subconstruct`, and marks that dimension as a
strong relation with a baseline difficulty — because a classification with no vector
behind it measures nothing (§6.3).

---

## M9 — Two preview modes, three editing modes

**The preview had three states that were one state.** *Jak to vidí žák*, *Vyzkoušet*
and *Celá hodina* all mounted the same `BlockStepEngine` on the same single block,
differing only in the `exportMode` string. So "how the student sees it" was not a
preview at all — reading a card meant clicking through it like a pupil. There are now
two modes, and they are genuinely different things:

- **Náhled** stacks one `StepContentRenderer` per step, with no engine. The check and
  continue buttons live in the engine, not the renderer, so leaving the engine out is
  what makes the view inert: there is no button because none was built. It also
  reuses the app's own renderer, so an app upgrade carries over with nothing to
  re-implement.
- **Vyzkoušet** plays the whole lesson from the selected card, mirroring
  `lesson_detail_page`'s grammar — a growing list, one current block, auto-advance on
  completion — without its auth, Drift and API dependencies. *Celá hodina* is gone
  because this subsumes it: you can now try a lesson end to end, which the old
  lesson view could not do.

**Inert does not mean untouchable.** `IgnorePointer` would have killed click-to-edit
along with the interaction. Instead `PreviewMode` gained `interactive`, and the three
option tap handlers in `step_content_renderer.dart` consult it: a tap either answers
or reports where that answer is authored. Outside preview mode the flag is `true` and
a student's session is byte-identical. The side benefit is that **answer options are
addressable for the first time** — clicking one lands on its row in the answer table.

**The expanded view shows what the student would not see yet.** Every question is
rendered as though answered (`StepAnswerState(isAnswered: true)`, nothing selected),
so per-option feedback and the worked solution are on screen without anyone answering;
branch targets and hints are drawn as preview-only markers. This is plan §5 M5's
"markers for content that exists but is not currently rendered", and it is the single
most useful thing here: a branching card's whole logic is readable at a glance.

**Back lives outside the engine.** `BlockStepEngine._currentStepIndex` only ever
increments or is assigned from `savedProgress`; rewriting its navigation would make
every future app upgrade a merge. So `PreviewLessonPlayer` keeps a history of
`(blockIndex, stepIndex)` and a back re-mounts at a place already visited. Answers
after that point are lost — which is the honest outcome, since the reason to go back
is to give different ones.

**Two bugs the browser found, not review.** `_restoreProgress` returned `null` for
index 0, so going back to the first step silently did nothing. And click-to-edit in
play mode fed the clicked card back in as the lesson's start point, restarting the run
on every click — the preview column now pins the start when the mode is entered.

**The player is told what to call other cards.** It holds one block and cannot look
another up; left alone its branch markers printed a `block_id`, which a teacher must
never be shown (§8). The editor sends a label map and decides per mode whether a label
is a name or an id. A browser test asserts it on the wire, because the frame is a
canvas with nothing to read.

---

## M10 — One card on screen, and a preview that stops remembering the wrong thing

**"It is hard to tell what is going on in a lesson."** The editor column stacked every
card of the lesson, one expanded and the rest collapsed to a summary line. That was an
improvement on rendering all of them open, but it solved the wrong problem: the shape
of a lesson — how many cards, of what kind, in what order, which are broken — was
still buried in the same column as the work, and readable only by scrolling past the
work. The shape now lives in the tree on the left, where it fits on one screen, and
the column holds exactly one card. Selection lives in the tree and nowhere else;
`Card` lost its `selected` state, because two "you are here" markers for one fact is
how a screen stops being scannable.

**Settings are containers' business, so they are one click away.** Course, lesson and
card settings are modals. `Modal.svelte` is a native `<dialog>` with `showModal()`,
which is what gives the focus trap, Escape, `inert` behind and the top layer — the
first dialog in this codebase hand-rolled all four and got three of them wrong, and
`RepairDialog` was converted first precisely because it is the one with browser
coverage.

**But "in a modal" and "expose everything in teacher mode" contradict each other, so
the line is content versus configuration.** What the *student reads* stays in the
column, always visible: the steps, `hint`, `help`, the solution. What describes the
card to the *platform* — duration, practice enrolment, GPF, FSRS, ids — is in the
modal. The consequence is testable and tested: teacher mode has no disclosure anywhere
in the editor column.

**`help` was advanced-only, and the app needs it.** The hint sheet's second rung,
"Nerozumím tomu", shows `step.help ?? block.help`. A teacher could not reach either
field in any mode they would ever use, so the button led nowhere and nothing in the
tool said so. Both moved to teacher mode, which took the teacher's field count from 28
to 30 — and `fields.test.ts`'s bound was 30 exactly, so it moved to 32 in the same
commit rather than failing a suite that has nothing to do with it.

**Nothing looked editable.** `FocusField` drew `border: 1px solid transparent;
background: none` until hover, which is the honest cause of "I can't tell what is a
field and what is a caption". A field at rest now carries a faint tint and a writing
line; empty adds a dashed line and italics; invalid keeps its red bar and wins. The
colours are tokens rather than literals, which is what lets the answer table invert
them — its hovered row paints the same 6 % tint, so the fields inside flip to the
surface colour and pop out of the row instead of dissolving into it. Empty is
deliberately *not* alarming: most optional fields are empty most of the time, and a
screen where every unfilled hint glows amber teaches authors to ignore the colour that
means "this is wrong".

**`FieldGroup` passed the hint as the placeholder**, so the sentence explaining what a
field does to the student vanished the moment anyone used the field — and where a spec
had no hint, the empty string fell through to the label and printed it twice.

**A chip meant nothing because everything was a chip.** Twelve of the thirty-eight
call sites are `quiet` now. A filled chip claims something: this is the card's type,
this is shared, this is broken. A number reported back to you is quiet.

**Twelve components each wrote out `.ghost`**, in three sizes that did not agree, and
the one button that gets a course out of the tool looked like a hover-only icon.
`Button.svelte` is the hierarchy. Dashed borders went with it: dashed is the drop-zone
idiom, and a button that adds a card is not a hole waiting to be filled.

### Náhled gets its buttons back

**The overturned argument, named.** M5 and M9 above say: *"leaving the engine out is
what makes the view inert: there is no button because none was built."* That is a
consequence mistaken for a cause. Inertness comes from where the callbacks go. The
engine is still not mounted, so `_currentStepIndex`, `_stepAnswers`, `onStepProgress`
and `onBlockCompleted` are not in the tree — `stepChanged` and `completed` are
impossible in Náhled *by construction*, and every tap terminates in `clicked`. The
browser test that asserts it still passes, and now passes for a stated reason.

**What it cost to be wrong about it.** A preview of a card that omits the card's own
controls is not a preview of the card: the author could not see whether the question
mark appears at all, how much vertical room the action row takes, or what a quiz card
looks like with the thumbs stripped out.

**Extraction, not a second drawing**, and it is verified rather than asserted:
`flutter analyze` is clean, `test/widgets/` still passes (it pumps a real engine and
asserts on the button labels, so it fails if the move changed what a student sees),
`test/preview/expanded_block_buttons_test.dart` covers the new row, and the browser
suite's "the expanded view is inert" now runs against a player build that *has* the
buttons. `widgets/block_action_buttons.dart` now holds
`BlockActionButton`, `BlockActionBar` and `BlockMainButton`, used by the engine and by
Náhled. The engine keeps the *decision* — which label, enabled, complete, the
`switch (_state)` — and the new file keeps the *drawing*. A hand-drawn copy in the
preview would drift from the app's, which is the same argument that put
`StepContentRenderer` into Náhled to begin with. Two near-duplicates were left alone
deliberately: `lesson_detail/action_button.dart` is a different 48 px button, and
`lesson_detail/action_button_row.dart` is the lesson's row, not the block's.

**The row is drawn completed.** Náhled already renders every question as though
answered, with its feedback and solution showing. The engine's own name for a step in
that state is a *history* step, and `_buildHistoryBottomRow` is the row it pairs with
one — action bar plus green check. A greyed "Zkontrolovat" underneath the answer's own
feedback would make the card contradict itself.

**The question mark is the hint's first front door.** Gated per step on
`step.hint ?? block.hint` / `step.help ?? block.help` rather than the engine's
block-level `hasHint`, because every step is on screen at once here. It reports
`{blockId, stepId?, field}` — and a *block*-level hint is sent without a `stepId`,
because the editor reads a ref carrying one as addressing the step and would write the
card's hint onto a step that never had one. The truncated one-line markers survive,
untruncated and tappable: the button goes and edits the text, so the marker is what
shows it.

### The preview stopped inheriting the played run

**The rule: nothing the player reports from a played run may decide what the expanded
view shows.** `#lastStepId` had exactly one writer — the `stepChanged` case, which only
*Vyzkoušet* emits — and exactly one reader, `showBlock`, which only *Náhled* calls. A
one-way channel from one mode into the other, with no handler on the editor side to
justify it. `showLesson` cleared the step *graph* and not this, so after a run the
expanded view restored to the step the run ended on; step ids are unique per block, not
per course, so a run that finished on the third step of card seven sent the expanded
view to the third step of whatever card was open. `bridge.reset()` would have cleared
it and is called from nowhere. The restore point is now owned by `showBlock`, cleared
by `showLesson`, and a requested step id that is not in the card on screen is ignored.

**A second bug wearing the same coat.** `setBlock` carried `stepId: undefined` on every
debounced content update, and the player assigns the outline from that field
unconditionally — so the outline died 250 ms after the author stopped typing. It came
back only because the highlight effect fired on every keystroke: its comment said it
depended on the reveal counter and not the selection, and its body read
`store.selection`, which Svelte tracks, and which `apply` reassigns to a fresh ref on
every `setField`. The editor now sends its selection with every `setBlock`, so the
outline and the restore point are one value; `highlight` went back to being what it was
for, the undebounced response to a jump.

**A queued card could be dropped by a button press.** `#post` parked *any* message in
`#pending` when the player was not ready, so a `highlight` or `back` issued during boot
overwrote the `setBlock` behind it and the player came up empty. Only content waits
now; navigation that precedes the run it would navigate means nothing.

**`CodeMirror` reported its own writes back as edits.** A programmatic dispatch raises
`docChanged` exactly like typing, so every externally-set value came straight back
through `onchange`. On import that was one spurious `setField` per visible step: undo
entries for changes nobody made, and a selection dragged to a ref with no `lessonId` —
which is what made the new tree open on the wrong lesson and is how it was found.

**Two latent bugs the restructure forced into the open.** A card in no lesson was
unselectable: the click registered and the "always keep a card open" effect threw the
selection straight back, and `CardEditor` required a binding it could not have.
`PreviewLessonPlayer` indexes its history by block *position*, so deleting cards during
a run threw a `RangeError` inside `build`, outside the message handler's try/catch — a
red error widget rather than the placeholder a broken draft is promised. The indices
are clamped; keying `_Visit` by `blockId` is the real fix and is still open.

## M9 — Three cumulative modes, and one table that decides them

**Učitel ⊂ Metodik ⊂ Pokročilý.** Cumulative, so nobody is stranded: a metodik can
still fix a typo, and the advanced author sees everything. The split follows one
question — what does the student experience because of this field? Direct, visible
consequences are the teacher's; what shapes how the platform *measures* the student is
the metodik's; the rest is the advanced author's.

**`src/lib/ui/fields.ts` is the only opinion about it.** Every editor renders from
that table rather than keeping a second view of who sees what — which is how the old
`CourseSettings` came to hide `emoji` behind author mode while nothing else did.

**`fields.test.ts` makes "Pokročilý exposes everything else" a property, not a
promise.** It walks every key in `KEY_ORDER` and fails unless each has a mode or a
written reason for having none. It caught three stub reasons and a field declared both
editable and not on its first run. Roughly forty fields had **no UI at all** —
`fsrs`, `adaptation`, `prerequisites`, `competencies`, `gpf.grade`/`level`, block
provenance, media positions — so the topbar's promise of "vektorů, FSRS a předpokladů"
was false. `FieldGroup` renders them generically; that is how forty fields arrive
without forty hand-written rows.

**Lesson name and description were unreachable.** `addLesson` hard-coded
"Nová lekce" and no component could change it. They are teacher-level fields now.

**The clutter was structural, not decorative.** Every card of the lesson rendered
every step with every settings row open. Only the selected card expands now; the rest
are one summary line. A card is always selected, or the editor would open on a list of
closed rows with nothing to type into.

**Many topics, one classification.** `relation_vector` has always been multi-valued —
the spec expects "one or two `2`s and perhaps a couple of `1`s" — but the picker was a
single `<select>` with three real bugs: picking a second topic rewrote
`gpf.subconstruct` and left the first topic's `2` behind, so the name and the vector
disagreed; "— nevybráno —" could not clear anything; and one pick wrote five undo
entries. `TopicPicker` shows a row per topic, and `setTopics` is one command that
rewrites the classification from the resulting set every time.

**Every live relation gets a difficulty.** `EloEngine.updateTask` skips any dimension
whose `elo_vector` entry is null or ≤ 0, so a relation written without one is a card
that claims to measure something and then measures nothing. `VectorEditor.setRelation`
wrote exactly that; it now routes through `setTopics`, which guarantees the pair.

**Two crashes fixed on the way.** A step's deriveds run once more after its card is
deleted, throwing on a torn-down prop. And the sidebar's keyed `{#each}` threw on two
lessons sharing an id — the exact document the validator exists to complain about, so
the tool broke on the error it was meant to report.

**Recorded, not surfaced: `relation_vector: 1` does nothing at runtime.**
`elo_engine.dart:122` is `if (relationVector[k] <= 1) continue;`, so a weak relation is
skipped entirely — the authoring spec's "updates with reduced weight" is intent, not
implementation. The editor keeps offering "okrajově" and says nothing, by decision;
this note is the record. Worth reconciling in the app or in the spec.

---

## Still open

Blockers and questions, in the order they will bite:

1. **RVP → GPF mapping table (M6)** — the GPF taxonomy is now wired (below), but the
   mapping from a *RVP outcome* to competencies and a starting vector is a different
   table, and the plan says to ask rather than invent it. Where does it come from, and
   who maintains it? Until then the didactic front door is the subconstruct picker.
2. **Publish (M7)** — `POST /api/courses/upload` is implemented in `api/client.ts`
   against the shape the Laravel controller accepts (whole document as the body;
   version must be strictly higher than the stored one). It is **not wired to a
   button** yet, because the auth question below is unanswered.
3. **Auth and roles** — the client assumes a same-origin `/api` proxy carrying the
   session cookie, the pattern the admin uses. Confirm, and say whether teacher/author
   mode is role-driven from the API or a local setting (§9.5). It is currently a local
   toggle.
5. **Id reuse beyond a session** — the editor now refuses to re-mint an id it has
   handed out, but only while the document is open. Reopening a course and deleting
   the last step of a block can still produce a fresh `s1` that a student's old answer
   is keyed to. Solving it properly needs somewhere to record the high-water mark;
   nothing in `CourseV2` currently holds one.
6. **`W_DUPLICATE_OPTION_ID`** — a check §14 does not list, added as a warning rather
   than an error to avoid inventing a blocking rule. Confirm which it should be.
7. **`relation_vector: 1` is inert in the app** while the authoring spec defines it as
   a reduced-weight update (`elo_engine.dart:122`). Either the engine should honour it
   or the spec should drop it; until then the editor offers it without comment.
8. **The app's lesson card always derives XP.** `_calculateBlockMaxXp` in
   `course_model.dart` ignores an authored `blocks[].xp` when computing the lesson's
   advertised reward, while §10 says the authored value is the reward. The editor
   follows the spec and shows the derived figure with an asterisk. Worth reconciling —
   right now a course can promise one number and award another.
9. **A run's result is computed and thrown away.** `bridge.reset()`, `onstepChanged`
   and `oncompleted` are wired to nothing, so the XP, score and mark that *Vyzkoušet*
   produces never reach the author. They are the obvious thing to show after a run.
10. **`PreviewMode.sideEffectsSuppressed` guards nothing.** It is referenced nowhere
   in `lib/`; safety currently rests entirely on `PreviewPage` handing the engine inert
   callbacks. It stays as the documented pattern for a write that does not exist yet,
   which is a bet that the next author reads the README.
11. **`PreviewLessonPlayer` keys its history by block index**, not `blockId`. The
   indices are clamped so a shrinking lesson cannot crash the frame, but a run whose
   cards were reordered mid-way still retraces to the wrong ones.
