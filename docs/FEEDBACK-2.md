# EDU-AI Course Editor — Test Feedback

Tested as a teacher building a short "Introduction to photosynthesis" lesson: text/image/video/audio steps, a multiple-choice question, a second lesson, the different card types, save/load, and the student-facing try-it mode.

## What's working well

- **Validation is genuinely good.** Errors (e.g. empty text block) vs. warnings (e.g. image missing alt text) are distinguished clearly, referenced inline right where the problem is, and gate the "Stáhnout JSON" export until the course is valid.
- **Pedagogical nudges, not just form validation.** It flags wrong answers that have no feedback text ("žák se nedozví, kde udělal chybu"), and the lesson settings modal shows a rollup like "zpětná vazba jen u 33 % chybných odpovědí" — this pushes toward better teaching, not just a technically complete course.
- **Progressive disclosure via Učitel / Metodik / Pokročilý** works nicely — a teacher never has to see FSRS/identifier-level settings unless they opt into "Pokročilý".
- **Auto XP calculation** from step/question counts, live markdown preview, and the lesson settings summary (card count, estimated time, XP, feedback %) are all solid, useful-at-a-glance features.
- **Undo works** even for a destructive change (see below), which saved my test data once.
- **Click-to-jump from preview to editor** (clicking a line in the right-hand preview jumps you to the matching step in the editor) is a great idea for quickly finding what to fix.

## Bugs

1. **Images don't render in "Vyzkoušet" (try-it/student) mode.** Confirmed — the image step shows up fine in the static "Náhled" preview but not when walking through as a student.
2. **Click-to-jump hit target is too small.** It currently only triggers on the text itself, but text can be short/small, so it should trigger on the whole step block instead.
3. **Switching a question's answer type wipes existing data with no warning.** E.g. going from "Výběr" (multiple choice) to "Vlastní slovo" instantly discards all answer options and their feedback text — no confirmation dialog. Recoverable via the toolbar undo, but only if caught immediately.
4. **No image-URL debounce.** Typing an image address fires a real network request on every keystroke instead of on blur/pause — unnecessary load, and will feel janky on slower connections.

## Inconsistencies / rough edges

- **Validation coverage is uneven across step types.** Empty text steps = error, images without alt text = warning, but an empty video or audio step (no URL at all) triggers no warning whatsoever — arguably the worst case for a student, since it's silently invisible.
- **No way to set a card's title directly.** It's auto-derived from the first step's text, so once a card has more than a line of content, the lesson sidebar shows long, truncated, hard-to-scan titles.
- **Internal IDs leak into teacher-facing messages** — e.g. "Výkladový blok 'L3_B1' nemá žádný text" or "krok 's3'". A teacher has no idea what L3_B1 or s3 refers to; these should resolve to the visible card/step name or position.
- **Card type vs. step type overlap is confusing.** A question can be its own top-level "Otázka" card, or an "Otázka" step embedded in a "Výklad" card — both scaffold identically, with no explanation of when to use which. Separately, "Cvičení" is both a card type inside a lesson and a whole course type in course settings — same name, different meaning.
- **New lessons all default to "Nová lekce"** with no auto-incrementing name, so a few lessons in a row become indistinguishable in the sidebar until renamed.
- **Video step requires a direct MP4 link ("ne YouTube")** — reasonable technically, but likely to surprise teachers who instinctively paste a YouTube URL. Worth a clearer inline hint or a YouTube-URL detection message.
- **Minor:** the monospace font on URL fields renders "//" so tightly it can misread as "https: /"; purely cosmetic.

## Worth double-checking

- The top bar shows "Uloženo v tomto prohlížeči" (saved in this browser) with manual "Stáhnout JSON" as the only export path. Worth confirming teachers understand this is local-storage-only with no server backup — clearing site data or switching machines would lose unsaved work.
