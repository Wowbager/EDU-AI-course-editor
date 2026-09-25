# EDU-AI Course Editor — Authoring Specification

**What this document is:** a complete inventory of everything a course editor for the EDU-AI
platform must be able to edit, what each field means, and — for every field — what actually
happens in the student app because of it.

**How it was produced:** by reading the three parts of the system as they stand today
(cloned 2026-09-10):

| Repo | Role | Key files used as evidence |
|---|---|---|
| `EDU-AI-asistent-ADM` | Next.js authoring admin (the current editor) | `src/types/block-v2.ts`, `src/lib/defaults.ts`, `src/components/editors/**`, `docs/flutter-block-v2-spec.md` |
| `EDU-AI-asistent-API` | Laravel backend, storage + access control | `app/Http/Controllers/Api/CourseController.php`, `app/Services/CourseStorageService.php`, `app/Services/EloEngine.php`, `database/migrations/**` |
| `EDU-AI-asistent-APP` | Flutter student app — **the final practice** | `lib/models/course_model.dart`, `lib/models/block_model.dart`, `lib/widgets/block_step_engine.dart`, `lib/widgets/step_content_renderer.dart`, `lib/pages/lesson_detail_page.dart`, `lib/pages/quiz_page.dart`, `lib/core/practice/**`, `lib/core/elo/**`, `lib/core/gamification/**` |

Where this document disagrees with `ADM/docs/flutter-block-v2-spec.md`, **this document is
what the code does** — the older spec describes intent that was partly implemented
differently. Every such divergence is called out explicitly in §13.

### Status marks used throughout

| Mark | Meaning |
|---|---|
| ✅ **Live** | The Flutter app reads it and student-visible behaviour changes. |
| 🟡 **Server** | Only the API reads it (listing, access control, search). Invisible inside the lesson player, but still real. |
| ⚪ **Inert** | Accepted, stored, round-tripped — but **no code anywhere reads it today**. The editor should keep it (forward-compatible, and it is didactic documentation), but the UI must not promise the author an effect. |

---

## 1. The pipeline an authored course travels through

```
  EDITOR                      API (Laravel)                  APP (Flutter)
  ──────                      ─────────────                  ─────────────
  CourseV2 JSON  ──POST──▶  /api/courses            ┌──▶ GET /api/courses (listing)
  (one document)            /api/courses/upload     │     → DB columns only
                                   │                │
                                   ├── full JSON ──▶ R2 object storage
                                   │   courses/{course_id}/v{version}.json
                                   │                │
                                   └── extracted ──▶ DB columns (name, pin,
                                       metadata          only_quiz, only_once,
                                                          logged_only, emoji, …)
                                                    │
                                        GET /api/courses/{id}/download
                                        (signed URL, 60 min) ──────────▶ Drift local DB
                                                                          │
                                                                          ▼
                                                          Lesson player / Quiz / Cvičení
```

Two consequences that shape editor design:

1. **The JSON is the product.** The app keeps the whole decoded document (`Course._rawData`,
   `APP/lib/models/course_model.dart`) and reads most things straight out of it. Unknown
   fields survive a round trip untouched — they simply do nothing.
2. **Some fields are read twice, in two places, with different rules.** `pin`, `only_quiz`,
   `only_once`, `logged_only`, `quiz_evaluate`, `emoji`, `description`, `author` are copied
   from the JSON into denormalized SQL columns by
   `API/app/Services/CourseStorageService.php::extractMetadata()`. The course *listing* uses
   the columns; the *player* uses the JSON. An editor that writes only one of the two views
   produces a course that looks wrong in the library but plays correctly, or vice versa.
   Always write the flag into the JSON — the API derives the column from it.

### Object tree

```
CourseV2                                (export_type: course_v2 | exercise_v2 | quiz_v2)
├── course-level metadata & flags       §3
├── lessons: LessonV2[]                 §4
│   └── blocks: LessonBlockBinding[]    §5   (references, by block_id, + per-lesson overrides)
└── blocks: BlockV2[]                   §6   (flat pool of every block definition)
    ├── identification / didactics      §6.1–6.4
    └── steps: BlockStep[]              §7   (the ordered content the student actually sees)
        └── question: QuestionConfig    §8
            └── options: QuestionOption[]  §8.2  (each carries feedback, score, go_to)
```

A block lives once in `blocks[]` and is *referenced* from lessons. The same block may be
referenced from several lessons; the app de-duplicates by `block_id`
(`Course.getDefaultPracticeBlocks`, `seen` set). Blocks that exist in `blocks[]` but are
referenced by no lesson are reachable only via a cross-block `go_to` — and are still picked
up by the practice queue if flagged (§11).

---

## 2. What "the final practice" means — the four surfaces content lands in

An editor decision does not have one effect; it has up to four, depending on where the
content is consumed. Keep these four in mind for every field.

| Surface | Where in the app | Driven by |
|---|---|---|
| **Lesson player** | `lesson_detail_page.dart` + `block_step_engine.dart` | `lessons[]` → bindings → blocks → steps |
| **Quiz / test** | `quiz_page.dart`, forced `ExportMode.quizV2` | question-type blocks; `only_quiz`, `starts_with_quiz`, `quiz_evaluate` |
| **Cvičení (spaced repetition)** | `practice_page.dart`, `core/practice/**` | `default_practice` flags + bookmarks + FSRS |
| **Adaptive profile (ELO / skills)** | `core/elo/elo_engine.dart`, API `EloEngine.php` | `gpf.relation_vector`, `gpf.elo_vector` |

### Export mode

`export_type` on the course selects the rendering mode
(`lesson_detail_page.dart:132-142`):

| `export_type` | `ExportMode` | Behaviour |
|---|---|---|
| `course_v2` | `courseV2` | Everything on: hints, help, solutions, per-option feedback, `go_to` branching. |
| `exercise_v2` | `exerciseV2` | Hints/solutions still shown, but **`go_to` is ignored entirely** — every answer advances linearly (`GoToResolver.resolve`, first branch). |
| `quiz_v2` | `quizV2` | Test mode. Only the hint button survives in the action row (`block_step_engine.dart:1052`, `:1100`); bookmark / like / dislike are hidden. Combined with `quiz_evaluate: false` it also suppresses correct/incorrect marking and solutions (`hideEvaluation`, `lesson_detail_page.dart:1808`). |

Note the separate axis: **`ExportMode.exerciseV2` is a property of the whole course**, while
**`BlockType.exercise` is a property of one block** and *also* disables `go_to` for that block
alone. Two different mechanisms, same consequence. The editor must make this non-confusing.

---

## 3. Course level

Edited today in `ADM/src/components/editors/CourseV2Editor.tsx`. Type: `CourseV2` in
`ADM/src/types/block-v2.ts`.

### 3.1 Identity and versioning

| Field | Type | Status | Meaning | Effect on the final practice |
|---|---|---|---|---|
| `export_type` | `"course_v2" \| "exercise_v2" \| "quiz_v2"` | ✅ | Package kind. | Selects the rendering mode — see §2. **Required**; the API rejects anything else (`CourseController@store`, rule `in:course_v2,exercise_v2,quiz_v2`). |
| `course_id` | string | ✅🟡 | Stable business key. | Part of the R2 path `courses/{course_id}/v{version}.json`. **Unique across the platform** (`unique:courses` on store). Changing it creates a new course, not a new version. |
| `version` | int ≥ 1 | ✅🟡 | Content version. | Two effects: (a) it is in the R2 file path, so bumping it writes a *new* object rather than overwriting; (b) the app compares versions to decide whether to re-download (`course_repository.dart:494-499`). **An editor that saves without bumping `version` will not reach students who already downloaded the course.** This is the single most common authoring foot-gun. Conversely, a pending update **locks every lesson** behind an update banner until the student downloads it (`course_detail_page.dart:997-1003`, `_hasUpdate`) — so bumping the version mid-term interrupts students. |
| `name` | string, ≤255 | ✅🟡 | Course title. | Course card and player header. Required by the API. |
| `description` | string, ≤500 | ✅🟡 | Short blurb. | Course card subtitle in the library; also copied into the DB column so it shows for courses the student has *not* downloaded yet. |
| `language` | string, ≤10 | ✅🟡 | BCP-ish language tag (`cs`, `en`). | Library language filter (`?language=` on the listing). Does **not** switch UI strings. |
| `author` | string | 🟡 | Author/organisation name. | Shown in listings. |
| `updated` | ISO timestamp | 🟡 | Last edit. | Display only; the API keeps its own `updated_at`. The editor should set it on every save. |
| `status` | `draft \| private \| locked \| approved \| published` | 🟡 | Publication state. | **Only `published` is visible to students.** `Course::scopePublished()` is `where('status','published')`, applied to every non-admin/non-teacher request (`CourseController@index`, `@checkUpdates`). `draft`, `private`, `locked`, `approved` are all equally invisible to a student — they differ only as editorial workflow labels. The editor must make "this is not yet live" unmistakable. |
| `emoji` | string | ✅🟡 | Course icon. | Rendered as the course tile icon (`course_model.dart:1026`, `knihovna_page.dart:669`), default `📖`. **Missing from the `CourseV2` TypeScript type — the current editor cannot set it**, so the API falls back to a keyword heuristic (`CourseStorageService::detectEmoji`, e.g. "zlomk" → ➗). A new editor should expose it. |
| `estimated_minutes` | int | 🟡 | Course length for the listing. | If absent the API computes `lesson_count × 15` (`CourseStorageService::extractMetadata`). Also missing from the TS type; worth exposing. |
| `header_image` | `{url, alt?}` | ✅ | Course cover. | Course detail header. `alt` is stored but the Flutter side currently renders the image only. |

### 3.2 Access control

| Field | Type | Status | Meaning | Effect on the final practice |
|---|---|---|---|---|
| `pin` | string, 6 alphanumeric | ✅🟡 | Access code. | The editor upper-cases and strips non-`[A-Z0-9]` (`CourseV2Editor.tsx:310-317`); the API upper-cases again on ingest. A student entering the PIN resolves the course through `GET /api/code/{code}` / `GET /api/courses/pin/{pin}` and is enrolled. The endpoint is rate-limited against brute force. Also matched against locally bundled courses (`course_local_datasource.dart:46-54`). |
| `logged_only` | bool | ✅🟡 | Requires a real account. | Guests are blocked at three separate gates: the PIN/auth path (`auth_page.dart:270-275`), the library open path (`knihovna_page.dart:172-177, 346-351`), and server-side in `CourseController@show`. The library also shows a badge (`knihovna_page.dart:733`). Effect: a guest can see the course exists but cannot start it. |
| `only_once` | bool | ✅🟡 | One-shot course. | After completion the student cannot re-enter: the player returns to the dashboard instead of reopening (`lesson_detail_page.dart:717`), re-entry through PIN is refused (`auth_page.dart:382-383`), and the course is hidden from both the course list and the dashboard (`kurzy_page.dart:85-88`, `prehled_page.dart:283`). Use for diagnostics and one-time tests. **There is no "reset" in the app** — treat as irreversible for the student. |

### 3.3 Quiz behaviour

| Field | Type | Status | Meaning | Effect on the final practice |
|---|---|---|---|---|
| `only_quiz` | bool | ✅🟡 | The course *is* a quiz; no lessons. | Course appears under "Rychlé kvízy" rather than the normal course list (`kurzy_page.dart:159, 278`; `prehled_page.dart:380`). The quiz can be started immediately instead of requiring all lessons complete (`prehled_page.dart:315-316`). The API **forces `starts_with_quiz = true`** whenever `only_quiz` is set (`CourseStorageService.php:124`), and the editor mirrors this by disabling the `starts_with_quiz` toggle. |
| `starts_with_quiz` | bool | ✅🟡 | Course opens with a diagnostic quiz. | **Every lesson in the course is locked until the entry quiz is completed** (`course_detail_page.dart:64, 997-1003`): lesson cards show a padlock and are untappable, a "Start quiz" card is inserted above them, and the course's primary action button becomes the quiz (`:1172-1173`). Once the quiz is finished the lessons unlock. |
| `quiz_evaluate` | bool | ✅🟡 | Show correct/incorrect and score in quiz mode. | Drives `hideEvaluation` (`lesson_detail_page.dart:1808`): with `quiz_v2` and `quiz_evaluate: false` the student answers "blind" — no green/red, no solution, no per-option feedback. With it `true`, a quiz behaves like an evaluated test. This is the flag that turns a survey/diagnostic into a graded test. |

### 3.4 Gamification & integrity

| Field | Type | Status | Meaning | Effect on the final practice |
|---|---|---|---|---|
| `max_xp` | int, optional | ✅ | Hard XP ceiling for the whole course. | Applied first in `GamificationService.applyAllCaps` (`gamification_service.dart:54-74`): `remaining = max_xp − xp_already_earned_in_this_course`; when exhausted the block awards **0 XP** and the student sees no gain. Per-course XP earned is tracked in `progressData['xp_earned']` (`lesson_detail_page.dart:_awardBlockXp`). Empty = no limit. Use it to stop a long course from dominating the leaderboard. |
| `stop_gambling` | bool | ⚪ | Intended: detect rapid random click-through. | **Not implemented anywhere.** No occurrence in APP or API. Editable, exported, ignored. |
| `stop_notice` | string | ⚪ | Message shown on gambling detection; blank = system default. | Same — inert. Shown in the editor only when `stop_gambling` is on. |
| `ai_context` | string (long) | ⚪ | Didactic notes and common-mistake remedies handed to the AI tutor. | **Not consumed.** The chat system prompt (`API/docs/chat-ai-prompt.md`) currently gives the AI the student's name, level/XP and active courses — not the course's `ai_context`. Keep the field (it is valuable authoring documentation and the obvious next integration point), but label it as "not yet used by the tutor". |

---

## 4. Lesson level

Type `LessonV2`; edited in `ADM/src/components/editors/LessonV2Editor.tsx`.

| Field | Type | Status | Meaning | Effect on the final practice |
|---|---|---|---|---|
| `lesson_id` | string | ✅ | Stable key. | Progress is keyed by lesson id (`progressData['lessons'][lessonId]`). **Renaming a lesson_id orphans every student's progress for that lesson.** The editor must treat it as immutable after first publish, or offer an explicit, warned rename. |
| `name` | string | ✅ | Lesson title. | Lesson card title (`course_model.dart:980`, `title:`). Fallback is "Lekce N". |
| `description` | string | ✅ | One-liner. | Lesson card **subtitle**. |
| `order` | int | ✅ | Position. | Lessons render in array order; `order` is the authored intent and what the editor sorts on. Keep array order and `order` in sync on every reorder — the app trusts array order for lessons, and `order` for block bindings (§5). |
| `version` | int | ⚪ | Per-lesson version. | Not read by anything; only the course `version` matters. |
| `header_image` | `{url, alt?}` | ⚪ | Lesson cover. | Present in the fixtures and the type, but only the **course-level** `header_image` is parsed (`course_model.dart:1009-1012`). No lesson header renders today. |
| `ai_context` | string | ⚪ | Per-lesson tutor notes. | Same status as the course-level one — inert. |
| `blocks` | `LessonBlockBinding[]` | ✅ | Ordered references into `blocks[]`. | §5. |

**Derived, not authored — but authored inputs decide it:**

* **Lesson duration.** Sum of the referenced blocks' `duration`, clamped to `1…120` minutes.
  If *no* block in the lesson carries a duration, it falls back to `blockCount × 4` clamped to
  `5…60` (`course_model.dart:940-960`, `totalCourseMinutes:630-672`). So leaving `duration`
  empty everywhere still produces a plausible number — but a *single* block with `"1 min"`
  among ten blocks without duration yields a 1-minute lesson. **Duration is all-or-nothing per
  lesson; the editor should warn on partial coverage.**
* **Lesson XP reward** shown on the card = sum over blocks of "max possible XP"
  (`_calculateBlockMaxXp`, `course_model.dart:1066-1092`): `+1` per non-question step, `+8` per
  question step; atomic blocks count `8` (question/exercise) or `1`. See §10.
* **Lesson emoji** is *not* authored — it is picked by lesson index from a fixed list
  (`course_model.dart:977`). Do not offer a lesson-emoji field; it would be a lie.

---

## 5. Lesson ↔ block binding

Type `LessonBlockBinding`. One entry per appearance of a block inside a lesson.

| Field | Type | Status | Meaning | Effect on the final practice |
|---|---|---|---|---|
| `block_id` | string | ✅ | Reference into `blocks[]`. | A binding whose `block_id` has no definition is **silently skipped** (`course_model.dart:743-744`, `if (blockJson == null) continue;`). The editor must validate referential integrity — this failure is invisible to the author and to the student. |
| `order` | int | ✅ | Position within the lesson. | Bindings are explicitly sorted by `order` before use (`course_model.dart:728-732`), unlike lessons. Duplicated `order` values give an unstable sequence. |
| `default_practice` | bool | ✅ (deprecated) | Legacy per-binding practice flag. | Still honoured — the app takes the OR of binding-level, block-level and step-level flags (§11). The type marks it deprecated in favour of `BlockV2.default_practice`. A new editor should read it for import but write the block-level flag. |
| `bg_image` | string | ⚪ | Card background image. | Not parsed at all by the Flutter binding model (`block_model.dart:1473-1476` parses only `block_id`, `order`, `bg_color`, `default_practice`). |
| `bg_color` | string (hex) | ⚪ | Card background colour. | Parsed into `LessonBlockBinding.bgColor` but never used by any widget. Inert today. |

An older lesson shape, `lesson.block_ids: string[]`, is still tolerated on the read path
(`course_model.dart:574-584`). New content should always use `blocks[]` bindings.

---

## 6. Block level

Type `BlockV2`. Edited across `BlockV2Editor.tsx` and `editors/block-v2/*`.

### 6.1 Identification

| Field | Type | Status | Meaning | Effect on the final practice |
|---|---|---|---|---|
| `export_type` | `"block_v2"` | ✅ | Discriminator. | Used by import type guards. |
| `block_id` | string | ✅ | Stable key, unique **within the course**. | Everything points at it: lesson bindings, `go_to` cross-block jumps, prerequisites, practice cards (one FSRS card per `(user, block_id)`), completed-block tracking, ELO interactions. **Changing it after publication resets that block's spaced-repetition card and completion state for every student.** |
| `type` | `display \| question \| exercise` | ✅ | Interaction model. | The most consequential single choice in the whole format — see §6.2. |
| `status` | `draft \| private \| locked \| approved \| published` | ⚪ | Per-block workflow state. | Nothing filters blocks by status; only the **course** status gates visibility. Purely an editorial label today. |
| `version`, `language`, `author`, `updated` | | ⚪ | Provenance. | Not read at runtime. Keep for editorial traceability. |
| `duration` | string, e.g. `"3 min"` | ✅ | Estimated time. | Parsed with `RegExp(r'(\d+)')` — the first integer in the string wins, unit text is ignored. Feeds lesson and course duration (§4). `duration_minutes: int` is also accepted as an alternative. Because parsing is "first number", `"1 h 30 min"` becomes **1 minute**. The editor should offer a numeric minutes input and serialise `"N min"`. |
| `xp` | int | ⚠️ **Inert** | Intended XP for the block. | **The app does not use it.** It is parsed (`block_model.dart:1180`, default `10`) and then never read; earned XP is computed from step composition (§10). Showing an author an "XP" box that does nothing is actively misleading — a new editor should either remove it or display the *computed* XP instead. |
| `default_practice` | bool | ✅ | Auto-enrol into the spaced-repetition queue. | §11. |
| `hint` | string (Markdown+LaTeX) | ✅ | Short block-level hint. | Shown from the `?` action button on any step of the block. Using it costs score — §12. |
| `help` | string (Markdown+LaTeX) | ✅ | Long block-level explanation. | Second-level help, costs more score than a hint — §12. |
| `steps` | `BlockStep[]` | ✅ | **The content.** | §7. |

**Legacy flat fields** — `content`, `image`, `video`, `question` directly on the block — are
still parsed by the app when `steps` is absent (`block_model.dart:1195-1245`), and the ADM has
a migration helper `migrateBlockToSteps()`. A new editor should read them on import, convert
to steps immediately, and never write them.

### 6.2 What `type` actually changes

| | `display` | `question` | `exercise` |
|---|---|---|---|
| Step types allowed by the editor | text, image, video, audio | + question | + question |
| `go_to` branching | n/a | **honoured** | **ignored** — always linear (`GoToResolver.resolve`, first branch) |
| Step advance model | one step at a time, student taps Next | **all steps rendered at once**; the active cursor jumps straight to the first question step, text/image steps are passive context (`block_step_engine.dart:250-273`) | same as `question` |
| Practice-queue flag lives on | **each step** (`step.default_practice`) | the block | the block |
| Hints editable at | block **and** step level | block **and** step level | **block level only** (the editor hides step-level hint/help for exercises, `StepEditor.tsx:101`) |

The "all steps at once, skip to the question" behaviour is the biggest surprise for authors:
in a `question` or `exercise` block, a text step placed *between* two questions is displayed
but is never a stop — the student is taken to the next question. If you need the student to
stop and read, that content belongs in a `display` block, or after the last question.

### 6.3 GPF — `gpf` object

The Global Proficiency Framework metadata. Two halves with very different weight: descriptive
labels (documentation) and the two 35-element vectors (a real, live adaptive mechanism).

| Field | Type | Status | Meaning | Effect |
|---|---|---|---|---|
| `domain` | string | ⚪ | e.g. "Number and operation". | Editorial classification. Not read at runtime. |
| `construct` | string | ⚪ | e.g. "N2 FRACTIONS". | Editorial. |
| `subconstruct` | string | ⚪ | e.g. "N2.3 Solve real-world problems…". | Editorial. |
| `grade` | int 1–10 \| null | ⚪ | Target school year. | Editorial. |
| `level` | 1–4 (below / partially / meets / exceeds) | ⚪ | Proficiency level targeted. | Parsed into `GpfMetadata.level` but unused. |
| `vector`, `kb_vector` | number[] | ⚪ | Taxonomy / knowledge-base vectors. | Not parsed by the app at all. |
| **`relation_vector`** | 35 × `0 \| 1 \| 2` | ✅ | Which GPF subconstructs this block exercises, and how strongly. | **Live.** See below. |
| **`elo_vector`** | 35 × float 1.0–10.0 | ✅ | This block's difficulty per subconstruct. | **Live.** See below. |

**How the two vectors are actually used** (`APP/lib/core/elo/elo_engine.dart`, mirrored in
`API/app/Services/EloEngine.php`):

* The 35 slots are fixed GPF subconstructs, grouped into 5 domains —
  N (indices 0–16), M (17–21), G (22–24), S (25–28), A (29–34)
  (`APP/lib/core/elo/gpf_structure.dart`). Human-readable labels come from the backend
  (`vector_dimensions` table), so the editor should fetch them rather than hard-code them —
  the existing `EloVectorsEditor` already accepts a `dimensions` prop for exactly this.
* On block completion, for each index `k`:
  **`relation_vector[k]` must be `> 1` (i.e. exactly `2`, "strong") and `elo_vector[k]` must be
  `> 0`, otherwise the index is skipped entirely** (`elo_engine.dart:118-123`).
  **A value of `1` ("weak") does nothing at all today.** The editor's three-state control is
  therefore honest about intent but not about effect — worth a tooltip.
* Student rating starts at `6.0` (`kDefaultStudentRating`). On first contact with a
  subconstruct the student's rating is *seeded*, not updated: correct → set to the task's
  difficulty `elo_vector[k]`; incorrect → set to `6.0`.
* Thereafter it is a bidirectional Elo update: the student's rating and the block's difficulty
  both move, with the item moving far more slowly (`kK0 = 1.0` vs `kK0Item = 0.01`).
* The score fed in is `0.0 / 0.5 / 0.75 / 1.0` — derived from correctness and hint usage (§12).
* **A block with no `relation_vector` or no `elo_vector` contributes nothing to the student's
  skill profile** (`lesson_detail_page.dart:388-395` returns early). If the platform's skill
  radar is meant to move, the vectors are mandatory, not optional.

Adjacent, and *not* part of the course JSON: `course_skill_configs` (a DB table — `vector_id`,
`formula_json`, `display_scale_min/max`, `confidence_c`, `min_count`) governs how those 35
numbers are aggregated into the skill display. It is edited on the admin course pages, not in
the course document. A new editor should link to it, not duplicate it.

### 6.4 Learning metadata — `learning` object

| Field | Type | Status | Meaning | Effect |
|---|---|---|---|---|
| `concepts` | string[] | ⚪ | Key concepts, e.g. `["Zlomky","Smíšená čísla"]`. | Editorial. |
| `competencies` | `{ "M.4.5.7": 50 }` | ⚪ | Curriculum-competency codes with weights. | Editorial; no consumer. |
| `bloom_level` | 1–6 | ⚪ | Bloom's taxonomy level. | Parsed as `gpf.blooms_level` shape only; unused. |
| `difficulty` | 1–5 | ⚪ | Author-assessed difficulty. | Not used for ordering or selection — the *live* difficulty signal is `gpf.elo_vector`. |
| `prerequisites` | `{block_id?, skill?, min_level, weight?}[]` | ⚪ | Readiness gates. | **Not enforced anywhere.** No gating in the app, no reference in the API. Additionally the Flutter model expects `prerequisites` as a list of *strings* under `gpf`, not objects under `learning` (`block_model.dart:500`) — so even the shape diverges. Nothing locks, skips or reorders a block today. |
| `d_data`, `l_data` | free-form objects | ⚪ | R&D / gamification signal buckets. | No consumer. Useful as an escape hatch for experiments. |

### 6.5 FSRS parameters — `fsrs` object

**This is the largest gap between the documented format and the running code, and it directly
affects practice.**

What the ADM type and editor write (`FSRSParameters`, `DEFAULT_FSRS`):
`initial_difficulty` (0.3), `initial_stability` (2.5), `initial_recall` (0.65),
`forgetting_rate` (0.25), `repetitions` (0), `weight` (1.0), `min_interval` (1),
`max_interval` (90), `skip_condition`, `time_limit_sec`.

What the app reads out of `block.fsrs` (`block_model.dart:543-553`, consumed in
`practice_repository.dart:106-127`): **`stability`, `difficulty`, `reps`, `lapses`,
`last_review`, `due_date`** — and nothing else.

| Authored key | Read by app? | Effect |
|---|---|---|
| `initial_difficulty` | ❌ | none — the app looks for `difficulty` |
| `initial_stability` | ❌ | none — the app looks for `stability` |
| `initial_recall` | ❌ | none |
| `forgetting_rate` | ❌ | none |
| `repetitions` | ❌ | none — the app looks for `reps` |
| `weight` | ❌ | none. Card weight is a **constant `5.0`** column default (`practice_cards_table.dart`), used for queue priority ordering. |
| `min_interval` | ❌ | none |
| `max_interval` | ❌ | none — the ceiling comes from the *student's* FSRS profile (`maximumInterval`), not the block |
| `skip_condition` | ❌ | column exists on `practice_cards`, never written from block JSON, never evaluated |
| `time_limit_sec` | ❌ | absent from the app entirely |
| `stability`, `difficulty`, `reps`, `lapses`, `last_review`, `due_date` | ✅ | seed values for a newly created practice card |

Scheduling itself is the standard FSRS algorithm driven by the **student's** profile
(`student_fsrs_profiles`: `desired_retention`, `learning_steps`, `relearning_steps`,
`maximum_interval`, `enable_fuzz`, `fsrs_weights`) — see `core/practice/fsrs_bridge.dart`.

**Editor implication.** Either (a) rename the fields the editor emits to the six keys the app
actually reads, and drop the rest; or (b) keep the didactic names but be explicit in the UI
that they are not yet wired. Do not ship a panel of eight sliders that change nothing — that is
the current state and it is the highest-value thing to fix.

### 6.6 `adaptation`

`{ scaffolded?: string, full?: string }` — condition expressions such as
`"avg_relevant_score < 3"`. ⚪ **Inert**: no occurrence in APP or API.

---

## 7. Steps — the unit the student actually sees

Type `BlockStep`. The ordered `steps[]` array is the primary content source; a block without
steps is a migration artefact.

| Field | Type | Status | Meaning | Effect |
|---|---|---|---|---|
| `id` | string, `"s1"`, `"s2"`… | ✅ | Stable within the block. | **`go_to` targets and per-step answer state are keyed by it.** The editor generates `s{max+1}` (`generateStepId`) so ids are never reused. Renumbering steps on reorder would break every `go_to` — the current editor deliberately keeps ids stable and only rewrites `order`. A new editor must preserve that invariant, and must rewrite `go_to` references when a step is deleted. |
| `type` | `text \| image \| video \| audio \| question` | ✅ | Renderer selection. | §7.1. |
| `order` | int, 1-based | ✅ | Position. | Should match array position; the engine iterates the array. |
| `content` | Markdown+LaTeX | ✅ | Text step body. | §7.1. |
| `image` / `video` / `audio` | objects | ✅ | Media payload. | §7.1. |
| `question` | `QuestionConfig` | ✅ | Interaction. | §8. |
| `hint` | Markdown | ✅ | Step-level short hint. | Shown from `?` on this step; takes precedence over the block hint. Costs score (§12). Hidden by the editor for `exercise` blocks. |
| `help` | Markdown | ✅ | Step-level detailed help. | Second level; costs more (§12). |
| `default_practice` | bool | ✅ | **Display blocks only.** | Any step flagged true promotes the *entire block* into the practice queue (`course_model.dart:_hasStepDefaultPractice`). It is not a per-step card — cards are per block. The editor should say so. |

### 7.1 Per-type rendering

**`text`** — `content` is Markdown + LaTeX, rendered by
`APP/lib/widgets/markdown_latex_widget.dart` / `step_content_renderer.dart`.
Supported: GFM (headings, bold, italic, lists, tables, code, links, images), inline `$…$` and
block `$$…$$` math, and raw HTML. Two behaviours an editor should surface:

* A `<video>` tag inside text content is **extracted and rendered as a real player**, with the
  surrounding text preserved in document order (`core/utils/content_embeds.dart`). Both
  `<video src="…">` and a nested `<source src="…">` work. This is the only supported inline
  embed — there is no YouTube/iframe handling.
* On **Flutter web**, every external image URL — in Markdown and in raw HTML `src=` — is
  rewritten through the API image proxy to dodge CORS (`core/utils/image_url.dart`,
  `GET /api/proxy-image?url=`). The proxy enforces a scheme allowlist, blocks private IPs, has
  a 10 MB cap and a 10 s timeout (`API/app/Http/Controllers/Api/ProxyImageController.php`).
  Practical rule for authors: **images must be public HTTPS URLs under 10 MB**, ideally
  uploaded through the admin asset manager (`POST /api/admin/assets/upload`).

**`image`** — `{url, alt?, position?}`. `position` is `above | below | inline`.
`alt` is authored for accessibility.

**`video`** — `{url, position?}`. **Direct MP4 URL, not a YouTube link.** Standard player with
play/pause/seek.

**`audio`** — `{url}`. MP3/WAV/OGG. Full-width player; **no `position`**.

**`question`** — §8.

---

## 8. Questions

### 8.1 `QuestionConfig`

| Field | Type | Status | Meaning | Effect on the final practice |
|---|---|---|---|---|
| `type` | `multiple_choice \| true_false \| open \| numeric` | ✅ | Input widget + grading rule. | §8.3. |
| `options` | `QuestionOption[]` | ✅ | Choices (MC and T/F). | §8.2. |
| `correct_answer` | string | ✅ | Expected answer for `open`. | Compared **case-insensitively and trimmed**; if no exact match, the app also accepts the text of any option marked `is_correct` (`block_step_engine.dart:520-529`). Matching is exact equality after normalisation — no fuzzy or substring matching — so the expected string must be exactly what you want students to type. |
| `correct_number` | number | ✅ | Expected value for `numeric`. | `isCorrect = |input − correct_number| <= tolerance`. |
| `tolerance` | number, default 0 | ✅ | Accepted ± band for `numeric`. | `0` means exact match. This is how you accept `0.33` for ⅓. |
| `allow_multiple` | bool, default false | ✅ | Multi-select. | Grading becomes **all-or-nothing set equality**: the selection must contain exactly the correct ids, no more, no fewer (`block_step_engine.dart:506-510`). There is no partial credit for multi-select. |
| `show_answers` | bool, default true | ✅ | Show the option list. | When `false`, options are not offered and the student's answer is not visually marked correct/incorrect (`step_content_renderer.dart:248-265`); the confirm button label switches from "Zkontrolovat" to "Další" (`block_step_engine.dart:1205-1206`). Use for reflective / survey questions. |
| `show_solution` | bool, default true | ✅ | Reveal the solution after answering. | `false` skips the solution state entirely and moves on (`block_step_engine.dart:288-290`). |
| `solution` | Markdown+LaTeX | ✅ | Worked explanation shown after answering. | Suppressed in `quiz_v2` + `quiz_evaluate:false`, and when `show_solution:false`. |
| `solution_image` | `{url, alt?, position?}` | ✅ | Image inside the solution. | Rendered with the solution. |
| `allow_photo` | bool | ⚪ | Intended: answer an open question with a photo. | **Not implemented in the app.** Inert. |

### 8.2 `QuestionOption`

| Field | Type | Status | Meaning | Effect |
|---|---|---|---|---|
| `id` | string | ✅ | Option key. | Referenced by answer state; must be unique in the question. The editor generates `opt_N`; True/False uses the fixed ids `true` / `false`. |
| `text` | Markdown+LaTeX | ✅ | Option label. | Rendered with full Markdown/LaTeX. |
| `is_correct` | bool | ✅ | Correctness. | Drives green/red marking, the FSRS grade, the ELO score and XP. |
| `feedback` | Markdown+LaTeX | ✅ | Shown after choosing **this** option. | The main tool for addressing a specific misconception. Hidden in blind quiz mode. |
| `feedback_image` | `{url, alt?}` | ✅ | Image in that feedback. | |
| `score_koef` | number 0–1, default 1.0 | ✅ | Partial credit for this option. | **Only survives if the option is also `is_correct`** — the engine computes `effectiveScoreKoef = isCorrect ? score_koef : 0.0` (`block_step_engine.dart:555`). So `is_correct:false, score_koef:0.5` scores **0**, not 0.5. To grant partial credit you must mark the option correct and lower its coefficient. This is the single most misunderstood field in the format; the editor should enforce or at least warn on the combination. Consequences: it becomes `bestScoreKoef` for the block, which feeds the ELO score (§12) and the XP tier (§10, `>= 1.0` → 8 XP, else 5). |
| `mark` | string `"1"`–`"5"` | ✅ (captured) | Czech school grade for quiz mode. | Captured into `StepProgressData.quizMark` and surfaced through `onBlockCompleted(mark:)`. Note the submitted quiz attempt records `score_percent` (0–100), not the mark (`API/QuizAttemptController`), so `mark` is currently a display/collection value rather than the graded result. |
| `go_to` | string | ✅ | Branch target. | §9. |

### 8.3 Grading per question type

| Type | Widget | Correct when |
|---|---|---|
| `multiple_choice` | radio (or checkboxes if `allow_multiple`) | selected option `is_correct`; for multi-select, exact set equality |
| `true_false` | two buttons, ids `true`/`false` | as MC with exactly two options |
| `open` | text field | `input.trim().toLowerCase() == correct_answer.trim().toLowerCase()`, or matches a correct option's text |
| `numeric` | numeric keyboard | `|input − correct_number| <= tolerance` |

---

## 9. Navigation — `go_to`

`go_to` sits on **each option**, so branching is per-answer. Resolution:
`APP/lib/models/step_navigation.dart::GoToResolver.resolve`.

| Value | Action |
|---|---|
| absent / `null` / `""` / `"NEXT_STEP"` | advance to the next step in order; past the last step → complete the block |
| `"AGAIN"` | re-show the same step for a retry. The wrong pick stays on screen marked incorrect, the correct answer is **not** revealed, and a retry button is enabled (`block_step_engine.dart:192-193`, `_isAgainRetry`) |
| `"END"` | complete the block immediately |
| `"CHAT"` or `"LECTURE"` | **open the AI chat with the block as context.** Supported by the app, **absent from the current editor's `go_to` picker** (`QuestionStepEditor.tsx:88-108`). A new editor should offer it. |
| a step id in this block (`"s3"`) | jump to that step |
| anything else | treated as a **cross-block jump** — load that block from its first step |

Two rules that matter more than they look:

* **Unknown targets do not fail loudly.** Any unrecognised string becomes a cross-block jump
  attempt; if no such block exists the student can land nowhere useful. The editor's validator
  currently only flags strings matching `/^s\d+$/` that don't resolve
  (`defaults.ts::validateBlockForExport`). **A new editor should validate every non-keyword
  `go_to` against the union of {step ids in this block} ∪ {block ids in the course} and refuse
  to export dangling references.**
* **`go_to` is ignored in `exercise` blocks and in `exercise_v2` courses.** Authoring a
  branching tree inside an exercise block silently produces linear behaviour. The editor should
  hide or disable the `go_to` column for `exercise` blocks (it already gates it with
  `showGoTo = blockType === "question"`) and warn on import when branches exist there.

---

## 10. XP — what students actually earn

**`block.xp` is not used.** Earned XP is computed from the block's step composition when the
block completes (`block_step_engine.dart:742-756`, mirrored by
`GamificationService.calculateBlockRawXp`):

```
rawXp = Σ over steps:
          non-question step                      → +1
          question step answered with score ≥ 1.0 → +8
          question step, anything else            → +5
```

Then two caps, in order (`GamificationService.applyAllCaps`):

1. **Course hard cap** — `remaining = max_xp − xp_earned_in_this_course`; if `≤ 0`, the block
   awards nothing.
2. **Daily soft cap** — the first **100 XP** of the day at 100 %, everything beyond at **20 %**
   (`dailySoftCapThreshold = 100`, `dailySoftCapRate = 0.20`). Levels are `xpPerLevel = 500`.

**Editing consequences.** XP is a function of *how many steps you write and how many of them
are questions*, not of any number the author types. Splitting one long text step into four
short ones quadruples that block's display XP. A new editor should show the **computed** XP for
each block and lesson live (the same formula the lesson card uses), and should treat `block.xp`
as read-only legacy — or remove it.

---

## 11. Cvičení — the spaced-repetition queue

### What puts a block into the queue

A block enters the practice pool if **any** of these is true
(`Course.getDefaultPracticeBlocks`, `course_model.dart:698-771`):

1. its lesson binding has `default_practice: true` (legacy), **or**
2. the block itself has `default_practice: true`, **or**
3. **any step** of the block has `default_practice: true` (the display-block route), **or**
4. the student bookmarks it manually, **or**
5. the student answers it wrong — exercise blocks are **auto-bookmarked on a wrong answer**
   (`quiz_page.dart:570-582`, `block_step_engine.dart:573-574`).

Blocks flagged in the JSON but not referenced by any lesson are still included (the
"unassigned blocks" pass).

Two filters then apply on the lesson-completion path: only blocks the student has **completed**
are shown (so Cvičení never spoils unseen content), minus blocks the student explicitly
un-bookmarked. The login/seed path deliberately skips the completion filter so a student who
signs in gets the full authored set (`PracticeRepository.seedCardsFromCourse`, regression
BR-WR4C8P).

### How a queue is built each day

`core/practice/queue_builder.dart`:

1. partition active cards into **overdue** (`state > 0` and `due ≤ now`) and **new**
   (`state == 0`); not-yet-due cards are excluded;
2. sort overdue by `weight` desc, then `dueDate` asc; sort new by `weight` desc, take up to the
   daily new limit;
3. overdue first, then new;
4. **diversify** — round-robin interleave by `courseId` within each weight bucket so one course
   never dominates;
5. cap at `dailyReviewLimit − todayReviewCount`.

`weight` is the queue's priority knob — and it is currently a **constant 5.0** for every card
(`practice_cards_table.dart`). Nothing in the course JSON can raise or lower a block's practice
priority today. If per-block priority is wanted, wiring `fsrs.weight` → `practice_cards.weight`
is the change to make, and the editor field already exists.

### How a review is graded

`GradeCalculator.gradeExercise` → FSRS rating 1–4:

| Rating | Condition |
|---|---|
| 1 — Again | wrong answer |
| 2 — Hard | correct, but hint **or** help was used |
| 3 — Good | correct, no help, response time **>** `avgTimeSec` |
| 4 — Easy | correct, no help, response time **≤** `avgTimeSec` |

`avgTimeSec` is a per-card column defaulting to **20 s** — again not authorable today.
Display/content cards with no question use a self-rating instead (`quiz_page.dart:645`).

The rating goes into the FSRS scheduler configured by the **student's** profile, so the same
block reschedules differently for different students. Nothing in the block JSON changes the
interval.

---

## 12. Hints, help, and what they cost

| Level | Source | Cost |
|---|---|---|
| 0 | no help used | score kept as answered |
| 1 | `hint` opened (step-level first, block-level fallback) | ELO score **clamped to ≤ 0.75** |
| 2 | `help` opened | ELO score **clamped to ≤ 0.5** |

`lesson_detail_page.dart:306-313`, tracked in `_hintUsage` (`:1549`, `:1579`) and reported as
`hint_used` / `help_used` on the ELO interaction (`:472-473`). The same usage downgrades the
FSRS rating to **2 (Hard)** even for a correct answer.

**The clamp applies to the ELO/skill score, not to XP.** XP uses the raw `scoreKoef ≥ 1.0`
test, so a hint that clamps ELO to 0.75 also drops the step from 8 XP to 5 XP — because the
clamped value is what reaches `bestScoreKoef`. Authors should know that hints are not free:
a generous hint on every step permanently flattens the skill signal the platform collects.

In `quiz_v2`, the hint button is the **only** action button that survives; bookmark, like and
dislike are hidden.

---

## 13. Where the existing spec and the running code disagree

These are the traps a new editor should be built around. Every one is verified in code.

| `ADM/docs/flutter-block-v2-spec.md` says | Reality |
|---|---|
| "`block.xp` — experience points awarded when block is completed", `earned_xp = block.xp × best_score_koef` | `block.xp` is parsed and discarded. XP = `+1`/display step, `+8`/`+5` per question step, then course and daily caps. §10 |
| FSRS block params `initial_difficulty`, `initial_stability`, `weight`, `min_interval`, `max_interval`… | None are read. The app reads `stability`, `difficulty`, `reps`, `lapses`, `last_review`, `due_date`. §6.5 |
| "Prerequisites — use for adaptive ordering: skip blocks the student already mastered, or lock blocks they're not ready for" | Not implemented in APP or API; shapes also diverge. §6.4 |
| `relation_vector` "0=none, 1=weak, 2=strong" | Only `2` has any effect; `1` is skipped by the engine. §6.3 |
| `go_to` targets: NEXT_STEP / AGAIN / END / step id / block id | Also `CHAT` and `LECTURE` (open the AI tutor) — supported by the app, missing from the editor's picker. §9 |
| `option.score_koef` "partially correct might have score_koef: 0.3" | Ignored unless the option is also `is_correct` — otherwise forced to 0. §8.2 |
| `bg_image`, `bg_color` "visual overrides for the block card" | `bg_image` isn't parsed; `bg_color` is parsed and never used. §5 |
| Lesson `header_image` | Only the course-level header image is parsed. §4 |
| — (not in the spec) | `emoji` and `estimated_minutes` are real course-JSON fields the API and app both use, and the `CourseV2` type lacks them. §3.1 |
| — | `ai_context`, `stop_gambling`, `stop_notice`, `allow_photo`, `adaptation`, `d_data`, `l_data`, block `status`, `time_limit_sec`, `skip_condition` are all inert today. |

---

## 14. Validation the editor must enforce

Already implemented in `ADM/src/lib/defaults.ts` (`validateBlockForExport`,
`validateCourseForExport`) and worth keeping:

* display block → at least one `text` step with non-empty content;
* question/exercise block → at least one `question` step, each with a config;
* `open` → non-empty `correct_answer`;
* `multiple_choice` → ≥ 2 options, ≥ 1 correct, no empty option text;
* `true_false` → exactly 2 options, exactly 1 correct;
* `numeric` → `correct_number` present;
* `go_to` matching `/^s\d+$/` must resolve to a step in the same block.

Missing, and worth adding — each corresponds to a failure that is silent at runtime:

1. **Dangling block references** — every binding `block_id` must exist in `blocks[]`
   (silently skipped otherwise, §5).
2. **Dangling cross-block `go_to`** — validate against course block ids, not just `sN` shape (§9).
3. **`block_id` / `lesson_id` uniqueness** and immutability after publication (progress and
   practice cards are keyed by them, §4, §6.1).
4. **`score_koef` on an incorrect option** — warn: it will score 0 (§8.2).
5. **`go_to` set on an `exercise` block** — warn: it will be ignored (§9).
6. **Partial `duration` coverage in a lesson** — warn: the lesson time will be wrong (§4).
7. **`version` not bumped** since the last publish — block or loudly warn (§3.1).
8. **Vector length ≠ 35** (or ≠ the backend's dimension count) for `relation_vector` /
   `elo_vector`, and `elo_vector` values outside 1.0–10.0.
9. **`relation_vector` all-zero while `elo_vector` is set** — the block will never affect the
   skill profile (§6.3).
10. **Orphan blocks** — defined but referenced by no lesson and no `go_to`: dead weight unless
    intentionally practice-only.
11. **Media reachability** — `video` must be a direct MP4 (not a YouTube URL); images should be
    public HTTPS and < 10 MB for the web proxy (§7.1).

---

## 15. Functional requirements for the new editor

Beyond field-by-field editing, these are the capabilities the format and the runtime demand.

**Structure**
- Course → lesson → block-binding → block → step tree with drag-reorder at every level;
  reorder must rewrite `order` **without** renumbering step `id`s.
- Add / duplicate / delete at every level. Duplication must mint a fresh `block_id` and
  renumber the copy's step ids (as `duplicateBlockV2` does), and must **not** copy `go_to`
  targets that pointed inside the original.
- Move a block between lessons; reference one block from several lessons.
- Delete-safety: deleting a block or step must find and offer to fix every `go_to`, binding and
  prerequisite that points at it.

**Content**
- Markdown + LaTeX editor with live preview matching the app's renderer (KaTeX, GFM tables,
  raw HTML, `<video>` embeds).
- Asset picker wired to `POST /api/admin/assets/upload`, so authors stop pasting arbitrary URLs.
- Media preview inline (image, MP4, audio) — a broken URL should be visible at authoring time.

**Question authoring**
- All four question types with type-appropriate controls; automatic True/False option seeding.
- Per-option: text, correct flag, feedback (+image), `score_koef`, `mark`, `go_to`.
- A `go_to` picker listing: keywords (`NEXT_STEP`, `AGAIN`, `END`, **`CHAT`**), the steps of the
  current block, and every other block in the course.

**Flow**
- A branching visualiser for `question` blocks (the current `StepFlowVisualizer.tsx` is the
  seed) showing step→step and block→block edges, unreachable steps, and dangling targets.
- A course-level map of cross-block jumps.

**Adaptivity**
- 35-dimension `relation_vector` / `elo_vector` editor with **labels fetched from the backend**
  (`vector_dimensions` via the skill-config endpoints), not hard-coded — the existing editor
  already takes a `dimensions` prop.
- Visual warning when `relation_vector` uses `1`, which currently has no effect.

**Practice**
- One clear control for "this block is practised" that writes the block-level flag, reads the
  legacy binding- and step-level flags, and explains that a card is per **block**.

**Feedback to the author**
- Live computed XP per block / lesson / course (the real formula), not an `xp` input box.
- Live computed duration per lesson / course, flagging partial `duration` coverage.
- Validation panel (§14) blocking export on errors, warning on the rest.

**Lifecycle**
- Import: `course_v2` / `exercise_v2` / `quiz_v2`, legacy flat blocks (auto-migrate to steps),
  legacy `lesson.block_ids`, and V1 `course`/`lecture` exports.
- Export: a single JSON document; and publish via `POST /api/courses` (create) /
  `PUT /api/courses/{id}` (update) / `POST /api/courses/upload`.
- Version discipline: auto-bump `version`, stamp `updated`, and show what changed since the
  last published version.
- A preview that renders a block exactly as `block_step_engine` does, in each of the three
  export modes, so an author can see the quiz-mode stripping before students do.

---

## 16. Minimal valid course

```json
{
  "export_type": "course_v2",
  "course_id": "ZLOMKY5TR",
  "version": 1,
  "name": "Zlomky pro 5. třídu",
  "description": "Úvod do zlomků",
  "language": "cs",
  "author": "EduAI Team",
  "updated": "2026-09-10T08:00:00.000Z",
  "status": "published",
  "emoji": "➗",
  "pin": "A1B2C3",
  "lessons": [
    {
      "lesson_id": "L1_INTRO",
      "version": 1,
      "name": "Co je zlomek?",
      "description": "Čitatel a jmenovatel",
      "order": 1,
      "blocks": [
        { "block_id": "L1_B1_uvod",  "order": 1 },
        { "block_id": "L1_B3_poznej","order": 2 }
      ]
    }
  ],
  "blocks": [
    {
      "export_type": "block_v2",
      "block_id": "L1_B1_uvod",
      "version": 1, "language": "cs", "author": "EduAI Team",
      "updated": "2026-09-10T08:00:00.000Z", "status": "published",
      "type": "display", "duration": "2 min",
      "gpf": { "domain": "Number and operation", "construct": "N2 FRACTIONS",
               "subconstruct": "N2.1 Identify and represent fractions",
               "grade": 5, "level": 2 },
      "learning": { "concepts": ["Zlomky"], "competencies": {},
                    "bloom_level": 2, "difficulty": 2, "prerequisites": [] },
      "steps": [
        { "id": "s1", "type": "text", "order": 1,
          "content": "Zlomek $\\frac{a}{b}$ zapisuje část celku." }
      ]
    },
    {
      "export_type": "block_v2",
      "block_id": "L1_B3_poznej",
      "version": 1, "language": "cs", "author": "EduAI Team",
      "updated": "2026-09-10T08:00:00.000Z", "status": "published",
      "type": "question", "duration": "3 min",
      "default_practice": true,
      "gpf": {
        "domain": "Number and operation", "construct": "N2 FRACTIONS",
        "subconstruct": "N2.1 Identify and represent fractions",
        "grade": 5, "level": 2,
        "relation_vector": [0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        "elo_vector":      [5,5,4.5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5]
      },
      "learning": { "concepts": ["Čitatel","Jmenovatel"], "competencies": { "M.5.2.1": 60 },
                    "bloom_level": 2, "difficulty": 2, "prerequisites": [] },
      "hint": "Horní číslo = čitatel, dolní = jmenovatel.",
      "steps": [
        { "id": "s1", "type": "text", "order": 1,
          "content": "Podívej se na zlomek $\\frac{5}{7}$." },
        { "id": "s2", "type": "question", "order": 2,
          "hint": "Čitatel je nahoře.",
          "question": {
            "type": "multiple_choice",
            "show_answers": true,
            "show_solution": true,
            "solution": "Čitatel je **5**, jmenovatel **7**.",
            "options": [
              { "id": "a", "text": "Čitatel 5, jmenovatel 7", "is_correct": true,
                "score_koef": 1.0, "feedback": "Správně!", "go_to": "s4" },
              { "id": "b", "text": "Čitatel 7, jmenovatel 5", "is_correct": false,
                "feedback": "Popletl/a sis to.", "go_to": "s3" }
            ]
          } },
        { "id": "s3", "type": "text", "order": 3,
          "content": "### Připomenutí\nVe zlomku $\\frac{a}{b}$ je **a** čitatel." },
        { "id": "s4", "type": "text", "order": 4, "content": "Výborně!" }
      ]
    }
  ]
}
```

This course, played end to end, yields: 1 + (1 + 8 + 1 + 1) = **12 raw XP** (all steps of both
blocks, question answered correctly first try, no hints), one practice card for
`L1_B3_poznej`, and one ELO update at subconstruct index 2 against difficulty 4.5.

---

## 17. Field index — quick reference

| Path | Status | One-line effect |
|---|---|---|
| `export_type` | ✅ | course / exercise (no branching) / quiz (stripped) mode |
| `course_id` | ✅🟡 | storage key, unique, immutable |
| `version` | ✅🟡 | **must bump or students never get the update** |
| `name`, `description`, `author`, `language` | ✅🟡 | listing + header |
| `status` | 🟡 | only `published` reaches students |
| `emoji`, `estimated_minutes` | ✅🟡 | course tile icon and length (missing from the TS type) |
| `header_image` | ✅ | course cover |
| `pin` | ✅🟡 | 6-char access code |
| `logged_only` | ✅🟡 | blocks guests |
| `only_once` | ✅🟡 | no re-entry after completion, hidden from lists |
| `only_quiz` | ✅🟡 | quiz-only course; forces `starts_with_quiz` |
| `starts_with_quiz` | ✅🟡 | locks every lesson until the entry quiz is done |
| `quiz_evaluate` | ✅🟡 | quiz shows correct/incorrect + score |
| `max_xp` | ✅ | hard XP ceiling for the course |
| `ai_context`, `stop_gambling`, `stop_notice` | ⚪ | inert |
| `lessons[].lesson_id` | ✅ | progress key — immutable |
| `lessons[].name` / `.description` | ✅ | lesson card title / subtitle |
| `lessons[].order` | ✅ | display order |
| `lessons[].header_image`, `.ai_context`, `.version` | ⚪ | inert |
| `lessons[].blocks[].block_id` | ✅ | must resolve or the block silently vanishes |
| `lessons[].blocks[].order` | ✅ | sort key within the lesson |
| `lessons[].blocks[].default_practice` | ✅ | legacy practice flag (still honoured) |
| `lessons[].blocks[].bg_image` / `.bg_color` | ⚪ | inert |
| `blocks[].block_id` | ✅ | practice card + progress + `go_to` key — immutable |
| `blocks[].type` | ✅ | display / question (branching) / exercise (linear) |
| `blocks[].duration` | ✅ | first integer feeds lesson & course time |
| `blocks[].xp` | ⚪ | **ignored** — XP is computed from steps |
| `blocks[].default_practice` | ✅ | enrols the block in Cvičení |
| `blocks[].hint` / `.help` | ✅ | `?` content; using them clamps score to 0.75 / 0.5 |
| `blocks[].status`, `.version`, `.language`, `.author`, `.updated` | ⚪ | editorial only |
| `gpf.relation_vector` | ✅ | which subconstructs update — **only value `2` counts** |
| `gpf.elo_vector` | ✅ | per-subconstruct difficulty 1–10 |
| `gpf.domain/construct/subconstruct/grade/level/vector/kb_vector` | ⚪ | documentation |
| `learning.*` (incl. `prerequisites`) | ⚪ | documentation; prerequisites are not enforced |
| `fsrs.stability/difficulty/reps/lapses/last_review/due_date` | ✅ | seed values for the practice card |
| `fsrs.initial_*`, `weight`, `*_interval`, `skip_condition`, `time_limit_sec` | ⚪ | **not read** |
| `adaptation` | ⚪ | inert |
| `steps[].id` | ✅ | `go_to` target and answer key — never reuse or renumber |
| `steps[].type` | ✅ | renderer |
| `steps[].content` | ✅ | Markdown + LaTeX + raw HTML + `<video>` embeds |
| `steps[].image/video/audio` | ✅ | media; video must be direct MP4 |
| `steps[].hint` / `.help` | ✅ | per-step `?`, overrides block level |
| `steps[].default_practice` | ✅ | display blocks: promotes the whole block into Cvičení |
| `question.type` | ✅ | input widget + grading rule |
| `question.correct_answer` | ✅ | open questions, case-insensitive trimmed |
| `question.correct_number` / `.tolerance` | ✅ | numeric grading band |
| `question.allow_multiple` | ✅ | exact-set grading, no partial credit |
| `question.show_answers` | ✅ | false → no options, no correct/incorrect marking |
| `question.show_solution` / `.solution` / `.solution_image` | ✅ | post-answer explanation |
| `question.allow_photo` | ⚪ | inert |
| `options[].id` / `.text` / `.is_correct` | ✅ | the answer itself |
| `options[].feedback` / `.feedback_image` | ✅ | misconception-specific response |
| `options[].score_koef` | ✅ | partial credit — **only if `is_correct` is true** |
| `options[].mark` | ✅ | Czech grade captured in quiz mode |
| `options[].go_to` | ✅ | branch; ignored in exercise blocks / exercise_v2 |
