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

### B. Click-to-edit hit target — still app-side, not shipped
In "Náhled", clicking a step jumps the editor to the field behind it, but the hit
target is only whatever the leaf widget paints, so a short line of text is a sliver of
the card and the padding around it is dead space. The fix is four lines in the app
(`preview_expanded_block.dart`, `preview_mode.dart`: wrap the card body in an opaque,
outline-less `PreviewTarget`) and there is **no editor-side equivalent** — the click
happens inside a Flutter canvas the editor cannot see into, and nothing in the preview
protocol reports where a step is drawn.

It needs to be a PR against the app. Until then the tester's finding stands as reported.
If it is never going to be accepted upstream, the alternative is a protocol change —
the player reporting step rectangles so the editor can put its own hit layer over the
iframe — which is more machinery than the problem deserves.

---

## Defects

### 1. An empty lesson is invisible to validation and lies about its length
**Verified: yes**, read off the code.

Add a lesson and leave it empty. The tree says `0 karet · 5 min · 0 XP` — five minutes
for a lesson containing nothing, because `lessonTotals` floors the estimate at
`clamp(blockCount * 4, 5, 60)` (`domain/derive.ts:73`) with no zero case. The editor
column does say the right thing when you click into the lesson ("Lekce … zatím nemá
kartu"), but `validate.ts` has no lesson-level emptiness check at all — the only binding
check is `lesson.blocks.length > 12` (`domain/validate.ts:136`) — so the top bar chip
and "Kontrola kurzu" both stay green and the course exports clean.

Two separate fixes: a zero case in the duration estimate, and a `W_EMPTY_LESSON`
alongside `W_ORPHAN_BLOCK`, which is the same idea one level up.

### 2. Dragging a card to reorder it only grabs on the text
**Verified: no** — reported by a scripted author, traced by them to
`svelte-dnd-action`'s nested-interactive-element guard combined with the row's `<li>`
being pixel-identical to the `<button>` inside it. Not reproduced independently.

If it holds, it is the same class as the click-to-jump hit target fixed in the player
this round: the affordance is the row, so the row should be the handle.

### 3. `block.status` is authored and read by nothing
**Verified: yes.** The editor lets an author mark a card `draft`/`published` and the
format carries it, but `block_model.dart` never parses `status` and the API does not
filter on it. The chip's tooltip used to promise that a draft card is skipped for the
student; it no longer claims that, but the field is still offered and still means
nothing. Either the app should honour it or the editor should stop asking.

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

### 6. The downloaded filename does not follow a course rename
**Verified: yes.** The file is named from `course_id`, which is minted once and
immutable by design, so a course renamed to "Úvod do fotosyntézy" still downloads as
`NOVY_KURZ.json`. Defensible, but a teacher looking in their Downloads folder for the
name they typed will not find it.

---

## Unconfirmed

### 7. A possible transition artifact in "Vyzkoušet"
**Verified: no.** One scripted author flagged it and was explicit about not being sure
what they saw. Recorded so it is not lost; needs a reproduction before it is worth
chasing.

### 8. The "draft" status has no rollup
**Verified: yes**, but only worth anything if #3 is resolved first. There is no
lesson- or course-level "3 of 5 cards are still draft" the way there is for XP,
duration and feedback coverage.
