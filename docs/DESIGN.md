# Design brief

Read this before any change a teacher can see, and give it to every subagent that
builds UI. It outranks the current UI, `DECISIONS.md`, and the UI descriptions in
`docs/spec/` (the Figma "focus-reveal" pattern, the preview's hover outlines, the
"roughly fifteen fields" of teacher mode). Those record how things were built, not
what they should become.

**The current editor is not the target.** It is far from it. Don't copy an existing
pattern because it is there, and don't cite it as precedent. When the code and this
brief disagree, the brief wins. When you touch a spot the brief would change, say so.
Don't silently widen your change to fix it.

## Who it is for

A tired Czech teacher, at the end of the day, writing a lesson. They are not technical.
They don't know what a block, an id, a step type or an export mode is, and they don't
need to. Within a few seconds they should know three things: which lesson and card
they are in, what they are expected to write next, and what the pupil will see.

In the owner's words:

- "minimal visual load (imagine tired teacher trying to use this)"
- "hard to tell what is important and to what give attention"
- "make the most important elements stand out, while keeping the less important things like informative elements less noticeable"
- "they shouldn't be shoved into the user's face"
- "the teacher doesn't need to know"
- "it still shouldn't become bloated"
- "some cool design that looks good and also has good UX"

"Cool" means polished and calm: good spacing, one clear focus, small quiet motion. It
does not mean more features, more panels or more information.

## Principles

1. **Less by default.** Every visible element costs the teacher attention. Nothing is
   on screen unless the teacher acts on it now. Counts, XP, minutes, positions,
   percentages and statuses are not shown by default. They go in a tooltip or in
   settings, or nowhere.
2. **Content, not machinery.** The teacher sees what they write and what the pupil
   sees. Ids, codes, block structure and how the app stores things stay hidden. One
   question per exported block is an example: the teacher sees one card.
3. **Actions appear where they are used.** A thing's actions show on hover or focus of
   that thing, or in one ⋯ menu. They are not a permanent row of buttons. A
   destructive action is not red until it is about to happen.
4. **Problems are quiet until they matter.** Mark an empty or broken field in place,
   after the teacher leaves it, never while they type. No banners, badges or counters
   that shout. Don't show a warning the teacher can't act on. Everything is said once,
   at export, with a way to fix it.
5. **Editable looks editable; information looks inert.** Order by weight: fields the
   teacher writes into first, then actions, then information. Information never looks
   like a button, and a field never looks like plain text.
6. **The same everywhere.** A behaviour is the same for every card type, and the same
   in Učitel and Metodik. If something works differently for one type, the teacher
   must never notice.
7. **The preview is the app.** Náhled shows the card as the pupil's app shows it,
   fully revealed, with its buttons. It changes only through the editor, and clicking
   it only moves focus in the editor. Vyzkoušet is exactly the pupil's experience.
   Neither shows editor markers, outlines or notes.
8. **Modes add, they don't clutter.** Učitel has only what a course needs to work.
   Metodik adds didactics (Zařadit do cvičení, the knowledge vector). Pokročilý adds
   the rest. Nothing from a higher mode leaks into a lower one as a hint, badge or
   note.
9. **Simple over clever.** One mechanism beats three special cases. Don't add a
   shortcut, animation, toast, panel or setting nobody asked for. Propose it instead.
   The same goes for tooling: no CI job or infrastructure the owner didn't ask for.

## Scope: build what was asked

The owner doesn't review plans. He judges the result on screen. So the scope rules
keep the result close to the ask:

- **The owner's idea is the design.** Build it as described, including the details he
  gives ("icon only", "on hover", "click twice to delete"). If you think it is wrong,
  say so before building. Don't quietly build your own version.
- **Anything beyond the ask that adds something visible is not built.** Put it under
  "Proposed, not built" in your final message, one line each. Removing or quieting
  something in the spirit of the ask is fine, but list it under "Changed without
  asking".
- **Keep the count.** A change should not add always-visible elements to a screen. If
  it must, name each one and why.
- **When the ask conflicts with this brief,** follow the ask for that item, flag it,
  and update this brief if the owner confirms. The owner is the source; this file is
  only his memory.
- **A plan for UI work starts with "What you will see".** At most ten lines, in plain
  words, split into *asked* and *not asked*. Engineering detail comes after, for
  agents.

## Before you hand back

1. **Screenshots.** Take screenshots at 1440×900 in Učitel mode, with a realistic
   course (`src/lib/domain/__tests__/fixtures/corpus/zlomky-5-trida.json` or
   `src/lib/domain/__tests__/fixtures/spec-16-course.json`), before and after your
   change. Include a new, empty card and a filled one. Use Playwright against your own
   dev server port, and save to your scratchpad, not the repo.
2. **An outside design review.** A fresh subagent that did not write the change gets
   only this file, the owner's request verbatim and the *after* screenshots. It gets
   no plan and no diff. It answers the checklist below and lists everything it would
   remove. Fix what it finds, or report it.
3. **Checklist.** Every answer should be yes:
   - Can a tired teacher tell in three seconds where they are and what to do next?
   - Is everything new on screen something the teacher acts on now?
   - Are the new actions hidden until hover, focus or the ⋯ menu?
   - Is anything red, amber or counted only where the teacher can fix it, and only
     after they left the field?
   - Are there no ids, codes or internal terms (blok, krok id, export_type)?
   - Does it behave the same for Výklad, Otázka and Cvičení cards, and in Učitel and
     Metodik?
   - Are Náhled and Vyzkoušet unchanged, except by the document?
   - Is everything not asked for listed rather than built?
4. **Final message.** Give the after screenshots and three short lists: *Changed as
   asked*, *Changed without asking*, *Proposed, not built*.

Subagents that build UI get the owner's words verbatim and the path to this file, not
only the orchestrator's paraphrase. The Round 8 rail was specced by paraphrase and
came back with a number, a gear and an error dot on every tile. It was reworked the
next round.

## What went wrong before

Each row is a design the agents chose, and what the owner said once he saw it.

| Built | Owner | Lesson |
|---|---|---|
| Three preview views, all the same engine | "only two modes" | Don't add modes or scopes |
| Náhled "not interactive", so no buttons | "should by default show the buttons" | Not interactive means clicks go to the editor, not that it looks different |
| Borderless fields until focused (Figma focus-reveal) | "hard to tell what is editable" | Fields look like fields |
| "Rozpracováno" chip on every new card | "strange and unnecessary" | No status the teacher can't change |
| Errors red while typing, a wall of amber | "too aggressive and not informative enough" | Quiet in place, everything at export |
| Help inline in Učitel ("no disclosures anywhere") | "doesn't look good in the teacher view" | "Visible" doesn't mean "in the main column" |
| One question per card in the sidebar | "bloats the cards sidebar, the teacher doesn't need to know" | Split under the hood |
| Rail tiles with icon, number, gear, error dot, stats in tooltip | "too cluttered… only show the icon" | Start from the least; add only what was asked |
| Hover outlines on the preview's text and images | "isn't ideal", "the old way" | The preview draws nothing of its own |
| Notes in the editor explaining an app bug | fix the fork instead | Don't explain a bug to the teacher, fix it |
| Recommended options that added a control (scope switch, caveat label) | chose the option with less, every time | Recommend the smaller option |
| CI with an e2e job | "extra complexity" | No infrastructure nobody asked for |

## Known gaps in the current editor

These are known gaps between the editor and this brief. Don't treat them as patterns
to follow. Some are being worked on in Round 9.

- The number of things left to fix shows twice (the banner and the topbar), and the
  save status can read as two warnings ("neuloženo" next to "Bez zálohy").
- The preview keeps a "Náhled" status chip while the player runs.
- Placeholders are styled so they look like written content.
- Metodik shows a practice switch on every step, and fields nothing reads.
- Náhled is a hand-drawn copy of the app's card layout (OPEN-PROBLEMS #18).
- The spec suggests `quiz_v2` with `quiz_evaluate: false` suppresses solutions
  and per-option feedback that the editor may still ask for; verify this against
  the app before changing those fields (OPEN-PROBLEMS #25).
- Hover-only actions are unverified on touch screens (OPEN-PROBLEMS #26).

## Keeping this file true

When the owner corrects a design, add one row to "What went wrong before" in the same
commit as the fix. If the correction changes a principle, change the principle. Keep
the file short enough to read whole. `DECISIONS.md` still records the reasoning.
