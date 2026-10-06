# The AI surface

Stub. It will cover the principles, the tools, the safeguards and how to add a tool.
For now it holds the one part that exists.

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
