# Decisions taken

Per plan §5, each milestone ends with a short written record of what was decided and
why. Read this with `docs/spec/PLAN.md` and `docs/spec/COURSE-AUTHORING-SPEC.md`.

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

**The card-wide ladder then moved into card settings.** `block.hint` and `block.help`
are only the fallback the app uses when a step has none of its own, and as a section
under the last step they read as one more step. They are still teacher-mode fields,
now in the first section of `CardSettings`. The preview's "?" and validation jumps
that name them open that dialog. The steps' own ladders stay in the column.

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

## Feedback round 1 — persistence, and the fields a teacher actually types into

**Autosave writes to localStorage, and every way it can fail says so instead of
staying quiet.** `DraftSession` (`src/lib/state/draft-session.svelte.ts`) debounces
400 ms behind a single `$effect` in `+page.svelte` that tracks `store.doc`,
`store.selection` and `store.mode`; `beforeunload` forces a synchronous `flush()` and
only then decides whether to warn, so the guard is never a stale guess about whether
the last edit made it out. The envelope (`src/lib/state/draft.ts`) is a zod schema
around `courseSchema`, and `readDraft` is commented on purpose: *"Recovery checks
shape, not publish validation: unfinished cards must survive."* A card mid-sentence —
missing feedback, an empty option — is exactly the state a reload must not discard,
so recovery only has to parse, never to pass `validate()`. Three failure modes are
refusals rather than silent overwrites, matching `e2e/recovery.spec.ts`: a draft that
fails `draftSchema.parse` (corrupt JSON, a future format) flips `status` to
`'blocked'` and leaves the stored value untouched until the author explicitly calls
`replace()`, which archives the old text under a timestamped backup key before
writing over it; a second tab is detected through the `storage` event and also lands
on `'blocked'`, pausing writes rather than letting two tabs race the same key; and a
`setItem` throw (quota, private mode) sets `status = 'error'` and shows "Koncept se
nepodařilo uložit" in the topbar instead of failing inside a `catch` nobody sees.
"Pause and tell the author" beats "overwrite and hope" for the same reason the corrupt
case does: a stopgap that occasionally destroys the thing it was built to protect is
worse than one that sometimes asks for help.

**FocusField stopped being a placeholder that swaps into an input.** The reported bug
— a click landing slightly off-target leaves `document.activeElement` on `<body>` and
loses every keystroke typed afterward — was inherent to the old design: the resting
state was a `<button>` that had to be clicked exactly, then unmounted in favour of a
real `<input>`. `FocusField` is now an always-mounted native `input`/`textarea` whose
full rectangle is the editable surface; there is no swap for a click to miss. It
commits `onchange` on every `oninput`, which is what makes the draft above capture an
edit that never reached blur — but committing per keystroke would also mean one undo
entry per character. `DocStore.beginEdit()` and `endEdit()` exist to absorb that:
`begin()` opens a session on focus, `apply()` folds every commit into the same
`UndoEntry` while the session is open by rewriting its `after` in place instead of
pushing a new entry, and `endEdit()` drops the entry entirely if the document nets out
unchanged — Escape reverts `draft` to `baseline` and closes the session, so a typed
line abandoned with Escape leaves no undo trace at all. The undo model had to change
because the input model did: grouping keystrokes is the price of fixing the fragility.

**Answer-table columns are shared tracks plus a container query, not fixed pixels.**
The old grid was `minmax(140px, 1.4fr) 80px auto minmax(160px, 1.6fr) auto auto` on
both `.head` and `.row` independently, so a long "Co se žák dozví" value could push
its own row's `auto` feedback track wide while the header and the other row kept
their own separately-computed width — which is what let `.cell.feedback` settle at
~60px for the whole column. `AnswerTable.svelte` now derives one `tracks` string from
the card's actual columns (marks, branching, advanced score) and applies it to every
`.head`/`.row` through a single `--answer-tracks` custom property, so there is exactly
one layout computation to get right instead of one per row. The container query
(`container: answers / inline-size`, `@container answers (max-width: 760px)`) is the
other half: below 760px of *available* width — which the feedback report already hit
at normal browser width once both sidebars and a wide preview were open — the grid
collapses to one column per row and each `.cell::before` prints its own label
("Odpověď", "Co se žák dozví", "Kam dál", "Známka"), so a narrow card stacks with
labels instead of squeezing six tracks into less space than they need.

**Course settings wrap instead of overflowing.** `CourseSettings.svelte`'s `.grid`
moved from a hard `repeat(2, minmax(0, 1fr))` to `repeat(auto-fit, minmax(min(100%,
20rem), 1fr))` inside its own `container: course-settings / inline-size`, and `.row`
drops to a single column under its own `@container … (max-width: 560px)` — which is
what stops "Zamčeno" from being clipped at 1316px, since the modal's *content* width
at that viewport was already below two 20rem columns. `Segmented` gained a `wrap`
prop for exactly the "Typ kurzu" and "Stav" rows, because a status list with five
options has nowhere to go but a second line on a narrow modal; the toolbar's mode
switch in `Topbar.svelte` does not pass `wrap`, so a compact control that must stay a
single row keeps its old non-wrapping layout. `FieldGroup`'s label column also gave
up its 160px fixed width for the same `auto-fit` treatment, and the hint text — which
used to truncate to one line with the full sentence hiding in `title` — now wraps,
because a hint nobody can read without hovering was not actually communicating.

**The XP counter explains itself.** `derivedBlockXp` in `src/lib/domain/derive.ts`
sums 8 XP per question step and 1 per content step. `addBlock` (`commands.ts`) always
seeds a new card with exactly one step, so a freshly added question card is a single
8-XP question step — which, added to the course's existing 1-XP display card, is
exactly the tester's "jumped from 1 XP to 9 XP before any content was written". That
arithmetic is unchanged; what changed is that it no longer looks accidental. The chip
now reads "8 XP · automaticky" or "5 XP · vlastní hodnota" instead of a bare number
with a trailing `*`, and next to it a note spells out the rule — "8 XP za každý krok
s otázkou, 1 XP za obsahový krok" — and says explicitly that it "platí hned, i když je
karta ještě rozepsaná", because the counter is correct for an unfinished card too and
a teacher watching it jump needs to know that before concluding something is broken.

**"Odebrat" became "Odebrat z lekce", and the orphan bucket got a way back.** The
feedback literally asked for a confirmation dialog before unlinking. What got built
instead is an undo notice after the fact: `removeFromLesson` in `CardEditor.svelte`
unbinds immediately and calls `showNotice()`, which pins the new `UndoEntry` and
shows a message naming exactly what happened — "Karta je nyní v části Karty mimo
lekci" or, when the card is still bound elsewhere, "Karta zůstává v lekcích (N): …" —
with a "Vrátit zpět" button. `activeNotice` is guarded against staleness: it only
renders while `store.undoStack.at(-1)` is still the entry it captured, so a notice
from one unbind can never undo a content edit made afterward
(`e2e/card-actions.spec.ts`'s "an undo notice cannot undo a later content edit"
pins exactly this). Two more pieces close the gap the feedback actually described:
a separate "Smazat kartu…" button now always opens `RepairDialog` — real deletion,
with its existing repair-and-confirm flow, whether the card is bound or already an
orphan — and a "Zařadit do lekce…" picker lets an orphaned card be reattached to any
lesson that doesn't already hold it (through the now-idempotent `bindBlock`, which
returns the document unchanged, same object identity, if the binding already exists)
without going through Undo at all. The argument for undo-after over confirm-before is
that unbinding is not destructive — the block, its steps and every incoming reference
survive untouched, only one lesson's binding changes — and a confirmation dialog on a
reversible action mostly trains authors to click through it. This is a deliberate
divergence from the literal ask, recorded as one.

**"živý náhled" is now just "Náhled" — and the behaviour was fixed, not just the
label.** Because `FocusField` commits on every keystroke instead of on blur, the
preview genuinely updates while typing now, which it did not before. The word "živý"
was dropped anyway: `bridge.ts` still debounces `setBlock` by 250 ms and re-sends the
whole step on a document change rather than tracking a caret or diffing the edit, so
calling it "live" would still overclaim a little even though it is no longer wrong.
The footer hint was changed to match — "Náhled se aktualizuje během psaní" — which is
now an accurate description rather than an aspiration.

Verification leans on properties rather than a test count. `e2e/recovery.spec.ts`
pins that an unblurred, invalid field survives a reload; that typing groups into one
undo entry and Escape leaves no trace; that a `setItem` throw both shows an error
status and still blocks unload; that a corrupt stored draft is never touched without
an explicit, backed-up replacement; and that a second tab pauses writes rather than
racing them. `e2e/card-actions.spec.ts` pins that unbinding touches only the one
binding and leaves every other lesson and reference intact, that the picker can only
bind to a lesson that doesn't already hold the card, that a stale undo notice cannot
swallow a later edit, and that the XP chip's arithmetic and wording stay in sync
across derived and authored values.
`e2e/feedback-layout.spec.ts` measures actual `gridTemplateColumns` and
`scrollWidth`/`clientWidth` at the viewport width from the report (1316px) and at
narrower ones, rather than asserting on a screenshot. And
`src/lib/domain/__tests__/card-actions.test.ts` holds the same `bindBlock` idempotence
and object-identity properties at the domain level, with no component runtime needed
to check them.

**The suite that proves all of the above had to be made deterministic first.** Run at
Playwright's default worker count, the e2e suite failed one or two tests per run and a
*different* one each time — `preview.spec.ts` timing out on a navigation, then
`card-actions.spec.ts` timing out on the first card appearing. Every spec passed in
isolation, and two consecutive full runs at `workers: 4` passed clean in the same
wall-clock time as the flaky ones, so the cause was the machine, not the code: each
page in this suite boots the Flutter/CanvasKit player, which makes a worker far more
expensive than a normal DOM test and lets half the cores' worth of them starve each
other. The cap is in `playwright.config.ts` with that reasoning written down, because
the next person to see a green suite on a smaller box will otherwise remove it.

**`data-hydrated` now means what its comment always claimed.** It was assigned at the
*top* of `onMount`, above the draft restore and the seed it says have finished. As
written this was not actually reachable — the whole function is straight-line
synchronous, so no test could observe the flag mid-flight — but a signal whose contract
is a comment rather than a fact is one refactor away from lying, and the comment was
the reason to trust it. It is set last now, after the seed and after the listeners are
attached. The four specs that were still waiting on DOM proxies (`section` count, the
starter card becoming visible) wait on the flag instead: counting sections is a weaker
guarantee, because SSR can satisfy it before any handler is wired.

**One real race turned up while chasing a flake that was not one.** `loadConfig()` in
`+page.svelte` is fired without `await` from both the initial seed and the import path,
so two requests to `/api` can be in flight at once — and it read `store.doc.course_id`
before the await but assigned the answer unconditionally after it. A slow response for
the pre-import course could therefore land last and leave the imported course being
measured against another course's dimensions. It now captures the id it asked about and
drops an answer the document has already moved past.

---

## Feedback round 2 — the preview's images, and never showing a teacher an id

**The reported bug was real; its reported shape was not.** "Images render in Náhled
but not in Vyzkoušet" turned out to be "images never render in the *player*, in either
mode". What the tester was seeing in "Náhled" was the editor column's own `<img>`,
which loads the authored URL directly and works; the Flutter player put every image
through `resolveImageUrl`, i.e. the Laravel proxy at `/api/proxy/image`, which was
answering 502 for the host in question. Both preview modes were equally broken, and every image
in the student's app with them. Four scripted reproductions of the literal report all
*passed* before the real cause showed up in a network trace — worth remembering the
next time a report names two states and one of them is the developer's own preview.

**Images are loaded direct-first, with the proxy as the fallback.** The proxy exists
to dodge CORS in CanvasKit, which is a real problem for the hosts that block
cross-origin reads — but most public image hosts send `access-control-allow-origin: *`,
so routing every image through one service made that service a single point of failure
for content it was not needed for.

The proxy is not uniformly broken, and the first version of this note said it was.
Measured directly: it returns a correct PNG for `placehold.co`, and **502** for
`picsum.photos` and `upload.wikimedia.org` — hosts that redirect, or that refuse the
API server's own requests. That is worse than a clean outage, because it works often
enough to look fine and then fails on exactly the kind of URL a teacher reaches for. `NetworkImageWithFallback` tries the authored URL,
and only an `errorBuilder` promotes the request to the proxied one. On native there is
no CORS and no second attempt. `isSvg` moved to the raw URL in the same change: the
proxied URL is `…/proxy/image?url=<encoded>`, which never ends in `.svg`, so every
proxied SVG had been mis-dispatched to the raster branch.

**Click-to-edit claims the whole card, and still loses to its own leaves.**
`PreviewTarget` shrink-wraps its child, so the hit target for a short line was the
glyphs. `_StepCard` now wraps its whole body in a second target with
`HitTestBehavior.opaque` and `outline: false`. Nesting is safe rather than lucky: a
descendant's arena entry is added before its ancestor's and `sweep` defaults to
`members.first`, so a leaf always wins a tap it was actually given — the outer target
only picks up the padding nobody else claimed.

**A destructive type switch asks, but only when there is something to lose.**
`setQuestionType` discards options, feedback and branching, and did so silently.
The confirmation is computed from what the *target type* would actually drop given the
question in hand, counting only authored content — a two-option scaffold with no text
is the type's own bookkeeping, and nagging about it would teach the author to click
through the dialog that matters.

**The media preview is debounced in the component, not in the field.** `FocusField`
writes on every keystroke on purpose (§ recovery, round 1), so the fix could not live
there: the `<img>`/`<video>`/`<audio>` `src` follows the value after a pause or
immediately on blur, and an external change — undo, import, a different step — is
distinguished from a typed echo by a stamp, so navigation never lags behind by half a
second.

**An empty media URL is an error, not a warning.** §14's media rule is already read
expansively here (HTTPS is checked on image and audio, not only video), and a step with
no address at all is a more basic failure of "media must be playable" than the two
cases already blocking export. It is the same failure as `E_DISPLAY_NO_TEXT`: the
student gets a card with nothing on it. This does mean a freshly added Video step is
invalid before its address is typed, which is intended and why the messages are written
as guidance ("zatím nemá žádnou adresu") rather than accusation.

**Ids are resolved to what the teacher sees, except where the id is the subject.**
`naming.ts` is the one place that answers "what is this thing called": a lesson by its
name, a card by `blockPreview` (so an authored title, then its first line, then its
position — one rule, already shared by the tree, the heading and the branch labels), a
step by its 1-based position, an option by its text. Validation messages and the
validation panel's breadcrumb both go through it. The exceptions are deliberate: a
duplicate-id message is *about* the id, and a dangling `go_to`/binding/prerequisite
target has nothing to resolve to — those print the id and name the thing that points
at it.

**A card gets an optional `name`, and nothing is written for one that has none.**
No block in the corpus and neither spec's block table carries a title field.
`learning.objective` was the near-candidate and was rejected: the app renders it as the
card's heading to students, so borrowing it would push an author's sidebar shorthand
onto the student's screen. `name` matches what the format already calls this at course
and lesson level. An untitled card falls back to its text and then to "Karta 3" by
position — computed for display only, because writing a default title into every card
would export it and go stale on the first reorder.

**"Uloženo v tomto prohlížeči" was reading as "saved".** The draft is in
`localStorage` and nowhere else, so the top bar now also says whether the work on
screen has ever left the browser, and the state is derived by comparing the serialised
document with the last downloaded text — type a sentence and undo it and the file on
disk is current again.

---

## Feedback round 2, second pass — what a scripted teacher found afterwards

Two simulated authors then drove the editor end to end: one building a lesson from
scratch, one importing a colleague's course and revising it. Three of their findings
were real and are fixed here; two were not, and the difference is worth recording.

**Repairing a binding could bind one card into a lesson twice.** Deleting a card and
redirecting its lesson binding to a card the lesson *already* held rewrote the id in
place, leaving two bindings for one card: the tree showed it twice and a student walked
it twice. Nothing downstream caught it, because §14's uniqueness check reads `blocks[]`
and the duplicates were in `lessons[].blocks` — the course exported clean. A redirect
onto a card already in the lesson is a *removal*, not a rename, and `applyRepairs` now
treats it as one.

**The delete dialog was the last place still speaking in ids** — „Smazat kartu
‚L1_B2_casti‘“, „Lekce ‚L1_INTRO‘“, „Odpověď ‚c‘ v kroku ‚s2‘“, and a redirect
menu listing raw block ids — and it was doing it while asking for the one irreversible
decision in the editor. It goes through `naming.ts` like everything else now, and shows
ids only in the mode allowed to see them.

**A card's name ate the author's own characters, and then the whole card.** `#` and `>`
were stripped wherever they appeared, so a card opening "Cena je > 2 Kč" was called
"Cena je 2 Kč" — not a truncation of what the author wrote but a different claim. They
are Markdown only at the start of a line, and are stripped only there now. The same
function also flattened every line into the name, so a card whose text was a paragraph
followed by a table was called "Části zlomku | Pozice | Název | Co říká | |---…". It
takes the first non-empty line, which is what its own doc comment always claimed.

**Counted nouns were not Czech.** The chips printed „1 chyb“ and the tree „1 kroků“.
Czech takes three forms after a number — 1, 2–4, and 0 or 5+ — and `ui/plural.ts` is
now the one place that knows them, shared by the chips, the tree, the lesson settings
and the question-type dialog.

**The `draft` chip was promising something nothing performs.** It told the author
"Blok, který není publikovaný, se žákovi v kurzu přeskočí". `block.status` is carried
through the format, but `block_model.dart` never parses it and the API does not filter
on it, so no such skip happens anywhere. The chip now says what is true — the card is
not marked finished — and leaves the consequence to whoever starts honouring the field.
Listed below as something to reconcile rather than a behaviour to build.

**Two reported findings were not defects, and checking beat believing.** "There is no
way to set a card title" was a false negative: the control is the editable heading above
the card, and the tester looked only in the settings dialog. "Duplicating a lesson
shares its cards rather than copying them" and "a no-op import/export reorders keys" are
both deliberate, recorded decisions (§5 shared blocks; canonical key order, M1 above) —
values round-trip deep-equal, which the tester confirmed. Two of five reports from the
first simulated author, and two of six from the second, did not survive verification;
a report that names a symptom is a place to start looking, not a fact.

---

## Round 3 — when a problem is worth saying out loud

The icon pass (Libertas, Sep 20–24) moved validation messages from lists at the bottom
of a card, step or answer to the field each one is about. That was the right direction
and it exposed the real problem: the editor said everything the moment it became true.
A new card is, by definition, full of errors — no text, no correct answer — and
painting those red while the teacher is still typing tells them nothing they do not
know. The decision was to change *when* an issue shows, and to leave `validate()`,
its severities and invariant 5 exactly where they were.

**Each code has a timing** (`ui/issue-visibility.ts`). *Immediate* for a contradiction
the author just caused — a YouTube link in the video field, a branch to a deleted step,
a duplicate id. *On leave* for unfinished content: silent until the author has blurred
that field or moved to another card, at which point it is plainly something skipped.
*Review* for advice: never inline while writing. A unit test reads the codes out of
`validate.ts`, so a new check cannot ship without someone deciding which it is, and no
error may be review-only.

**Leaving is tracked in the store, not in components.** The `selection` setter marks
the previous card as touched when the selected `blockId` changes — selection also moves
on every edit, so "changed ref" would have meant "touched on the first keystroke" —
and `FocusField` marks its own ref on blur. `issuesAt()` and the sidebar counts read
the filtered `shown`; the validation panel and the export review read `validation`,
which is always everything. An empty text step now carries the card-level
`E_DISPLAY_NO_TEXT`, because that is where it is fixed.

**Export is where everything is said.** „Stáhnout“ is never disabled. A clean course
downloads; otherwise it opens a review grouped by card (`domain/issue-groups.ts`), each
row with „Přejít“. With errors the dialog has no download in it, and `download()`
refuses on its own as a backstop; with warnings only it offers „Stáhnout i tak“.
Having seen the review sets `reviewing`, after which every issue shows inline and the
top-bar count turns red — before that it is a grey "N k dokončení". This dialog is
where per-row AI repair will attach.

**An imported or restored course is not "untouched".** Its problems were not made in
this session, so the on-leave rule would hide all of them. Rather than mark everything
touched and turn the screen red, one banner says "V kurzu je ještě N věcí k dokončení ·
Zobrazit", which opens the review.

Also fixed from the icon pass: a global `transition: all` was animating
`grid-template-columns` and misaligning the answer table; `$inspect` left in
`FocusField`; the XP explanation commented out (it is the XP chip's tooltip now);
lost accessible names on the validation chip, answer toggle and delete buttons; a
second status-label list that disagreed with the settings field.

---

## Round 4 — things that looked finished and were not

The owner's review found three problems that were half-specified rather than broken,
and each hid real defects underneath. They are one class: **something the teacher
sees that nothing behind it supports** — a warning they cannot clear, a fold the
code forgets, a preview that re-lays itself out when focused. The fixes are aimed at
the class, and each has a test that fails on the old code.

### Card status is gone; publishing is the course's business

**Every new card was born with a warning.** `addBlock` wrote `status: "draft"`, the
card header showed a warning chip for anything not `published`, and the only way to
change the status was a select in Pokročilý whose hint ("a draft card is skipped for
the student") was false: neither `block_model.dart` nor the API reads `block.status`
(`docs/spec/COURSE-EDITOR-SPEC.md` §3.5). The status is no longer written, shown or
offered; a value in an imported file survives the round trip (`NOT_EDITABLE` says
why). *Rejected:* making the app honour it — that is an upstream change this repo
cannot ship, and a per-card publish switch is exactly the thing the owner asked to
replace with course-level versions.

**"Bez délky" was the same bug.** A card with no `duration` showed a warning chip and
put a dot on the settings button. The app then estimates ~4 min a card
(`course_model.dart`), just as XP is derived from the steps when not set, so the chip
now says "délka odhadem", quietly. The one case that misleads a student — only some
cards of a lesson have a length — is still `W_PARTIAL_DURATION`, in the review.
`W_EMPTY_LESSON` joins `W_ORPHAN_BLOCK`: the app lists an empty lesson and advertises
it at five minutes. The editor's arithmetic still mirrors the app's (an empty lesson
*is* "5 min" to a student), which is why the fix is a warning and not a different sum.

**Prevention:** `issue-visibility.test.ts` builds every card type with every step type
and asserts nothing is shown before the card is left. No chip may compute its own
warning; warnings come from `validate()`, with a timing.

### A folded step stays folded, and focus opens it

`collapsed` was `$state` inside `StepEditor`. `svelte-dnd-action` swaps the dragged
item for a placeholder with another id (`id:dnd-shadow-placeholder-0000`), so the
keyed `{#each}` destroyed the folded instance and mounted a fresh, open one: an
expanded-height hole while carrying, an open step after the drop. It also leaked
between cards, because step ids repeat per card and the column reuses its
components.

- Folding lives in `StepView` (`state/step-view.svelte.ts`), keyed `blockId/stepKey`,
  and one pure rule decides open or folded (`ui/step-expansion.ts`, truth-table
  tested): dragging folds everything; otherwise a step is open unless folded; a
  folded step opens while the selection is in it; folding it *while* focused holds
  until the selection is set again.
- "Focused" is the selection. Working in a step's body selects it (it did not
  before — only typing moved the selection), and a preview click, a validation jump
  or the export review's "Přejít" already did, so all of them now open a folded step
  instead of scrolling to a header whose field was not rendered.
- Steps move by a grip handle. The press folds every step *before* the library
  measures the list, and scrolls the column by however far the handle moved, so the
  step is picked up from under the pointer. *Rejected:* folding on the first
  `consider` — by then `preventShrinking` has fixed the zone's height and the clone
  has been sized to the old placeholder. *Rejected:* keeping the whole row as the
  handle — a press on a chevron and 3 px of movement started a drag.
- A reveal is consumed once (`StepView.revealHandled`), so a remount mid-drag no
  longer scrolls the page back to the selected step.
- A folded row shows `stepSummary()` — plain text, a picture's description or file
  name — never `https://upload.wiki…`. The card's derived name is its first sentence
  when its first line is a whole paragraph.

A drag dropped where it started is not an edit: the reorder commands return the same
document, so no undo entry and no dirty flag. Keys that repeat in a broken document
(`E_DUPLICATE_STEP_ID`, `W_DUPLICATE_OPTION_ID`) go through `uniqueKeys()` instead of
crashing the keyed `{#each}`.

### Náhled is read, Vyzkoušet is taken — and the preview never re-lays itself out

Fork commit `9789fd5`, pinned by `PLAYER_REF`.

**Focus reflowed the card.** The outline widened the step's border from 1 to 2 px,
and a `Container` adds its border to its padding, so the focused step was laid out
2 px narrower and its text wrapped at a different word. It is a `foregroundDecoration`
now, painted over the card. **Hover did the same everywhere:** every `PreviewTarget`
carried a permanent transparent 1.5 px border for its hover outline, so all wrapped
text in the preview was 3 px narrower than in the app. The hover is gone (it was the
old click-to-focus affordance); the pointer cursor is the only sign of a target.
`test/preview/preview_fidelity_test.dart` asserts, per paragraph, the same size and
the same line breaks with and without focus, and with and without a target around the
app's own renderer. It fails on the previous player.

**Vyzkoušet is the pupil's app.** `PreviewTarget` is inert when `interactive` is true,
so a click on text or a picture does nothing, as for a pupil; nothing marks a focused
step. The question mark is wired as `lesson_detail_page` wires it and opens the app's
own hint sheet (`preview_hint.dart`) — it was never passed to the engine, which is why
"help did not work". *Rejected:* keeping click-to-edit in Vyzkoušet — it competes with
following the run, and the owner chose "like a student".

**The editor follows the run.** `stepChanged` used to be sent only for moves within a
card. The engine now has an optional `onStepShown`, fired after the frame from the
single setter every write to `_currentStepIndex` goes through, and the lesson player
turns it into `stepChanged {blockId, stepId}` on every move — mount, next card,
branch, back, restart. *Rejected:* a report at each transition in the player — the
bug was exactly a transition nobody remembered. The editor selects the reported step
with `store.follow()`, which does not count the card left behind as touched (playing
is not finishing), and the step opens and scrolls into view.

**The run's inputs are pinned, the selection is its output.** Following the run moves
the selection, so the lesson and start card are fixed when Vyzkoušet is entered. That
also fixes a branch into a card shared by another lesson switching the lesson (and
restarting the run), and "Od začátku", which re-pinned the start to the card the run
had reached and so restarted twice.

**M10's rule, refined rather than dropped.** "Nothing the player reports from a played
run may decide what the expanded view shows" was about hidden state in the bridge.
It still holds: Náhled shows the editor's selection and nothing else. What changed is
that the run now *moves* the selection, openly, so after a run Náhled outlines the
step the run reached. Relatedly, Náhled outlined step 1 of any card when nothing was
focused — the restore point doubled as the outline; in Náhled the outline is now the
selection or nothing.

**The "?" in Náhled promised hints the app never shows.** It was gated per step on
`step.hint ?? block.hint`. The app gates on `block.hasHint`, which reads
`ContentBlock.currentHint` at `currentStepIndex`, and nothing in a lesson moves that
off 0: every step of a card offers the *first* step's hint, or the card's, and help
only as the second rung of a hint. Náhled now draws what the app does, marks a later
step's own hint "žák ji neuvidí", and `W_HINT_UNREACHABLE` says it in the review. The
spec's own example course has one such hint (the quiz card's question), so its
"clean" tests now expect exactly that warning. The app bug is in OPEN-PROBLEMS.

History and position in the lesson player are card ids, not indices (Still open #12).

**The protocol says when, not only what.** `lib/preview/README.md` → "The contract"
has a table of when each player message is sent, and the editor's `receive()` is an
exhaustive `switch` that fails to compile on a new message type. A second `ready`
(the frame reloaded) re-sends the last content instead of leaving a placeholder.

**Said where it is typed, not at export.** The owner put a hint on step 2 and found
no "?" in Vyzkoušet — correctly, because no student would get one (OPEN-PROBLEMS C).
`W_HINT_UNREACHABLE` was review-only; it is `immediate` now, under the field, like a
YouTube link in the video field: text written into a field nobody will read is a
contradiction the author is causing right now, not advice. A later step's empty hint
field no longer promises "žák uvidí otazník jen když tu něco je".

**A question card is one bubble.** Also from the owner: a question card with two
questions "joins the steps and cannot continue". It continues — the questions are
answered strictly top to bottom, and a field below the current question takes no input
while looking as if it would (OPEN-PROBLEMS C2). The preview is right to show that;
the card now says so in one quiet line when it has two or more questions. *Rejected:*
making Vyzkoušet draw the later questions differently — the preview would then disagree
with the app, which is the one thing it may not do.

### Version control replaces card status

The owner asked for a version button that opens every version, lets the teacher pick
which is published, and sets who sees the course — private, public, signed-in only in
teacher mode, more from Metodik, without bloat.

**What upstream allows decided the model** (`domain/versions.ts`). The API keeps one
row per course and takes an upload only with a strictly higher `version`; the app
offers students an update only when the number grows. So a version is a numbered,
frozen copy of the whole course, numbers only grow, and "make version 3 the published
one" after 5 was out becomes **version 6 with version 3's content** — the dialog says
"Zveřejnit znovu jako verzi 6" before it happens. *Rejected:* pointing "published" back
at 3 — the API would refuse it and every app that has 5 would ignore it.

**Visibility is the two keys the platform reads.** Soukromý = `status: private` (not in
the library, open with the PIN), Veřejný = `published`, Jen pro přihlášené =
`published` + `logged_only`. Metodik adds Rozpracovaný, Schválený and K revizi — the
spec's `locked`, "frozen for review, hidden from students". *Rejected:* calling
"signed-in only" *locked*, which the owner's wording suggested: the spec already
means something else by it, and one word for two states is how a course gets hidden
by accident.

**The working copy stays the document.** Saving freezes it as the next number;
restoring is an undoable edit (`restoreVersion` keeps the course's id and current
visibility); nothing replaces the document behind the author's back. The top bar says
`v3`, `v3 · upraveno` or `v1 · neuloženo`, and the working copy's download carries the
number it will be saved as. An imported file is recorded as the version it came with,
so the next save cannot reuse a number it was published under.

**Where versions live: this browser and the editor's server.** IndexedDB first, always;
the editor's own server (`routes/versions/`, files under `DATA_DIR`) second. A store
merges both and copies a version to whichever lacks it, so a history written offline
reaches the server later, and one on the server comes back to a browser whose
IndexedDB was cleared. There is no login, so the owner is a random per-browser key; the
server keeps only its SHA-256. The interface answers for "the current owner" so that a
signed-in owner (`lib/server/versions/owner.ts`) and a per-course access list for
collaboration slot in without changing the client. *Rejected:* keying by course id
alone — every new course used to be `NOVY_KURZ`, and anyone who could reach the editor
could have replaced anyone's history.

**Publishing is still a download.** The API upload's sign-in is unresolved ("Still
open" 2 and 3), so a published version is marked, and downloaded for the
administration. `W_VERSION_NOT_BUMPED` stays for a hand-edited `version` in Pokročilý;
the editor's own numbering cannot produce it.

### How this class of problem is caught from now on

Each of these fails on the code as it was before this round:

- **A field names its consumer.** `fields.test.ts` reads `COURSE-EDITOR-SPEC.md`'s
  ✅/🟡/⚪ markers and requires `unread: true` on exactly the fields nothing reads — both
  ways, so the flag goes when the platform starts reading a key. None may be in teacher
  mode; wherever one is shown its help starts "Zatím bez účinku" (`hintFor`). It found
  38, some promising effects outright. *Rejected:* a hand-maintained `readBy` on every
  field — a second record of the same fact, and the spec is the one that cites code.
- **An issue is fixable where it is shown.** `fixModeOf` knows the mode that draws the
  field behind any issue; the review and the panel say so and switch on "Přejít". A
  test fails when an issue names a field the registry does not know.
- **A card is born quiet.** Every card type with every step type shows nothing before
  it is left. No chip computes its own warning — warnings come from `validate()`, with
  a timing.
- **View state outlives components.** Folding is keyed in `StepView`; the rule is a
  truth table; e2e drags a folded step.
- **The preview is measured.** Line breaks are compared with and without focus, and
  with and without a click target around the app's own renderer
  (`test/preview/preview_fidelity_test.dart` in the fork).
- **The protocol says when.** Every player message has a "sent when" line, the lesson
  player test asserts each emission point, and `receive()` fails to compile on a new
  message type.

### Mode parity

What each surface does, so that a preview change can be checked against it:

| | App (student) | Vyzkoušet | Náhled |
|---|---|---|---|
| Layout of content | — | identical to app | identical to app, focus included |
| Tap on text / picture | nothing | nothing | selects the field in the editor |
| Tap on an answer | answers | answers | selects the answer's row |
| Hover | nothing | nothing | pointer cursor only |
| Focus mark | — | none | outline over the focused step |
| "?" | the step on screen's hint, else the card's (fork fix, Round 5) | same, app's sheet | same rule per step; unreachable text marked |
| Question card | grows question by question (fork fix) | same | every step at once |
| A finished card | keeps its answers and visited steps | same | — |
| Where the editor is | — | follows the run; steps not reached yet are folded | wherever the author is |

### Smaller finds from the same pass

- Every new course was `course_id: "NOVY_KURZ"`, so two new courses were one course to
  the API and to any version history. Ids are minted per course (`KURZ_` + 10 random
  characters, never shown), and the download is named from the course name.
- The branch picker named cards and steps its own way (a table's syntax as a card
  name, `(question)` in English for an empty step). It uses `blockPreview` and
  `stepSummary` now.
- At the 1280 floor a folded step's summary was squeezed to nothing and "Smazat" ran
  off the card; a step's Duplikovat/Smazat fold to icons when the step is narrow.

## Round 5 — fixing the app in the fork, until upstream catches up

The owner: the app code on GitHub is older than the app in production, with bugs the
newer one fixes, such as the per-step hint; that newer version lands in days. Until
then, fix the fork so the preview is right now. The joined steps in a question card
are the same kind of bug. And Vyzkoušet opened every step of the next card in the
editor, which is not how the pupil sees it.

Round 4 treated the app as fixed and made the editor honest about it: a warning per
unreachable hint, and a note on every question card with two questions. Both said
true things about code that is about to be replaced. The fork now carries the fixes
instead, in the app's own files, so Vyzkoušet and Náhled show the corrected app. The
warnings that described the old bugs are gone or rewritten. The fork's
`lib/preview/README.md` → "Fixes to the app" lists them for the upstream merge, and
`test/widgets/block_step_engine_reveal_test.dart` states what the merged code must
still do.

**The hint is the step on screen's.** The engine's index setter keeps
`ContentBlock.currentStepIndex` on the step it draws, so every reader of `currentHint`
(the hint sheet, the AI chat context, the quiz bar) is right without being touched.
The engine also decides whether to draw the "?". Owners used to gate it on
`block.hasHint` once, at build, so they only ever saw step 1. *Rejected:* passing the
step index through `onHintRequested`. It changes four call sites' signatures and
still leaves `currentHint` wrong for the chat context. The "?" is on the current step
only, not on history cards: a hint is for the step being worked on, and the sheet
shows the current one.

`W_HINT_UNREACHABLE` now warns only about what the fixed app really never shows:
- help with no hint to open it;
- a card hint or help that every step overrides;
- the hint or help of a text step in a question card, which is never the step on
  screen. The editor stops offering the ladder on such a step unless it already
  has text.

The spec's example course is clean again, and the e2e workaround that stripped its
hint is gone.

**A question card reveals its questions as they come.** The bubble stays one bubble.
That is the app's design, and a card that should stop between questions is a Výklad
card. Only the question to answer is drawn, with the text before it, and the answered
ones stay above. *Rejected:* drawing later questions greyed out. They would still
look like part of the task before their turn. The disabled check button now says
"Nejprve napiš odpověď" for a typed answer. The editor's note about one bubble is
removed, because it described the bug.

**A skipped step is not history.** Found while doing the above: a `go_to` over a step
still drew it, because the history was "every index below the current one". The engine
records visits (`StepProgressData.visitedSteps`, optional, so older saved progress
restores as before).

**The editor follows the run the way the pupil sees it.** `stepChanged` now carries
`shownStepIds`, the steps of that card on the pupil's screen. `StepView` folds the
played card's other steps (`unreached` in the `stepExpanded` truth table). Focus and
the chevron still open one, and leaving Vyzkoušet gives the author's own folding back.
Round 4 selected and opened the current step but left every other step of the new
card open. *Rejected:* computing "reached" from positions in the editor. With
branching, the player is the only one that knows.

**A finished card keeps its engine.** The lesson player keyed a card's engine by "the
run's generation while current, else `done`". So a finished card was re-created as
merely completed: its answers and feedback were lost, and every step was drawn.
Each card keeps the key it was mounted with now, until the run goes back past it.
A card a branch jumped over is drawn unfinished, on its first step, as the app draws
it, not as history with every step open.

Fork commits `f90a384` and `8ec5352`, pinned by `PLAYER_REF`.

---

## Still open

Blockers and questions, in the order they will bite. Defects a teacher can hit today
are listed separately in `docs/OPEN-PROBLEMS.md`, with what has and has not been
reproduced.

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
11. ~~`block.status` is authored and read by nothing~~ — no longer offered (Round 4).
12. ~~`PreviewLessonPlayer` keys its history by block index~~ — keyed by `blockId`
   (Round 4).
