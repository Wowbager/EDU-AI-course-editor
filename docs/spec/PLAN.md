# EDU-AI Course Editor — implementation brief

You are building a **standalone web editor** whose only output is a `CourseV2` JSON document that the
existing EDU-AI app already knows how to play. The app, the API and the admin exist and work. Nothing
in them changes except one small, additive companion PR described in §6.

Read §0 before writing any code. Do not infer the data format from this brief — this brief is a plan,
`COURSE-AUTHORING-SPEC.md` is the truth.

---

## 0. Where the context lives

Read these, in this order, before milestone 1.

| Source | What you get from it | Priority |
|---|---|---|
| `COURSE-AUTHORING-SPEC.md` (provided with this brief) | **The authoritative format.** Every field, its didactic meaning, its runtime effect. §14 is your validation spec, §15 is your functional spec, §16 is a complete valid document you can use as a fixture. | Must read in full |
| `github.com/edu-ai-00/EDU-AI-asistent-APP` → `lib/models/course_model.dart`, `lib/models/block_model.dart`, `lib/models/step_navigation.dart` | The **parser the app actually runs**. Where this and the spec disagree about accepted shapes, match the app and raise the discrepancy. | Must read |
| Same repo → `lib/widgets/block_step_engine.dart`, `lib/widgets/step_content_renderer.dart`, `lib/widgets/markdown_latex_widget.dart` | The renderer you will embed rather than reimplement. `BlockStepEngine` takes a `ContentBlock` + `ExportMode` + callbacks and owns no persistence — that is what makes the preview possible. | Must read |
| Same repo → `lib/routing/app_router.dart`, `Dockerfile`, `nginx.conf`, `web/index.html` | How the Flutter web build is routed and served. You will add one route here (§6). | Must read |
| Same repo → `lib/core/theme/` and `docs/theme-guide.html`; also `https://app-admin.edu-ai.eu/docs/design-tokens.html` | Colour, type and radius tokens. Port them to CSS custom properties; do not invent new ones. | Must read |
| Figma `1iFxrymwGgRlX1cBlSJffh` → frames `main page v2 — editor kurzu` and `focus-reveal states` | Target layout and the core interaction pattern (values shown as text, fields appear on focus). `focus-reveal states` contains the written rules for that pattern. | Must read |
| `EDU-AI-asistent-API` (Laravel, separate repo) | `/api/courses`, `/api/courses/upload`, auth, and the **skill configuration** endpoint that supplies GPF dimension labels and count. | Must read before M7 |
| `EDU-AI-asistent-ADM` (Next.js, separate repo) | Existing auth/session pattern for admin-side tools. Reuse it; do not design a new one. | Read before M7 |

If a source above is unavailable to you, stop and ask. Do not proceed on a guessed format.

---

## 1. Scope

**Building:** a teacher-facing editor that produces valid `CourseV2` / `exercise_v2` / `quiz_v2`
documents, imports existing ones (including legacy shapes), validates per spec §14, previews using
the real app renderer, and publishes through the API.

**Not building:** any change to the student experience, a second content renderer, a gradebook, class
management, or anything in the app beyond the companion PR in §6.

**Two audiences, one document.** *Teacher mode* exposes roughly fifteen fields and writes sane
defaults for everything else. *Author mode* exposes the full surface (vectors, FSRS, adaptation,
prerequisites, ids). Same document, same validation, capability flag on the field components. A
document produced in teacher mode must never need repair in author mode.

---

## 2. Stack

**SvelteKit 2 + Svelte 5 (runes) + TypeScript + Vite.** This is a good fit here specifically because
the editor does not render course content: markdown, LaTeX, media and branching are all handled by the
embedded Flutter player, which removes the usual ecosystem argument for React. What is left is form
state, a tree, drag-reordering and a validation panel, all of which Svelte does with less ceremony.

- **CodeMirror 6** for markdown/LaTeX input (framework-agnostic, mount in an action).
- **svelte-dnd-action** for reordering lessons, cards and steps.
- **zod** for schema parse/serialise.
- **No component library.** Build primitives off the ported tokens; the design is custom anyway.
- Client-heavy SPA; SvelteKit only for routing, the dev server and a thin server layer for API proxying
  and auth cookies. `adapter-node` in Docker, to match how the app is deployed.

---

## 3. Invariants — encode these as tests, not as intentions

1. `course_id`, `lesson_id`, `block_id` and step `id` are **immutable after first publish**. The UI must
   make changing them impossible in teacher mode and loud in author mode.
2. Step ids are minted as `s{max+1}` and **never reused or renumbered**. Reordering rewrites `order` only.
3. Deleting a step or block must surface and repair every `go_to`, binding and prerequisite that points
   at it. Deletion without repair is a bug, not a warning.
4. Duplicating a block mints a fresh `block_id`, renumbers the copy's step ids, and drops `go_to` targets
   that pointed inside the original.
5. **Errors block export; warnings never do.** Spec §14 defines which is which. Do not promote or demote any.
6. `relation_vector` / `elo_vector` length and labels come from the course's skill configuration at
   runtime. **Never hardcode 35 or the dimension names.** The set is versioned per course, and subjects
   beyond mathematics are being added.
7. The editor reads legacy flat `content`/`image`/`video`/`question` on import, converts to `steps[]`,
   and **never writes them back**.
8. `version` auto-bumps on publish; `updated` is stamped on save; publish shows a diff against the last
   published version.
9. `go_to` is always chosen from a picker (keywords, steps in this block, blocks in this course). There
   is no free-text path.
10. Every question type's structural requirements (spec §14.1) are enforced at edit time, not at export time.

---

## 4. Architecture

**One document, one index.** A `CourseDoc` store holds the parsed document plus derived maps
(`blocksById`, `lessonsById`, `stepsByBlock`, reverse reference index for `go_to` / bindings /
prerequisites). The reverse index is what makes delete-safety and the validation panel cheap.

**Mutations are commands, not direct writes.** Every change goes through a command
(`addBlock`, `duplicateBlock`, `deleteStep`, `reorderBindings`, `setField`, …) that produces a patch,
appends to an undo log, and re-runs validation for the touched refs. This is the only way the
invariants in §3 stay true under a year of feature additions.

**`Ref` is the universal address.** `{ lessonId?, blockId, stepId?, optionId?, field? }`. It is used by
selection, validation results, preview click-to-edit, deep links into the editor, and the "jump to fix"
action. Implement it once, in the domain layer, with `refToJsonPath` and `jsonPathToRef`.

**Validation is a pure function** `validate(doc, skillConfig) → { errors: Issue[], warnings: Issue[] }`
where `Issue = { code, ref, message }`. Message text is Czech and written in student consequences
("žák se nedozví, kde udělal chybu"), not field names. No UI in this module.

**Layout** (desktop only, target 1440, degrade to 1280):
sidebar 260 (collapsible to a 56 rail) · editor column flexible · preview column 400 fixed.
Card settings live inline under the selected card, not in a separate column. Validation lives behind
the topbar chip.

**Preview** is an iframe running the Flutter web build at `/player/preview`, booted once and kept warm.
Contract:

- editor → player: `setBlock {block, exportMode, stepId?}`, `setLesson {course, lessonId}`,
  `highlight {ref}`, `reset`
- player → editor: `ready`, `stepChanged {stepId}`, `clicked {ref}`, `completed {xp, scoreKoef, mark}`

Updates are debounced ~250ms. **Never reload the iframe to refresh content** — a reload costs seconds of
Flutter boot and destroys the live feel. Re-mount the engine only when the step graph changes (ids added
or removed), and restore to the nearest surviving step.

---

## 5. Milestones

Each milestone ends with tests passing and a short written summary of decisions taken.

**M1 — Domain.** Types, zod schema, ids, `Ref`, validation engine. Headless. Fixture: spec §16 must
round-trip byte-stable through parse → serialise. Add a broken variant of it that produces exactly the
expected error and warning codes.

**M2 — Document store + commands.** Undo/redo, the reverse reference index, delete-safety and duplicate
semantics. Property tests: after any sequence of add/duplicate/delete/reorder, no dangling `go_to`, no
duplicate ids, no renumbered step ids.

**M3 — Shell.** Tokens as CSS custom properties, primitives (chip, segmented control, toggle, card),
three-column layout, sidebar tree, collapsed/expanded card list. Matches the Figma frame.

**M4 — Card editors.** Display / question / exercise. The answer table in the `focus-reveal` pattern:
values as text, fields on focus, one row per option with outcome verb, mark and feedback. `go_to` picker.
Block type is chosen by which card the teacher adds, never as a raw field.

**M5 — Preview.** Requires §6 landed. Both sides of the postMessage contract, click-to-edit in both
directions, the three preview states (*Jak to vidí žák* / *Vyzkoušet* / *Celá hodina*), export-mode
switch, and markers for content that exists but is not currently rendered (hints, unshown feedback,
branches). Broken drafts must render a placeholder card, never crash the player.

**M6 — Didactics.** RVP outcome picker as the front door: teacher picks an outcome, editor writes
`competencies`, `concepts`, `relation_vector` and a starting `elo_vector`. The mapping table is data,
loaded from the API or a versioned JSON — ask before inventing it. Difficulty as three words, not numbers.
Practice toggle. Author-mode panels for vectors, FSRS, prerequisites, adaptation.

**M7 — Import / export / publish.** Import `course_v2`, `exercise_v2`, `quiz_v2`, single `block_v2`,
legacy flat blocks, legacy `lesson.block_ids`, V1 `course`/`lecture`. Export one JSON document. Publish
with auto version bump, `updated` stamp, and a diff. Publish is blocked by errors only.

**M8 — Validation UX + polish.** Validation panel wired to refs with jump-to-fix, computed XP and
duration shown live at card/lesson/course level, partial `duration` coverage warning, Bloom and
question-type mix summary per lesson.

---

## 6. Companion PR in the app repo

Small and additive. Ship it before M5.

1. New route in `lib/routing/app_router.dart`: `/preview`, outside `AuthWrapper`, rendering a bare
   scaffold that hosts `BlockStepEngine` (single block) or the lesson scaffold (full lesson) from JSON
   handed in over JS interop.
2. A `previewMode` flag threaded into the engine and `step_content_renderer.dart` that
   (a) wraps rendered leaves in a hit-target reporting a `Ref`, (b) draws a hover outline,
   (c) **hard-disables** persistence, XP, FSRS enrolment, API calls and analytics. Check the flag at the
   lowest level, not at call sites.
3. A JS channel implementing the message contract in §4.
4. Serve the web build under `/player/` on the editor's origin (nginx), so the iframe is same-origin.

Acceptance: opening `/player/preview` directly and posting a block from the browser console renders it,
answers work, and nothing is written to Drift or the API.

---

## 7. Testing

- **vitest** for the domain layer. This is where the invariants live; aim for real coverage here and
  treat UI tests as secondary.
- **Golden round-trips.** A corpus of real course documents: import → no-op edit → export must equal
  input, modulo `updated`. Collect the corpus before M7, not after.
- **Playwright** for four flows: create a lesson from scratch, fix a validation error via jump-to-fix,
  click an element in preview and land on the right field, publish a course with warnings present.
- Manual gate before shipping: a teacher who has never seen the tool builds a working lesson in under
  ten minutes with no explanation. Count every question they ask; each control asked about twice gets
  renamed or moved to author mode.

---

## 8. Do not

- Reimplement markdown, LaTeX or branching rendering in Svelte. The preview is the real player or it is
  a liar.
- Hardcode the GPF dimension count or labels.
- Write legacy flat block fields.
- Let a warning block publish, or an error pass it.
- Show `block_id`, `lesson_id` or step ids in teacher mode.
- Add fields that are not in `COURSE-AUTHORING-SPEC.md`. If something seems missing, raise it.

---

## 9. Ask before guessing

1. API base URL, auth scheme, and the exact shape of `/api/courses/upload`.
2. The skill-configuration endpoint: dimension labels, count, and how it is versioned per course.
3. Where the RVP → GPF mapping table comes from, and who maintains it.
4. Whether the editor and the Flutter player share an origin in production (decides iframe messaging).
5. Whether teacher mode and author mode are role-driven from the API or a local setting.