# The AI surface

How an AI helper reads, tests and edits a course in the editor, and what stops it doing
harm. The reasoning and the rejected alternatives are in `DECISIONS.md`, "Round 14 — AI
tool layer"; what is not built is `OPEN-PROBLEMS.md` 50 to 52.

```
src/lib/screen/        the screen model: what the teacher sees, as data
src/lib/agent/
  tool.ts              defineTool, converters (MCP, strict function), executeTool
  catalog.ts           the definitions: names, descriptions, zod schemas, annotations
  handlers.ts          the code of every tool, over an AgentContext
  simulation.ts        the simulator tools
  context.ts           AgentContext, and createHeadlessContext(store, {confirm})
  card-content.ts      interim: a card's fields as the mode shows them
  server-prompt.ts     the system prompt (Czech) and the catalogue the server offers
src/lib/domain/simulate.ts   the pupil simulator
src/lib/server/ai/     the provider adapter
```

## Principles

1. **What the AI is told is what the teacher sees.** A read tool returns the screen
   model's regions copied as JSON (`screenSlice`), not a description of them. What it must
   add is named: `not_open` (a lesson or card that is not open), `hidden_in_mode` (a field
   the mode does not show), `visibility` on an issue (`shown`, `pending_timing`,
   `held_back`), `simulace: true`, and addresses (`paths`, `address`) that are not content.
   There is never a silent superset.
2. **One door for writes.** Every write is `store.apply` inside `store.transaction(fn,
   {origin: 'ai'})`: the same validation, view-to-source sync and id reservations as the
   teacher's edit.
3. **One action, one undo entry.** A batch is one action and rolls back whole.
4. **The model proposes, the code enforces.** Every rule below is in code and tested; the
   system prompt says it so the model does not waste calls.
5. **Course content is data.** Teacher text is returned in labelled fields and never read
   as an instruction.

## Tools

| Group | Tool | Gate |
|---|---|---|
| Read | `get_screen(region)`, `get_outline(lesson?)`, `get_card(path)`, `search_text(query)`, `get_course_totals` | read only |
| Test | `list_issues(severity?)` | read only |
| Test (simulation) | `simulate_start`, `simulate_answer`, `simulate_state`, `explore_paths` | read only; results are `simulace: true` |
| Show | `show_in_preview(path, view)` | read only (moves the teacher's selection, not the course) |
| Edit | `set_field`, `add_lesson`, `add_card`, `add_step`, `add_option`, `duplicate`, `move`, `reorder`, `rename`, `set_question_type`, `set_topics`, `set_prerequisites` | revision, mode, ids, size; `set_question_type` asks when answers would be dropped |
| Edit | `apply_batch(ops)` | up to 50 operations, one undo entry; asks over 20 |
| Delete | `plan_delete(path)`, `delete(path, repairs)` | `delete` is destructive: always asks |
| Safety | `list_ai_actions`, `undo_last_ai_action`, `revert_ai_session` | undo only the AI's last change; revert is destructive: always asks |

Paths are `refToJsonPath` strings: `$.lessons[lesson_id=L1]`,
`$.blocks[block_id=B1].steps[id=s2].question.options[id=a]`, with a field name last for a
field (`….content`). A card is addressed as `$.blocks[…]`; `$.lessons[…].blocks[…]` is its
place in one lesson (to move it, or take it out of the lesson).

**Never exposed:** export, publish, import, saving or restoring a version, visibility,
switching the editing mode.

A tool answers `{ok: true, data, text}` or `{ok: false, error: {code, message}}` and
never throws. `message` is Czech. Codes: `bad_arguments`, `stale`, `declined`, `mode`,
`refused`, `not_found`, `bad_path`, `too_large`, `no_session`, `unknown_tool`, `internal`.

## Safeguards

| Safeguard | Where | What it does |
|---|---|---|
| Revision | `DocStore.revision`, `executeTool` | Grows on every change to the document and on a mode switch. A write names the revision it read (`expected_revision`); a stale one is `stale` and nothing is asked or applied. |
| Mode | `allowField` in `handlers.ts`, `ui/fields.ts` | A field the mode (or the Zpětná vazba toggle) hides is refused with the sentence `modeGain` gives the dialogs, naming the mode needed. The AI never switches it. |
| Ids | `allowField`, `setField` | `course_id`, `lesson_id`, `block_id` and step and answer `id` are never written. |
| Own tool | `ROUTED` in `handlers.ts` | The question type, topics and prerequisites are refused by `set_field` and named to their tool. |
| Confirmation | `executeTool`, `ctx.confirm` | `delete`, `revert_ai_session`, a type change that drops written answers, a batch of more than 20 operations. A decline is `declined` and changes nothing. |
| Atomicity | `store.transaction` | One undo entry with `origin: 'ai'` and an `actionId`; any failure restores document, undo log, reservations, selection and revision. |
| Checkpoint | `beginAiSession`, `revertAiSession` | The first real AI change snapshots the course and the reserved ids, and saves one durable version "Před úpravami AI" if the course has unsaved work (`onBeforeAiSession`). The revert is one ordinary undoable entry; ids stay reserved. |
| Report | `runWrite` | Every write returns its Czech description, the path, the new revision, `operations`, and the `validationDelta` (new and resolved errors and warnings; a new one as the screen lists it). New errors are reported, not blocked. |
| Size | `limits` in `context.ts` | Text at most 20 000 characters, a batch at most 50 operations, lists cut with `truncated`. |
| Content as data | result field names, `SYSTEM_PROMPT` | `course_content` and `course_text`, and a note saying so. |

## How to add a tool

1. **Define it** in `catalog.ts` with `defineSpec`: `name`, Czech `title` and
   `description` (what it does, when to use it, what it returns), a `z.strictObject`
   input, an optional output, and `annotations` (`READ`, `EDIT`, `SET` for idempotent,
   `DESTRUCTIVE`). Every property is required; make an optional one `.nullable()`. A
   write tool also has `expected_revision`. An edit operation goes into `OPS` (its
   arguments, which `apply_batch` reuses as an entry) and gets a `writeSpec` line in
   `TOOL_SPECS`.
2. **Implement it** in `handlers.ts`: the `IMPLS` map must have it (a type error says so).
   - A read tool answers from `ctx.screen()` / `ctx.screenAt()` and returns a slice
     verbatim. If it needs something that is not on screen, name it in the result.
   - A write tool is an `EditOp` in `EDIT_OPS` (`check`, `describe`, optional `confirm`,
     `run`) and is `single(name)` in `IMPLS`. It writes with `w.apply(command)`, the same command the component
     calls. It never touches `store.source`.
   - A `destructiveHint` tool must return a `confirm`.
3. **Test it** in `handlers.test.ts`: the tool runs on every fixture; a read equals the
   screen; the safeguards that apply (stale, mode, declined) have a case. The catalogue
   tests convert it to MCP and a strict function for you.
4. If it changes what the model should do, say so in `SYSTEM_PROMPT` (the test checks every
   tool name the prompt uses exists).

## Provider configuration

The in-app chat is served by the editor's server at `POST /ai/chat`, and talks to any
OpenAI-compatible provider. It is read from the environment (`$env/dynamic/private`),
so nothing is baked into the build. With no `AI_API_KEY` the route answers 503 and the
chat is off.

| Variable | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `openrouter` | `openrouter` or `deepseek` |
| `AI_API_KEY` | none | the provider's key; required |
| `AI_MODEL` | `deepseek/deepseek-v4.1-flash` (OpenRouter), `deepseek-flash` (DeepSeek) | model id |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1`, `https://api.deepseek.com` | endpoint override |
| `AI_REASONING_EFFORT` | `high` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; DeepSeek knows only `high` and `max` (`none` turns thinking off) |
| `AI_DAILY_TOKEN_BUDGET` | `2000000` | tokens per owner per UTC day |
| `AI_MAX_REQUESTS_PER_MINUTE` | `20` | requests per owner per minute |

OpenRouter requests carry `provider: {require_parameters: true, data_collection:
'deny'}`. Where teacher content is processed is an open question:
`OPEN-PROBLEMS.md` 47. The reasoning for the design is in `DECISIONS.md`, Round 14.

nginx sends `/ai/` to the editor with buffering off, because the answer is a stream.
