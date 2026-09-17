# Course Editor — Feedback from a Hands-On Test

I went through the editor as a teacher would: wrote a text card, added a multiple-choice question card, filled in answers/feedback/branching, tried course settings, undo/redo, and the "Vyzkoušet" student-preview mode. Overall the concept and the didactic thinking behind it are strong — the rough edges are concentrated in a few specific spots.

## What's working well

- **Progressive disclosure (Učitel / Metodik / Pokročilý)** does its job cleanly — plain content and branching by default, exercise-classification one tier up, scoring weights/media placement at the top tier. Nothing feels hidden, just deferred until needed.
- **Validation messages are written for teachers, not for a schema.** E.g. *"Výkladový blok nemá žádný text. Žákovi se otevře prázdná karta"* or *"Žádná chybná odpověď nemá zpětnou vazbu. Žák se nedozví, kde udělal chybu — jen že chyboval."* This is the best part of the tool as it stands.
- **Errors vs. warnings are correctly distinguished.** Hard errors (red) block "Stáhnout JSON"; soft warnings (orange) don't. Confirmed the button is genuinely disabled while errors exist, not just greyed out visually.
- **Reactive totals** — duration and XP recompute up the lesson/course chain immediately.
- **Branching dropdown ("KAM DÁL")** shows human-readable targets grouped into flow actions vs. "jump to another block by name" — much better than raw IDs.
- **"Vyzkoušet"** lets you click through your own course as a student would, including stepping back to try another branch.
- **Honest WIP signaling** — toggles with no effect yet ("Hlídat náhodné klikání", "Dovolit odpověď fotkou") say so explicitly instead of pretending to work.

## The one thing to fix first

**No autosave, no unload warning.** Editing sits in "neuloženo" indefinitely, and reloading the page silently discards everything — no `beforeunload` prompt, no recovery. The only persistence path is manual "Stáhnout JSON". For a teacher writing a real lesson, one accidental refresh or crashed tab currently means total data loss. Even a localStorage draft + unload guard as a stopgap would remove most of the risk.

## Reproducible bugs

- **Answer feedback column can collapse to ~60px wide.** After typing a longer "Co se žák dozví" text, the `.cell.feedback` container gets stuck at 60px width for the whole column (both rows), wrapping text one word per line. Data isn't lost, just unreadable — looks like a grid/table column-sizing bug tied to that specific cell.
- **Answer/question/feedback inputs are fragile to click.** They render as a placeholder that swaps into a real input on click; a click that lands slightly off-target does nothing — no focus, no visual feedback — and anything typed afterward goes nowhere silently (confirmed `document.activeElement` staying on `<body>`). These are the fields used constantly while authoring a question, so the cost of this fragility is high relative to its size.
- **"Nastavení kurzu" modal overflows horizontally** at a normal browser width (~1316px) — a horizontal scrollbar appears partway down and the "Zamčeno" course-status option gets clipped at the edge.

## Smaller UX notes

- Adding a blank question card jumped the course from 1 XP to 9 XP before any content was written — probably an intentional default per-answer value, but worth surfacing so it doesn't read as a bug to a teacher watching the counter.
- **"Odebrat" doesn't delete a card** — it unlinks it into a new "Karty mimo lekci" bucket, which is a good non-destructive default. But the label reads as destructive, there's no confirmation, and I didn't find a way to put an orphaned card back into a lesson short of Undo.
- **"živý náhled"** doesn't actually update per keystroke, only on blur/field-commit — fine behavior, but the "live" naming oversells it slightly.

## Bottom line

The information architecture and validation/didactic layer feel like they were designed by someone who thought hard about what a teacher needs to know at each moment — that part is in good shape. Priority order for fixes: **persistence/autosave**, then the **answer-table input fragility + feedback-column layout bug**, then the smaller polish items.
