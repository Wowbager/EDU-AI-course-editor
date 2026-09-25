# EDU-AI Course Editor — Authoring Specification (full-feature reference)

**What this document is:** the complete definition of everything a course editor for the
EDU-AI platform must be able to edit — what each field means, how it is meant to be used
didactically, and what it does to the student's experience in the app.

It describes the **CourseV2 / BlockV2** format as a fully implemented system: every field
listed here has an effect. Use it as the requirements document for the editor and as the
authoring handbook for course designers.

> **Companion document.** `COURSE-EDITOR-SPEC.md` is a field-by-field audit against the
> public snapshot of the three repositories, which lags the production code. Where the two
> disagree, *this* document describes the intended and current behaviour; the audit is useful
> only as a record of what the older public snapshot happened to implement.

### Reading the tables

Each field is given with its type, its meaning, and — the column that matters — **its effect
in the app**. Fields are grouped by the level of the document they live on, which is also the
natural shape of the editor's UI.

---

## 1. The system in one page

```
  EDITOR                       API (Laravel)                    APP (Flutter)
  ──────                       ─────────────                    ─────────────
  CourseV2 JSON  ──publish──▶  /api/courses                ┌──▶ course library
  (a single document)          /api/courses/upload         │    (listing metadata)
                                     │                     │
                                     ├── full JSON ──────▶ R2 object storage
                                     │   courses/{course_id}/v{version}.json
                                     │                     │
                                     └── extracted ──────▶ SQL columns
                                         metadata          (name, pin, flags, emoji …)
                                                           │
                                             signed download URL
                                                           ▼
                                                   local Drift database
                                                           │
                    ┌──────────────────┬───────────────────┼────────────────────┐
                    ▼                  ▼                   ▼                    ▼
              Lesson player      Quiz / test         Cvičení (FSRS)      Skill profile (ELO)
```

### The four surfaces a field can affect

Every authoring decision lands on one or more of these. Keep them in mind for every field.

| Surface | What the student sees | Driven by |
|---|---|---|
| **Lesson player** | The chat-like sequence of steps inside a lesson | `lessons[]` → bindings → blocks → steps |
| **Quiz / test** | A graded or blind test run | question blocks; `only_quiz`, `starts_with_quiz`, `quiz_evaluate`, option `mark` |
| **Cvičení** | The daily spaced-repetition queue | `default_practice`, bookmarks, `fsrs` |
| **Skill profile** | The proficiency radar and adaptive difficulty | `gpf.relation_vector`, `gpf.elo_vector`, `learning.prerequisites` |

### Object tree

```
CourseV2                                   export_type: course_v2 | exercise_v2 | quiz_v2
├── metadata, access flags, gamification    §3
├── lessons: LessonV2[]                     §4
│   └── blocks: LessonBlockBinding[]        §5   references into the block pool + overrides
└── blocks: BlockV2[]                       §6   every block definition, flat
    ├── identification & didactics          §6.1–6.6
    └── steps: BlockStep[]                  §7   the ordered content the student walks through
        └── question: QuestionConfig        §8
            └── options: QuestionOption[]   §8.2  each with feedback, credit and branching
```

A block is defined **once** in `blocks[]` and *referenced* from lessons, so the same block can
appear in several lessons and is de-duplicated by `block_id`. A block that no lesson
references is still reachable through a cross-block `go_to`, and still enters the practice
queue if flagged.

### Export modes

`export_type` selects how the whole package is rendered.

| `export_type` | Mode | Behaviour |
|---|---|---|
| `course_v2` | Course | The full experience: hints, help, solutions, per-option feedback, `go_to` branching, XP, practice enrolment. |
| `exercise_v2` | Exercise / practice | Hints and solutions stay visible, answers are evaluated, but **branching is disabled** — every answer advances linearly. Use for drill sets where the sequence is fixed. |
| `quiz_v2` | Test | Hints, help, solutions and per-option feedback are suppressed; only the question and its options are shown. Answers are collected and graded via `mark` and score. Turn `quiz_evaluate` on to reveal correct/incorrect and the score at the end. |

Note the two independent axes: `exercise_v2` disables branching for the **whole course**;
`type: "exercise"` disables it for **one block** (§6.2). Both exist and the editor should make
the distinction obvious.

---

## 2. Identity, versioning and the publish cycle

Three ids carry state and must be treated as immutable once a course is live.

| Id | Keys what | Consequence of changing it |
|---|---|---|
| `course_id` | The course itself, its R2 path, enrolments | Creates a **new course**; students keep the old one |
| `lesson_id` | Per-lesson progress records | Orphans every student's progress for that lesson |
| `block_id` | Completion state, practice cards, ELO interactions, `go_to` and prerequisite targets | Resets that block's spaced-repetition card and completion for every student, and breaks every reference to it |

`version` is the publish unit. Bumping it writes a new object in storage and signals the app
that an update exists. The app locks the course's lessons behind an update banner until the
student downloads the new version, so **bump the version deliberately**: it is the right thing
to do for a content fix, and disruptive in the middle of a class.

The editor should: auto-bump `version` on publish, stamp `updated`, show a diff against the
last published version, and refuse to publish while validation errors remain (§14).

---

## 3. Course level

Type `CourseV2`.

### 3.1 Identity and presentation

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `export_type` | `course_v2 \| exercise_v2 \| quiz_v2` | Package kind. | Selects the rendering mode — §1. Required. |
| `course_id` | string | Stable business key, unique platform-wide. | Storage path and enrolment key. Immutable after publish. |
| `version` | int ≥ 1 | Content version. | Storage path; triggers the update flow in the app. §2. |
| `name` | string ≤ 255 | Course title. | Course card and player header. |
| `description` | string ≤ 500 | Short blurb. | Course card subtitle — visible in the library **before** the student downloads the course, so write it for a browsing student. |
| `language` | string ≤ 10 (`cs`, `en`) | Content language. | Library language filter. Does not switch the app's own UI language. |
| `author` | string | Author or organisation. | Shown on the course card and detail page. |
| `updated` | ISO 8601 timestamp | Last edit. | Displayed as "last updated"; set on every save. |
| `status` | `draft \| private \| locked \| approved \| published` | Editorial workflow state. | Only `published` is visible to students. `draft` = work in progress, `private` = finished but distributed by PIN only, `locked` = frozen for review, `approved` = signed off and awaiting release. §3.5. |
| `emoji` | string (1 emoji) | Course icon. | The tile icon in the library and dashboard. If omitted the platform picks one from the subject keywords in the name. |
| `estimated_minutes` | int | Total course length. | Shown on the course card. If omitted it is derived from block durations (§4). Set it explicitly when the derived figure misrepresents the real workload. |
| `header_image` | `{ url, alt? }` | Course cover. | Banner on the course detail page. `alt` is read by screen readers. Use a wide image (roughly 3:1); it is cropped to the banner. |

### 3.2 Access control

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `pin` | 6 alphanumeric chars | Access code. | A student entering the PIN is enrolled in the course immediately, without browsing the library. Case-insensitive on entry, stored upper-case. Rate-limited server-side against guessing. The standard distribution mechanism for a classroom: write it on the board. |
| `logged_only` | bool | Requires a real account. | Guests can see the course exists but cannot open it; they are prompted to sign in. Set it whenever results must be attributable to a named student — homework, assessments, anything a teacher will review. |
| `only_once` | bool | One-shot course. | After completion the student cannot re-enter: the course is hidden from the library and dashboard, and both the PIN path and the direct link refuse re-entry. Use for entry diagnostics and one-time tests. **Irreversible from the student's side** — there is no self-service reset, so never set it on practice material. |

### 3.3 Quiz configuration

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `only_quiz` | bool | The course *is* a quiz; it has no lessons. | The course appears under "Rychlé kvízy" instead of the normal course list, and the quiz can be started immediately. Implies `starts_with_quiz`. |
| `starts_with_quiz` | bool | The course opens with a diagnostic quiz. | **Every lesson is locked** behind a "Start quiz" card until the entry quiz is finished; the course's primary action button becomes the quiz. Lessons unlock on completion. Combine with the adaptive machinery (§6.3, §6.4) so the diagnostic actually changes what the student is then shown. |
| `quiz_evaluate` | bool | Reveal correctness and score in quiz mode. | With `quiz_v2` and `quiz_evaluate: false` the student answers **blind** — no green/red, no solution, no feedback — which is what you want for a diagnostic or a survey. With it `true` the quiz behaves like a graded test: per-question marking and a score summary at the end. |

### 3.4 Gamification and integrity

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `max_xp` | int, optional | Hard XP ceiling for the whole course. | Once a student has earned this much XP from the course, further blocks award zero. Prevents a long course from dominating the leaderboard, and removes the incentive to grind one course repeatedly. Leave empty for no limit. §10. |
| `stop_gambling` | bool | Detect and stop rapid random clicking. | The app watches answer latency and accuracy; a burst of fast, near-random answers interrupts the session with a notice and requires the student to slow down before continuing. The interaction is recorded so the pattern shows up in teacher reporting rather than silently inflating results. Turn it on for any assessed content. |
| `stop_notice` | string | Message shown when the pattern is detected. | Replaces the system default. Keep it short and non-punitive — "Zpomal a odpovídej s rozmyslem" reads better than an accusation. Leave empty to use the platform wording. |
| `ai_context` | string (long, Markdown) | Didactic briefing for the AI tutor. | Injected into the tutor's context whenever a student opens chat from inside this course. Use it for the things a tutor needs and cannot infer: the notation and vocabulary this course uses, the misconceptions you expect, how far to go before giving the answer away, and any terminology that differs from the textbook. This is the highest-leverage free-text field in the format — a well-written `ai_context` changes every tutor conversation in the course. |

### 3.5 What `status` means in practice

| Status | Visible to students | Typical use |
|---|---|---|
| `draft` | no | Being written. |
| `private` | no (library) | Finished, distributed only by PIN — pilot classes, a single school. |
| `locked` | no | Frozen for review; the editor should discourage edits. |
| `approved` | no | Signed off, waiting for a release date. |
| `published` | **yes** | Live in the library, subject to the `logged_only` / `pin` rules. |

---

## 4. Lesson level

Type `LessonV2`. A lesson is the unit of progress: it is what the student opens, what gets a
completion state, and what the dashboard counts.

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `lesson_id` | string | Stable key. | Progress is recorded against it. Immutable after publish. |
| `name` | string | Lesson title. | Lesson card title and player header. |
| `description` | string | One-line summary. | Lesson card subtitle. Write it as a promise of what the student will be able to do. |
| `order` | int | Position in the course. | Lesson sequence. Keep it dense and 1-based; the editor should renumber on reorder. |
| `version` | int | Per-lesson revision. | Editorial traceability; the course `version` is what drives distribution. |
| `header_image` | `{ url, alt? }` | Lesson cover. | Banner at the top of the lesson. Falls back to the course header when absent. |
| `ai_context` | string (Markdown) | Lesson-specific tutor briefing. | Layered **on top of** the course `ai_context` when the student opens chat inside this lesson. Put the course-wide conventions on the course and the lesson-specific misconceptions here. |
| `blocks` | `LessonBlockBinding[]` | Ordered references into `blocks[]`. | §5. |

### Derived values the author controls indirectly

The lesson card shows a **duration** and an **XP reward**, and neither is typed in directly:

* **Duration** = the sum of the `duration` of the referenced blocks, clamped to 1–120 minutes.
  If no block in the lesson declares a duration, the platform estimates ~4 minutes per block
  (clamped to 5–60). Because the sum is over whatever is present, a lesson where only one of
  ten blocks has a duration will show that single block's time. **Fill `duration` on every
  block in a lesson, or on none.** The editor should surface partial coverage as a warning.
* **XP reward** = the maximum XP obtainable from the lesson's blocks (§10). It is a promise to
  the student, so it moves whenever you add or remove steps.

The lesson icon is assigned by the platform from the lesson's position — it is deliberately not
authorable, so a course's lessons read as a consistent series.

---

## 5. Lesson ↔ block binding

Type `LessonBlockBinding`. One entry per appearance of a block in a lesson. This is where a
shared block gets its per-lesson presentation.

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `block_id` | string | Reference into `blocks[]`. | Must resolve. The editor must validate this — a binding to a non-existent block produces a lesson that is quietly shorter than the author intended. |
| `order` | int | Position within the lesson. | Bindings are sorted by `order`, so it is authoritative — duplicated values give an unstable sequence. |
| `bg_color` | string, hex `#RRGGBB` | Card background colour. | Tints the block's card in the lesson. Use it sparingly and systematically — for example one colour for worked examples, another for "try it yourself" — not for decoration. Contrast is the author's responsibility. |
| `bg_image` | string (URL) | Card background image. | Behind the block card, under the text. Needs to be low-contrast or the content becomes unreadable. |
| `default_practice` | bool | Legacy per-binding practice flag. | Still honoured, and OR-ed with the block- and step-level flags (§11). New content should set the flag on the **block** instead, so a shared block behaves consistently everywhere it appears. |

---

## 6. Block level

Type `BlockV2`. A block is one coherent teaching or assessment moment — the unit of
completion, of XP, of a practice card, and of an ELO update. If two ideas can be practised
separately, they are two blocks.

### 6.1 Identification

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `export_type` | `"block_v2"` | Discriminator. | Lets a single block be exported and imported on its own. |
| `block_id` | string, unique in the course | Stable key. | Referenced by bindings, `go_to`, prerequisites; keys completion, practice cards and ELO interactions. Immutable after publish. |
| `type` | `display \| question \| exercise` | Interaction model. | The most consequential single choice in the format — §6.2. |
| `status` | `draft \| private \| locked \| approved \| published` | Per-block workflow state. | Only `published` and `approved` blocks are served to students; a `draft` block inside a published course is skipped. This lets a course go live while one block is still being written. |
| `version` | int | Block revision. | Editorial traceability and block-library reuse. |
| `language` | string | Block language. | Lets a multilingual course mix blocks; falls back to the course language. |
| `author` | string | Who wrote it. | Attribution in the block library. |
| `updated` | ISO 8601 | Last edit. | Sorting and review in the block library. |
| `duration` | string, e.g. `"3 min"` | Expected time on task. | Feeds lesson and course duration (§4) and the pacing signal used for the practice grade (§11). Give a realistic figure for an average student; over-optimistic durations make every student look slow. |
| `xp` | int | XP awarded for completing the block. | The authored reward, scaled by how well the student did — §10. Omit it to let the platform compute a value from the block's step composition. |
| `default_practice` | bool | Enrol this block in spaced repetition. | §11. |
| `hint` | string (Markdown + LaTeX) | Short block-level hint. | Available from the `?` button on any step of the block. Costs score — §12. |
| `help` | string (Markdown + LaTeX) | Detailed block-level explanation. | The second level of the `?` button. Costs more — §12. |
| `steps` | `BlockStep[]` | **The content.** | §7. Always present; the flat `content` / `image` / `video` / `question` fields are a legacy import shape that the editor converts to steps on load and never writes. |

### 6.2 What `type` changes

| | `display` | `question` | `exercise` |
|---|---|---|---|
| Purpose | Teaching content | Assessment with branching | Drill and practice |
| Step types | text, image, video, audio | + question | + question |
| Flow | one step at a time; the student taps Next | all steps visible, the cursor jumps to the next question — text steps are passive context | same as `question` |
| `go_to` branching | n/a | **honoured** | **ignored** — always linear |
| Practice flag lives on | each **step** | the **block** | the **block** |
| Hints | block and step level | block and step level | block level (the drill is the point) |

The passive-context behaviour is worth internalising: in a `question` or `exercise` block, a
text step placed between two questions is shown but is never a stop — the student is taken
straight to the next question. **If you need the student to stop and read, use a `display`
block.**

Choosing between the three:

* **`display`** — explanation, worked example, video, definition. No evaluation, no score.
* **`question`** — a diagnostic moment where the *answer should change what happens next*:
  correct → skip ahead, a specific wrong answer → its own remediation step, a badly wrong
  answer → a different block entirely.
* **`exercise`** — repetition of a known skill where the sequence is fixed. Cheapest to author,
  the natural default for practice sets, and the type that feeds Cvičení best.

### 6.3 GPF — `gpf`

The Global Proficiency Framework metadata. Two halves: descriptive classification, and the two
35-element vectors that drive adaptivity.

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `domain` | string | Top-level area, e.g. "Number and operation". | Classification; used to group blocks in the library and to label the skill profile. |
| `construct` | string | e.g. `N2 FRACTIONS`. | Classification. |
| `subconstruct` | string | e.g. `N2.3 Solve real-world problems…`. | Classification, and the human-readable name of what this block trains. |
| `grade` | int 1–10 \| null | Target school year. | Age-appropriateness filtering and reporting. |
| `level` | 1–4 | Proficiency level targeted: 1 below, 2 partially meets, 3 meets, 4 exceeds. | Positions the block against the expected standard for its `grade`. |
| `vector` | number[] | GPF taxonomy vector. | Machine classification for content search and recommendation. |
| `kb_vector` | number[] | Knowledge-base vector. | Links the block to the RAG knowledge base used by the tutor. |
| **`relation_vector`** | 35 × `0 \| 1 \| 2` | Which subconstructs this block exercises, and how strongly. | See below. |
| **`elo_vector`** | 35 × float 1.0–10.0 | This block's difficulty in each subconstruct. | See below. |

**The 35 dimensions.** They are fixed GPF subconstructs, grouped into five domains:
N — Number and operation (indices 0–16), M — Measurement (17–21), G — Geometry (22–24),
S — Statistics and probability (25–28), A — Algebra (29–34). Human-readable labels come from
the backend's vector definition, so **the editor must fetch them rather than hard-code them** —
the dimension set is versioned per course through the skill configuration.

**`relation_vector` — what the block trains.**

| Value | Meaning | Effect |
|---|---|---|
| `0` | unrelated | The subconstruct is untouched by this block. |
| `1` | weak relation | The subconstruct is involved but incidental — it updates with reduced weight, so a student's rating moves slowly here. |
| `2` | strong relation | The subconstruct is what the block is *about* — it updates at full weight. |

Keep it honest and sparse. A block that claims a strong relation to eight subconstructs will
smear a single result across eight ratings and make the skill profile noisy. Most blocks have
one or two `2`s and perhaps a couple of `1`s.

**`elo_vector` — how hard the block is.** One difficulty per subconstruct on a 1–10 scale,
where a student's rating starts at **6.0**. A block rated at the student's own level gives them
roughly a 50 % chance; that is the most informative and the most motivating place to be. Set
the value per subconstruct, not per block — the same word problem can be easy arithmetic and
hard reading comprehension.

**What happens at runtime.** When a student completes the block, a bidirectional Elo update
runs for every related subconstruct: the student's rating moves toward or away from the block's
difficulty according to the outcome, and the block's own difficulty drifts in the opposite
direction — much more slowly, so that a block's difficulty is calibrated by the population over
time rather than by any single student. On a student's first contact with a subconstruct their
rating is seeded rather than nudged, so early answers position them quickly. The outcome fed in
is the score from §12: `1.0`, `0.75`, `0.5` or `0.0`.

Consequences for authoring:

* **A block with no vectors contributes nothing to the skill profile.** If the radar is meant
  to move, the vectors are mandatory. Assessment content without vectors is a wasted measurement.
* Difficulty is used for **task selection** as well as scoring: the adaptive picker prefers
  blocks near the student's current rating in the subconstruct being trained.
* The scale is shared across courses. A `7.0` in one course must mean the same as a `7.0` in
  another, or the profile stops being comparable. Calibrate against existing content.

**Adjacent configuration.** How the 35 numbers are aggregated into the skill display —
the dimension set, the grouping formula, the display scale, and the confidence parameters —
lives in the course's skill configuration on the server, not in the course document. The editor
should link to it, and use it as the source of the dimension labels.

### 6.4 Learning metadata — `learning`

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `concepts` | string[] | Key concepts, e.g. `["Zlomky", "Smíšená čísla"]`. | Surfaced as the block's topic tags; used for search, for the "what you'll learn" summary, and as retrieval keys for the tutor. |
| `competencies` | `{ "M.4.5.7": 50 }` | Curriculum competency codes with percentage weights. | Maps the block onto the national curriculum. Drives curriculum-coverage reporting for teachers — "which framework outcomes has this class actually practised". Weights should sum to something sensible per block; they express how much of the block serves each outcome. |
| `bloom_level` | 1–6 | Bloom's taxonomy: 1 remember, 2 understand, 3 apply, 4 analyse, 5 evaluate, 6 create. | Reported in the course's cognitive-demand profile, and used to balance a lesson — a lesson of nothing but level-1 recall is flagged for the author. |
| `difficulty` | 1–5 | Author-assessed difficulty. | The **initial** difficulty estimate, used before enough student data exists to calibrate `elo_vector` empirically, and as the ordering key within an adaptive set. |
| `prerequisites` | `PrerequisiteRule[]` | Readiness gates. | See below. |
| `d_data` | object | Free-form research variables. | Carried through to analytics exports; an escape hatch for experiments without a format change. |
| `l_data` | object | Free-form learning/gamification signals. | Same, on the learning side. |

**`PrerequisiteRule`** — `{ block_id?, skill?, min_level, weight? }`

| Field | Meaning |
|---|---|
| `block_id` | The student must have reached `min_level` mastery on that block. |
| `skill` | The student must have reached `min_level` on that skill / subconstruct code, e.g. `ALG_3.1.2`. |
| `min_level` | Threshold, `0`–`1`. |
| `weight` | How much this rule counts in the combined readiness score (default 1). |

Prerequisites drive **adaptive ordering in both directions**:

* **Locking** — a block whose readiness score is below threshold is not offered yet; the
  student is routed to the prerequisite content first.
* **Skipping** — a block whose prerequisites are already comfortably exceeded can be skipped
  for that student, so a strong student is not made to grind through material they have
  demonstrated.

Use `min_level` deliberately: `0.5` means "has seen it and half-way holds it", `0.8` means
"reliably". Over-tight prerequisites produce a course where nothing unlocks; the editor should
visualise the prerequisite graph and flag cycles and unreachable blocks (§14).

### 6.5 Spaced repetition — `fsrs`

Per-block parameters for the FSRS scheduler. All are optional; the defaults are sensible for
ordinary content, and most blocks should leave them alone.

| Field | Default | Meaning | Effect in the app |
|---|---|---|---|
| `initial_difficulty` | 0.3 | D₀ — how hard this item is to retain, `0`–`1`. | Higher values make intervals grow more slowly from the start. Raise it for arbitrary facts (vocabulary, formulae with no derivation), lower it for material with strong internal logic. |
| `initial_stability` | 2.5 | S₀ — memory strength after the first successful review, in days. | Sets the first interval. Lower it for material you expect to be forgotten quickly. |
| `initial_recall` | 0.65 | R₀ — assumed recall probability at first review. | Seeds the scheduler before the student has any history with the block. |
| `forgetting_rate` | 0.25 | λ — how fast retrievability decays. | Higher = reviews come back sooner. |
| `repetitions` | 0 | Prior review count. | Non-zero only when importing a block with existing history. |
| `weight` | 1.0 | Priority of this block in the daily queue. | The queue is ordered by weight before due date, so a higher weight pushes a block to the front of a crowded day. Reserve values above 1 for genuinely foundational blocks — if everything is important, nothing is. |
| `min_interval` | 1 | Floor, in days. | The block will never come back sooner than this, even after a failure. |
| `max_interval` | 90 | Ceiling, in days. | Caps the interval regardless of how well the student knows it. Lower it for material that must stay fresh for an exam date; raise it for durable knowledge. |
| `skip_condition` | — | Expression, e.g. `GPF_mastery > 0.8`. | Evaluated before the block is queued: when it holds, the block is dropped from that student's queue. The clean way to stop drilling a student on something they have demonstrably mastered. |
| `time_limit_sec` | — | Optional time limit for the block. | Shows a countdown and closes the block when it expires. Use for timed assessment only — a timer on teaching content mostly measures anxiety. |

The scheduler combines these with the **student's** own FSRS profile (desired retention,
learning and relearning steps, maximum interval, fuzzing), so the same block will be scheduled
differently for different students. Block parameters express properties of the *material*;
the profile expresses properties of the *learner*.

### 6.6 Adaptation — `adaptation`

`{ scaffolded?: string, full?: string }` — two condition expressions evaluated against the
student's recent performance, e.g.:

```json
"adaptation": {
  "scaffolded": "avg_relevant_score < 3",
  "full":       "avg_relevant_score >= 3"
}
```

The matching branch selects the variant of the block the student is shown: **scaffolded**
(more steps, worked example first, hints surfaced earlier) or **full** (the bare task). This is
how one authored block serves two readiness levels without duplicating content. Leave both
empty for a block that behaves the same for everyone.

---

## 7. Steps

Type `BlockStep`. The `steps[]` array is the content: an ordered sequence of cards the student
moves through.

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `id` | string, `"s1"`, `"s2"`… | Stable within the block. | **`go_to` targets and saved answers are keyed by it.** Ids are minted as `s{max+1}` and never reused — reordering steps must rewrite `order`, never renumber `id`. Deleting a step must repair every `go_to` that pointed at it. |
| `type` | `text \| image \| video \| audio \| question` | Renderer. | §7.1. |
| `order` | int, 1-based | Position. | Should match the array position; the editor keeps them in sync. |
| `content` | Markdown + LaTeX | Text body. | §7.1. |
| `image` / `video` / `audio` | objects | Media payload. | §7.1. |
| `question` | `QuestionConfig` | The interaction. | §8. |
| `hint` | Markdown | Short step hint. | Shown from `?` on this step; takes precedence over the block-level hint. Costs score — §12. |
| `help` | Markdown | Detailed step help. | Second level; costs more. |
| `default_practice` | bool | Display blocks only. | Marks this step's block as practice material (§11). The card is per **block**, not per step — flagging one step of a display block enrols the whole block. |

### 7.1 Rendering by type

**`text`** — `content` is Markdown with LaTeX. Supported: headings, bold, italic, ordered and
unordered lists, GFM pipe tables, code blocks, links, images, blockquotes; inline math `$…$`
and display math `$$…$$`; and raw HTML for anything Markdown cannot express.

Two behaviours to design content around:

* A `<video>` tag inside text content is turned into a **real player** in place, with the
  surrounding text preserved in order. Both `<video src="…">` and a nested `<source src="…">`
  work. This is the way to put a clip in the middle of an explanation without splitting the
  step. There is no iframe or YouTube embedding — see below.
* On the web build, external images are fetched through the platform's image proxy to avoid
  CORS problems. Images must be **public HTTPS URLs**; anything behind auth or on a private
  host will not render. Keep files under ~10 MB.

**`image`** — `{ url, alt?, position? }` where `position` is `above | below | inline`.
Always write `alt`: it is read aloud by screen readers and shown when the image fails to load.

**`video`** — `{ url, position? }`. A **direct MP4 URL**, not a YouTube or Vimeo link. Standard
player with play, pause and seek.

**`audio`** — `{ url }`. MP3, WAV or OGG. Rendered as a full-width player; there is no
`position` — audio always occupies its own row.

**`question`** — §8.

Media should be uploaded through the platform's asset manager rather than hot-linked from
arbitrary sites: assets get stable URLs, survive the source going away, and are covered by the
proxy and CDN.

---

## 8. Questions

### 8.1 `QuestionConfig`

| Field | Type | Default | Meaning | Effect in the app |
|---|---|---|---|---|
| `type` | `multiple_choice \| true_false \| open \| numeric` | — | Input widget and grading rule. | §8.3. |
| `options` | `QuestionOption[]` | — | The choices, for MC and True/False. | §8.2. |
| `correct_answer` | string | — | Expected answer for `open`. | Compared case-insensitively and trimmed. |
| `correct_number` | number | — | Expected value for `numeric`. | Graded against `tolerance`. |
| `tolerance` | number | 0 | Accepted ± band for `numeric`. | `0` requires an exact match. This is how you accept `0.33` for ⅓, or a rounded result in a physics calculation. Always set a tolerance when the correct answer is irrational or comes from a multi-step calculation. |
| `allow_multiple` | bool | false | Multi-select. | Checkboxes instead of radio buttons. Grading is **exact set equality** — the student must select every correct option and no incorrect one. There is no partial credit for a partially correct set, so for "choose all that apply" with many options, consider several True/False questions instead. |
| `show_answers` | bool | true | Show the option list. | With `false` the options are hidden and the student's response is not marked correct or incorrect; the confirm button reads "Další" rather than "Zkontrolovat". Use for reflection prompts, self-assessment and opinion questions where there is no right answer. |
| `show_solution` | bool | true | Reveal the worked solution after answering. | `false` moves straight on. Turn it off when the solution would spoil the next question. |
| `solution` | Markdown + LaTeX | — | The worked explanation. | Shown after the student answers. Write it as the *method*, not just the result — this is the highest-traffic teaching text in the whole format. |
| `solution_image` | `{ url, alt?, position? }` | — | Image in the solution. | A diagram of the method; often more effective than prose. |
| `allow_photo` | bool | false | Let the student answer an open question with a photo. | Adds a camera control next to the text field. Intended for work done on paper — long division, geometric constructions, handwritten proofs. The photo is stored with the response and shown to the teacher in the answers export; the tutor can also read it when the student asks for help. |

### 8.2 `QuestionOption`

| Field | Type | Meaning | Effect in the app |
|---|---|---|---|
| `id` | string | Option key, unique within the question. | Referenced by saved answers. True/False uses the fixed ids `true` and `false`. |
| `text` | Markdown + LaTeX | Option label. | Rendered with full formatting, so an option can be an equation or a fraction. |
| `is_correct` | bool | Whether this option is correct. | Drives marking, the practice grade and the skill update. |
| `feedback` | Markdown + LaTeX | Shown after choosing **this** option. | The single most valuable field for teaching. Write a distinct response for each wrong option that names the misconception behind it — "you swapped the numerator and denominator" beats "incorrect". Suppressed in blind quiz mode. |
| `feedback_image` | `{ url, alt? }` | Image in that feedback. | A diagram that shows the error. |
| `score_koef` | number 0–1 (default 1.0) | Partial credit for this option. | Scales what the answer is worth: XP earned, the score fed into the skill profile, and the practice grade. Use it for genuinely partial answers — an option that is right in method but wrong in arithmetic might be `0.5`; a right answer for the wrong reason, `0.3`. Full credit is `1.0`; a plainly wrong option is `0` (or omit it). |
| `mark` | string `"1"`–`"5"` | Czech school grade for quiz mode. | Collected as the grade for this question when the course runs as a test (1 = best, 5 = worst). The quiz result aggregates the marks alongside the percentage score, so a test can report in the form teachers and parents actually use. |
| `go_to` | string | Branch target. | §9. |

### 8.3 Grading by question type

| Type | Widget | Correct when | Notes |
|---|---|---|---|
| `multiple_choice` | radio, or checkboxes with `allow_multiple` | the chosen option is `is_correct`; multi-select requires exact set equality | 3–5 options works best; every distractor should encode a real misconception |
| `true_false` | two large buttons | as MC with exactly two options | fast to answer, so good for drilling; pairs well with a `feedback` on each side |
| `open` | text field (+ camera with `allow_photo`) | input matches `correct_answer`, case-insensitive and trimmed, or matches the text of a correct option | only use where the answer is a single unambiguous word or number |
| `numeric` | numeric keypad | `\|input − correct_number\| ≤ tolerance` | always set `tolerance` for calculated or irrational answers |

---

## 9. Navigation — `go_to`

`go_to` lives on each **option**, so branching is per-answer. This is what turns a question
block from a test into a teaching conversation.

| Value | Action |
|---|---|
| absent / `null` / `""` / `"NEXT_STEP"` | Advance to the next step in order; past the last step, complete the block. |
| `"AGAIN"` | Re-show the same step for another attempt. The wrong choice stays on screen marked incorrect **without revealing the correct answer**, and a retry control appears. |
| `"END"` | Complete the block immediately. |
| `"CHAT"` (alias `"LECTURE"`) | Open the AI tutor with this block as context. The natural target for a "I don't understand any of this" option. |
| a step id in this block, e.g. `"s3"` | Jump to that step. |
| a `block_id` in this course | Cross-block jump — load that block from its first step. |

### Patterns worth knowing

**Remediate then rejoin.** Wrong answer → a text step explaining the specific misconception →
which falls through to a second attempt → which rejoins the success path.

```
s2 (question)
 ├─ A correct        → go_to "s5"   ─────────────▶ s5 (well done) → END
 ├─ B swapped terms  → go_to "s3"   → s3 (reminder) → s4 (retry) ─┘
 └─ C lost entirely  → go_to "L1_B2_casti"  (back to the prerequisite block)
```

**Retry without spoiling.** `AGAIN` on a wrong option, with `feedback` that hints but does not
tell. Better than an immediate solution for anything mechanical.

**Escalate to the tutor.** A final "Nerozumím" option with `go_to: "CHAT"`, and an `ai_context`
on the course that tells the tutor what this block is for.

**Steps reachable only by jump.** A step that no linear path reaches is remediation content —
that is legitimate and intentional. The editor should distinguish it from an accidentally
orphaned step (§14).

### Rules

* `go_to` is **ignored in `exercise` blocks and throughout `exercise_v2` courses** — flow is
  always linear there. The editor should hide the control for exercise blocks and warn when an
  imported course has branches inside one.
* Every non-keyword target must resolve to a step in the same block or a block in the same
  course. Cross-*course* jumps are not supported. The editor must validate this before export.

---

## 10. XP and progression

XP is the student-facing reward signal. It has one authored input and two guard rails.

**Per block:**

```
earned_xp = block.xp × best_score_koef
```

`best_score_koef` is the best coefficient achieved on the block's questions (§8.2). A perfect
first-pass answer earns the full `xp`; a partially credited one earns proportionally less; the
hint and help penalties (§12) reduce it further.

If `xp` is omitted the platform derives it from the block's shape — roughly **+1 per content
step and +8 per question step** — so a block always carries a sensible reward even before the
author tunes it. Because of this, the editor should show the **effective** XP for every block
and lesson live, whether it came from the author or the default.

**Then two caps, in order:**

1. **Course hard cap** — `max_xp` (§3.4). Once the student has earned that much from the
   course, further blocks award zero.
2. **Daily soft cap** — the first **100 XP** of a day count in full, everything beyond counts at
   **20 %**. Long sessions still pay, but a single marathon cannot substitute for regular
   practice. Levels are 500 XP apart.

Authoring guidance: keep XP proportional to *effort and value*, and roughly consistent across a
course — a 2-minute recall question at 15 XP next to a 15-minute problem set at 20 XP teaches
students to farm the cheap one.

---

## 11. Cvičení — the spaced-repetition queue

### What enters the queue

A block becomes a practice card when **any** of these holds:

1. the block has `default_practice: true`;
2. any of its steps has `default_practice: true` (the route for display blocks);
3. its lesson binding has `default_practice: true` (legacy, still honoured);
4. the student bookmarks it;
5. the student answers it wrong — exercise blocks are auto-bookmarked on a wrong answer, so
   mistakes come back without the student having to do anything.

Cards are **per block, per student**. Blocks the student has not yet completed are held back so
that Cvičení reviews what has been taught rather than spoiling what has not.

### What to flag

Flag the blocks that carry knowledge worth retaining: definitions, procedures, facts,
worked patterns. Do not flag scaffolding, transitions, or anything whose value was in seeing it
once. A good rule of thumb is 20–40 % of a course's blocks. A course where everything is
flagged produces a queue the student abandons.

### How the daily queue is built

1. Cards are partitioned into **overdue** (due today or earlier) and **new** (never reviewed);
   cards not yet due are left alone.
2. Overdue cards are sorted by `fsrs.weight` descending, then by how long they have been
   overdue.
3. New cards are sorted by weight and admitted up to the student's daily new-card limit.
4. Overdue first, then new.
5. Cards are **interleaved across courses** within each priority band, so no single course
   dominates a session.
6. The whole thing is capped at the student's daily review limit.

This is why `fsrs.weight` matters: it is the only authored control over what a student sees
first on a crowded day.

### How a review is graded

The FSRS rating is derived automatically from the answer:

| Rating | Condition | Effect on the interval |
|---|---|---|
| 1 — Again | wrong answer | interval collapses; the card returns soon |
| 2 — Hard | correct, but a hint or help was used | interval grows slowly |
| 3 — Good | correct, unaided, slower than the block's expected time | normal growth |
| 4 — Easy | correct, unaided, at or under the expected time | interval grows fastest |

The "expected time" comes from the block's `duration`, which is a second reason to make it
realistic: a duration that is too generous makes every correct answer look Easy and pushes
material out of the queue too fast.

Display blocks with no question use a self-rating instead — the student says how well they
remembered it.

---

## 12. Hints, help, and what they cost

Two levels, and both are recorded:

| Level | Trigger | Cost |
|---|---|---|
| 0 | answered unaided | full score |
| 1 | `hint` opened (step-level first, block-level as fallback) | score capped at **0.75** |
| 2 | `help` opened | score capped at **0.5** |

The capped score is what flows into everything downstream: the XP calculation (§10), the score
fed into the Elo update (§6.3), and the FSRS rating, which drops to **2 (Hard)** for any
assisted correct answer (§11).

In quiz mode the hint button is the only assistance that remains; bookmarking, rating and the
solution are all suppressed.

Authoring guidance: a hint should **narrow the search** — "the numerator is the number on top" —
and help should **teach the method**. A hint that gives the answer converts the question into a
reading exercise and permanently flattens the skill signal the platform collects on that
student. Hints are not free, and that is deliberate.

---

## 13. Field index

| Path | One-line effect |
|---|---|
| `export_type` | course / exercise (linear) / quiz (stripped) mode |
| `course_id` | storage and enrolment key — immutable |
| `version` | publish unit; triggers the student update flow |
| `name`, `description`, `author`, `language` | library card and header |
| `status` | only `published` reaches students |
| `emoji`, `estimated_minutes` | course tile icon and advertised length |
| `header_image` | course banner |
| `pin` | 6-character enrolment code |
| `logged_only` | blocks guests |
| `only_once` | no re-entry after completion; hidden from lists |
| `only_quiz` | quiz-only course; implies `starts_with_quiz` |
| `starts_with_quiz` | locks every lesson behind an entry quiz |
| `quiz_evaluate` | quiz reveals correctness and score |
| `max_xp` | hard XP ceiling for the course |
| `stop_gambling`, `stop_notice` | interrupt rapid random clicking, with a custom message |
| `ai_context` | didactic briefing injected into the AI tutor |
| `lessons[].lesson_id` | progress key — immutable |
| `lessons[].name`, `.description` | lesson card title and subtitle |
| `lessons[].order` | lesson sequence |
| `lessons[].header_image` | lesson banner |
| `lessons[].ai_context` | tutor briefing layered over the course one |
| `lessons[].blocks[].block_id` | reference into the block pool — must resolve |
| `lessons[].blocks[].order` | block order within the lesson |
| `lessons[].blocks[].bg_color`, `.bg_image` | block card styling |
| `lessons[].blocks[].default_practice` | legacy practice flag (still honoured) |
| `blocks[].block_id` | completion, practice card, ELO and `go_to` key — immutable |
| `blocks[].type` | display / question (branching) / exercise (linear drill) |
| `blocks[].status` | draft blocks are skipped inside a published course |
| `blocks[].duration` | lesson time, course time, and the pacing threshold for the practice grade |
| `blocks[].xp` | XP awarded, scaled by best score coefficient |
| `blocks[].default_practice` | enrols the block in Cvičení |
| `blocks[].hint`, `.help` | `?` content; using them caps the score at 0.75 / 0.5 |
| `gpf.domain/construct/subconstruct/grade/level` | classification and standards alignment |
| `gpf.vector`, `.kb_vector` | content search and tutor knowledge-base linkage |
| `gpf.relation_vector` | which subconstructs update (0 none, 1 weak, 2 strong) |
| `gpf.elo_vector` | per-subconstruct difficulty, 1–10, student baseline 6.0 |
| `learning.concepts` | topic tags, search, tutor retrieval |
| `learning.competencies` | curriculum coverage reporting |
| `learning.bloom_level` | cognitive-demand profile of the lesson |
| `learning.difficulty` | initial difficulty before Elo calibration |
| `learning.prerequisites` | locks blocks not yet reachable, skips blocks already mastered |
| `learning.d_data`, `.l_data` | free-form analytics payloads |
| `fsrs.initial_difficulty/stability/recall`, `forgetting_rate` | starting memory model for the block |
| `fsrs.weight` | priority in a crowded daily queue |
| `fsrs.min_interval`, `.max_interval` | interval floor and ceiling in days |
| `fsrs.skip_condition` | drops the block from the queue once mastered |
| `fsrs.time_limit_sec` | countdown on the block |
| `adaptation.scaffolded` / `.full` | selects the scaffolded or bare variant per student |
| `steps[].id` | `go_to` target and answer key — never reuse or renumber |
| `steps[].type` | renderer |
| `steps[].content` | Markdown + LaTeX + HTML + inline `<video>` |
| `steps[].image/video/audio` | media; video is a direct MP4 |
| `steps[].hint`, `.help` | per-step `?`, overrides the block level |
| `steps[].default_practice` | display blocks: enrols the block in Cvičení |
| `question.type` | input widget and grading rule |
| `question.correct_answer` | open questions, case-insensitive and trimmed |
| `question.correct_number`, `.tolerance` | numeric grading band |
| `question.allow_multiple` | exact-set grading |
| `question.show_answers` | false → no options, no marking (reflection prompts) |
| `question.show_solution`, `.solution`, `.solution_image` | post-answer teaching |
| `question.allow_photo` | photo answers for work done on paper |
| `options[].id`, `.text`, `.is_correct` | the answer itself |
| `options[].feedback`, `.feedback_image` | misconception-specific response |
| `options[].score_koef` | partial credit; scales XP, skill score and practice grade |
| `options[].mark` | Czech grade collected in quiz mode |
| `options[].go_to` | branch target; ignored in exercise blocks |

---

## 14. Validation the editor must enforce

### Errors — block the export

1. **Structural completeness**
   - display block → at least one `text` step with non-empty content;
   - question / exercise block → at least one `question` step, each with a config;
   - `open` → non-empty `correct_answer`;
   - `multiple_choice` → ≥ 2 options, ≥ 1 correct, no empty option text;
   - `true_false` → exactly 2 options, exactly 1 correct;
   - `numeric` → `correct_number` present.
2. **Referential integrity**
   - every binding `block_id` resolves to a block in `blocks[]`;
   - every `go_to` resolves to a keyword, a step id in the same block, or a block id in the
     same course;
   - every `prerequisites[].block_id` resolves;
   - `block_id`, `lesson_id` and step `id`s are unique within their scope.
3. **Vectors** — `relation_vector` and `elo_vector` have the dimension count declared by the
   course's skill configuration; `relation_vector` values are `0`, `1` or `2`; `elo_vector`
   values are within 1.0–10.0.
4. **Prerequisite graph** is acyclic.
5. **Media** — `video.url` is a direct media URL, not a YouTube or Vimeo page; all media URLs
   are absolute HTTPS.

### Warnings — publish, but tell the author

1. `version` not bumped since the last publish.
2. Partial `duration` coverage within a lesson (some blocks have it, some do not) — the lesson
   time will be wrong.
3. `go_to` set on options inside an `exercise` block, or anywhere in an `exercise_v2` course —
   it will be ignored.
4. A step that is unreachable from `s1` and is not the target of any `go_to`.
5. A block defined but referenced by no lesson and no `go_to`, and not flagged for practice.
6. `relation_vector` all zero while `elo_vector` is set — the block will never move the skill
   profile.
7. More than three `2`s in a `relation_vector` — the result will be smeared across too many
   subconstructs.
8. `elo_vector` values far from the course's mean without a corresponding `learning.difficulty`.
9. A question with no `feedback` on any wrong option — a missed teaching opportunity.
10. `is_correct: false` combined with `score_koef > 0` — confirm the partial credit is intended.
11. A lesson of more than ~12 blocks, or a block of more than ~10 steps — likely wants splitting.
12. `only_once` combined with `default_practice` — the student will have practice cards for a
    course they can never re-open.
13. Prerequisites with `min_level ≥ 0.9` — very likely to lock the block permanently.

---

## 15. Functional requirements for the editor

### Structure
- Full course → lesson → binding → block → step tree with drag-reordering at every level.
  Reordering rewrites `order` and **never** renumbers step `id`s.
- Add, duplicate, delete at every level. Duplicating a block mints a fresh `block_id`,
  renumbers the copy's step ids, and drops `go_to` targets that pointed inside the original.
- Move a block between lessons; reference one block from several lessons; a shared-block
  indicator so an author knows an edit will affect more than one lesson.
- Delete-safety: deleting a block or step surfaces every `go_to`, binding and prerequisite that
  points at it and offers to repair or redirect them.
- A block library: search and insert existing blocks by `block_id`, concept, competency,
  subconstruct or GPF domain.

### Content
- Markdown + LaTeX editor with live preview that matches the app's renderer exactly (KaTeX,
  GFM tables, raw HTML, inline `<video>`).
- Asset picker wired to the platform's upload endpoint, so authors stop pasting arbitrary URLs;
  inline preview for images, MP4 and audio so a broken link is visible at authoring time.
- Accessibility nudges: missing `alt`, contrast warning on `bg_color`.

### Questions and flow
- All four question types with type-appropriate controls, and automatic True/False seeding.
- Per option: text, correct flag, feedback (+ image), `score_koef`, `mark`, `go_to`.
- A `go_to` picker offering the keywords (`NEXT_STEP`, `AGAIN`, `END`, `CHAT`), the steps of the
  current block, and every other block in the course — never a free-text field.
- A branching visualiser for question blocks: step→step and block→block edges, unreachable
  steps, dangling targets, and the loops that `AGAIN` creates.
- A course-level map of cross-block jumps and the prerequisite graph.

### Didactics and adaptivity
- 35-dimension `relation_vector` / `elo_vector` editor with dimension labels **fetched from the
  course's skill configuration**, not hard-coded, plus a compact summary ("strong: N2.1, N2.3")
  so the author can see the claim at a glance.
- Competency and concept pickers backed by the curriculum list rather than free text.
- Prerequisite editor with block and skill autocomplete, and a live readiness preview.
- FSRS panel with the defaults visible, so an author can see they are not overriding anything.

### Feedback to the author
- Live computed XP per block, lesson and course, and live computed duration, with the partial
  coverage warning.
- A didactic summary per lesson: Bloom distribution, question-type mix, share of blocks flagged
  for practice, share of wrong options that carry feedback.
- The validation panel of §14, errors blocking export and warnings visible but dismissible.

### Preview and lifecycle
- A preview that renders a block exactly as the app does, switchable between the three export
  modes, so the author sees the quiz-mode stripping before students do — and a "as a student
  who answers wrong" mode that walks the remediation branches.
- Import: `course_v2` / `exercise_v2` / `quiz_v2`, single `block_v2` files, legacy flat blocks
  (auto-migrated to steps), legacy `lesson.block_ids`, and V1 `course` / `lecture` exports.
- Export: one JSON document, and direct publish to the API with auto version bump, `updated`
  stamp, and a diff against the last published version.

---

## 16. A complete worked course

```json
{
  "export_type": "course_v2",
  "course_id": "ZLOMKY5TR",
  "version": 3,
  "name": "Zlomky pro 5. třídu",
  "description": "Od poznání zlomku k sčítání se stejným jmenovatelem.",
  "language": "cs",
  "author": "EduAI Team",
  "updated": "2026-09-10T08:00:00.000Z",
  "status": "published",
  "emoji": "➗",
  "estimated_minutes": 45,
  "pin": "A1B2C3",
  "logged_only": true,
  "quiz_evaluate": true,
  "max_xp": 300,
  "stop_gambling": true,
  "stop_notice": "Zpomal a odpovídej s rozmyslem — o to tu jde.",
  "ai_context": "Kurz používá zápis $\\frac{a}{b}$, nikoli a/b. Nejčastější chyba: prohození čitatele a jmenovatele. Druhá: sčítání jmenovatelů při sčítání zlomků. Neprozrazuj výsledek — veď studenta otázkou, ať sám pojmenuje, co je nahoře a co dole.",
  "header_image": { "url": "https://cdn.edu-ai.eu/zlomky/cover.png", "alt": "Pizza rozdělená na osminy" },

  "lessons": [
    {
      "lesson_id": "L1_INTRO",
      "version": 1,
      "name": "Co je zlomek?",
      "description": "Naučíš se poznat čitatele a jmenovatele.",
      "order": 1,
      "header_image": { "url": "https://cdn.edu-ai.eu/zlomky/l1.png", "alt": "Zlomek pět sedmin" },
      "ai_context": "V této lekci student ještě nezná pojem společný jmenovatel — nepoužívej ho.",
      "blocks": [
        { "block_id": "L1_B1_uvod",   "order": 1 },
        { "block_id": "L1_B2_casti",  "order": 2, "bg_color": "#FFF7E6" },
        { "block_id": "L1_B3_poznej", "order": 3 }
      ]
    }
  ],

  "blocks": [
    {
      "export_type": "block_v2",
      "block_id": "L1_B1_uvod",
      "version": 1, "language": "cs", "author": "EduAI Team",
      "updated": "2026-09-10T08:00:00.000Z", "status": "published",
      "type": "display", "duration": "2 min", "xp": 5,
      "gpf": {
        "domain": "Number and operation",
        "construct": "N2 FRACTIONS",
        "subconstruct": "N2.1 Identify and represent fractions",
        "grade": 5, "level": 2
      },
      "learning": {
        "concepts": ["Zlomek", "Část celku"],
        "competencies": { "M.5.2.1": 40 },
        "bloom_level": 2, "difficulty": 1,
        "prerequisites": []
      },
      "steps": [
        { "id": "s1", "type": "text", "order": 1,
          "content": "Zlomek $\\frac{a}{b}$ popisuje **část celku**.\n\nČíslo nahoře je *čitatel*, číslo dole *jmenovatel*." },
        { "id": "s2", "type": "image", "order": 2,
          "image": { "url": "https://cdn.edu-ai.eu/zlomky/pizza.svg",
                     "alt": "Pizza rozdělená na 8 dílů, 3 jsou zvýrazněné", "position": "below" } }
      ]
    },

    {
      "export_type": "block_v2",
      "block_id": "L1_B2_casti",
      "version": 1, "language": "cs", "author": "EduAI Team",
      "updated": "2026-09-10T08:00:00.000Z", "status": "published",
      "type": "display", "duration": "3 min", "xp": 5,
      "gpf": {
        "domain": "Number and operation", "construct": "N2 FRACTIONS",
        "subconstruct": "N2.1 Identify and represent fractions",
        "grade": 5, "level": 2
      },
      "learning": {
        "concepts": ["Čitatel", "Jmenovatel"],
        "competencies": { "M.5.2.1": 60 },
        "bloom_level": 2, "difficulty": 1, "prerequisites": []
      },
      "steps": [
        { "id": "s1", "type": "text", "order": 1,
          "content": "### Části zlomku\n\n| Pozice | Název | Co říká |\n|---|---|---|\n| nahoře | čitatel | kolik dílů bereme |\n| dole | jmenovatel | na kolik dílů je celek rozdělen |",
          "default_practice": true }
      ]
    },

    {
      "export_type": "block_v2",
      "block_id": "L1_B3_poznej",
      "version": 2, "language": "cs", "author": "EduAI Team",
      "updated": "2026-09-10T08:00:00.000Z", "status": "published",
      "type": "question", "duration": "3 min", "xp": 15,
      "default_practice": true,
      "hint": "Horní číslo = čitatel, dolní = jmenovatel.",
      "help": "Ve zlomku $\\frac{a}{b}$ říká **b**, na kolik stejných dílů je celek rozdělen, a **a**, kolik jich bereme.",
      "gpf": {
        "domain": "Number and operation",
        "construct": "N2 FRACTIONS",
        "subconstruct": "N2.1 Identify and represent fractions",
        "grade": 5, "level": 2,
        "relation_vector": [0,0,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        "elo_vector":      [5,5,4.5,5.5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5]
      },
      "learning": {
        "concepts": ["Čitatel", "Jmenovatel"],
        "competencies": { "M.5.2.1": 60 },
        "bloom_level": 2, "difficulty": 2,
        "prerequisites": [ { "block_id": "L1_B2_casti", "min_level": 0.5 } ]
      },
      "fsrs": {
        "initial_difficulty": 0.3, "initial_stability": 2.5, "initial_recall": 0.65,
        "forgetting_rate": 0.25, "repetitions": 0,
        "weight": 1.5, "min_interval": 1, "max_interval": 60,
        "skip_condition": "GPF_mastery > 0.85"
      },
      "steps": [
        { "id": "s1", "type": "text", "order": 1,
          "content": "Podívej se na zlomek $\\frac{5}{7}$ a odpověz." },

        { "id": "s2", "type": "question", "order": 2,
          "hint": "Čitatel je číslo nahoře.",
          "question": {
            "type": "multiple_choice",
            "show_answers": true,
            "show_solution": true,
            "solution": "Ve zlomku $\\frac{5}{7}$ je čitatel **5** a jmenovatel **7**.",
            "options": [
              { "id": "a", "text": "Čitatel je 5, jmenovatel je 7",
                "is_correct": true,  "score_koef": 1.0, "mark": "1",
                "feedback": "Správně! Čitatel nahoře = 5, jmenovatel dole = 7.",
                "go_to": "s4" },
              { "id": "b", "text": "Čitatel je 7, jmenovatel je 5",
                "is_correct": false, "mark": "4",
                "feedback": "Pozor — prohodil/a jsi je. Které číslo je ve zlomku nahoře?",
                "go_to": "s3" },
              { "id": "c", "text": "Čitatel je 5, jmenovatel je 12",
                "is_correct": false, "mark": "5",
                "feedback": "Jmenovatel není součet — je to číslo dole, tedy 7.",
                "go_to": "L1_B2_casti" },
              { "id": "d", "text": "Nevím, potřebuji vysvětlit",
                "is_correct": false, "mark": "5",
                "go_to": "CHAT" }
            ]
          } },

        { "id": "s3", "type": "text", "order": 3,
          "content": "### Připomenutí\n\nVe zlomku $\\frac{a}{b}$:\n- **a** (nahoře) = **čitatel**\n- **b** (dole) = **jmenovatel**\n\nZkus to znovu." },

        { "id": "s4", "type": "text", "order": 4,
          "content": "Výborně! Umíš určit čitatele i jmenovatele." }
      ]
    }
  ]
}
```

**What a student experiences.** They enter with PIN `A1B2C3` (a guest is asked to sign in
first). Lesson 1 shows three cards; the middle one is tinted cream. The third is a question:
a correct first answer jumps to the congratulation step and earns the full 15 XP; the
"swapped" answer routes to a reminder and a second attempt; the badly wrong answer sends them
back to the parts-of-a-fraction block; "Nevím" opens the tutor, which already knows not to
mention common denominators in this lesson and not to hand over the answer. If they used the
hint, their score is capped at 0.75 — 11 XP, and the practice card comes back sooner. Two
blocks are flagged for Cvičení, one with weight 1.5 so it leads the queue, and both drop out
once mastery passes 0.85. The course stops awarding XP at 300, and a burst of fast random
tapping interrupts the session with the author's own message.
