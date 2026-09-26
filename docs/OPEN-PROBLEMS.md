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

### C. The app's question mark is always the first step's — app-side, not shipped
**Verified: yes**, read off the code. `lesson_detail_page` gates the "?" on
`ContentBlock.hasHint` and the sheet shows `currentHint` / `currentHelp`, which read
the step at `currentStepIndex` — and nothing in a lesson moves that off 0
(`block_model.dart:1333`, `hint_sheet.dart:26`). So on every step of a card a student
gets the first step's hint, or the card's; a hint written on step 2 or later is never
shown, and help is reachable only as the second rung of such a hint. The spec's own
example course has one (the quiz card's question step).

The editor now tells the truth about it (Náhled mirrors the app, `W_HINT_UNREACHABLE`
in the review). The fix is app-side — update the block's current step as the engine
advances, or read `step.hint` in the engine — and needs a PR a human opens against
`edu-ai-00`.

### C2. A question card's later questions look answerable and are not — app-side
**Verified: yes**, reproduced in Vyzkoušet with the current player, and read off the
code. A card of type Otázka or Cvičení is one bubble (`_buildExerciseCard` in
`block_step_engine.dart`): every step is drawn at once, but only the current question
gets input handlers. A number or text field further down is drawn exactly like an
active one and ignores typing until the questions above it are answered, and the check
button's only complaint is "Nejprve vyber odpověď" — "pick an answer", for a field you
type into. Reported by the owner as "Vyzkoušet joins steps and I cannot continue"; the
run does continue once the questions are answered top to bottom.

Vyzkoušet shows it because the app does. The editor now says it on any question or
exercise card with two or more questions. The fix — draw a later question as inactive,
and word the message for the input type — is app-side.

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

### 2. Dragging a card to reorder it only grabs on the text
**Verified: no** — reported by a scripted author, traced by them to
`svelte-dnd-action`'s nested-interactive-element guard combined with the row's `<li>`
being pixel-identical to the `<button>` inside it. Not reproduced independently.

If it holds, it is the same class as the click-to-jump hit target fixed in the player
this round: the affordance is the row, so the row should be the handle.

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

### 7. A possible transition artifact in "Vyzkoušet"
**Verified: no.** One scripted author flagged it and was explicit about not being sure
what they saw. Recorded so it is not lost; needs a reproduction before it is worth
chasing.

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
set. Worth showing the derived figure with the authored one crossed out, or not
offering the field.

### 16. "Přejít" can switch the editing mode
**By design, recorded because it is surprising.** A review row whose fix is in a higher
mode switches to that mode on the jump, and the mode stays switched. The alternative —
landing on a card whose field is not drawn — is what this replaced.

### 11. Folding is remembered for the session only
**By design for now.** `StepView` lives as long as the page. A reload opens every step
again. Worth persisting with the draft if authors of long cards ask for it.
