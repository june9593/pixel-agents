# Plan B — Integration Surface Analysis

## How pixel-agents currently watches Claude

### File watching (`fileWatcher.ts`)
- Locates JSONL at `~/.claude/projects/<project-hash>/<session-id>.jsonl`
  where `project-hash` replaces `:`, `\`, `/` with `-` in the workspace path.
- Hybrid `fs.watch` + 2s polling backup (Windows `fs.watch` unreliable).
- Reads file from last known `fileOffset`, buffers partial lines across reads.
- Detects `/clear` by noticing a new JSONL file for the same session UUID.

### Transcript parsing (`transcriptParser.ts`)
Consumes raw JSONL lines and emits typed webview messages:

| JSONL record | Emitted message |
|---|---|
| `assistant` with `tool_use` block | `agentToolStart` |
| `user` with `tool_result` block | `agentToolDone` (300ms delayed) |
| `system { subtype:"turn_duration" }` | clears all tool state → `agentStatus: idle` |
| `progress { data.type:"agent_progress" }` | sub-agent `agentToolStart/Done` |
| `progress { data.type:"bash_progress" \| "mcp_progress" }` | resets permission timer |
| 5s silence after text-only content | `agentStatus: waiting` (text-idle timer) |

### Agent lifecycle (`agentManager.ts`)
- `agentCreated`: triggered immediately when `+Agent` opens a terminal running `claude --session-id <uuid>`.
- 1s poll until `<uuid>.jsonl` appears → file watching starts.
- `agentClosed`: terminal dispose event.
- Terminal adoption: 1s scan for orphaned JSONL files → reassign to focused agent.

---

## What pixel-agents needs from OpenClaw

### File path
- Claude: `~/.claude/projects/<hash>/<sessionId>.jsonl` — one file per session.
- OpenClaw: `~/.openclaw/state/agents/<agentId>/sessions/<sessionId>.jsonl` — same pattern but two levels deep (`agentId` + `sessionId`).
- The session store at `…/sessions/sessions.json` maps session keys to `{sessionId, sessionFile}` — useful for discovery.

### Line format
OpenClaw transcript lines (`src/config/sessions/transcript.ts`):
```json
{"id":"<msgId>","message":{"role":"assistant","content":[{"type":"text","text":"…"}],"api":"openai-responses","provider":"…","model":"…","usage":{…},"stopReason":"stop","timestamp":<ms>}}
```
- No `type` field at the top level (Claude uses `{"type":"assistant",…}`).
- No `tool_use` / `tool_result` blocks in the Pi agent format — tool activity is opaque in the transcript; it is only surfaced via ACP streaming events.
- No `system { subtype:"turn_duration" }` analogue in the JSONL.
- Turn boundaries must be inferred from `stopReason:"stop"` or ACP events.

### Lifecycle events
pixel-agents needs these signals:
1. **Agent born** — a new OpenClaw session starts (character should spawn).
2. **Tool active** — agent is using a tool (character animates: type/read).
3. **Tool done** — tool result received (animation winds down).
4. **Turn complete** — assistant finished its reply (character idles).
5. **Waiting / permission needed** — agent is blocked (speech bubble).
6. **Agent gone** — session ends or is aborted (character despawns).

---

## Gap analysis

| Need | Claude JSONL | OpenClaw JSONL | Gap |
|---|---|---|---|
| Tool start/done | `tool_use` / `tool_result` blocks | Not in JSONL | **Missing** — must use ACP events |
| Turn end | `system{turn_duration}` | `stopReason:"stop"` in message | Workable via JSONL polling |
| Sub-agent events | `progress{agent_progress}` | Sub-agents get their own sessions | Different model (separate files vs inline) |
| Session discovery | 1s poll for `<uuid>.jsonl` | `sessions.json` store + `sessions.*` RPC | Richer discovery via Gateway RPC |
| `/clear` detection | New JSONL file same UUID | `sessions_compact` RPC or new session key | Different mechanism |
| Permission waiting | 5s text-idle timer | Unknown — no `bash_progress` equivalent | May need ACP `tool_pending` event |
| Agent identity | terminal UUID = session UUID | `agentId` + `sessionId` both needed | Two-level key instead of one |

**Root gap**: OpenClaw's JSONL is a message store, not a tool-activity log. Tool-level granularity only exists on the ACP event stream.

---

## Recommended integration point

### Verdict: ACP client (Path 1) as primary, Gateway RPC for session discovery

**ACP client** (`openclaw acp` bridge mode):
- `openclaw acp` exposes an OpenClaw session as an ACP server on a local socket.
- pixel-agents connects via `@agentclientprotocol/sdk` and receives structured events:
  `tool_use_start`, `tool_use_end`, `turn_start`, `turn_end`, `session_end`.
- Covers all harnesses OpenClaw spawns (Claude Code via ACP, Codex, Pi) uniformly.
- Maps cleanly onto existing webview messages without new message types.
- One connection per active session; teardown on `session_end` handles despawn.

**Gateway RPC** (`openclaw gateway` HTTP/WS on port 18789) for session discovery only:
- `sessions.list` → enumerate running `agentId`/`sessionId` pairs on startup.
- Subscribe to `session_created` / `session_closed` gateway events for lifecycle.
- Avoids polling `sessions.json` and handles multi-agent fan-out naturally.

**Why not JSONL watching alone**:
- No tool events in the file — watching gives turn-level data only.
- Would require re-implementing the text-idle heuristic with no `turn_duration` signal.
- Polling `sessions.json` for discovery is brittle vs. gateway subscription.

**Why not Gateway RPC alone**:
- Full tool-level granularity requires ACP stream; gateway methods expose session metadata, not per-tool events.

### Integration seam in pixel-agents
Introduce `src/openclawAdapter.ts` alongside existing `fileWatcher.ts` / `transcriptParser.ts`:
- Implements same interface: `startWatching(agentId) → { stop() }`, emits same `AgentEvent` union.
- `agentManager.ts` selects adapter based on a `source: "claude" | "openclaw"` field on `AgentState`.
- No changes to webview-side message protocol or renderer.
