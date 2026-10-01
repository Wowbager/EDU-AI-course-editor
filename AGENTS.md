# AGENTS.md — EDU-AI course editor

For any agent working in this repository (`github.com/Wowbager/EDU-AI-course-editor`).
Several people and agents push to `main`.

## What this is

A SvelteKit app whose only output is a valid `CourseV2` JSON document. The format's
source of truth is `docs/spec/COURSE-AUTHORING-SPEC.md`; "§14" or "plan §7" in the code
means that spec and `docs/spec/PLAN.md`. The preview column is the **real Flutter
player** in a same-origin iframe, built from the fork `Wowbager/EDU-AI-asistent-APP` at
the commit pinned by `PLAYER_REF` in `Dockerfile`.

This repo is the only thing the project can ship. The app, API and admin
(`edu-ai-00/EDU-AI-asistent-*`) are read-only upstreams. A fix that needs them goes in
`docs/OPEN-PROBLEMS.md` as app-side, not into a commit elsewhere. Changing the player is
a fork commit plus a separate `PLAYER_REF` bump, and a human's call. Publishing a
course (`POST /api/courses/upload`) waits on auth (DECISIONS → "Still open"). The GPF
dimension count comes from the course's skill configuration or `src/lib/gpf/`, never a
hard-coded number.

Read `docs/DECISIONS.md` before a large change and `docs/OPEN-PROBLEMS.md` for what is
known to be broken.

## Design

**Before any change a teacher can see, read `docs/DESIGN.md`**, and give its path
and the owner's words verbatim to every subagent that builds UI. It outranks the
current UI, `DECISIONS.md` and the specs' UI descriptions. In short: build what was
asked, and list anything else you'd add as *Proposed, not built*. Show screenshots and
have an outside review against its checklist before handing back. Record every design
correction from the owner there.

## Git

- Start with `git fetch origin && git status -sb`, and rebase onto `origin/main` if
  anything came in. If others' commits break `npm test` or `npm run check`, say so and
  fix it in its own commit.
- Small commits, one logical change each, pushed as soon as the checks pass. Rebase
  again before every push. Never force-push `main`; on your own branch use
  `--force-with-lease`.
- Resolve a conflict by keeping both intents. Never take one side of a whole file. If
  you can't tell what the other side meant, ask.
- Working alone for a person: push to `main`. In parallel with another agent, or on
  GitHub: a `<who>/<topic>` branch and a PR. Never leave work unpushed.
- Commit messages say what changed for the teacher or the code, like the existing log.
  Never commit `test-results/`, `playwright-report/`, `build/`, `.svelte-kit/`, `.env*`.
- Formatting is decided by `.prettierrc.json`, not by taste: tabs, single quotes,
  no trailing commas, width 100. Prettier is a dev dependency; `npm run format`
  rewrites in place and `npm run format:check` reports. Neither is in CI on purpose —
  a formatting failure should never be what a red build means.
  - Don't reformat code you aren't changing: run `npm run format` on the files you
    touched, not on the repo. A whole-tree reformat is its own commit with nothing else
    in it, and it says so.
  - `docs/`, `*.md`, `*.json` and the fixture corpus are deliberately outside Prettier
    (see `.prettierignore`): Prettier rewrites Markdown emphasis and reflows prose in
    files whose headings are citation keys, and it would reorder course JSON whose key
    order is a tested invariant (DECISIONS M1).
- **npm only**: `package-lock.json` is the lockfile, and a dependency change is a
  commit of `package.json` + `package-lock.json` alone.

## Checks

```bash
npm run check          # svelte-check, 0 errors
npm test               # vitest: the domain invariants
npm run test:e2e       # Playwright, against the built editor on port 5178
```

CI runs `check`, `npm test` and `test:e2e -- --project=editor`. The `editor` project needs
no Flutter build, so it is a real gate on every push and PR. The `player` project is
yours to run, and so is `REQUIRE_PLAYER=1` — the one thing CI cannot check is the
preview itself, because the runner has no player.

- Two Playwright projects: `editor` (every suite about the editor, with a fake player
  from `e2e/fixtures.ts`) and `player` (`e2e/preview*.spec.ts`, the real Flutter build,
  2 workers — don't raise it). Suites import `test`/`expect` from `./fixtures`.
- Without the Flutter build the `player` project skips. After touching
  `src/lib/preview/`, `vite-plugin-player.ts`, `scripts/inject-player-shim.mjs` or
  `routes/preview-image`, run with `REQUIRE_PLAYER=1` so a missing build fails.
- The suite reuses a server already on 5178, so a stale one tests old code.
  `E2E_DEV=1` uses the dev server instead of the build.
- Open the page with `openEditor(page)`; it waits for hydration and retries one aborted
  load. Find elements by their Czech accessible names. When you change a label, grep
  `e2e/` for the old text in the same commit (the player's labels too).
- Inside the player use `e2e/player.ts`: `button`/`player` to find by name, `press` to
  click with the real mouse, `inspect`/`waitForPlayer` to ask what it shows,
  `recordMessages` for the traffic. Step text has no accessible name; assert on the
  message a click sends instead.

## Rules that stop the mistakes we keep making

Each of these comes from a bug that cost a round.

1. **One source per app rule.** When the editor must know how the app behaves (which
   hint shows, which steps a pupil sees, how a card is split), that rule lives in one
   function in `src/lib/domain/`, cites the app code it mirrors, and is tested. Never a
   second copy in a component, and never a guess where the player can be asked.
2. **The preview draws with the app's widgets only.** A hand-made copy of the app's
   layout drifts from it. Náhled still is one (OPEN-PROBLEMS).
3. **Card types and course modes are one table.** Behaviour that differs by block type
   (`display` / `question` / `exercise`) or `export_type` is listed in the spec's table,
   and a change is tested for every type, not just the one in the bug report.
4. **Fix the layer that owns the behaviour** — app, bridge, domain or UI — and name it
   before fixing. A fix that makes one symptom go away somewhere else is a bolt-on. A bug
   fix comes with a test that fails without it.
5. **A card is one graded item in the app** (one score, mark, practice card and ELO
   update). So every question is its own exported block, and several blocks show as
   one card on screen (`src/lib/domain/groups.ts`, COURSE-EDITOR-SPEC §6.2a). Only the
   advanced mode may keep several questions in one block, on purpose. Code that needs
   the exported course reads `store.source`; code that draws the editor reads
   `store.doc`.
6. **The document is what gets exported.** Parsing injects no defaults, unknown keys
   survive, and nothing is converted on the way out. A view (like a card group) is
   derived from the document, never stored beside it.
7. **Tests wait on a condition, never on time**, and find things by name, never by
   pixel.
8. **Nothing about one machine goes in this repo**: no local paths (`/home/...`), ports of
   someone's own servers, or quirks of one network. This repository has to stand alone —
   an agent or a person reading it on GitHub has none of that context. Every fact the
   repo needs belongs in the repo, written for a reader who has never seen the machine
   it was written on; the machine-specific side (checkout layout, which port is busy,
   how to build the player in a sibling directory, the archive of retired work) lives in
   the workspace notes outside the repo.

## Conventions that are tested

- `src/lib/domain/` is headless (no Svelte, no UI). Put logic there, with tests.
- Which fields each mode (Učitel ⊂ Metodik ⊂ Pokročilý) shows is declared once, in
  `src/lib/ui/fields.ts`. A field nothing downstream reads carries `unread: true` and
  is never in teacher mode; `fields.test.ts` checks it against the ✅/⚪ markers in
  `docs/spec/COURSE-EDITOR-SPEC.md`.
- Validation messages are Czech, written as consequences for the student. No chip
  computes its own warning: warnings come from `validate()`, with a timing in
  `ui/issue-visibility.ts`.
- Teachers never see ids.
- The preview protocol exchanges JSON strings, posted to `window.location.origin`.
  A new message type updates the union and every `switch` on both sides, and gets a
  "sent when" line in the fork's `lib/preview/README.md`.
- `{#each}` keys stay unique in a broken document (`ui/keys.ts`). State a component
  must not forget on remount lives in a keyed store (`state/step-view.svelte.ts`).
- The preview's layout may not depend on focus or click targets
  (`test/preview/preview_fidelity_test.dart` in the fork).

## Writing things down

Every UX or architecture decision goes in `docs/DECISIONS.md` under the current round,
with what was rejected. Every defect you find and don't fix goes in
`docs/OPEN-PROBLEMS.md`, with whether it was reproduced. Work in progress is fine;
burying problems is not.

**Every change carries something back, and a reason for not testing is itself a claim
that expires.** A fix arrives with one of:

- a test that fails without it (the ordinary case, and rule 4 above);
- an `OPEN-PROBLEMS.md` entry, if it is app-side or cannot be tested from here — the
  player is a repository this project cannot push to, and #40 is the example: production
  `nginx.conf` is reached by no test, so the gap is written down rather than implied.

The second half is the part that keeps getting missed. When a check is *deliberately*
not run, the reason for that is a statement about the world at the time — and the world
moves. Two working examples, both of which cost a round:

- CI ran only `check` and `npm test` because "without the Flutter player it would skip
  the preview suites anyway" (`3e5c0d0`, Sep 26). True of one Playwright project; false
  once `playwright.config.ts` split `editor` from `player`, and nobody re-read it while
  round 9 kept fixing clicky bugs by hand. The `editor` project is a CI job now.
- The workspace instructions told agents to follow a design brief that only existed on an
  unmerged branch (`OPEN-PROBLEMS.md` #39, 2026-09-30): a proposal consumed as settled.

So: when you touch the thing a documented reason is about — a test config, a skip
condition, a file the instructions point at — re-read the reason in the same commit. If
it no longer holds, the commit that invalidates it is the commit that fixes it. A reason
that has stopped being true reads exactly like one that is still true, which is why
nothing else catches this.
