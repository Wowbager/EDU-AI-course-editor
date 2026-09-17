# EDU-AI — editor kurzu

A teacher-facing editor whose only output is a valid `CourseV2` JSON document, as
defined by `../docs/COURSE-AUTHORING-SPEC.md`. See `PLAN.md` for the brief and
`DECISIONS.md` for what was decided and what is still open.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### The preview

The preview column is the **real player from the app**, not a lookalike, so it needs
the Flutter web build of `../EDU-AI-asistent-APP` served on this origin. The dev
server does that at `/player/` once the build exists:

```bash
cd ../EDU-AI-asistent-APP
flutter build web --release --base-href /player/
```

Without it the editor runs fine and the preview column says what is missing.

Two modes, and they are different things rather than two spellings of one:

- **Náhled** — the selected card with every step expanded at once, and nothing to
  click through. It is inert: a click anywhere lands on the field that produced it.
  It also shows what a student would not see yet — every option's feedback, the
  solution, and where each branch leads — so a branching card can be read at a glance.
- **Vyzkoušet** — the whole lesson from the selected card onward, exactly as a pupil
  takes it, with **Zpět** so a branch can be tried and then the other one. Going back
  re-mounts the card, so answers after that point are re-entered.

### The API

The editor expects the API on the same origin under `/api`. In development that is
proxied (`vite.config.ts`); set `API_URL` to point somewhere else:

```bash
API_URL=http://localhost:8000 npm run dev
```

It works without the API too. What it cannot do then is check vector length against
the course's own skill configuration — it falls back to the GPF taxonomy shipped in
`src/lib/gpf/`, marks it as the default in the UI, and you can load a different one
by dropping the admin's export onto **Načíst**.

## Tests

```bash
npm test         # domain: the invariants live here
npm run test:e2e # the flows of plan §7, in a real browser
npm run check    # types
```

The browser suite includes three tests that drive the real player. They skip
themselves when the Flutter build is absent.

## Layout

```
src/lib/domain/     headless: schema, ids, Ref, index, validation, commands, import
src/lib/state/      the document store: undo, id reservations, derived validation
src/lib/ui/         primitives built on the ported tokens, and `fields.ts`
src/lib/editor/     the shell, the card editors, the validation panel
src/lib/preview/    the editor half of the postMessage contract with the player
src/lib/api/        the API client
```

The domain layer has no UI imports and no Svelte dependency. That is deliberate: the
invariants in plan §3 are tested there as properties, not hoped for in components.

### The screen

```
Topbar          course name, totals, validation, mode, import/export
Sidebar         the tree: lessons, and the cards inside the open one
main            exactly one card — the one selected in the tree
PreviewColumn   the real player, showing that card
```

**One card at a time.** The tree carries the shape of the lesson so the editor column
does not have to; selection lives in the tree and nowhere else.

**Content is in the column, configuration is in a modal.** What the student reads —
the steps, the hint, the detailed help, the solution — is always visible. What
describes the card to the platform is behind `Nastavení karty`, next to
`Nastavení lekce` and `Nastavení kurzu`. In teacher mode there is no disclosure
anywhere in the editor column; `editor.spec.ts` asserts it.

### The three modes

**Učitel ⊂ Metodik ⊂ Pokročilý** — cumulative, so nothing becomes unreachable by
switching up a level. Teacher mode is content and answers; metodik adds practice
enrolment and the knowledge vector; pokročilý adds everything else the format carries,
identifiers included.

Which fields belong to which mode is declared once, in `src/lib/ui/fields.ts`. No
component keeps a second opinion about it, and `fields.test.ts` fails if a key in
`KEY_ORDER` has neither a mode nor a written reason for having none — which is what
makes "pokročilý shows everything else" a tested property rather than an intention.

## Deployment

`Dockerfile` builds both halves and serves them on one origin — the editor from
`adapter-node`, the Flutter player under `/player/` — because the preview is an
iframe that has to talk to the page around it. Build from the workspace root, which
holds both repositories:

```bash
docker build -f editor/Dockerfile -t edu-editor .
```
