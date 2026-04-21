# OpenClaw fixtures

**Synthesized** representative `chat.history` responses, hand-authored to match
the OpenClaw Gateway protocol shape. We do **not** commit real captures —
this is an open-source repo and real captures contain user-specific session
keys, agent IDs, and conversation content.

The gateway protocol returns Anthropic-style messages with `role` and
`content` (string or array of typed blocks: `text`, `tool_use`, `tool_result`,
`thinking`). All IDs in fixtures are anonymous (`toolu_01ABCxyz`,
`toolu_LIST_01`, etc.); all conversation content is generic.

## Adding a new fixture

1. Identify the protocol-shape variant you need to cover (see schema reference
   below).
2. Hand-write a JSON file with the literal `{ messages, thinkingLevel? }` shape.
3. Use anonymous tool IDs and generic content — never paste real captures.
4. Add a test in `web/src/watchers/openclawTranslator.test.ts` that loads the
   fixture and asserts the expected `PixelMessage[]` output.

Source of truth for the message shape: `~/tmp_openclaw/src/tui/tui-formatters.ts`
(see `extractContentFromMessage`, `extractTextBlocks`, and the `assistant`
branches), and `~/tmp_openclaw/src/tui/gateway-chat.ts:loadHistory()` which
calls `chat.history` and returns `{messages, thinkingLevel}`.

`session.message` events themselves carry only `{sessionKey}` (see
`~/tmp_openclaw/ui/src/ui/app-gateway.sessions.node.test.ts`). Consumers must
follow up with a `chat.history` RPC to fetch the actual transcript.

## Files

- `text-only.json` — pure text turn
- `tool-use.json` — assistant invokes a single tool
- `tool-result.json` — assistant + tool_use, then tool_result, then text reply
- `multi-block.json` — assistant message with text + multiple tool_uses in one content array
- `mixed-with-thinking.json` — includes a `thinking` block (must be ignored)

Each `chat.history`-shaped file above is the literal `chat.history` response:
`{ messages: [...], thinkingLevel?: string }`.

## `health` event + `sessions.list` fixtures (YUE-94)

Verified live against deployed gateway v2026.3.3 (2026-04-21). Schemas
documented in `/tmp/openclaw-inventory.md`. Synthesized only — never real captures.

- `health-payload.json` — **array** of `health.payload` variants. Each variant
  has a `_variant` description field (ignored by code) plus `agents[]` and
  `sessions{}`. Variants: single agent + single session; single agent + 3
  sessions (cron + direct); two agents (one with empty `recent`); agent with
  empty name (must be skipped + warned by translator).
- `sessions-list-response.json` — **array** of `sessions.list` payload variants.
  Each variant has a `_variant` field plus `sessions[]`. Variants: with `label`
  fields populated; without `label` fields.

Tests load by index, e.g. `loadFixture('health-payload.json')[0]`.
