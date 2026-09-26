# EDU-AI — editor kurzu

A teacher-facing editor whose only output is a valid `CourseV2` JSON document, as
defined by `docs/spec/COURSE-AUTHORING-SPEC.md`. See `docs/spec/PLAN.md` for the brief and
`docs/DECISIONS.md` for what was decided and what is still open.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### The preview

The preview column is the **real player from the app**, not a lookalike, so it needs
the Flutter web build served on this origin.

The player lives in a fork: <https://github.com/Wowbager/EDU-AI-asistent-APP>. The
preview half of it — `lib/preview/`, the channel the editor talks to — is not in
`edu-ai-00/EDU-AI-asistent-APP`, so the fork is where the editor's player actually
comes from. `Dockerfile` pins the exact commit it builds against (`PLAYER_REF`);
bump that deliberately when the player changes, so the preview's claim about what a
student sees stays a fact recorded in this repository.

For development, check the fork out anywhere and point the dev server at its build:

```bash
git clone https://github.com/Wowbager/EDU-AI-asistent-APP.git
cd EDU-AI-asistent-APP && flutter build web --release --base-href /player/ --no-web-resources-cdn
cd ../editor && PLAYER_BUILD=../EDU-AI-asistent-APP/build/web npm run dev
```

`PLAYER_BUILD` defaults to `../EDU-AI-asistent-APP/build/web`, so a checkout beside
the editor needs no variable at all. Without any build the editor runs fine and the
preview column says what is missing.

Images in the preview do **not** go through the app's `/api/proxy/image`: the editor
serves the player's page and splices in `src/lib/preview/player-shim.js`, which
redirects those requests to the editor's own `/preview-image`. That endpoint fetches
the image server-side, where there is no CORS to fight, and falls back to the Laravel
proxy. The app's proxy 502s for hosts that redirect or that refuse its requests —
Wikimedia among them — which is why a pasted image URL used to come back broken.

### Building the image

```bash
docker build -t edu-editor .
```

The context is this directory; the player is cloned and built from the pinned commit,
so nothing has to be checked out beside it.

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

Agents: read `AGENTS.md` first, especially the git routine and which checks count.


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
iframe that has to talk to the page around it. The player is cloned at the pinned
`PLAYER_REF`, so the build context is this directory alone (see "Building the image"
above).

### Version history

Saved versions of a course (the version button in the top bar) are kept in two places:
the browser's IndexedDB, and the editor's own server under `DATA_DIR` — `/data` in the
image, declared as a volume, so mount it:

```bash
docker run -p 8080:8080 -v edu-editor-data:/data edu-editor
```

In development `DATA_DIR` defaults to `.data/` in the checkout (gitignored). There is no
login yet: each browser makes a random key, the server stores only its hash, and a
browser that loses its site data loses its way to its server history too. When sign-in
exists, `lib/server/versions/owner.ts` is the one place that changes.
