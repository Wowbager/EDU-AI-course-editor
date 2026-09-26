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
set. Worth showing the derived figure with the authored one crossed out, or not
offering the field.

### 16. "Přejít" can switch the editing mode
**By design, recorded because it is surprising.** A review row whose fix is in a higher
mode switches to that mode on the jump, and the mode stays switched. The alternative —
landing on a card whose field is not drawn — is what this replaced.

### 17. On this machine the network drops requests, and the e2e suite flakes with it
**Verified: yes.** WSL's connectivity check fails every few minutes
(`CheckConnection: getaddrinfo() failed` in `dmesg`). Each time, Chrome aborts every
request in flight with `net::ERR_NETWORK_CHANGED`, localhost included. A page caught
mid-load never hydrates, and a player caught mid-boot never starts. The preview now
retries a stalled player (DECISIONS Round 5). The e2e suite does not retry. A full run
shows a few tests timing out on `data-hydrated` at page load, different ones each
time. Run with `--retries=2` to tell those apart from real failures. Round 5's run:
44 passed, 7 flaky, and 1 failed three times on page load, none of them on an
assertion. The player still makes requests to other origins while it runs (Google
Fonts, `accounts.google.com`). They do not block its boot, but they are app-side
(fonts via `google_fonts`, Google Sign-In's client).

### 11. Folding is remembered for the session only
**By design for now.** `StepView` lives as long as the page. A reload opens every step
again. Worth persisting with the draft if authors of long cards ask for it.
