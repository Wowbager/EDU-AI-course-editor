# The AI surface

How an AI helper reads, tests and edits a course in the editor, and what stops it doing
harm. The reasoning and the rejected alternatives are in `DECISIONS.md`, "Round 14 — AI
tool layer"; what is not built is `OPEN-PROBLEMS.md` 50, 52 and 53 to 56.

```
src/lib/screen/        the screen model: what the teacher sees, as data
src/lib/agent/
  chat.svelte.ts       ChatSession: the browser's chat loop
  chat-transport.ts    POST /ai/chat and its server-sent events
  tool.ts              defineTool, converters (MCP, strict function), executeTool
  catalog.ts           the definitions: names, descriptions, zod schemas, annotations
  handlers.ts          the code of every tool, over an AgentContext
  simulation.ts        the simulator tools
  context.ts           AgentContext, and createHeadlessContext(store, {confirm})
  card-content.ts      interim: a card's fields as the mode shows them
  server-prompt.ts     the system prompt (Czech) and the catalogue the server offers
src/lib/state/ai-state.svelte.ts          what the drawer shows (store.ai)
src/lib/state/agent-context.svelte.ts     the browser AgentContext, "Vrátit až sem"
src/lib/editor/AiPanel.svelte, AiConfirmDialog.svelte
evals/agent/           the eval suite (run by hand)
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

## The chat loop and the drawer

`ChatSession` (`agent/chat.svelte.ts`) is the browser's loop; the page and the eval suite
use the same class and differ only in the transport (`httpTransport` against
`POST /ai/chat`, or the provider adapter directly).

1. The teacher's message is appended to the history, which is append-only and
   provider-neutral (`protocol.ts`). Each assistant turn keeps its `reasoning` exactly as
   the provider returned it and sends it back on every later turn. The reasoning is never
   shown; the drawer says "Přemýšlí…" while the model has said nothing.
2. The answer streams into one bubble. On tool calls each one is run by `runTool`
   (JSON parse and zod validation are `executeTool`'s; a bad call is an error result the
   model reads) and answered by one `tool` message per call id. Then the loop asks again.
3. At most `limits.maxToolRounds` (40) requests per message of the teacher's; then a note
   in Czech and a stop, with every call answered so the history stays valid.
4. **Zastavit** aborts the request. A tool already running finishes, nothing starts
   after it, calls not yet run get a "stopped" result, and a question to the teacher
   that is open is answered "no".
5. If `store.revision` moved since the AI last finished (the teacher edited), a `notice`
   message "Učitel mezitím upravil kurz; čti znovu, než něco změníš." precedes the next
   message. The revision check on every write is the real guard; the notice saves a call.
6. A tool name the server does not know is dropped from the history and the model is
   told, because the server would otherwise refuse the whole conversation from then on.
7. `length` with no tool call ends the turn with a note; a truncated tool call fails its
   JSON parse and the model sees that.
8. Errors are the Czech sentence the server sent (`error` event, or the JSON of a refusal).
   The history lives for the page session only; opening another course starts a new one.

The drawer (`AiPanel.svelte`, opened from "AI asistent" in the top bar; the label gives
way to the icon below 1360 px) shows the conversation, the action log (`store.aiActions`,
each with "Ukázat" and "Vrátit až sem"), "Vrátit změny AI" and the input. Its state is
the `ai` region of the screen model (`store.screen.ai`), with `data-screen` paths like the
other regions; the agent does not get `ai` through `get_screen`. The confirmation dialog
(`AiConfirmDialog.svelte`: "Povolit" / "Nepovolit", Escape is "no") is drawn whether or
not the drawer is open. The checkpoint version "Před úpravami AI" is saved only when the
course differs from the newest saved version; a failure is said in a notice, never
swallowed. `GET /ai/chat` answers `{configured}` and nothing else; unconfigured, the button
says "AI není nastavena" and is disabled.

## Evals

`npm run eval:agent` runs `evals/agent/` against the configured provider. It needs
`AI_API_KEY` (environment or `.env`); without one it runs nothing. It is not in CI and not
in `npm test`. `EVAL_ONLY=id,id` runs some scenarios. Run it before changing the model,
the provider, the system prompt or a tool description, and record the scores in
`DECISIONS.md`.

Each scenario (`scenarios.ts`) is a corpus fixture (sometimes damaged on purpose), a mode,
the teacher's messages, an auto-approving or auto-declining confirmation, and a grader.
There are twelve: fixing errors, adding an option with feedback, a pupil walk, renaming,
a delete declined and a delete approved, a prompt injection in a step (read and edit), a
teacher edit between the AI's last read and its first write, a field the mode hides,
undo, and a batch of renames. `harness.ts` adds to every one: no id, path or argument
name in what the teacher is told, the round limit not hit, and `revert_ai_session` giving
the start back byte for byte. Grading is code only, never another model. Results (every
check, tools called, what was asked and said, token use with the cached part) go to
`evals/agent/results/` (ignored) as JSON and `latest.md`.

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
| `AI_OPENROUTER_PROVIDERS` | none | OpenRouter hosts to try first, comma separated (`DeepInfra`); see below |
| `AI_REASONING_EFFORT` | `high` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; DeepSeek knows only `high` and `max` (`none` turns thinking off) |
| `AI_DAILY_TOKEN_BUDGET` | `2000000` | tokens per owner per UTC day |
| `AI_MAX_REQUESTS_PER_MINUTE` | `20` | requests per owner per minute |

OpenRouter requests carry `provider: {require_parameters: true, data_collection:
'deny'}`. Where teacher content is processed is an open question:
`OPEN-PROBLEMS.md` 47. The reasoning for the design is in `DECISIONS.md`, Round 14.

**Pin the host.** Without `AI_OPENROUTER_PROVIDERS` OpenRouter picks a host per request,
and consecutive turns of one conversation went to Together, AtlasCloud and DeepInfra: the
prompt (about 9 500 tokens before the conversation starts) was never cached, and the same
request cost twelve times more on one host than another. Pinned to one host, 99 percent
of it was served from that host's cache. The others stay a fallback. Which hosts are
acceptable is a data-protection decision (`OPEN-PROBLEMS.md` 47).

nginx sends `/ai/` to the editor with buffering off, because the answer is a stream.
