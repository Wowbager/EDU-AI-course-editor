# AGENTS.md — EDU-AI course editor

Rules for any agent working in this repository: a local agent, or one running on
GitHub with nothing but this checkout. Several people and agents push to `main` at the
same time, so most of this file is about not stepping on each other.

This repo is `github.com/Wowbager/EDU-AI-course-editor`. It is the **only** thing this
project can ship. The app, API and admin (`edu-ai-00/EDU-AI-asistent-*`) are read-only
upstreams: nothing here may depend on changing them. If a fix "belongs" in the app,
find the editor-side fix, or write it up in `docs/OPEN-PROBLEMS.md` as an app-side
change that cannot ship from here. Don't put it in a commit to another repo.

## What the editor is

A SvelteKit app whose only output is a valid `CourseV2` JSON document. The format's
source of truth is `docs/spec/COURSE-AUTHORING-SPEC.md`. When code says "§14" or
"plan §7", it means that spec and `docs/spec/PLAN.md`. Don't infer the format from
components or fixtures.

The preview column is the **real Flutter player** in a same-origin iframe, built from
the fork `Wowbager/EDU-AI-asistent-APP` at the commit pinned in `Dockerfile`
(`PLAYER_REF`). Bump `PLAYER_REF` only as a deliberate, separate commit.

Before a large change, read `docs/DECISIONS.md` (why things are the way they are) and
`docs/OPEN-PROBLEMS.md` (what's known to be broken). `README.md` covers running and
building.

## Git: the routine

1. **Start from what is on GitHub.**
   ```bash
   git fetch origin
   git status -sb                     # behind? diverged?
   git log --oneline HEAD..origin/main
   git pull --rebase origin main      # if anything came in
   ```
   If someone else's commits came in, run `npm test` and `npm run check` **before**
   you write code. If they fail, their breakage isn't yours to silently absorb: say
   so, then fix it in its own commit.

2. **Commit small and push often.** One logical change per commit. Push as soon as a
   commit passes the checks below. Don't sit on hours of unpushed work, because the
   longer it waits, the worse the conflict. Work in progress is fine to push as long
   as it builds and the tests pass. Don't hide what is unfinished: say it in the commit
   message or in `docs/OPEN-PROBLEMS.md`.

3. **Before every push, rebase again.**
   ```bash
   git fetch origin && git rebase origin/main
   # if the rebase brought in changes to files you touched: rerun the checks
   git push origin HEAD
   ```
   A rejected push means someone pushed first. Fetch and rebase. Never
   `--force` on `main`. On your own branch, use `--force-with-lease` and nothing
   stronger.

4. **Resolving a conflict.** Read both sides and keep both intents. Never resolve a
   conflict by taking your own side of a whole file (`git checkout --ours`). This
   matters most for the most-edited files: `src/routes/+page.svelte`,
   `src/lib/editor/CardEditor.svelte`, `StepEditor.svelte`, `AnswerTable.svelte`,
   `src/lib/ui/FocusField.svelte`. If one side is mostly whitespace or reformatting, or
   you can't tell what the other side meant, stop and ask a human. After resolving,
   rerun all checks before you continue the rebase.

5. **Where to push.**
   - Local agents working for a person push to `main` (rebased, fast-forward only)
     unless told to use a branch.
   - Agents running on GitHub, and anyone running in parallel with another agent on
     the same machine, work on a branch named `<who>/<topic>` and open a PR against
     `main`. Keep the PR small and rebase it on `main` before asking for review.
   - Never commit on a detached HEAD. Never leave a branch unpushed at the end of
     a session.

6. **Commit messages** say what changed for the teacher or the code, in the style of
   `git log` (e.g. "Export explains itself instead of greying out"). Don't commit
   `test-results/`, `playwright-report/`, `build/`, `.svelte-kit/`, `.env*` or
   `.claude/settings.local.json`.

## Keep diffs reviewable

- **Don't reformat code you aren't changing.** No editor auto-format on save across a
  whole file, no tab→space conversion, no reordering imports "while you're there". The
  code uses **tabs**. Some files currently mix tabs and spaces from an earlier reformat;
  leave that alone. A single repo-wide formatting commit is planned. Until it
  lands, match the indentation of the lines around your change.
- **npm only.** `package-lock.json` is the lockfile. Never run `bun`, `yarn` or
  `pnpm` here, and never commit their lockfiles (they are gitignored). Change
  dependencies with `npm install <pkg>` and commit `package.json` and
  `package-lock.json` together, in a commit that does nothing else.
- A commit that touches `package-lock.json` without a matching `package.json` change
  is almost always an accident. Check before you commit it.

## Before you push: the checks

```bash
npm ci                 # if package-lock.json changed
npm run check          # svelte-check; must be 0 errors
npm test               # vitest: the domain invariants
npm run test:e2e       # Playwright; slow, see below
```

CI (`.github/workflows/ci.yml`) runs only `check` and `npm test`. The e2e suite is
yours to run locally. If CI on `main` is red, fix it or say why before you push more.

**Playwright:**
- The suite starts its own dev server on port **5178** (`playwright.config.ts`).
  It reuses one already running there, so a stale server on 5178 can make the tests
  run against old code.
- The preview suites (`preview.spec.ts`, `preview-image-proxy.spec.ts`) need the
  Flutter web build and **skip without it**. A green run without the player hasn't
  tested the preview. When you have changed anything in `src/lib/preview/`,
  `vite-plugin-player.ts`, `scripts/inject-player-shim.mjs` or `routes/preview-image`,
  run with the player and `REQUIRE_PLAYER=1` so a missing build fails loudly:
  ```bash
  PLAYER_BUILD=../EDU-AI-asistent-APP/build/web REQUIRE_PLAYER=1 npm run test:e2e
  ```
- `workers: 4` is deliberate: every page boots the Flutter/CanvasKit player. Don't
  raise it to "speed things up", because that makes the suite flaky.
- The full suite takes several minutes. Run it in the background and wait for it to
  exit. Don't poll it with fixed sleeps.
- Wait for `html[data-hydrated="true"]` before interacting. Handlers are client-only
  and the SSR shell looks ready before it is.
- Tests find elements by their Czech accessible names (`getByRole('button', { name:
  'Stáhnout' })`). **When you change any visible label, `aria-label` or dialog title,
  grep `e2e/` for the old text and update it in the same commit.**
- The player draws to a canvas, so there's no DOM to assert inside the iframe. Preview
  tests assert the postMessage contract instead.

## Code conventions that are tested, not just preferred

- `src/lib/domain/` is headless: no Svelte, no UI imports. Invariants are tested there
  as properties. Put logic there, not in components.
- Which fields each mode (Učitel ⊂ Metodik ⊂ Pokročilý) shows is declared once, in
  `src/lib/ui/fields.ts`. `fields.test.ts` fails on a key with no mode and no reason.
- Validation messages are Czech and written as consequences for the student.
  `validate.test.ts` enforces this.
- Round trip: parsing never injects defaults, and unknown keys survive export. Don't
  "normalise" documents.
- Teachers never see ids in teacher mode (`editor.spec.ts` asserts it).
- The preview protocol: both sides exchange **JSON strings**, posted to
  `window.location.origin`, never `*`. When you add a message type, update the union
  **and** every `switch` that handles it, on both the editor and player side.
- `{#each}` keys must be unique even when the document is broken (duplicate ids are a
  thing validation reports, not a thing the UI may crash on). Use `ui/keys.ts`
  (`uniqueKeys`). Derived state must tolerate teardown (no unguarded property access
  after unmount).
- A field nothing downstream reads carries `unread: true` in `fields.ts`, never in
  teacher mode; `fields.test.ts` checks it against the ✅/⚪ markers in
  `docs/spec/COURSE-EDITOR-SPEC.md`. When the app starts reading a key, update the spec
  and the test tells you which flag to drop.
- No chip or dot computes its own warning. Warnings come from `validate()` and get a
  timing in `ui/issue-visibility.ts`; a new card of any type shows none before it is
  left (`issue-visibility.test.ts`).
- State a component must not forget on remount (folding, anything a drag touches)
  lives in a keyed store (`state/step-view.svelte.ts`), not in component `$state`.
- The preview's layout may not depend on focus or on click targets. Player changes run
  `test/preview/preview_fidelity_test.dart` in the fork; a new player message gets a
  "sent when" line in the fork's `lib/preview/README.md`.

## Writing things down

Record every UX or architecture decision in `docs/DECISIONS.md` under the current
round, including what was rejected and why. Record every defect you find and don't fix
in `docs/OPEN-PROBLEMS.md`, with whether it was reproduced. The rule from the project
owner: **work in progress is fine, burying problems is not.** A summary that says
"done" while a known issue is unrecorded is wrong.

## Things that cannot be done from here

- Changing the player's behaviour. That's a commit to the fork plus a `PLAYER_REF`
  bump, and it's a human's call. Anything that must reach `edu-ai-00` is a PR a human
  opens.
- Publishing a course (`POST /api/courses/upload`). Auth is unresolved; see
  `docs/DECISIONS.md` → "Still open".
- The GPF dimension count. It comes from the course's skill configuration or the
  shipped taxonomy in `src/lib/gpf/`, never a hard-coded number.
